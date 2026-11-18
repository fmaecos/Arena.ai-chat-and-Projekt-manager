import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, AudioLines, Check, ChevronDown, Files, Globe2, Link2, Mic, MoreHorizontal, PanelRightClose, Settings2, Sparkles, Square, TextAlignStart, Volume2, VolumeX, X } from 'lucide-react';
import { api, asBase64 } from '../api.js';
import { RichText } from './Transcript.jsx';
import { Button, IconButton, Menu, MenuItem, StatusDot } from './ui.jsx';

const heights = [11, 20, 30, 42, 31, 19, 10];
const points = [[63, 62, 1.25], [91, 32, 1.35], [49, 112, 1], [112, 130, 1.1], [89, 119, 1.45], [118, 23, 1], [206, 29, 1.3], [236, 43, 1.7], [271, 61, 1.4], [250, 95, 1], [227, 132, 1.5], [190, 145, 1], [70, 86, .8], [277, 111, 1.05], [156, 19, 1], [148, 147, 1.15]];
function VoiceOrb({ onClick, active }) {
  return <button className={`orb-button${active ? ' listening' : ''}`} type="button" onClick={onClick} aria-label={active ? 'Aufnahme beenden' : 'Sprachmodus starten'} title={active ? 'Aufnahme beenden' : 'Sprachmodus starten'}>
    <svg className="voice-orb" viewBox="0 0 320 163" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="orb-halo"><stop stopColor="#7d50f8" stopOpacity=".36"/><stop offset=".64" stopColor="#6940f1" stopOpacity=".11"/><stop offset="1" stopColor="#6940f1" stopOpacity="0"/></radialGradient>
        <radialGradient id="orb-body" cx=".32" cy=".19" r=".86"><stop stopColor="#c5a0ff"/><stop offset=".24" stopColor="#9870ed"/><stop offset=".61" stopColor="#653cd1"/><stop offset=".84" stopColor="#46259e"/><stop offset="1" stopColor="#2d1b67"/></radialGradient>
        <radialGradient id="orb-gloss" cx=".25" cy=".14" r=".79"><stop stopColor="#e6d3ff" stopOpacity=".66"/><stop offset=".54" stopColor="#bd9cfb" stopOpacity=".08"/><stop offset="1" stopColor="#bd9cfb" stopOpacity="0"/></radialGradient>
        <linearGradient id="orb-rim" x1="114" y1="34" x2="196" y2="132" gradientUnits="userSpaceOnUse"><stop stopColor="#dbbaff"/><stop offset=".55" stopColor="#9063f4"/><stop offset="1" stopColor="#ad85fb" stopOpacity=".3"/></linearGradient>
        <linearGradient id="orb-orbit" x1="74" y1="114" x2="248" y2="69" gradientUnits="userSpaceOnUse"><stop stopColor="#8a62e9" stopOpacity=".1"/><stop offset=".46" stopColor="#a57afc" stopOpacity=".78"/><stop offset="1" stopColor="#9a72ea" stopOpacity=".2"/></linearGradient>
        <linearGradient id="orb-bars" x1="147" y1="60" x2="171" y2="108" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#d9c4ff"/></linearGradient>
        <filter id="orb-glow" x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="6"/></filter>
        <filter id="bar-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6"/></filter>
      </defs>
      <ellipse cx="160" cy="82" rx="141" ry="81" fill="url(#orb-halo)"/>
      <circle cx="160" cy="82" r="68" stroke="#946df3" strokeOpacity=".13" strokeDasharray="2 4"/>
      <circle cx="160" cy="82" r="59" stroke="#ac88f9" strokeOpacity=".17"/>
      <ellipse cx="160" cy="82" rx="94" ry="30" transform="rotate(-13 160 82)" stroke="#9c78e7" strokeOpacity=".23"/>
      <ellipse cx="160" cy="82" rx="105" ry="38" transform="rotate(-13 160 82)" stroke="#a184dc" strokeOpacity=".1"/>
      {points.map(([x, y, r], i) => <circle className={i % 5 === 0 ? 'orb-particle' : undefined} key={x} cx={x} cy={y} r={r} fill={i % 3 ? '#a986eb' : '#cfafff'} opacity={i % 3 ? '.46' : '.8'} />)}
      <path d="M64 42v8m-4-4h8m183 70v8m-4-4h8M221 35v6m-3-3h6" stroke="#a881f6" strokeOpacity=".57" strokeWidth=".8" strokeLinecap="round"/>
      <circle cx="160" cy="82" r="47" fill="#834cf7" filter="url(#orb-glow)" opacity=".52"/>
      <circle className="orb-core" cx="160" cy="82" r="47" fill="url(#orb-body)" stroke="url(#orb-rim)" strokeWidth="1.2"/>
      <circle cx="160" cy="82" r="45.6" fill="url(#orb-gloss)"/>
      <path d="M123.5 64.5a40 40 0 0 1 40-22" stroke="#f1dfff" strokeOpacity=".52" strokeWidth="1.1" strokeLinecap="round"/>
      <path d="M67 101.5c5.7 16.2 49.5 23.1 99.6 11.6 48.9-11.2 86.8-34.2 85.4-47" stroke="url(#orb-orbit)" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="91" cy="114" r="2.1" fill="#c2a3ff"/><circle cx="229" cy="89" r="1.6" fill="#caaaff"/>
      <g fill="#f6e7ff" filter="url(#bar-glow)" opacity=".56">{heights.map((h, i) => <rect key={i} x={135 + i * 7.6} y={82 - h / 2} width="4.6" height={h} rx="2.3" />)}</g>
      <g fill="url(#orb-bars)" className="orb-bars">{heights.map((h, i) => <rect key={i} x={135 + i * 7.6} y={82 - h / 2} width="4.6" height={h} rx="2.3" style={{ '--bar-delay': `${i * 80}ms` }} />)}</g>
    </svg>
  </button>;
}

function useVoice(mode, onText, notify) {
  const [state, setState] = useState('idle');
  const active = useRef(null);
  const onLatestText = useRef(onText);
  useEffect(() => { onLatestText.current = onText; }, [onText]);
  useEffect(() => () => {
    clearTimeout(active.current?.timeout);
    active.current?.recognition?.abort?.();
    active.current?.stream?.getTracks().forEach((track) => track.stop());
  }, []);
  async function toggle() {
    if (state === 'recording') {
      if (active.current?.recognition) active.current.recognition.stop();
      else if (active.current?.recorder?.state === 'recording') active.current.recorder.stop();
      return;
    }
    if (state !== 'idle') return;
    if (mode === 'browser') {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) return notify('Dieser Browser unterstützt keine Spracherkennung. Im Desktop kannst du lokales Whisper nutzen.', 'error');
      const recognition = new Recognition();
      recognition.lang = 'de-DE';
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const result = [...event.results].filter((item) => item.isFinal).map((item) => item[0].transcript).join(' ').trim();
        if (result) onLatestText.current(result);
      };
      recognition.onerror = (event) => {
        if (event.error === 'aborted') return;
        notify(event.error === 'not-allowed' ? 'Der Mikrofonzugriff wurde nicht erlaubt.' : 'Die Browser-Spracherkennung ist gerade nicht verfügbar.', 'error');
      };
      recognition.onend = () => { clearTimeout(active.current?.timeout); setState('idle'); active.current = null; };
      try { recognition.start(); active.current = { recognition, timeout: setTimeout(() => recognition.stop(), 45_000) }; setState('recording'); }
      catch { notify('Die Spracherkennung konnte nicht gestartet werden.', 'error'); }
      return;
    }
    setState('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find((value) => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        clearTimeout(active.current?.timeout);
        stream.getTracks().forEach((track) => track.stop());
        active.current = null;
        if (!chunks.length) { setState('idle'); return; }
        setState('transcribing');
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
          const result = await api('/transcribe', 'POST', { data: await asBase64(blob), mime: blob.type });
          if (result.text) onLatestText.current(result.text);
          else notify('In der Aufnahme wurde kein Text erkannt.', 'error');
        } catch (error) { notify(error.message, 'error'); }
        finally { setState('idle'); }
      };
      recorder.onerror = () => { clearTimeout(active.current?.timeout); active.current = null; stream.getTracks().forEach((track) => track.stop()); setState('idle'); notify('Die Aufnahme wurde unterbrochen.', 'error'); };
      recorder.start();
      active.current = { stream, recorder, timeout: setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 45_000) };
      setState('recording');
    } catch { stream?.getTracks().forEach((track) => track.stop()); setState('idle'); notify('Kein Mikrofon verfügbar oder der Zugriff wurde nicht erlaubt.', 'error'); }
  }
  return { state, toggle };
}

function speak(text, notify) {
  if (!('speechSynthesis' in window)) return notify('Dieses System bietet keine Sprachausgabe.', 'error');
  const utterance = new SpeechSynthesisUtterance(text.replace(/[`*_#~]/g, ''));
  utterance.lang = 'de-DE';
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => item.localService && item.lang.toLowerCase().startsWith('de')) || voices.find((item) => item.localService);
  if (voice) utterance.voice = voice;
  else return notify('Es ist keine lokale Systemstimme verfügbar.', 'error');
  utterance.onerror = (event) => { if (!['canceled', 'interrupted'].includes(event.error)) notify('Die Systemstimme ist nicht verfügbar.', 'error'); };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

const actions = { open_tab: 'Chrome-Tab öffnen', focus_chat: 'Original-Chat fokussieren', capture: 'Live-Chat aktualisieren', archive_chat: 'Chat sichern', new_project: 'Neues Projekt vorbereiten', navigate_workspace: 'Workspace-Ansicht öffnen' };
const workspaceLabels = { live: 'Live-Chat', archive: 'Chat-Archiv', projects: 'Projekte', files: 'Dateimanager', code: 'Code-Ansicht' };
const suggestions = [
  { icon: TextAlignStart, name: 'Chat zusammenfassen', value: 'Fasse den aktuellen Chat zusammen.', intent: 'summarize' },
  { icon: Files, name: 'Dateien durchsuchen', value: 'Zeige mir Dateien im Workspace.', intent: 'files' },
  { icon: Globe2, name: 'Chrome-Tab öffnen', value: 'Öffne ', fill: true },
];

export default function Assistant({ data, notify, onSettings, onSettingsChange, onClose, onArchive, onFile, onNavigate, onProject, runBrowser, visible }) {
  const [value, setValue] = useState('');
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [includeChat, setIncludeChat] = useState(false);
  const field = useRef(null);
  const scroll = useRef(null);
  const sending = useRef(false);
  const [doing, setDoing] = useState(null);
  const voice = useVoice(data?.settings?.speechMode || 'browser', (text) => {
    const recognized = `${value.trimEnd()}${value.trim() ? ' ' : ''}${text}`;
    if (data?.settings?.voiceAutoSend && !sending.current) { submit(recognized); return; }
    setValue(recognized);
    field.current?.focus();
  }, notify);
  const live = data?.browser?.live;
  const spoken = Boolean(data?.settings?.speakReplies);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [turns, busy]);

  async function submit(prompt, intent) {
    const body = prompt.trim();
    if (!body || sending.current) return;
    sending.current = true;
    const id = `t-${Date.now()}-${Math.random()}`;
    setValue(''); setBusy(true);
    setTurns((current) => [...current.slice(-30), { id: `${id}-user`, role: 'user', content: body }]);
    try {
      const result = await api('/assistant', 'POST', {
        prompt: body, includeChat: Boolean(includeChat && live), intent,
        history: turns.slice(-8).map(({ role, content }) => ({ role, content })),
      });
      setTurns((current) => [...current, { id, role: 'assistant', content: result.reply, source: result.source,
        action: result.action, matches: result.matches, revision: live?.revision }]);
      if (spoken) speak(result.reply, notify);
    } catch (error) {
      notify(error.message, 'error');
      setTurns((current) => current.filter((turn) => turn.id !== `${id}-user`));
      setValue(body);
    } finally { setBusy(false); sending.current = false; }
  }
  const mark = (id, state) => setTurns((items) => items.map((item) => item.id === id ? { ...item, actionState: state } : item));
  async function approve(turn) {
    const action = turn.action;
    if (action.type === 'archive_chat') {
      if (!live || live.revision !== turn.revision) return notify('Der Live-Chat ist nicht mehr derselbe. Bitte fordere die Aktion erneut an.', 'error');
      onArchive();
      return;
    }
    if (action.type === 'navigate_workspace') { onNavigate(action.page); mark(turn.id, 'done'); return; }
    if (action.type === 'new_project') { onProject(action.name); return; }
    setDoing(turn.id);
    try { await runBrowser({ ...action, revision: turn.revision }); mark(turn.id, 'done'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setDoing(null); }
  }
  async function toggleSpeech() {
    try {
      if (spoken) window.speechSynthesis?.cancel();
      onSettingsChange(await api('/settings', 'PATCH', { speakReplies: !spoken }));
      notify(spoken ? 'Sprachausgabe deaktiviert.' : 'Sprachausgabe aktiviert.');
    } catch (error) { notify(error.message, 'error'); }
  }
  const active = voice.state === 'recording';
  const working = ['starting', 'transcribing'].includes(voice.state);

  return <aside className={`assistant-panel${visible ? ' visible' : ''}`} aria-label="KI-Assistent">
    <header className="assistant-head">
      <div className="assistant-symbol"><Sparkles size={20} /></div>
      <div className="assistant-title"><h2>KI-Assistent</h2><p><StatusDot tone={busy || active ? 'violet' : 'green'} />{active ? 'Hört zu' : busy ? 'Antwortet' : working ? 'Verarbeitet' : 'Bereit'}</p></div>
      <Menu icon={MoreHorizontal} label="Assistent-Optionen">{(close) => <>
        <MenuItem icon={Settings2} onClick={() => { close(); onSettings('assistant'); }}>KI & Sprache einstellen</MenuItem>
        <MenuItem icon={Volume2} onClick={() => { close(); toggleSpeech(); }}>{spoken ? 'Sprachausgabe ausschalten' : 'Sprachausgabe einschalten'}</MenuItem>
        {!!turns.length && <MenuItem icon={X} disabled={busy || Boolean(doing)} onClick={() => { close(); setTurns([]); }}>Unterhaltung leeren</MenuItem>}
        <MenuItem icon={PanelRightClose} onClick={() => { close(); onClose(); }}>Assistent ausblenden</MenuItem>
      </>}</Menu>
      <IconButton icon={X} className="assistant-mobile-close" label="Assistent schließen" onClick={onClose} />
    </header>
    {turns.length || busy ? <div className="assistant-thread scroll-region" ref={scroll} aria-live="polite">
      {turns.map((turn) => <div className={`ai-turn ${turn.role}`} key={turn.id}>
        {turn.role === 'assistant' && <div className="ai-turn-label"><Sparkles size={13} /><strong>Kontext</strong>{turn.source && <span>{turn.source}</span>}</div>}
        <RichText>{turn.content}</RichText>
        {turn.matches?.map((file) => <button key={file.id} className="ai-file" onClick={() => onFile(file)}><Files size={14} /><span>{file.path}</span><ArrowRight size={13} /></button>)}
        {turn.action && <div className="action-card">
          <strong>{actions[turn.action.type]}</strong>
          {(turn.action.url || turn.action.name || workspaceLabels[turn.action.page]) && <p>{turn.action.url || turn.action.name || workspaceLabels[turn.action.page]}</p>}
          {turn.actionState ? <span className="action-state">{turn.actionState === 'done' ? <><Check size={13} /> Ausgeführt</> : 'Verworfen'}</span> : <div className="action-buttons"><Button variant="primary" busy={doing === turn.id} onClick={() => approve(turn)}>{turn.action.type === 'archive_chat' ? 'Speicherdialog' : 'Bestätigen'}</Button><Button variant="ghost" disabled={doing === turn.id} onClick={() => mark(turn.id, 'dismissed')}>Verwerfen</Button></div>}
        </div>}
      </div>)}
      {busy && <div className="ai-loading"><Sparkles size={15} /><span></span><span></span><span></span></div>}
    </div> : <div className="assistant-start scroll-region">
      <div className="voice-intro">
        <VoiceOrb active={active} onClick={voice.toggle} />
        <h3>{active ? 'Ich höre zu …' : 'Bereit, wenn du es bist.'}</h3>
        <p>Sprich mit Kontext, steuere Chrome<br className="assistant-break" /> oder arbeite mit deinem Archiv.</p>
      </div>
      <div className="suggestions"><h3>Schnellbefehle</h3>{suggestions.map(({ icon: Icon, name, intent, value: suggestion, fill }) => <button className="suggestion" type="button" key={name} onClick={() => {
        if (!fill) submit(suggestion, intent);
        else { setValue(suggestion); field.current?.focus(); }
      }}><span className="suggestion-icon"><Icon size={16} /></span><span>{name}</span><ArrowRight size={15} className="suggestion-arrow" /></button>)}</div>
    </div>}
    <div className="composer-wrap">
      {working && <div className="recording-label" role="status"><AudioLines size={14} />{voice.state === 'starting' ? 'Mikrofon wird geöffnet …' : 'Sprache wird erkannt …'}</div>}
      {active && <div className="recording-label" role="status"><StatusDot tone="rose" />Aufnahme läuft · zum Beenden erneut klicken</div>}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); submit(value); }}>
        <textarea aria-label="Nachricht an den Assistenten" ref={field} placeholder="Frag mich etwas …" rows="2" value={value} maxLength={12000}
          onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(value); }
          }} />
        <div className="composer-actions"><div>
          <IconButton icon={active ? Square : Mic} className={active ? 'recording' : ''} label={active ? 'Aufnahme beenden' : 'Spracheingabe'} onClick={voice.toggle} disabled={working} />
          <IconButton icon={Link2} className={includeChat && live ? 'selected' : ''} label="Live-Chat als Kontext verwenden" aria-pressed={Boolean(includeChat && live)} disabled={!live} onClick={() => setIncludeChat(!includeChat)} />
        </div><button type="submit" className="send-button" disabled={!value.trim() || busy} title="Nachricht senden" aria-label="Nachricht senden"><ArrowUp size={19} /></button></div>
      </form>
      <div className="voice-footer"><button onClick={toggleSpeech}>{spoken ? <Volume2 size={13} /> : <VolumeX size={13} />} Sprachausgabe <span>{spoken ? 'an' : 'aus'}</span><ChevronDown size={11} /></button>{includeChat && live && <span className="context-label">Mit Chat-Kontext</span>}</div>
    </div>
  </aside>;
}
