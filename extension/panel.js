const $ = (id) => document.getElementById(id);
const api = 'http://127.0.0.1:17654/api/extension/agent/';
const activeStates = new Set(['exploring', 'revising', 'archiving']);
const modeNames = { chat: 'Chat', duel: 'Duell', multi: 'Multi-Chat', unknown: 'Modus offen' };
const chatCount = (count) => `${count} ${count === 1 ? 'Chat' : 'Chats'}`;
const labels = { exploring: 'Seite wird erkundet', revising: 'Plan wird überarbeitet', review: 'Archivplan prüfen', archiving: 'Chats werden archiviert', paused: 'Lauf pausiert', done: 'Archivlauf abgeschlossen' };
let tokenValue = '';
let connected = false;
let setup = false;
let busy = false;
let pending = false;
let run = null;
let scope = null;
let selection = new Set();
let planKey = '';
let activeTab = 'run';
let turns = [];
let spoken = false;
let spokenSet = false;
let talking = false;
let voice = { mode: 'local', autoSend: false };

const make = (tag, value, className) => {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
};
const error = (value = '') => { $('failure').textContent = value; $('failure').hidden = !value; };
const local = async (type, values = {}) => {
  const result = await chrome.runtime.sendMessage({ type, ...values });
  if (!result) throw Error('Die Chrome-Erweiterung antwortet nicht.');
  if (result.error) throw Error(result.error);
  return result;
};
async function request(endpoint, payload = {}, timeout = 130_000) {
  if (!tokenValue) tokenValue = (await chrome.storage.local.get('token')).token;
  if (!tokenValue) throw Error('Die Erweiterung ist nicht gekoppelt.');
  const result = await fetch(`${api}${endpoint}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${tokenValue}`, 'Content-Type': 'application/json', 'X-Kontext-Extension-Id': chrome.runtime.id }, body: JSON.stringify(payload) });
  const json = await result.json();
  if (!result.ok) throw Error(json.error || 'Kontext Desktop hat die Anfrage abgelehnt.');
  return json;
}
function speak(text) {
  if (!spoken || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices().filter((item) => item.localService);
  const systemVoice = voices.find((item) => item.lang.startsWith('de')) || voices[0];
  if (!systemVoice) { error('Chrome stellt gerade keine lokale Systemstimme bereit.'); return; }
  const speech = new SpeechSynthesisUtterance(text);
  speech.voice = systemVoice; speech.lang = systemVoice.lang;
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(speech);
}
function updateVoice() {
  $('speak').setAttribute('aria-pressed', String(spoken));
  $('speak').textContent = spoken ? 'Vorlesen: an' : 'Vorlesen: aus';
}
function apply(next, announce = true) {
  if (next?.id === run?.id && (next?.updatedAt < run?.updatedAt || next?.updatedAt === run?.updatedAt && next?.status === run?.status && next?.planVersion === run?.planVersion)) return;
  const before = run?.status;
  run = next;
  const key = run?.status === 'review' ? `${run.id}-${run.planVersion}` : '';
  if (key && key !== planKey) selection = new Set(run.plan.items.map((item) => item.id));
  planKey = key;
  renderRun();
  switchTab(activeTab);
  if (announce && before && before !== run?.status && run?.status === 'review') speak(`Der Plan für ${chatCount(run.plan.items.length)} ist bereit. Bitte prüfe die Zuordnung und gib die Auswahl zur Archivierung frei.`);
  if (announce && before && before !== run?.status && run?.status === 'done') speak(`Archivlauf abgeschlossen. Im Archiv: ${chatCount(run.saved)}.`);
}
function syncConnection() {
  $('connection').querySelector('i').classList.toggle('online', connected);
  $('connection').querySelector('span').textContent = connected ? 'Desktop verbunden' : tokenValue ? 'Desktop nicht erreichbar' : 'Nicht gekoppelt';
  $('workspace').hidden = !connected;
  $('setup').hidden = connected && !setup;
  $('pair').hidden = connected;
  $('mirror-option').hidden = !connected;
  $('disconnect').hidden = !tokenValue;
}
async function checkConnection() {
  tokenValue = (await chrome.storage.local.get('token')).token || '';
  try { const result = await local('STATUS'); connected = Boolean(result.connected); $('mirror').checked = Boolean(result.mirror); error(); }
  catch (failure) { connected = false; error(failure.message); }
  syncConnection();
  if (connected) { await syncScope(); await poll(); }
}
async function syncScope() {
  const old = scope;
  try { scope = (await local('TAB_SCOPE')).scope; }
  catch { scope = null; }
  $('origin').textContent = scope ? new URL(scope.origin).host : 'Klicke im gewünschten HTTPS-Tab erneut auf Kontext';
  $('origin').title = scope?.origin || '';
  if (!samePage(old, scope)) {
    $('page-context').checked = false;
    renderRun();
    if (activeTab === 'talk') renderTurns();
  }
  $('page-option').hidden = activeTab !== 'talk' || !scope;
}
async function poll() {
  if (!connected || pending) return;
  pending = true;
  try {
    const data = await request('state', {}, 6000);
    voice = data.voice;
    if (!spokenSet) { spoken = Boolean(voice.speak); updateVoice(); }
    apply(data.run);
  } catch (failure) {
    connected = false; syncConnection(); error(failure.message || 'Der lokale Desktop ist nicht erreichbar.');
  } finally { pending = false; }
}
const control = (label, action, variant = 'secondary', disabled = false) => {
  const button = make('button', label, variant); button.type = 'button'; button.disabled = busy || disabled;
  button.addEventListener('click', action);
  return button;
};
function addLog(section) {
  if (!run?.log.length) return;
  const previous = $('run').querySelector('details[data-log]');
  const details = make('details'); details.dataset.log = 'true'; details.open = previous?.open || false;
  details.append(make('summary', `Protokoll · ${run.log.length} Schritte`));
  const list = make('ul');
  run.log.forEach((event) => list.append(make('li', event.text)));
  details.append(list); section.append(details);
}
function available() { return Boolean(scope && (!run || !['review', 'paused'].includes(run.status) || scope.origin === run.origin)); }
const samePage = (a, b) => a?.tabId === b?.tabId && a?.url === b?.url;
function renderRun() {
  const region = $('run');
  const card = make('div', '', run ? 'card run-card' : 'intro');
  card.append(make('small', run ? new URL(run.origin).host : 'LESENDER BROWSER-AGENT'));
  if (!run) {
    card.append(make('h2', 'Chats und Projekte archivieren'), make('p', 'Der Agent erkundet den aktiven Tab und schlägt vor, welche Chats, Projekte und Phasen zusammengehören. Erst nach deiner Freigabe beginnt das Sichern.'));
    card.append(control('Aktive Seite untersuchen', () => launch('AGENT_START'), 'primary', !scope));
    region.replaceChildren(card); return;
  }
  card.append(make('h2', labels[run.status] || 'Archivlauf'));
  if (run.notice) card.append(make('p', run.notice));
  const buttons = make('div', '', 'run-actions');
  if (run.status === 'review') {
    const { plan } = run;
    card.append(make('p', plan.explanation || plan.caption));
    const schema = make('details'); schema.open = true;
    schema.append(make('summary', 'Vorgeschlagene Archivstruktur'), make('p', plan.structure || 'Projekt → Phase → Chat → Nachricht → Antwortspur.'));
    for (const item of plan.projects) {
      const line = make('div', '', 'project-line'); line.append(make('strong', item.name));
      const chips = make('div', '', 'chips'); item.stages.forEach((stage) => chips.append(make('span', stage, 'chip'))); line.append(chips); schema.append(line);
    }
    card.append(schema);
    const approve = control(`${chatCount(selection.size)} archivieren`, () => launch('AGENT_APPROVE'), 'primary', !selection.size || !available());
    const lists = make('details'); lists.open = true; const count = make('summary', `${selection.size} / ${plan.items.length} ausgewählt`); lists.append(count);
    const choices = make('div', '', 'run-list');
    for (const item of plan.items) {
      const row = make('label', '', 'item'); const field = make('input'); field.type = 'checkbox'; field.checked = selection.has(item.id); field.disabled = busy;
      const content = make('div'); content.append(make('strong', item.label), make('span', [modeNames[item.mode], item.project, item.stage, new URL(item.url).pathname].filter(Boolean).join(' · ')));
      field.addEventListener('change', () => {
        if (field.checked) selection.add(item.id); else selection.delete(item.id);
        count.textContent = `${selection.size} / ${plan.items.length} ausgewählt`; approve.textContent = `${chatCount(selection.size)} archivieren`;
        approve.disabled = !selection.size || !available();
      });
      row.append(field, content); choices.append(row);
    }
    lists.append(choices); card.append(lists);
    if (plan.caution) card.append(make('p', plan.caution));
    card.append(make('p', 'Tipp: Sag mir unten, was ich am Plan ändern soll.'));
    buttons.append(approve, control('Plan verwerfen', () => { if (confirm('Diesen Plan verwerfen und die Website erneut untersuchen?')) launch('AGENT_START', true); }, 'secondary', !scope));
  } else if (activeStates.has(run.status)) {
    if (run.status === 'archiving') card.append(make('p', `${run.saved + run.skipped} / ${run.items.length} geprüft · ${run.saved} gesichert`));
    else card.append(make('p', `${run.observedCount} Seiten oder Links gesehen. Noch nichts archiviert.`));
    if (run.current) card.append(make('p', `Aktuell: ${run.current}`));
    buttons.append(control('Pausieren', () => update('pause')));
  } else if (run.status === 'paused') {
    buttons.append(control('Lauf fortsetzen', () => launch('AGENT_RESUME'), 'primary', !available()), control('Neuer Lauf', () => {
      if (confirm('Den pausierten Lauf durch einen neuen ersetzen? Gesicherte Chats bleiben erhalten.')) launch('AGENT_START', true);
    }, 'secondary', !scope));
  } else {
    card.append(make('p', `${run.saved} lokal gesichert${run.skipped ? ` · ${run.skipped} übersprungen` : ''}. Die Chats findest du im Desktop-Archiv.`));
    buttons.append(control('Neue Seite untersuchen', () => launch('AGENT_START'), 'primary', !scope));
  }
  if (run.items.length) {
    const bar = make('progress', '', 'meter'); bar.max = run.items.length; bar.value = run.saved + run.skipped; bar.setAttribute('aria-label', 'Fortschritt'); card.append(bar);
    const details = make('details'); details.open = run.status === 'done'; details.append(make('summary', 'Chat-Status'));
    for (const entry of run.items) {
      const item = make('div', '', `item ${entry.status}`);
      const copy = make('div'); copy.append(make('strong', entry.label), make('span', [{ pending: 'Wartet', reading: 'Wird gelesen', saved: 'Gesichert', skipped: 'Übersprungen' }[entry.status], entry.stage, entry.note].filter(Boolean).join(' · ')));
      item.append(copy); details.append(item);
    }
    card.append(details);
  }
  card.append(buttons);
  addLog(card);
  region.replaceChildren(card);
}
async function update(endpoint, payload = {}) {
  if (busy) return false;
  busy = true; error(); renderRun();
  try { apply(await request(endpoint, { id: run?.id, planVersion: run?.planVersion, ...payload })); return true; }
  catch (failure) { error(failure.message); return false; }
  finally { busy = false; renderRun(); }
}
async function launch(type, replace = false, prompt = $('prompt').value.trim()) {
  if (busy || !scope) return false;
  busy = true; error(); renderRun();
  try {
    const result = await local(type, { ...scope, id: run?.id, planVersion: run?.planVersion, ids: [...selection], prompt, replace });
    if ($('prompt').value.trim() === prompt) $('prompt').value = '';
    apply(result.run); return true;
  } catch (failure) { error(failure.message); await syncScope(); return false; }
  finally { busy = false; renderRun(); }
}
function switchTab(tab) {
  activeTab = tab;
  $('run-tab').setAttribute('aria-pressed', String(tab === 'run'));
  $('talk-tab').setAttribute('aria-pressed', String(tab === 'talk'));
  $('run').hidden = tab !== 'run'; $('dialogue').hidden = tab !== 'talk';
  $('page-option').hidden = tab !== 'talk' || !scope;
  if (tab !== 'talk') $('page-context').checked = false;
  $('talk-state').hidden = tab !== 'talk' || !talking;
  $('send').disabled = tab === 'talk' && talking;
  $('prompt').placeholder = tab === 'talk' ? 'Frag mich etwas …' : run?.status === 'review' ? 'Was soll ich am Plan ändern? …' : 'Was soll ich untersuchen? …';
}
function canFollow(proposal) {
  if (proposal.runId !== run?.id || proposal.done) return false;
  if (proposal.type === 'explore') return scope && samePage(proposal.scope, scope) && (!run || run.status === 'done');
  return proposal.type === 'revise' && run?.status === 'review' && run.planVersion === proposal.planVersion;
}
async function follow(proposal) {
  if (!canFollow(proposal)) { error('Der Tab oder der Plan hat sich geändert. Bitte frage erneut.'); renderTurns(); return; }
  const ok = proposal.type === 'explore' ? await launch('AGENT_START', false, proposal.prompt)
    : await update('revise', { prompt: proposal.prompt, planVersion: proposal.planVersion });
  if (ok) { proposal.done = true; switchTab('run'); }
  renderTurns();
}
function renderTurns() {
  $('dialogue').querySelector('.chat-welcome').hidden = turns.length > 0;
  const nodes = turns.map(({ role, content, source, proposal }) => {
    const node = make('div', '', `turn ${role}`);
    node.append(make('b', role === 'user' ? (source ? `Du · mit ${source}` : 'Du') : 'Kontext'), document.createTextNode(content));
    if (proposal) {
      if (canFollow(proposal)) node.append(control(proposal.type === 'explore' ? 'Erkundung starten' : 'Plan überarbeiten', () => follow(proposal)));
      else node.append(make('small', proposal.done ? 'Vorschlag ausgeführt' : 'Vorschlag nicht mehr aktuell'));
    }
    return node;
  });
  $('turns').replaceChildren(...nodes);
  if (activeTab === 'talk') { const scroll = $('turns').closest('.stage-scroll'); scroll.scrollTop = scroll.scrollHeight; }
}
async function submit() {
  const input = $('prompt').value.trim();
  if (busy || !input) return;
  if (activeTab === 'run') {
    if (run?.status === 'review') {
      if (await update('revise', { prompt: input }) && $('prompt').value.trim() === input) $('prompt').value = '';
      return;
    }
    if (run?.status === 'paused') return launch('AGENT_RESUME');
    if (!run || run.status === 'done') return launch('AGENT_START');
    switchTab('talk');
  }
  if (talking) return;
  const tab = scope;
  const includePage = Boolean(tab && $('page-context').checked);
  const expected = { scope: tab, runId: run?.id, planVersion: run?.planVersion };
  $('page-context').checked = false;
  $('prompt').value = '';
  talking = true; error(); switchTab('talk');
  const entry = { role: 'user', content: input, source: includePage ? new URL(tab.origin).host : '' };
  const history = turns.slice(-10).map(({ role, content }) => ({ role, content }));
  turns = [...turns.slice(-24), entry]; renderTurns();
  try {
    const page = includePage ? (await local('PAGE_CONTEXT', tab)).page : undefined;
    const output = await request('talk', { prompt: input, history, scope: tab, page });
    if (!connected) return;
    const proposal = output.proposal ? { ...expected, type: output.proposal, prompt: input } : null;
    turns.push({ role: 'assistant', content: output.reply, proposal }); renderTurns(); speak(output.reply);
  } catch (failure) {
    if (connected) { error(failure.message); turns = turns.filter((turn) => turn !== entry); renderTurns(); $('prompt').value ||= input; }
  } finally { talking = false; switchTab(activeTab); }
}

let recording;
let stream;
let timer;
let listening = false;
let voiceBusy = false;
function voiceStatus(line, active = false) {
  $('voice-state').hidden = !line; $('voice-state').textContent = line;
  $('mic').classList.toggle('recording', active);
  $('mic').setAttribute('aria-label', active ? 'Aufnahme beenden' : 'Mikrofon starten');
  $('mic').title = $('mic').getAttribute('aria-label');
}
function voiceResult(value) {
  if (value?.trim()) {
    $('prompt').value = `${$('prompt').value.trim()} ${value.trim()}`.trim();
    if (voice.autoSend && activeTab === 'talk') void submit(); else $('prompt').focus();
  }
}
const base64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
});
async function mic() {
  if (listening) { recording?.stop?.(); return; }
  if (voiceBusy) return;
  $('mic-help').hidden = true; error();
  if (voice.mode === 'browser') {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return error('Diese Chrome-Version bietet keine Browser-Spracherkennung. Nutze den lokalen Whisper-Dienst.');
    const input = new Recognition(); input.lang = 'de-DE';
    input.onresult = (event) => voiceResult([...event.results].filter((item) => item.isFinal).map((item) => item[0].transcript).join(' '));
    input.onerror = (event) => { error('Chrome konnte das Mikrofon oder die Spracherkennung nicht starten.'); $('mic-help').hidden = event.error !== 'not-allowed'; };
    input.onend = () => { listening = false; recording = null; clearTimeout(timer); voiceStatus(''); };
    try { input.start(); recording = input; listening = true; timer = setTimeout(() => { if (listening) input.stop(); }, 45_000); voiceStatus('Chrome hört zu …', true); }
    catch { error('Die Browser-Spracherkennung konnte nicht gestartet werden.'); }
    return;
  }
  voiceBusy = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recording = recorder;
    const parts = [];
    recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    recorder.onerror = () => { clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); listening = false; recording = null; voiceStatus(''); error('Die Aufnahme ist fehlgeschlagen.'); };
    recorder.onstop = async () => {
      clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); stream = null; listening = false; recording = null; voiceBusy = true;
      voiceStatus('Lokales Whisper erkennt die Aufnahme …');
      try {
        const audio = new Blob(parts, { type: recorder.mimeType || 'audio/webm' });
        if (!audio.size) throw Error('Es wurde kein Ton aufgenommen.');
        const result = await request('transcribe', { data: await base64(audio), mime: audio.type });
        if (result.text) voiceResult(result.text); else error('Keine Sprache erkannt.');
      } catch (failure) { error(failure.message || 'Die Aufnahme konnte nicht verarbeitet werden.'); }
      finally { voiceStatus(''); voiceBusy = false; }
    };
    recorder.start(); listening = true; timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 45_000); voiceStatus('Aufnahme läuft · erneut klicken zum Beenden', true);
  } catch { stream?.getTracks().forEach((track) => track.stop()); error('Kein Mikrofon verfügbar oder Zugriff nicht erlaubt.'); $('mic-help').hidden = false; }
  finally { voiceBusy = false; }
}
$('settings').addEventListener('click', () => { setup = !setup; syncConnection(); });
$('scope-refresh').addEventListener('click', () => { error(); void syncScope(); });
$('run-tab').addEventListener('click', () => switchTab('run'));
$('talk-tab').addEventListener('click', () => switchTab('talk'));
$('composer').addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
$('prompt').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); } });
$('mic').addEventListener('click', mic);
$('mic-help').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('microphone.html') }));
$('speak').addEventListener('click', () => { spokenSet = true; spoken = !spoken; updateVoice(); if (!spoken) window.speechSynthesis?.cancel(); });
$('mirror').addEventListener('change', async () => {
  const field = $('mirror'); field.disabled = true;
  try { field.checked = (await local('SET_MIRROR', { enabled: field.checked })).mirror; error(); }
  catch (failure) { field.checked = !field.checked; error(failure.message); }
  finally { field.disabled = false; }
});
$('disconnect').addEventListener('click', async () => {
  try {
    await local('UNPAIR'); tokenValue = ''; connected = false; turns = []; $('prompt').value = ''; $('page-context').checked = false;
    window.speechSynthesis?.cancel(); apply(null); renderTurns(); syncConnection(); error();
  }
  catch (failure) { error(failure.message); }
});
$('pair').addEventListener('submit', async (event) => {
  event.preventDefault(); error(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try { await local('PAIR', { code: $('code').value.trim() }); $('code').value = ''; setup = false; await checkConnection(); }
  catch (failure) { error(failure.message); }
  finally { button.disabled = false; }
});
chrome.tabs.onActivated.addListener(() => { if (connected) void syncScope(); });
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (connected && tab.active && change.url) void syncScope(); });
window.addEventListener('beforeunload', () => { stream?.getTracks().forEach((track) => track.stop()); clearTimeout(timer); });
renderRun(); void checkConnection();
setInterval(() => { if (connected) void poll(); else if (tokenValue && !setup) void checkConnection(); }, 1600);
