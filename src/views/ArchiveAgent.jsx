import { useEffect, useState } from 'react';
import { Archive, ArrowRight, Check, ChevronRight, Chrome, CircleHelp, FolderTree, ListChecks, Pause, Play, ScanLine, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { Button, ErrorLine, formatTime, modeNames, PlatformIcon, ProjectSymbol, StatusDot } from '../components/ui.jsx';
import { Heading } from './Workspace.jsx';
import './archive-agent.css';

const phases = [
  [ScanLine, 'Seite erkunden', 'Der Agent findet sichtbare Verläufe und Projekte im freigegebenen Tab.'],
  [FolderTree, 'Archivplan prüfen', 'Sieh nach, wie Chats, Phasen und Antwortspuren zugeordnet werden.'],
  [Archive, 'Chats sichern', 'Die freigegebenen Chats werden nacheinander lokal gespeichert.'],
];
const names = { exploring: 'Seite erkunden', revising: 'Plan wird überarbeitet', review: 'Archivplan zur Freigabe', archiving: 'Chats werden gesichert', paused: 'Archivlauf pausiert', done: 'Archivlauf abgeschlossen' };
const active = ['exploring', 'revising', 'archiving'];
const itemStates = { pending: 'Wartet', reading: 'Wird gelesen', saved: 'Gesichert', skipped: 'Übersprungen' };
const demoPrompt = 'Untersuche meinen Arena-Verlauf und ordne die Chats nach Projekten und Phasen. Bewahre beide Antworten bei Duellen.';

function Steps({ run }) {
  const step = !run ? -1 : run.status === 'paused' ? (run.resumeStage === 'archiving' ? 2 : run.resumeStage === 'revising' ? 1 : 0)
    : run.status === 'exploring' ? 0 : ['review', 'revising'].includes(run.status) ? 1 : 2;
  return <ol className="agent-steps" aria-label="Ablauf">{phases.map(([Icon, title, detail], index) => <li key={title} className={step > index || run?.status === 'done' ? 'complete' : step === index ? 'current' : ''}>
    <div className="agent-step-top"><span className="agent-step-icon">{step > index || run?.status === 'done' ? <Check size={18} /> : <Icon size={18} />}</span><span className="agent-step-num">0{index + 1}</span></div>
    <h3>{title}</h3><p>{detail}</p>
  </li>)}</ol>;
}
function RunLog({ run }) {
  if (!run.log.length) return null;
  return <details className="agent-log card" open={active.includes(run.status) && run.status !== 'archiving' || undefined}>
    <summary><ListChecks size={16} /> Schrittprotokoll <span>{run.log.length} Einträge</span></summary>
    <ol>{run.log.slice().reverse().map((entry, i) => <li key={`${entry.time}-${i}`}><time>{formatTime(entry.time)}</time><span>{entry.text}</span></li>)}</ol>
  </details>;
}
function Structure({ plan }) {
  return <div className="agent-structure card">
    <div className="agent-section-heading"><span className="agent-step-icon"><FolderTree size={18} /></span><div><h3>{plan.caption}</h3><p>Vorgeschlagene Archivstruktur</p></div></div>
    {plan.explanation && <p className="agent-copy">{plan.explanation}</p>}
    <div className="agent-schema">{['Projekt', 'Phase', 'Chat', 'Nachricht', 'Antwortspur'].map((label, i) => <span key={label}>{i > 0 && <ChevronRight size={13} />}{label}</span>)}</div>
    {plan.structure && <p className="agent-copy">{plan.structure}</p>}
    <div className="agent-projects">{plan.projects.map((project, i) => <div key={project.name} className="agent-project">
      <h4><ProjectSymbol color={i % 2 ? 'mint' : 'violet'} />{project.name}</h4><div className="phase-chips">{project.stages.map((stage) => <span key={stage}>{stage}</span>)}</div>
    </div>)}</div>
  </div>;
}
export default function ArchiveAgentView({ data, run, statusError, onRun, onSettings, navigate }) {
  const demo = data.demo;
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [choice, setChoice] = useState(new Set());
  const [revise, setRevise] = useState('');
  const planKey = run?.status === 'review' ? `${run.id}-${run.planVersion}` : '';
  useEffect(() => {
    if (planKey) setChoice(new Set(run.plan.items.map((item) => item.id)));
  }, [planKey]);
  async function control(action, body = {}) {
    setBusy(true); setFailure('');
    try { onRun(await api(`/agent/${action}`, 'POST', { id: run?.id, ...body })); return true; }
    catch (error) { setFailure(error.message); return false; }
    finally { setBusy(false); }
  }
  const start = (replace = false) => control('start', { prompt: prompt.trim() || demoPrompt, id: undefined, replace });
  const startLabel = run?.status === 'done' ? 'Neue Demo starten' : 'Demo-Lauf starten';
  const toggle = (id) => setChoice((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const complete = run?.status === 'done';
  return <section className="workspace-page collection-page agent-page">
    <Heading icon={Sparkles} kicker="Browser-Assistent" title="Archiv-Agent" description="Vom geöffneten Chrome-Tab zum strukturierten, lokalen Archiv."
      actions={demo && !run ? <Button variant="primary" icon={Play} onClick={() => start()} busy={busy}>{startLabel}</Button>
        : !demo ? <Button icon={Chrome} onClick={() => onSettings('chrome')}>{data.browser.connection === 'connected' ? 'Chrome-Anleitung' : 'Chrome einrichten'}</Button> : null} />
    <section className="agent-source card" aria-label="Quelle">
      <PlatformIcon platform={demo || run?.origin?.includes('arena.ai') ? 'arena' : null} />
      <div className="agent-source-copy"><small>{demo ? 'BEISPIEL-QUELLE' : 'CHROME-VERBINDUNG'}</small><strong>{demo ? 'Arena' : run ? new URL(run.origin).host : 'Kontext in Chrome'}</strong>
        <span>{demo ? 'arena.ai · simulierte Oberfläche' : run ? 'Freigegebene Website des Archivlaufs' : 'Starte einen Archivlauf über das Erweiterungssymbol'}</span></div>
      <span className="pill neutral-pill agent-source-tag"><StatusDot tone={demo ? 'violet' : data.browser.connection === 'connected' ? 'green' : 'muted'} />{demo ? 'Demo-Modus' : data.browser.connection === 'connected' ? 'Gekoppelt' : 'Nicht verbunden'}</span>
    </section>
    <Steps run={run} />
    <ErrorLine>{failure || statusError}</ErrorLine>
    {!run && <section className="agent-start card">
      <div className="agent-section-heading"><span className="agent-step-icon"><ScanLine size={19} /></span><div><h2>{demo ? 'Einen Archivlauf ausprobieren' : 'In Chrome starten'}</h2><p>{demo ? 'Ein Beispiel mit mehreren Projekten, Multi-Chat und Duell.' : 'Die Website bleibt in deinem Chrome-Tab. Kontext speichert nur die freigegebenen Kopien.'}</p></div></div>
      {demo ? <form onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <label className="field"><span>Archivauftrag <small>optional</small></span><textarea rows="2" value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder={demoPrompt} /></label>
        <div className="agent-start-foot"><span><ShieldCheck size={14} /> Keine Verbindung zu deinem Browser</span><Button type="submit" icon={ArrowRight} busy={busy}>Erkundung starten</Button></div>
      </form> : <div className="agent-instructions"><p><strong>1.</strong> Öffne in Chrome die Chat-Seite, deren Verlauf du archivieren möchtest.</p><p><strong>2.</strong> Klicke auf das Kontext-Symbol. Im Seitenbereich kannst du den Auftrag diktieren oder eingeben.</p><p><strong>3.</strong> Prüfe den Archivplan dort und gib die Auswahl frei. Den Fortschritt siehst du auch hier.</p></div>}
    </section>}
    {run && <>
      <div className="agent-run-header card" role="status">
        <span className={`agent-step-icon ${complete ? 'completed' : ''}`}>{complete ? <Check size={19} /> : run.status === 'paused' ? <Pause size={18} /> : <ScanLine size={18} />}</span>
        <div><h2>{names[run.status] || 'Archivlauf'}</h2><p>{run.notice || (run.status === 'review' ? `${run.plan.items.length} belegte Chat-Ziele · noch nichts gespeichert.`
          : run.status === 'archiving' || complete ? `${run.saved} gespeichert · ${run.skipped} übersprungen${run.current ? ` · ${run.current}` : ''}`
            : `${run.observedCount} Seiten und Links gesehen. Noch nichts gespeichert.`)}</p></div>
        {active.includes(run.status) && <Button icon={Pause} onClick={() => control('pause')} busy={busy}>Pausieren</Button>}
        {run.status === 'paused' && demo && <Button variant="primary" icon={Play} onClick={() => control('resume')} busy={busy}>Fortsetzen</Button>}
        {complete && <Button icon={Archive} onClick={() => navigate({ page: 'archive' })}>Zum Archiv</Button>}
      </div>
      {run.status === 'paused' && (demo ? <button className="agent-replace inline-button" type="button" disabled={busy} onClick={() => start(true)}>Pausierten Lauf durch neuen Demo-Lauf ersetzen</button>
        : <div className="inline-info agent-tip"><CircleHelp size={15} /> Setze den Lauf über den Kontext-Seitenbereich in Chrome fort.</div>)}
      {['review', 'revising'].includes(run.status) && run.plan && <>
        <Structure plan={run.plan} />
        {run.plan.caution && <div className="inline-info agent-tip"><CircleHelp size={15} />{run.plan.caution}</div>}
        <section className="agent-review card"><div className="agent-review-heading"><div><h3>Chats zur Freigabe</h3><p>{demo ? `${choice.size} von ${run.plan.items.length} ausgewählt` : `${run.plan.items.length} vorgeschlagen · Freigabe im Chrome-Seitenbereich`}</p></div>
          {demo && <Button icon={Check} variant="primary" onClick={() => control('approve', { ids: [...choice], planVersion: run.planVersion })} disabled={!choice.size || run.status !== 'review'} busy={busy}>Auswahl archivieren</Button>}
        </div>
          <div className="agent-review-items">{run.plan.items.map((item) => <label className="agent-review-item" key={item.id}>{demo && <input type="checkbox" checked={choice.has(item.id)} onChange={() => toggle(item.id)} disabled={run.status !== 'review' || busy} />}
            <span><strong>{item.label}</strong><small>{[item.project, item.stage, new URL(item.url).pathname].filter(Boolean).join(' · ')}</small></span><span className={`mode-badge ${item.mode}`}>{modeNames[item.mode]}</span></label>)}</div>
          {demo && <form className="agent-revise" onSubmit={async (event) => { event.preventDefault(); if (await control('revise', { prompt: revise, planVersion: run.planVersion })) setRevise(''); }}>
            <label className="field"><span>Plan überarbeiten</span><input value={revise} onChange={(event) => setRevise(event.target.value)} maxLength={4000} placeholder="z. B. Nur Campus-App archivieren" /></label>
            <Button type="submit" disabled={!revise.trim() || run.status !== 'review'} busy={busy}>Überarbeiten</Button>
          </form>}
        </section>
      </>}
      {!!run.items.length && <section className="agent-review card"><div className="agent-review-heading"><div><h3>Archivierte und vorgemerkte Chats</h3><p>{run.saved + run.skipped} von {run.items.length} geprüft</p></div><span className="progress-num">{Math.round(100 * (run.saved + run.skipped) / run.items.length)}%</span></div>
        <progress className="agent-progress" value={run.saved + run.skipped} max={run.items.length} aria-label="Archivfortschritt" />
        {run.items.map((item) => item.chatId ? <button type="button" key={item.id} className="agent-review-item agent-result" onClick={() => navigate({ page: 'archive', id: item.chatId, from: { page: 'agent' } })}>
          <Check size={17} /><span><strong>{item.label}</strong><small>{[itemStates[item.status], item.stage, item.note].filter(Boolean).join(' · ')}</small></span><span className={`mode-badge ${item.mode}`}>{modeNames[item.mode]}</span><ArrowRight size={15} />
        </button> : <div key={item.id} className="agent-review-item"><StatusDot tone={item.status === 'reading' ? 'violet' : 'muted'} /><span><strong>{item.label}</strong><small>{[itemStates[item.status], item.note].filter(Boolean).join(' · ')}</small></span></div>)}
      </section>}
      <RunLog run={run} />
      {complete && demo && <Button className="agent-repeat" icon={Play} onClick={() => start()} busy={busy}>{startLabel}</Button>}
    </>}
    <div className="agent-note"><ShieldCheck size={14} /><span>Der Archiv-Agent liest und navigiert. Er sendet keine Nachrichten, füllt keine Formulare aus und ändert keine Online-Chats.</span></div>
  </section>;
}
