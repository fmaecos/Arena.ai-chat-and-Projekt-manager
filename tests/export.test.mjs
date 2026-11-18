import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportChat } from '../src/api.js';

test('Markdown export awaits the save and includes original code, phase, lane and attachment evidence', async (t) => {
  const saved = [];
  const previous = globalThis.window;
  globalThis.window = { kontext: { saveFile: async (name, bytes) => { saved.push([name, Buffer.from(bytes).toString('utf8')]); return true; } } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const chat = { title: 'Vergleich', url: 'https://example.test/threads/4', capturedAt: '2026-11-17T08:00:00Z',
    archive: { project: 'Atlas', stage: 'Review', mode: 'duel' }, messages: [{ role: 'assistant', lane: 'Modell A', blocks: [
      { type: 'code', language: 'js', text: '  const x = 1;\n' }, { type: 'attachment', text: 'bericht.pdf', url: '' },
    ] }] };
  assert.equal(await exportChat(chat), true);
  assert.equal(saved[0][0], 'Vergleich.md');
  assert.match(saved[0][1], /Projekt: Atlas · Phase: Review · Modus: duel/);
  assert.match(saved[0][1], /## Assistent · Modell A/);
  assert.match(saved[0][1], /```js\n  const x = 1;\n\n```/);
  assert.match(saved[0][1], /bericht.pdf \(kein verfügbarer Link\)/);
  globalThis.window.kontext.saveFile = async () => { throw Error('Speichern fehlgeschlagen'); };
  await assert.rejects(exportChat(chat), /Speichern fehlgeschlagen/);
});
