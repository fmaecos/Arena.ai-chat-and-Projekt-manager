import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi } from '../server/api.mjs';

const worker = await readFile(new URL('../extension/worker.js', import.meta.url), 'utf8');
const mockEvent = () => { let listener; return { addListener(fn) { listener = fn; }, emit: (...args) => listener?.(...args) }; };
const until = async (condition) => {
  for (let i = 0; i < 50; i++) {
    const result = condition();
    if (result) return result;
    await sleep(20);
  }
  assert.fail('Expected worker event was not delivered');
};

test('extension worker pairs, captures the active tab, runs and acknowledges approved commands', { timeout: 5000 }, async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const api = createApi({ port, desktopToken: 'test' });
  server.on('request', api.handler);
  const capturedTab = { id: 3, windowId: 1, title: 'Echte Worker-Fixture', active: true, url: 'https://chatgpt.com/c/test' };
  let activeTab = capturedTab;
  let token;
  let mirrorEnabled = false;
  let opened;
  let focused;
  t.after(async () => {
    token = undefined;
    api.channel.reset();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    api.store.close();
  });
  const id = 'c'.repeat(32);
  const chrome = {
    runtime: { id, getURL: (route) => `chrome-extension://${id}/${route}`, onMessage: mockEvent(), onStartup: mockEvent(), onInstalled: mockEvent() },
    storage: { local: { get: async () => ({ token, mirrorEnabled }), set: async (values) => {
      if ('token' in values) token = values.token; if ('mirrorEnabled' in values) mirrorEnabled = values.mirrorEnabled;
    }, remove: async () => { token = undefined; } } },
    alarms: { create() {}, onAlarm: mockEvent() },
    tabs: {
      onActivated: mockEvent(), onUpdated: mockEvent(), onRemoved: mockEvent(), query: async () => [activeTab],
      get: async () => capturedTab,
      update: async (id) => { assert.equal(id, capturedTab.id); activeTab = capturedTab; return capturedTab; },
      sendMessage: async (id, message) => {
        assert.equal(id, capturedTab.id);
        assert.equal(message.type, 'KONTEXT_CAPTURE');
        return { url: capturedTab.url, chat: { title: capturedTab.title, messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Hallo!' }] }] } };
      },
      create: async ({ url }) => { opened = url; return { id: 5, windowId: 1 }; },
    },
    windows: { onFocusChanged: mockEvent(), update: async (id, options) => { focused = id === 1 && options.focused; } },
  };
  runInNewContext(worker, { URL, AbortSignal, setTimeout, clearTimeout, chrome, fetch: (url, options) => fetch(url.replace(':17654', `:${port}`), options) });
  const popup = (type, data = {}) => new Promise((resolve) => chrome.runtime.onMessage.emit({ type, ...data }, { id, url: chrome.runtime.getURL('panel.html') }, resolve));
  assert.equal((await popup('STATUS')).paired, false);
  const oldCode = api.store.setting('pairingCode');
  assert.equal((await popup('PAIR', { code: oldCode })).connected, true);
  assert.equal(api.channel.live, null);
  assert.equal((await popup('SET_MIRROR', { enabled: true })).mirror, true);
  const live = await until(() => api.channel.live);
  assert.equal(live.title, capturedTab.title);
  const open = api.channel.enqueue({ type: 'open_tab', url: 'https://example.org' });
  await until(() => api.channel.command(open.id).status === 'done');
  assert.equal(opened, 'https://example.org/');
  assert.equal(focused, true);
  assert.throws(() => api.channel.enqueue({ type: 'draft_text', revision: live.revision, text: 'Nicht erlaubt' }), /nicht unterstützt/);
  const focus = api.channel.enqueue({ type: 'focus_chat', revision: live.revision });
  await until(() => api.channel.command(focus.id).status === 'done');
  activeTab = { id: 4, windowId: 1, active: true, url: 'https://example.org/', title: 'Privater fremder Tab' };
  chrome.tabs.onActivated.emit();
  await until(() => api.channel.live === null && api.channel.tab === null);
  assert.equal((await popup('UNPAIR')).paired, false);
  assert.notEqual(api.store.setting('pairingCode'), oldCode);
});

test('generic Chrome agent explores an unfamiliar site and archives a duel after explicit plan approval', { timeout: 8000 }, async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = 'https://chats.invalid';
  const navigation = [];
  const injected = [];
  let lastDialogue;
  const api = createApi({ port, desktopToken: 'test', fetcher: async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
    let answer;
    if (input.message) {
      lastDialogue = input;
      answer = { reply: 'Ich schlage einen Archivlauf vor.', proposal: input.page ? 'approve' : 'explore' };
    } else if (input.instruction) answer = { ...input.previous, caption: 'Atlas: überarbeitet' };
    else if (input.page?.tools.some((tool) => tool.kind === 'expand')) answer = { tool: 'expand', ref: 'hide-1' };
    else if (input.page) answer = { tool: 'propose', caption: 'Projekt Atlas', projects: [{ name: 'Atlas', stages: ['Review'] }],
      items: [{ id: input.catalog.find((item) => item[1] === 'Antwort-Duell')[0], project: 'Atlas', stage: 'Review', mode: 'duel' }, 'c999'] };
    else answer = { isConversation: true, mode: 'duel', project: 'Erfunden', stage: 'Erfunden', messages: [
      { first: 'b2', role: 'assistant', lane: 'Modell A', text: 'Halluzinierter Text' }, { first: 'b3', role: 'assistant', lane: 'Modell B' },
    ] };
    return Response.json({ message: { content: JSON.stringify(answer) } });
  } });
  server.on('request', api.handler);
  t.after(async () => {
    api.agent.disconnect('Test beendet');
    delete persistent.token;
    api.channel.reset();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    api.store.close();
  });
  const extensionId = 'd'.repeat(32);
  const persistent = {};
  const session = {};
  const storage = (values) => ({ get: async () => ({ ...values }), set: async (patch) => Object.assign(values, patch), remove: async (key) => { delete values[key]; } });
  const tab = { id: 7, windowId: 1, url: `${origin}/work`, title: 'Anderer Anbieter', active: true, status: 'complete' };
  let active = tab;
  let expanded = false;
  const chrome = { runtime: { id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}`, onMessage: mockEvent(), onStartup: mockEvent(), onInstalled: mockEvent() },
    storage: { local: storage(persistent), session: storage(session) }, alarms: { create() {}, onAlarm: mockEvent() },
    windows: { onFocusChanged: mockEvent() }, tabs: { query: async () => [active], get: async () => tab, onActivated: mockEvent(), onUpdated: mockEvent(), onRemoved: mockEvent(),
      update: async (id, change) => { assert.equal(id, tab.id); navigation.push(change.url); tab.url = change.url; return tab; } },
    scripting: { executeScript: async ({ files, args, target }) => {
      assert.equal(target.tabId, 7);
      if (files) { assert.equal(files[0], 'page-agent.js'); return [{}]; }
      const [op] = args;
      assert.equal(op.origin, origin);
      injected.push(op.kind);
      if (op.kind === 'expand') { assert.equal(op.ref, 'hide-1'); expanded = true; }
      return [{ result: { url: tab.url, title: tab.url.endsWith('/answer') ? 'Antwort-Duell' : 'Historie', targets: expanded ? [
        { ref: 'seen-1', kind: 'link', href: `${origin}/conversations/answer`, label: 'Antwort-Duell', context: 'Atlas' },
        { ref: 'seen-2', kind: 'link', href: 'https://unrelated.invalid/other', label: 'Fremde Website' },
      ] : [{ ref: 'hide-1', kind: 'expand', label: 'Chatverlauf öffnen' }], blocks: ['read', 'context'].includes(op.kind) ? [
        { id: 'b1', role: 'user', type: 'text', text: 'Die ursprüngliche Frage' },
        { id: 'b2', type: 'text', text: 'Erste Originalantwort' }, { id: 'b3', type: 'text', text: 'Zweite Originalantwort' },
      ] : [] } }];
    } },
  };
  runInNewContext(worker, { URL, AbortSignal, setTimeout, clearTimeout, chrome, crypto, fetch: (url, options) => fetch(url.replace(':17654', `:${port}`), options) });
  const panel = (type, extra = {}) => new Promise((resolve) => chrome.runtime.onMessage.emit({ type, ...extra }, { id: extensionId, url: chrome.runtime.getURL('panel.html') }, resolve));
  assert.equal((await panel('PAIR', { code: api.store.setting('pairingCode') })).connected, true);
  const { scope } = await panel('TAB_SCOPE');
  assert.equal(scope.origin, origin);
  const talk = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/extension/agent/${path}`, { method: 'POST', headers: {
      Authorization: `Bearer ${persistent.token}`, 'X-Kontext-Extension-Id': extensionId, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) });
    assert.equal(response.ok, true);
    return response.json();
  };
  assert.match((await panel('AGENT_START', { ...scope, origin: 'https://unrelated.invalid' })).error, /geändert/);
  assert.equal((await talk('talk', { prompt: 'Ordne den Verlauf.', scope })).proposal, 'explore');
  assert.equal(lastDialogue.page, undefined);
  assert.equal(api.agent.state(), null);
  active = { ...tab, id: 8 };
  assert.match((await panel('PAGE_CONTEXT', scope)).error, /geändert/);
  active = tab;
  assert.match((await panel('PAGE_CONTEXT', { ...scope, url: `${origin}/other` })).error, /geändert/);
  assert.deepEqual(injected, []);
  const { page } = await panel('PAGE_CONTEXT', scope);
  const dialogue = await talk('talk', { prompt: 'Was steht im aktiven Tab?', scope, page });
  assert.equal(lastDialogue.page.sample[0].sample, 'Die ursprüngliche Frage');
  assert.equal(dialogue.proposal, null); // No model output can approve a run.
  assert.equal(api.agent.state(), null);
  const { run } = await panel('AGENT_START', { ...scope, prompt: 'Archiv mit Projektstufen' });
  assert.equal(run.status, 'exploring');
  const review = await until(() => api.agent.state()?.status === 'review' && api.agent.state());
  assert.equal(api.store.chats().length, 0);
  assert.deepEqual(injected, ['context', 'inspect', 'expand']);
  assert.equal(review.plan.items.length, 1);
  assert.equal((await talk('revise', { id: run.id, planVersion: review.planVersion, prompt: 'Plan weiter schärfen' })).status, 'revising');
  const revised = await until(() => api.agent.state()?.status === 'review' && api.agent.state());
  assert.equal(revised.plan.caption, 'Atlas: überarbeitet');
  assert.notEqual(revised.planVersion, review.planVersion);
  assert.match((await panel('AGENT_APPROVE', { ...scope, id: run.id, planVersion: review.planVersion, ids: [review.plan.items[0].id] })).error, /geändert/);
  assert.match((await panel('AGENT_APPROVE', { ...scope, id: run.id, planVersion: revised.planVersion, ids: ['c999'] })).error, /nicht zum/);
  assert.deepEqual(navigation, []);
  const approved = await panel('AGENT_APPROVE', { ...scope, id: run.id, planVersion: revised.planVersion, ids: [revised.plan.items[0].id] });
  assert.equal(approved.run.status, 'archiving');
  const done = await until(() => api.agent.state()?.status === 'done' && api.agent.state());
  assert.equal(done.saved, 1);
  assert.deepEqual(navigation, [`${origin}/conversations/answer`]);
  const saved = api.store.chat(done.items[0].chatId);
  assert.deepEqual(saved.messages.map((message) => message.blocks[0].text), ['Die ursprüngliche Frage', 'Erste Originalantwort', 'Zweite Originalantwort']);
  assert.deepEqual(saved.archive.lanes, ['Modell A', 'Modell B']);
  assert.deepEqual([saved.archive.project, saved.archive.stage, saved.archive.mode], ['Atlas', 'Review', 'duel']);
});
