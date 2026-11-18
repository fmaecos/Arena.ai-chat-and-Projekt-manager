import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

const directory = new URL('../extension/', import.meta.url);
const js = await readFile(new URL('adapters.js', directory), 'utf8');
const sandbox = { URL };
runInNewContext(js, sandbox);
const { capture } = sandbox.KontextAdapters;
const doc = (body, title = 'Testchat') => parseHTML(`<html><head><title>${title}</title></head><body>${body}</body></html>`).document;
const snapshot = (url, body, title) => capture(doc(body, title), new URL(url));

test('ChatGPT: Nachrichten, zeitliche Reihenfolge, Code, Tabelle und Anhang', () => {
  const result = snapshot('https://chatgpt.com/c/fixture', `
    <div data-message-author-role="user"><time datetime="2026-11-16T10:00:00Z"></time><div class="whitespace-pre-wrap">Zeile 1\nZeile 2</div><a download="plan.md" href="https://example.com/plan.md">Datei</a></div>
    <div data-message-author-role="assistant"><p><strong>Typ</strong> und <a href="https://example.org">Link</a>.</p>
    <pre><code class="language-typescript">const x = 1;\nconsole.log(x);</code><button>Code kopieren</button></pre>
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><button>Feedback</button></div>
    <div data-message-author-role="assistant" hidden>Versteckter Text</div>`, 'Archivtest – ChatGPT');
  assert.equal(result.title, 'Archivtest');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].time, '2026-11-16T10:00:00Z');
  assert.equal(result.messages[0].blocks[0].text, 'Zeile 1\nZeile 2');
  assert.equal(result.messages[0].blocks[1].text, 'plan.md');
  assert.equal(result.messages[1].blocks[1].language, 'typescript');
  assert.match(result.messages[1].blocks[0].text, /\*\*Typ\*\*/);
  assert.match(result.messages[1].blocks[2].text, /\| 1 \| 2 \|/);
  assert.equal(JSON.stringify(result).includes('Feedback'), false);
});

test('Claude, Gemini und Arena trennen Nutzer und Assistent; keine Duplikate bei verschachtelten Selektoren', () => {
  const examples = [
    ['https://claude.ai/chat/test', '<div data-testid="user-message">Frage</div><div class="font-claude-response"><div class="standard-markdown">Antwort</div></div>'],
    ['https://gemini.google.com/app/test', '<user-query><div class="query-text">Frage</div></user-query><model-response><div class="markdown">Antwort</div></model-response>'],
    ['https://arena.ai/c/test', '<div data-message-role="user">Frage</div><div data-role="assistant" data-model-name="Model A"><div data-testid="assistant-message">Antwort</div></div>'],
  ];
  for (const [url, html] of examples) {
    const result = snapshot(url, html);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.messages[0].blocks[0].text, 'Frage');
    assert.equal(result.messages[1].role, 'assistant');
    assert.equal(result.messages[1].blocks[0].text, 'Antwort');
  }
  assert.equal(snapshot('https://evil.example', '<div data-role="user">private</div>'), null);
  assert.equal(snapshot('https://constructor', '<div data-role="user">private</div>'), null);
});
