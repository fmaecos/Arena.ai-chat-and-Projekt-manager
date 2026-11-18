import { createServer } from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { AppError, decodeData, EXTENSION_ORIGIN, localUrl, MAX_FILE, normalizeCapture, PORT, text } from './domain.mjs';
import { Store } from './store.mjs';
import { Channel } from './channel.mjs';
import { seedDemo } from './demo.mjs';
import { answerAssistant, transcribe } from './assistant.mjs';
import { ArchiveAgent } from './archive-agent.mjs';
import { demoAgentServices, demoScope } from './demo-agent.mjs';

const isToken = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
const secret = (req) => typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer /, '') : '';
const send = (res, status, data) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};

async function json(req, limit = 100_000) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'JSON erwartet.');
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw new AppError(413, 'Die Anfrage ist zu groß.'); }
  let size = 0;
  const parts = [];
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    size += part.length;
    if (size > limit) { req.resume(); throw new AppError(413, 'Die Anfrage ist zu groß.'); }
    parts.push(part);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch { throw new AppError(400, 'Ungültige JSON-Daten.'); }
}

export function createApi({ filename = ':memory:', demo = false, desktopToken = '', fetcher = fetch, port = PORT } = {}) {
  const store = new Store(filename, { demo });
  const channel = new Channel(demo);
  if (demo) seedDemo(store, channel);
  const agent = new ArchiveAgent(store, channel, fetcher, demo ? demoAgentServices() : undefined);
  let assistantRequests = 0;
  let transcriptionRequests = 0;
  const paired = () => Boolean(store.setting('extensionOrigin'));
  async function speech(input) {
    if (transcriptionRequests >= 1) throw new AppError(429, 'Eine Aufnahme wird bereits verarbeitet.');
    transcriptionRequests++;
    try { return await transcribe(store, input, fetcher); } finally { transcriptionRequests--; }
  }

  const handler = async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://local').pathname;
      const method = req.method;
      const origin = req.headers.origin;
      if (!pathname.startsWith('/api/') || (!demo && req.headers.host !== `127.0.0.1:${port}`)) throw new AppError(404, 'Nicht gefunden.');
      const extension = pathname.startsWith('/api/extension/');
      if (extension) {
        if (demo) throw new AppError(404, 'Die Erweiterung ist nur im Desktop verfügbar.');
        if (origin && !EXTENSION_ORIGIN.test(origin)) throw new AppError(403, 'Nur die Chrome-Erweiterung kann sich verbinden.');
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        if (method === 'OPTIONS' && origin) {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Kontext-Extension-Id', 'Access-Control-Allow-Private-Network': 'true' });
          return res.end();
        }
        const id = req.headers['x-kontext-extension-id'];
        const extensionOrigin = `chrome-extension://${id || ''}`;
        if (method !== 'POST' || !EXTENSION_ORIGIN.test(extensionOrigin) || (origin && origin !== extensionOrigin)
          || !isToken(secret(req), store.setting('pairingCode'))) throw new AppError(401, 'Der Kopplungscode ist ungültig.');
        const savedOrigin = store.setting('extensionOrigin');
        if (savedOrigin && savedOrigin !== extensionOrigin) throw new AppError(403, 'Es ist eine andere Erweiterung gekoppelt. Erneuere zuerst den Code.');
        if (pathname === '/api/extension/hello') {
          await json(req, 1024);
          // Recheck after reading the body so a token rotated during the request cannot bind an old client.
          if (!isToken(secret(req), store.setting('pairingCode')) || (store.setting('extensionOrigin') && store.setting('extensionOrigin') !== extensionOrigin)) {
            throw new AppError(401, 'Der Kopplungscode ist nicht mehr gültig.');
          }
          store.setSetting('extensionOrigin', extensionOrigin);
          channel.seen();
          return send(res, 200, { paired: true });
        }
        if (!savedOrigin) throw new AppError(401, 'Kopple die Erweiterung zuerst.');
        const endpoint = pathname.slice('/api/extension/'.length);
        const limit = endpoint === 'agent/transcribe' ? 9 * 1024 * 1024
          : ['snapshot', 'agent/tool-result'].includes(endpoint) ? 5_000_000 : endpoint.startsWith('agent/') ? 80_000 : 2000;
        const body = await json(req, limit);
        if (!isToken(secret(req), store.setting('pairingCode'))) throw new AppError(401, 'Der Kopplungscode ist nicht mehr gültig.');
        if (pathname === '/api/extension/snapshot') {
          channel.setLive(normalizeCapture(body));
          return send(res, 200, { accepted: true });
        }
        if (pathname === '/api/extension/poll') return send(res, 200, { commands: await channel.poll(res) });
        if (pathname === '/api/extension/ack') {
          channel.acknowledge(body.id, body.ok, body.note);
          return send(res, 200, { accepted: true });
        }
        if (endpoint === 'agent/tool-result') {
          channel.answerAgentTool(body.id, body.ok, body.note, body.result);
          return send(res, 200, { accepted: true });
        }
        if (endpoint === 'agent/state') return send(res, 200, { run: agent.state(), voice: { mode: store.settings().speechMode, speak: store.settings().speakReplies, autoSend: store.settings().voiceAutoSend } });
        if (endpoint === 'agent/start') return send(res, 202, agent.start(body));
        if (endpoint === 'agent/revise') return send(res, 202, agent.revise(body));
        if (endpoint === 'agent/approve') return send(res, 202, agent.approve(body));
        if (endpoint === 'agent/pause') return send(res, 200, agent.pause(body));
        if (endpoint === 'agent/resume') return send(res, 202, agent.resume(body));
        if (endpoint === 'agent/talk') return send(res, 200, await agent.talk(body));
        if (endpoint === 'agent/transcribe') return send(res, 200, await speech(body));
        if (pathname === '/api/extension/disconnect') {
          agent.disconnect('Die Chrome-Erweiterung wurde entkoppelt.');
          store.rotatePairing();
          channel.reset();
          return send(res, 200, { accepted: true });
        }
        throw new AppError(404, 'Nicht gefunden.');
      }
      if (!demo && (origin || !isToken(secret(req), desktopToken))) throw new AppError(401, 'Die Anfrage benötigt den lokalen Desktop-Zugriff.');
      const reply = (value, status = 200) => send(res, status, value);
      const body = (limit) => json(req, limit);
      if (method === 'GET' && pathname === '/api/bootstrap') {
        return reply({ demo, chats: store.chats(), projects: store.projects(), files: store.files(), settings: store.settings(), browser: channel.state(paired()) });
      }
      if (method === 'GET' && /^\/api\/live(?:\/[a-f0-9-]{36})?$/.test(pathname)) {
        const state = channel.state(paired());
        if (state.live && pathname === `/api/live/${state.live.revision}`) return reply({ ...state, live: undefined, unchanged: true });
        return reply(state);
      }
      if (method === 'GET' && pathname === '/api/settings') return reply(store.settings(true));
      if (method === 'PATCH' && pathname === '/api/settings') {
        const input = await body();
        const changes = {};
        for (const key of ['speakReplies', 'voiceAutoSend']) if (key in input) changes[key] = input[key] === true ? 'true' : 'false';
        if (['browser', 'local'].includes(input.speechMode) && (!demo || input.speechMode === 'browser')) changes.speechMode = input.speechMode;
        if (!demo) {
          for (const name of ['ollamaUrl', 'whisperUrl']) if (name in input) changes[name] = localUrl(input[name]);
          if ('model' in input) changes.model = text(input.model, 100);
        }
        for (const [name, value] of Object.entries(changes)) store.setSetting(name, value);
        return reply(store.settings(true));
      }
      if (method === 'POST' && pathname === '/api/settings/ollama-test') {
        if (demo) throw new AppError(409, 'Ollama kann nur im Desktop verbunden werden.');
        const input = await body();
        const endpoint = localUrl(input.ollamaUrl);
        if (!endpoint) throw new AppError(400, 'Gib die Ollama-Adresse ein.');
        try {
          const result = await fetcher(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3500), redirect: 'error' });
          if (!result.ok) throw Error();
          const models = (await result.json()).models;
          return reply({ models: Array.isArray(models) ? models.slice(0, 80).map((model) => text(model.name, 100)).filter(Boolean) : [] });
        } catch { throw new AppError(502, 'Ollama antwortet nicht. Läuft der Dienst an dieser Adresse?'); }
      }
      if (method === 'POST' && pathname === '/api/pairing/rotate') {
        if (demo) throw new AppError(409, 'Kopplung gibt es nur im Desktop.');
        agent.disconnect('Die Chrome-Kopplung wurde erneuert.');
        store.rotatePairing();
        channel.reset();
        return reply(store.settings(true));
      }
      if (method === 'POST' && pathname === '/api/search') {
        const search = text((await body()).query, 240).toLowerCase();
        if (!search) return reply({ chats: [], projects: [], files: [] });
        const words = search.split(/\s+/);
        const like = words.map((word) => `%${word.replace(/[\\%_]/g, '\\$&')}%`);
        const clauses = like.map(() => "(unicode_lower(title || ' ' || messages) LIKE ? ESCAPE '\\')").join(' AND ');
        const ids = new Set(store.db.prepare(`SELECT id FROM chats WHERE ${clauses} ORDER BY updated_at DESC LIMIT 12`).all(...like).map((row) => row.id));
        const contains = (value) => words.every((word) => value.toLowerCase().includes(word));
        return reply({ chats: store.chats().filter((chat) => ids.has(chat.id)), projects: store.projects().filter((p) => contains(`${p.name} ${p.description}`)).slice(0, 8),
          files: store.files().filter((file) => contains(file.path)).slice(0, 12) });
      }
      if (method === 'GET' && pathname === '/api/snippets') {
        const rows = store.db.prepare(`SELECT c.id AS chatId, c.title, c.project_id AS projectId, m.key AS messageIndex,
          b.key AS blockIndex, json_extract(b.value, '$.language') AS language FROM chats c,
          json_each(c.messages) m, json_each(m.value, '$.blocks') b WHERE json_extract(b.value, '$.type')='code'
          ORDER BY c.updated_at DESC, m.key, b.key LIMIT 500`).all();
        return reply(rows);
      }
      if (method === 'POST' && pathname === '/api/chats') {
        const input = await body();
        const live = channel.live;
        if (!live || live.revision !== input.revision) throw new AppError(409, 'Der Live-Chat hat sich geändert. Öffne den Speicherdialog erneut.');
        return reply(store.saveChat(live, input), 201);
      }
      const version = pathname.match(/^\/api\/chats\/([\w-]+)\/versions(?:\/([\w-]+))?$/);
      if (method === 'GET' && version) return reply(version[2] ? store.archiveVersion(version[1], version[2]) : store.archiveVersions(version[1]));
      const chatId = pathname.match(/^\/api\/chats\/([\w-]+)$/)?.[1];
      if (chatId) {
        if (method === 'GET') return reply(store.chat(chatId));
        if (method === 'PATCH') return reply(store.editChat(chatId, await body()));
        if (method === 'DELETE') { store.deleteChat(chatId); return reply({ deleted: true }); }
      }
      if (method === 'POST' && pathname === '/api/projects') {
        if (demo && store.projects().length >= 60) throw new AppError(413, 'Das Projektlimit der Demo ist erreicht.');
        return reply(store.saveProject(await body()), 201);
      }
      const project = pathname.match(/^\/api\/projects\/([\w-]+)(\/export)?$/);
      if (project) {
        const [, id, exportSuffix] = project;
        if (method === 'GET' && exportSuffix) return reply(store.exportProject(id));
        if (method === 'PATCH' && !exportSuffix) { store.project(id); return reply(store.saveProject(await body(), id)); }
        if (method === 'DELETE' && !exportSuffix) { store.deleteProject(id); return reply({ deleted: true }); }
      }
      if (method === 'POST' && pathname === '/api/files') {
        const input = await body(17 * 1024 * 1024);
        return reply(store.addFile(input, decodeData(input.data, MAX_FILE)), 201);
      }
      const fileId = pathname.match(/^\/api\/files\/([\w-]+)$/)?.[1];
      if (fileId) {
        if (method === 'GET') return reply(store.file(fileId));
        if (method === 'PATCH') return reply(store.editFile(fileId, await body()));
        if (method === 'DELETE') { store.deleteFile(fileId); return reply({ deleted: true }); }
      }
      if (method === 'POST' && pathname === '/api/browser/commands') return reply(channel.enqueue(await body()), 201);
      const commandId = pathname.match(/^\/api\/browser\/commands\/([\w-]+)$/)?.[1];
      if (method === 'GET' && commandId) return reply(channel.command(commandId));
      if (method === 'POST' && pathname === '/api/assistant') {
        if (assistantRequests >= 2) throw new AppError(429, 'Der Assistent beantwortet gerade andere Anfragen.');
        assistantRequests++;
        try { return reply(await answerAssistant(store, channel, await body(), fetcher)); } finally { assistantRequests--; }
      }
      if (method === 'POST' && pathname === '/api/transcribe') return reply(await speech(await body(9 * 1024 * 1024)));
      if (method === 'GET' && pathname === '/api/agent') return reply({ run: agent.state() });
      if (method === 'POST' && pathname === '/api/agent/pause') return reply(agent.pause(await body()));
      if (method === 'POST' && demo) {
        if (pathname === '/api/agent/start') return reply(agent.start({ ...await body(), scope: demoScope }), 202);
        if (pathname === '/api/agent/approve') return reply(agent.approve({ ...await body(), scope: demoScope }), 202);
        if (pathname === '/api/agent/resume') return reply(agent.resume({ ...await body(), scope: demoScope }), 202);
        if (pathname === '/api/agent/revise') return reply(agent.revise(await body()), 202);
      }
      throw new AppError(404, 'Nicht gefunden.');
    } catch (error) {
      if (!(error instanceof AppError) && !res.destroyed) console.error('Kontext API:', error);
      send(res, error.status || 500, { error: error.status ? error.message : 'Etwas ist schiefgelaufen. Versuche es erneut.' });
    }
  };
  return { handler, store, channel, agent };
}

export async function startDesktopServer(filename, port = PORT) {
  const token = randomBytes(32).toString('base64url');
  const api = createApi({ filename, desktopToken: token, port });
  const server = createServer({ requestTimeout: 150_000, headersTimeout: 10_000 }, api.handler);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) { api.store.close(); throw error; }
  return { token, stop: () => {
    api.agent.disconnect('Der Desktop wurde beendet.');
    api.channel.reset();
    server.close(() => api.store.close());
    server.closeAllConnections();
  } };
}
