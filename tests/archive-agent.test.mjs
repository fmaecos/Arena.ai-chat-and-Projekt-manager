import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArchiveAgent } from '../server/archive-agent.mjs';
import { archiveUrl, buildArchiveRecord, normalizeObservation } from '../server/archive-model.mjs';
import { Channel } from '../server/channel.mjs';
import { Store } from '../server/store.mjs';

const scope = { tabId: 1, origin: 'https://chats.invalid', url: 'https://chats.invalid/history' };
const stages = ['Konzept', 'Umsetzung', 'Testlauf'];
const project = { name: 'Atlas', description: 'Testprojekt', stages };
const getFixture = (url, name, blocks = []) => ({ url, title: name, ready: true, blocks });
async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { const value = predicate(); if (value) return value; await delay(10); }
  assert.fail('Archivschritt wurde nicht erreicht.');
}

test('same-origin guard excludes foreign and sensitive routes without losing legitimate chat slugs', () => {
  assert.equal(archiveUrl('https://chats.invalid/c/campus-api?utm_campaign=c', scope.origin), 'https://chats.invalid/c/campus-api');
  for (const value of ['https://foreign.invalid/c/9', 'https://chats.invalid/api/chats', 'https://chats.invalid/user/%73ettings',
    'https://chats.invalid/#/account', 'https://chats.invalid/c/9?session_token=secret', 'https://chats.invalid/c/9?action=delete', 'javascript:alert(1)']) assert.equal(archiveUrl(value, scope.origin), '');
});

test('forty chats can be planned and processed; a persisted run resumes without rereading saved chats', { timeout: 7000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'kontext-agent-'));
  let store = new Store(join(dir, 'workspace.sqlite'));
  let agent;
  t.after(async () => { agent?.disconnect('Test beendet'); store.close(); await rm(dir, { recursive: true, force: true }); });
  const targets = Array.from({ length: 40 }, (_, i) => ({ ref: `h${i}`, kind: 'link', href: `${scope.origin}/threads/${i + 1}`, label: `Teil ${i + 1}`, group: 'Historie' }));
  const operations = [];
  let browserUrl = scope.url;
  let shouldWait = true;
  const services = {
    browse: async (_run, op, signal) => {
      if (op.kind === 'inspect') { browserUrl = scope.url; return { ...getFixture(browserUrl, 'Historie'), targets }; }
      if (op.kind === 'open') {
        if (shouldWait && op.url.endsWith('/2')) await delay(60_000, undefined, { signal });
        browserUrl = op.url; operations.push(op.url);
        return getFixture(browserUrl, 'Voransicht');
      }
      return getFixture(browserUrl, `Chat ${browserUrl.split('/').at(-1)}`, [{ id: 'b1', role: 'user', type: 'text', text: `Original ${browserUrl}` },
        { id: 'b2', role: 'assistant', type: 'code', language: 'js', text: 'const x = 1;' }]);
    },
    decide: async (task, input) => task === 'plan' ? { tool: 'propose', caption: 'Historie planen', projects: [project],
      groups: [input.catalog.find((entry) => entry[1] === 'Teil 1')[4]] } : { isConversation: true, mode: 'chat', project: 'Atlas', stage: 'Umsetzung' },
  };
  agent = new ArchiveAgent(store, new Channel(), fetch, services);
  const { id } = agent.start({ id: randomUUID(), scope });
  const review = await waitFor(() => agent.state().status === 'review' && agent.state());
  assert.equal(review.plan.items.length, 40);
  assert.equal(store.chats().length, 0);
  agent.approve({ id, scope, planVersion: review.planVersion, ids: review.plan.items.map((item) => item.id) });
  await waitFor(() => agent.state().items[1]?.status === 'reading');
  agent.pause({ id });
  assert.equal(agent.state().saved, 1);
  store.close();
  store = new Store(join(dir, 'workspace.sqlite'));
  shouldWait = false;
  agent = new ArchiveAgent(store, new Channel(), fetch, services);
  assert.equal(agent.state().status, 'paused');
  assert.throws(() => agent.resume({ id, scope: { ...scope, origin: 'https://other.invalid', url: 'https://other.invalid/' } }), /wieder/);
  agent.resume({ id, scope });
  const done = await waitFor(() => agent.state().status === 'done' && agent.state());
  assert.equal(done.saved, 40);
  assert.equal(operations.filter((url) => url.endsWith('/1')).length, 1);
  assert.equal(store.chats().length, 40);
  assert.deepEqual(store.projects()[0].stages, stages);
  assert.equal(store.chat(done.items.at(-1).chatId).messages[1].blocks[0].text, 'const x = 1;');
});

test('archiving a new phase keeps previous versions and does not store invented text', () => {
  const store = new Store();
  try {
    const url = `${scope.origin}/threads/a`;
    const evidence = normalizeObservation(getFixture(url, 'Projekt', [
      { id: 'b1', role: 'user', type: 'text', text: 'Unveränderte Frage' }, { id: 'b2', type: 'text', text: 'Unveränderte Antwort' },
      { id: 'b3', type: 'attachment', text: 'Datei.txt', url: 'javascript:alert(1)' },
    ]), scope.origin);
    const item = { url, label: 'Projekt', mode: 'unknown' };
    const decide = (stage) => ({ isConversation: true, mode: 'chat', project: project.name, stage,
      messages: [{ first: 'b2', last: 'b3', role: 'assistant', text: 'Soll nicht gespeichert werden' }] });
    const save = (stage) => store.saveArchiveConversation(buildArchiveRecord(evidence, decide(stage), item, { projects: [project] }), randomUUID(), project);
    const first = save('Konzept');
    const newer = save('Testlauf');
    assert.equal(first.id, newer.id);
    assert.equal(newer.archive.versionCount, 2);
    assert.equal(newer.archive.stage, 'Testlauf');
    assert.equal(newer.messages[1].blocks[0].text, 'Unveränderte Antwort');
    assert.equal(newer.messages[1].blocks[1].url, '');
    const stages = store.archiveVersions(first.id).map((version) => store.archiveVersion(first.id, version.id).archive.stage);
    assert.deepEqual(stages.sort(), ['Konzept', 'Testlauf']);
  } finally { store.close(); }
});

test('reads explicitly available earlier messages and keeps all lanes of a multi-chat in evidence order', async (t) => {
  const store = new Store();
  const url = `${scope.origin}/threads/parallel`;
  const path = [];
  let earlierVisible = false;
  const original = [
    { id: 'b1', role: 'user', type: 'text', text: 'Bitte drei Varianten.' },
    ...['Alpha', 'Beta', 'Gamma'].map((lane, index) => ({ id: `b${index + 2}`, role: 'assistant', type: 'text', text: `Antwort ${lane}`, lane })),
  ];
  const agent = new ArchiveAgent(store, new Channel(), fetch, {
    browse: async (_run, operation) => {
      path.push(operation.kind);
      if (operation.kind === 'inspect') return { ...getFixture(scope.url, 'Übersicht'), targets: [{ ref: 'r1', kind: 'link', href: url, label: 'Parallel' }] };
      if (operation.kind === 'expand') { assert.equal(operation.ref, 'load-earlier'); earlierVisible = true; }
      return { ...getFixture(url, 'Parallel', earlierVisible ? [{ id: 'earliest', role: 'user', type: 'text', text: 'Frühere Frage' }, ...original] : original),
        targets: earlierVisible ? [] : [{ ref: 'load-earlier', kind: 'expand', label: 'Load earlier messages' }] };
    },
    decide: async (task, input) => task === 'plan' ? { tool: 'propose', items: [{ id: input.catalog[0][0], mode: 'multi' }] }
      : { mode: 'multi', needEarlier: !earlierVisible },
  });
  t.after(() => { agent.disconnect('Test beendet'); store.close(); });
  const { id } = agent.start({ id: randomUUID(), scope });
  const review = await waitFor(() => agent.state().status === 'review' && agent.state());
  agent.approve({ id, scope, planVersion: review.planVersion, ids: [review.plan.items[0].id] });
  const done = await waitFor(() => agent.state().status === 'done' && agent.state());
  assert.deepEqual(path, ['inspect', 'open', 'read', 'expand', 'read']);
  const saved = store.chat(done.items[0].chatId);
  assert.equal(saved.archive.mode, 'multi');
  assert.deepEqual(saved.archive.lanes, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(saved.messages[0].blocks[0].text, 'Frühere Frage');
  assert.equal(saved.messages[0].blocks[1].text, 'Bitte drei Varianten.');
  assert.equal(saved.messages.at(-1).blocks[0].text, 'Antwort Gamma');
  assert.equal(saved.truncated, false);
});

test('an unfinished persisted run must be reauthorized after a restart', () => {
  const store = new Store();
  try {
    const run = { id: randomUUID(), status: 'archiving', scope, items: [{ status: 'saved' }, { status: 'reading' }],
      log: [], catalog: [], updatedAt: new Date().toISOString() };
    store.saveArchiveRun(run);
    const agent = new ArchiveAgent(store, new Channel(), fetch);
    assert.equal(agent.state().status, 'paused');
    assert.equal(agent.state().resumeStage, 'archiving');
    assert.equal(agent.state().saved, 1);
    assert.equal(store.latestArchiveRun().status, 'paused');
  } finally { store.close(); }
});
