const API = 'http://127.0.0.1:17654/api/extension';
const domains = new Set(['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'arena.ai', 'lmarena.ai']);
let loop = null;
let timer = null;
let captureSequence = 0;
let lastSnapshot = '';
let publishing = Promise.resolve();

const token = async () => (await chrome.storage.local.get('token')).token;
function supported(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && domains.has(url.hostname); } catch { return false; }
}
async function send(path, body = {}, key, timeout = 4500) {
  if (!key) throw Error('Die Erweiterung ist nicht gekoppelt.');
  let response;
  try {
    response = await fetch(`${API}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Kontext-Extension-Id': chrome.runtime.id },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
  } catch { throw Error('Kontext Desktop antwortet nicht. Ist die App geöffnet?'); }
  if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'Der Desktop hat die Anfrage abgelehnt.');
  return response.json();
}
const activeTab = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
const scopeKey = 'kontextArchiveScope';
const prohibited = /^(?:log[-_ ]?in|log[-_ ]?out|sign[-_ ]?in|sign[-_ ]?out|oauth|auth|account|password|api|billing|payment|checkout|settings|admin|delete|remove|revoke|unsubscribe|reset|cancel|löschen|abmelden|konto|zahlung)$/iu;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function archiveUrl(raw, origin) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || (origin && url.origin !== origin) || url.username || url.password
      || `${decodeURIComponent(url.pathname)}/${decodeURIComponent(url.hash).replace(/^#/, '')}`.split('/').some((part) => prohibited.test(part))) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|password|session|api[_-]?key|signature/i.test(key) || /^(?:action|op|command)$/i.test(key) && prohibited.test(url.searchParams.get(key))) return '';
      if (/^(?:utm_\w+|fbclid|gclid|ref)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return ''; }
}
async function selectedScope() {
  const tab = await activeTab();
  if (tab?.id == null) throw Error('Öffne zuerst die Chat-Seite in Chrome.');
  let raw = tab.url;
  if (!raw) {
    try { [{ result: raw }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => location.href }); }
    catch { throw Error('Klicke im gewünschten Chat-Tab erneut auf das Kontext-Symbol, um ihn freizugeben.'); }
  }
  const url = archiveUrl(raw);
  if (!url) throw Error('Der Agent benötigt eine normale HTTPS-Seite außerhalb von Anmeldungen und Kontoeinstellungen.');
  return { tabId: tab.id, url, origin: new URL(url).origin, title: tab.title || '' };
}
async function inspectTab(tabId, scope) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || (await activeTab())?.id !== tabId) throw Error('Der freigegebene Chrome-Tab ist nicht aktiv. Wechsle zurück und setze den Lauf fort.');
  const url = archiveUrl(tab.url, scope.origin);
  if (!url || (tab.pendingUrl && !archiveUrl(tab.pendingUrl, scope.origin))) throw Error('Der Tab hat die freigegebene Website verlassen.');
  return { tab, url };
}
function checkSelection(current, expected, checkUrl = false) {
  if (current.tabId !== expected.tabId || current.origin !== expected.origin || (checkUrl && current.url !== expected.url)) {
    throw Error('Der aktive Tab hat sich seit deiner Freigabe geändert. Prüfe die angezeigte Website.');
  }
}
async function readPage(scope, operation) {
  const { tabId, origin } = scope;
  const before = await inspectTab(tabId, scope);
  if (operation.from && before.url !== operation.from) throw Error('Die Seite hat sich vor dem Lesen geändert.');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page-agent.js'] });
  const [injection] = await chrome.scripting.executeScript({ target: { tabId },
    func: (op) => globalThis.KontextArchivePage.run(op), args: [{ ...operation, origin }] });
  const result = injection?.result;
  const current = await inspectTab(tabId, scope);
  if (!result || !archiveUrl(result.url, origin) || result.url !== current.url) throw Error('Die Seite konnte nicht gelesen werden oder hat sich geändert.');
  return result;
}
async function archiveTool(action, target) {
  const scope = (await chrome.storage.session.get(scopeKey))[scopeKey];
  if (!scope || scope.id !== action.runId || scope.tabId !== target?.id || scope.origin !== target?.origin) {
    throw Error('Die Browser-Freigabe fehlt. Öffne den Kontext-Assistenten am gewünschten Tab und setze den Lauf fort.');
  }
  const { tabId, origin } = scope;
  const first = await inspectTab(tabId, scope);
  if (action.kind === 'open') {
    const url = archiveUrl(action.url, origin);
    if (!url) throw Error('Die vorgeschlagene Adresse liegt nicht in der Freigabe.');
    if (first.url !== url) {
      await chrome.tabs.update(tabId, { url });
      for (let attempt = 0; attempt < 23; attempt++) {
        await pause(220);
        const updated = await inspectTab(tabId, scope);
        if (updated.url === url && !updated.tab.pendingUrl && updated.tab.status !== 'loading') break;
        if (attempt === 22) throw Error('Der erwartete Chat wurde nicht geöffnet. Prüfe in Chrome, ob er erreichbar ist.');
      }
      await pause(360);
    }
  } else if (!['inspect', 'read', 'expand', 'scroll'].includes(action.kind)) throw Error('Unbekanntes Archiv-Werkzeug.');
  const checked = await inspectTab(tabId, scope);
  if (action.from && checked.url !== action.from) throw Error('Die freigegebene Seite hat sich verändert.');
  if (action.kind === 'open' && checked.url !== archiveUrl(action.url, origin)) throw Error('Die Adresse wurde umgeleitet.');
  return readPage(scope, { kind: action.kind, from: action.from || checked.url, ref: action.ref, direction: action.direction });
}

function configurePanel() {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
}
configurePanel();

async function capture(key, force = false) {
  if (!force && (await chrome.storage.local.get('mirrorEnabled')).mirrorEnabled !== true) return;
  const sequence = ++captureSequence;
  const tab = await activeTab();
  let snapshot = { tab: null };
  let missingScript = false;
  if (tab?.id != null && supported(tab.url)) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'KONTEXT_CAPTURE' });
      const current = await activeTab();
      if (current?.id !== tab.id || current.url !== tab.url || result?.url !== tab.url) return;
      snapshot = { tab: { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title }, chat: result.chat };
    } catch {
      snapshot = { tab: { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title }, chat: null };
      missingScript = true;
    }
  }
  const encoded = JSON.stringify(snapshot);
  const publication = publishing.then(async () => {
    if (key !== await token() || sequence !== captureSequence) return false;
    if (force || encoded !== lastSnapshot) {
      await send('snapshot', snapshot, key);
      if (sequence === captureSequence) lastSnapshot = encoded;
    }
    return true;
  });
  publishing = publication.catch(() => {});
  if (!await publication) return;
  if (force && missingScript) return 'Lade den Chat einmal in Chrome neu, damit die Erweiterung ihn lesen kann.';
  if (force && !snapshot.tab) return 'Der aktuelle Chrome-Tab ist kein unterstützter Webchat.';
  return force ? 'Live-Chat aktualisiert.' : undefined;
}
function schedule(delay = 250) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    const key = await token();
    if (key) capture(key).catch(() => {});
  }, delay);
}

async function execute(command, key) {
  if (key !== await token()) return;
  const { action, target, id } = command;
  if (action.type === 'agent_tool') {
    try {
      const result = await archiveTool(action, target);
      await send('agent/tool-result', { id, ok: true, result }, key, 8000);
    } catch (error) { await send('agent/tool-result', { id, ok: false, note: error.message }, key).catch(() => {}); }
    return;
  }
  let note = '';
  let ok = false;
  try {
    if (action.type === 'capture') note = (await capture(key, true)) || 'Der aktive Tab wurde erneut geprüft.';
    else if (action.type === 'open_tab') {
      const url = new URL(action.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Ungültige Webadresse.');
      const created = await chrome.tabs.create({ url: url.href, active: true });
      await chrome.windows.update(created.windowId, { focused: true });
      note = 'Chrome-Tab geöffnet.';
    } else if (action.type === 'focus_chat') {
      const tab = await chrome.tabs.get(target?.id);
      if (!supported(tab.url) || tab.url !== target.url) throw Error('Der ursprüngliche Chrome-Tab hat sich geändert.');
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      note = 'Original-Chat in Chrome geöffnet.';
    } else throw Error('Nicht unterstützte Browser-Aktion.');
    ok = true;
  } catch (error) { note = error.message || 'Chrome konnte die Aktion nicht ausführen.'; }
  await send('ack', { id, ok, note }, key).catch(() => {});
}

async function connect(key) {
  await send('hello', {}, key);
  lastSnapshot = '';
  await capture(key).catch(() => {});
  while (key === await token()) {
    const result = await send('poll', {}, key, 18_000);
    for (const command of result.commands || []) await execute(command, key);
  }
}
function start() {
  if (loop) return;
  loop = (async () => {
    const key = await token();
    if (key) await connect(key);
  })().catch(() => {}).finally(() => { loop = null; });
}
const ensureAlarm = () => chrome.alarms.create('kontext-reconnect', { periodInMinutes: 0.5 });
chrome.runtime.onStartup.addListener(() => { configurePanel(); ensureAlarm(); start(); });
chrome.runtime.onInstalled.addListener(() => { configurePanel(); ensureAlarm(); start(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'kontext-reconnect') start(); });
chrome.tabs.onActivated.addListener(() => schedule());
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (tab.active && (change.url || change.title || change.status === 'complete')) schedule(); });
chrome.tabs.onRemoved.addListener(() => schedule());
chrome.windows.onFocusChanged.addListener((id) => { if (id >= 0) schedule(); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === 'KONTEXT_DIRTY' && supported(sender.url) && sender.tab?.active) {
    // Do not let DOM mutations on another Chrome window delay the actual active tab.
    activeTab().then((tab) => { if (tab?.id === sender.tab.id) schedule(150); }).catch(() => {});
    return false;
  }
  if (sender.url !== chrome.runtime.getURL('panel.html')) return false;
  async function popup() {
    if (message.type === 'PAIR') {
      const key = typeof message.code === 'string' ? message.code.trim() : '';
      if (!/^[\w-]{32}$/.test(key)) throw Error('Kopiere den vollständigen Code aus den Desktop-Einstellungen.');
      await send('hello', {}, key);
      await chrome.storage.local.set({ token: key });
      ensureAlarm();
      if (loop) void loop.then(start);
      else start();
      return { paired: true, connected: true };
    }
    const key = await token();
    if (message.type === 'UNPAIR') {
      await chrome.storage.local.remove('token');
      await chrome.storage.session?.remove(scopeKey);
      if (key) await send('disconnect', {}, key).catch(() => {});
      lastSnapshot = '';
      return { paired: false, connected: false };
    }
    if (message.type === 'STATUS') {
      if (!key) return { paired: false, connected: false };
      try { await send('hello', {}, key); start(); return { paired: true, connected: true, mirror: (await chrome.storage.local.get('mirrorEnabled')).mirrorEnabled === true }; }
      catch (error) { return { paired: true, connected: false, error: error.message }; }
    }
    if (message.type === 'SET_MIRROR' && key) {
      const mirror = message.enabled === true;
      await chrome.storage.local.set({ mirrorEnabled: mirror });
      lastSnapshot = '';
      if (mirror) void capture(key).catch(() => {});
      else {
        ++captureSequence;
        const clear = publishing.then(() => send('snapshot', { tab: null }, key));
        publishing = clear.catch(() => {});
        await clear;
      }
      return { mirror };
    }
    if (message.type === 'TAB_SCOPE') return { scope: await selectedScope() };
    if (message.type === 'PAGE_CONTEXT' && key) {
      const scope = await selectedScope();
      checkSelection(scope, message, true);
      const page = await readPage(scope, { kind: 'context', from: scope.url });
      return { page: { url: page.url, title: page.title,
        blocks: page.blocks.slice(0, 36).map(({ id, type, role, author, lane, text }) => ({ id, type, role, author, lane, text: text.slice(0, 220) })),
        targets: page.targets.filter((target) => target.kind === 'link' && target.href.length <= 320).slice(0, 30)
          .map(({ kind, ref, href, label, context }) => ({ kind, ref, href, label: label.slice(0, 110), context: context.slice(0, 80) })), truncated: true } };
    }
    if (['AGENT_START', 'AGENT_APPROVE', 'AGENT_RESUME'].includes(message.type)) {
      if (!key) throw Error('Kopple zuerst die Erweiterung mit Kontext.');
      const scope = await selectedScope();
      checkSelection(scope, message, message.type === 'AGENT_START');
      const id = message.type === 'AGENT_START' ? crypto.randomUUID() : message.id;
      const old = (await chrome.storage.session.get(scopeKey))[scopeKey];
      await chrome.storage.session.set({ [scopeKey]: { tabId: scope.tabId, origin: scope.origin, id } });
      try {
        await send('hello', {}, key);
        start();
        const endpoint = { AGENT_START: 'start', AGENT_APPROVE: 'approve', AGENT_RESUME: 'resume' }[message.type];
        return { run: await send(`agent/${endpoint}`, { scope, id, prompt: message.prompt, ids: message.ids, planVersion: message.planVersion, replace: message.replace === true }, key) };
      } catch (error) {
        if (old) await chrome.storage.session.set({ [scopeKey]: old });
        else await chrome.storage.session.remove(scopeKey);
        throw error;
      }
    }
    if (message.type === 'REFRESH' && key) return { paired: true, connected: true, note: await capture(key, true) };
    throw Error('Unbekannte Aktion.');
  }
  popup().then(respond).catch((error) => respond({ error: error.message }));
  return true;
});
