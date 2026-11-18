import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';
import { Store } from '../server/store.mjs';

const desktopToken = 'private-desktop-token-test';
const ext = 'a'.repeat(32);
const origin = `chrome-extension://${ext}`;
const sample = {
  tab: { id: 14, windowId: 2, url: 'https://chatgpt.com/c/example', title: 'Testchat' },
  chat: { title: 'Testchat', messages: [
    { id: 'u', role: 'user', blocks: [{ type: 'text', text: 'Wie speichere ich Daten?' }] },
    { id: 'a', role: 'assistant', blocks: [{ type: 'text', text: 'SQLite hilft bei der Archivierung.' },
      { type: 'code', language: 'sql', text: 'SELECT * FROM chats;' }, { type: 'attachment', text: 'plan.md', url: 'javascript:alert(1)' }] },
  ] },
};
let server, service, base, port, mockFetch;
beforeEach(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  mockFetch = () => { throw Error('no configured providers'); };
  service = createApi({ desktopToken, port, fetcher: (...args) => mockFetch(...args) });
  server.on('request', service.handler);
});
afterEach(async () => {
  service.channel.reset();
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  service.store.close();
});
async function call(path, method = 'GET', data, headers = {}) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${desktopToken}`, ...headers },
    body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}
const settings = async () => (await call('/settings')).data;
async function pair(code = null) {
  code ??= (await settings()).pairingCode;
  const headers = { Authorization: `Bearer ${code}`, Origin: origin, 'X-Kontext-Extension-Id': ext };
  assert.equal((await call('/extension/hello', 'POST', {}, headers)).status, 200);
  return headers;
}

test('desktop-only API, pairing, origin binding and rotation', async () => {
  assert.equal((await call('/bootstrap', 'GET', undefined, { Authorization: '' })).status, 401);
  assert.equal((await call('/bootstrap', 'GET', undefined, { Origin: 'https://example.com' })).status, 401);
  const badHost = await new Promise((resolve, reject) => get(`${base}/api/bootstrap`, {
    headers: { Host: `example.com:${port}`, Authorization: `Bearer ${desktopToken}` },
  }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(badHost, 404);
  const code = (await settings()).pairingCode;
  assert.match(code, /^[\w-]{32}$/);
  assert.equal((await call('/extension/snapshot', 'POST', sample, { Origin: origin, 'X-Kontext-Extension-Id': ext, Authorization: `Bearer ${code}` })).status, 401);
  const headers = await pair(code);
  assert.equal((await call('/extension/hello', 'POST', {}, { ...headers, Origin: 'https://chatgpt.com' })).status, 403);
  assert.equal((await call('/extension/hello', 'POST', {}, { ...headers, Origin: `chrome-extension://${'b'.repeat(32)}`, 'X-Kontext-Extension-Id': 'b'.repeat(32) })).status, 403);
  assert.equal((await call('/bootstrap', 'GET', undefined, { Authorization: headers.Authorization })).status, 401);
  const rotated = await call('/pairing/rotate', 'POST', {});
  assert.notEqual(rotated.data.pairingCode, code);
  assert.equal((await call('/extension/hello', 'POST', {}, headers)).status, 401);
  assert.equal((await call('/live')).data.connection, 'unpaired');
});

test('capture -> archive -> whole-text search, snippets, edit and deduplicate', async () => {
  const headers = await pair();
  assert.equal((await call('/extension/snapshot', 'POST', sample, headers)).status, 200);
  const live = (await call('/live')).data.live;
  assert.equal(live.messages[1].blocks[2].url, '');
  const unchanged = (await call(`/live/${live.revision}`)).data;
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.live, undefined);
  assert.equal((await call('/chats', 'POST', { revision: 'wrong' })).status, 409);
  const project = (await call('/projects', 'POST', { name: 'Prototyp', color: 'blue' })).data;
  const first = await call('/chats', 'POST', { title: 'Mein Archivchat', projectId: project.id, revision: live.revision });
  assert.equal(first.status, 201);
  assert.equal(first.data.count, 2);
  const search = await call('/search', 'POST', { query: 'SELECT chats' });
  assert.equal(search.status, 200);
  assert.equal(search.data.chats[0].id, first.data.id);
  assert.equal((await call('/search', 'POST', { query: '%' })).data.chats.length, 0);
  assert.deepEqual((await call('/snippets')).data[0], { chatId: first.data.id, title: 'Mein Archivchat', projectId: project.id, language: 'sql', messageIndex: 1, blockIndex: 1 });
  const second = await call('/chats', 'POST', { revision: live.revision });
  assert.equal(second.data.id, first.data.id);
  assert.equal(second.data.projectId, project.id);
  const rename = await call(`/chats/${first.data.id}`, 'PATCH', { title: 'Umbenannt' });
  assert.equal(rename.data.title, 'Umbenannt');
  await call('/extension/snapshot', 'POST', { tab: null }, headers);
  assert.equal((await call('/live')).data.live, null);
  assert.equal((await call(`/chats/${first.data.id}`)).data.messages.length, 2);
});

test('file bytes, project export, move and delete; project deletion keeps files', async () => {
  const project = (await call('/projects', 'POST', { name: 'Dokumente' })).data;
  const data = Buffer.from('Grüße\n').toString('base64');
  const item = await call('/files', 'POST', { path: 'src/grüße.md', mime: 'text/markdown', data, projectId: project.id });
  assert.equal(item.status, 201);
  assert.equal(item.data.size, Buffer.from(data, 'base64').length);
  assert.equal((await call('/files', 'POST', { path: '../a.txt', data })).status, 400);
  assert.equal((await call('/files', 'POST', { path: 'src/Grüße.md', data, projectId: project.id })).status, 409);
  assert.equal((await call(`/files/${item.data.id}`)).data.data, data);
  const file = (await call(`/files/${item.data.id}`, 'PATCH', { path: 'docs/planung.md' })).data;
  assert.equal(file.name, 'planung.md');
  const backup = (await call(`/projects/${project.id}/export`)).data;
  assert.equal(backup.format, 'kontext-project-v1');
  assert.equal(backup.files[0].data, data);
  await call(`/projects/${project.id}`, 'DELETE');
  assert.equal((await call(`/files/${file.id}`)).data.projectId, null);
  await call(`/files/${file.id}`, 'DELETE');
  assert.equal((await call(`/files/${file.id}`)).status, 404);
});

test('browser commands are allowlisted and delivered only after approval', async () => {
  const headers = await pair();
  await call('/extension/snapshot', 'POST', sample, headers);
  const proposed = (await call('/assistant', 'POST', { prompt: 'Öffne example.org.' })).data;
  assert.deepEqual(proposed.action, { type: 'open_tab', url: 'https://example.org/' });
  assert.equal(service.channel.commands.size, 0);
  assert.equal((await call('/browser/commands', 'POST', { type: 'execute', command: 'echo' })).status, 400);
  assert.equal((await call('/browser/commands', 'POST', { type: 'open_tab', url: 'file:///tmp/untrusted' })).status, 400);
  assert.equal((await call('/browser/commands', 'POST', { type: 'draft_text', text: 'Entwurf', revision: (await call('/live')).data.live.revision })).status, 400);
  const poll = call('/extension/poll', 'POST', {}, headers);
  const approved = (await call('/browser/commands', 'POST', proposed.action)).data;
  assert.deepEqual((await poll).data.commands, [{ id: approved.id, action: proposed.action, target: null }]);
  await call('/extension/ack', 'POST', { id: approved.id, ok: true, note: 'Geöffnet.' }, headers);
  assert.equal((await call(`/browser/commands/${approved.id}`)).data.status, 'done');
});

test('Ollama sees the live chat only on request; transcription uses localhost', async () => {
  const headers = await pair();
  await call('/extension/snapshot', 'POST', sample, headers);
  assert.equal((await call('/settings', 'PATCH', { ollamaUrl: 'https://example.org' })).status, 400);
  let request;
  mockFetch = async (url, options) => {
    request = { url, options };
    if (url.endsWith('/api/chat')) return Response.json({ message: { content: '{"reply":"Hallo","action":{"type":"execute","command":"echo"}}' } });
    return Response.json({ text: 'Das ist ein Test.' });
  };
  const normal = (await call('/assistant', 'POST', { prompt: 'Hallo' })).data;
  assert.equal(normal.reply, 'Hallo');
  assert.equal(normal.action, null);
  assert.equal(request.options.body.includes('SQLite hilft'), false);
  await call('/assistant', 'POST', { prompt: 'Fasse den Chat zusammen.' });
  assert.equal(request.options.body.includes('SQLite hilft'), true);
  const converted = await call('/transcribe', 'POST', { data: Buffer.from('fixture').toString('base64'), mime: 'audio/webm;codecs=opus' });
  assert.equal(converted.data.text, 'Das ist ein Test.');
  assert.equal(request.url, 'http://127.0.0.1:17861/v1/audio/transcriptions');
  assert.equal(request.options.headers['X-Kontext-Audio'], '1');
});

test('SQLite persistence across application restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kontext-test-'));
  try {
    const path = join(dir, 'workspace.sqlite');
    const first = new Store(path);
    const code = first.setting('pairingCode');
    const project = first.saveProject({ name: 'Beständig' });
    const file = first.addFile({ path: 'test.txt', projectId: project.id }, Buffer.from('local only'));
    first.close();
    const second = new Store(path);
    assert.equal(second.setting('pairingCode'), code);
    assert.equal(second.project(project.id).fileCount, 1);
    assert.equal(Buffer.from(second.file(file.id).data, 'base64').toString(), 'local only');
    second.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workspace instructions propose allowlisted views and seed a project dialog', async () => {
  const view = (await call('/assistant', 'POST', { prompt: 'Zeige meine Projekte.' })).data.action;
  assert.deepEqual(view, { type: 'navigate_workspace', page: 'projects' });
  const draft = (await call('/assistant', 'POST', { prompt: 'Erstelle ein Projekt namens Relaunch.' })).data.action;
  assert.deepEqual(draft, { type: 'new_project', name: 'Relaunch' });
  assert.equal((await call('/bootstrap')).data.projects.length, 0);
  assert.equal((await call('/browser/commands', 'POST', view)).status, 400);
});
