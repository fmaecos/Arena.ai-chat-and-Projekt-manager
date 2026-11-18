import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

const source = await readFile(new URL('../extension/page-agent.js', import.meta.url), 'utf8');

test('DOM agent exposes history controls, not write controls, and preserves visible code and answer lanes', async () => {
  const { document, Node } = parseHTML(`<!doctype html><html><head><title>Unbekannter Anbieter</title></head><body>
    <button type="button" aria-expanded="false" aria-controls="history" id="open">Open sidebar</button>
    <nav id="history" aria-label="Chat History" hidden>
      <a href="/threads/campus-api">Semesterplan</a>
      <a href="https://other.invalid/threads/12">Andere Website</a>
      <a href="/account/delete">Konto löschen</a>
      <a href="/threads/a?token=private">Privater Link</a>
      <button type="button" id="modify">Open projects to delete</button>
      <form><button type="submit">Show more chats</button></form>
    </nav>
    <main><h1 hidden>Abgeschnittener Titel</h1><h1>Ein Vergleich</h1>
      <article aria-label="User message" data-message-id="q"><p>Vergleiche bitte.</p></article>
      <section aria-label="Model A"><article data-role="assistant" data-message-id="l"><p>Links.</p>
        <pre><code class="language-py"><span hidden>Versteckte Zeilennummer</span>  print(42)<br/>  print(43)</code></pre></article></section>
      <section aria-label="Model B"><article data-role="assistant" data-message-id="r"><p>Rechts.</p>
        <a download="ablauf.pdf" href="/files/ablauf.pdf">Anlage</a></article></section>
      <textarea>Ungesendeter Text</textarea><input type="password" value="passwort"/>
    </main></body></html>`);
  const opener = document.getElementById('open');
  opener.addEventListener('click', () => {
    document.getElementById('history').removeAttribute('hidden');
    opener.setAttribute('aria-expanded', 'true');
  });
  const location = new URL('https://unknown.invalid/threads/abc');
  const sandbox = { document, Node, URL, location, innerWidth: 900,
    getComputedStyle: (node) => node.style, setTimeout: (resolve) => setTimeout(resolve, 0) };
  runInNewContext(source, sandbox);
  const run = (kind, options) => sandbox.KontextArchivePage.run({ kind, origin: location.origin, from: location.href, ...options });
  const discovered = await run('inspect');
  assert.equal(discovered.title, 'Ein Vergleich');
  const expand = discovered.targets.find((target) => target.kind === 'expand');
  assert.equal(expand.label, 'Open sidebar');
  await run('context'); // A page question does not invalidate an in-flight exploration reference.
  const next = await run('expand', { ref: expand.ref });
  assert.equal(next.targets.filter((target) => target.kind === 'link').length, 1);
  assert.equal(next.targets[0].href, 'https://unknown.invalid/threads/campus-api');
  assert.equal(next.targets.some((target) => target.kind === 'expand'), false);
  const observed = await run('read');
  assert.equal(observed.blocks.find((block) => block.type === 'code').text, '  print(42)\n  print(43)');
  assert.equal(observed.blocks.find((block) => block.text === 'Rechts.').lane, 'Model B');
  assert.equal(observed.blocks.find((block) => block.type === 'attachment').text, 'ablauf.pdf');
  assert.doesNotMatch(JSON.stringify(observed), /Versteckte Zeilennummer|Ungesendeter Text|passwort|private/);
  await assert.rejects(() => run('expand', { ref: expand.ref }), /nicht mehr sichtbar/);
  await assert.rejects(() => run('inspect', { origin: 'https://other.invalid' }), /verändert/);
});
