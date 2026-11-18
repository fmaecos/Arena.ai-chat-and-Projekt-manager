import { useCallback, useEffect, useState } from 'react';
import { Archive, ChevronDown, Chrome, Code2, Database, Folder, FolderOpen, Layers3, MessageSquare, PanelRightOpen, Plus, ScanLine, Search, Settings, ShieldCheck } from 'lucide-react';
import { api, sleep } from './api.js';
import Assistant from './components/Assistant.jsx';
import Dialogs from './components/Dialogs.jsx';
import { Button, ErrorLine, IconButton, Logo, ProjectSymbol, StatusDot, Toasts } from './components/ui.jsx';
import { CodeView, FilesView } from './views/Files.jsx';
import { ArchiveView, LiveView, Loading, ProjectsView } from './views/Workspace.jsx';
import ArchiveAgentView from './views/ArchiveAgent.jsx';

const navItems = [
  ['agent', ScanLine, 'Archiv-Agent'], ['live', MessageSquare, 'Live-Chat'], ['archive', Archive, 'Chat-Archiv'], ['projects', Folder, 'Projekte'], ['files', FolderOpen, 'Dateien'], ['code', Code2, 'Code-Ansicht'],
];
const initialView = { page: 'agent' };
const statusName = { demo: 'Chrome-Demo', connected: 'Chrome verbunden', offline: 'Chrome offline', unpaired: 'Chrome nicht gekoppelt' };

function Sidebar({ data, view, navigate, openSettings, openDialog }) {
  const projects = data?.projects.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)) || [];
  return <nav className="sidebar" aria-label="Arbeitsbereich">
    <button className="workspace-switch" type="button" title="Workspace-Speicher anzeigen" onClick={() => openSettings('storage')}>
      <span className="workspace-icon"><Layers3 size={18} /></span><span className="workspace-id"><strong>Mein Workspace</strong><small>Persönlicher Bereich</small></span><ChevronDown size={14} />
    </button>
    <div className="sidebar-scroll scroll-region"><div className="sidebar-section main-nav"><span className="sidebar-label">Arbeitsbereich</span>
      {navItems.map(([page, Icon, label]) => <button type="button" key={page} title={label} className={`nav-item${view.page === page ? ' active' : ''}`} aria-current={view.page === page ? 'page' : undefined}
        onClick={() => navigate({ page })}><Icon size={17} /><span>{label}</span>
        {page === 'live' && ['demo', 'connected'].includes(data?.browser?.connection) && <StatusDot />}
        {page === 'archive' && data?.chats?.length > 0 && <small className="nav-count">{data.chats.length}</small>}
      </button>)}
    </div>
    <div className="sidebar-section project-nav"><div className="sidebar-label-row"><span className="sidebar-label">Projekte</span><IconButton icon={Plus} label="Neues Projekt" size={16} onClick={() => openDialog({ kind: 'project' })} disabled={!data} /></div>
      {projects.map((project) => <button className={`project-nav-item${view.page === 'projects' && view.id === project.id ? ' active' : ''}`} key={project.id} type="button" title={project.name}
        onClick={() => navigate({ page: 'projects', id: project.id })}><ProjectSymbol color={project.color} /><span>{project.name}</span></button>)}
      {!projects.length && data && <button className="project-nav-empty" type="button" onClick={() => openDialog({ kind: 'project' })}>Projekt erstellen</button>}
    </div></div>
    <button className="storage-card" type="button" title="Lokalen Speicher anzeigen" onClick={() => openSettings('storage')}>
      <span className="storage-icon"><Database size={17} /></span><span><strong>Lokaler Speicher</strong><small>{data?.demo ? 'SQLite · Demo-Daten' : 'SQLite · Auf diesem Gerät'}</small></span><StatusDot />
    </button>
  </nav>;
}

export default function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState(initialView);
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [error, setError] = useState('');
  const [assistantVisible, setAssistantVisible] = useState(() => window.innerWidth > 1000);
  const [browserFeedback, setBrowserFeedback] = useState(false);
  const [agentRun, setAgentRun] = useState(null);
  const [agentError, setAgentError] = useState('');
  const updateRun = useCallback((next) => setAgentRun((old) => {
    if (!next || old && (old.updatedAt > next.updatedAt || old.updatedAt === next.updatedAt && old.id === next.id && old.status === next.status)) return old;
    return next;
  }), []);
  const dismiss = useCallback((id) => setToasts((current) => current.filter((item) => item.id !== id)), []);
  const notify = useCallback((message, tone) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => dismiss(id), 4800);
  }, [dismiss]);
  const navigate = useCallback((target) => setView(target), []);
  const openSettings = useCallback((tab = 'chrome') => setDialog({ kind: 'settings', tab }), []);
  const reload = useCallback(async () => {
    try { const next = await api('/bootstrap'); setData(next); setError(''); return next; }
    catch (failure) { setError(failure.message); throw failure; }
  }, []);
  const revision = data?.browser?.live?.revision;
  const ready = Boolean(data);
  const sync = useCallback(async (knownRevision) => {
    const next = await api(knownRevision ? `/live/${knownRevision}` : '/live');
    setData((old) => {
      if (!old) return old;
      if (next.unchanged && old.browser.live?.revision !== knownRevision) return old;
      const live = next.unchanged ? old.browser.live : next.live;
      if (old.browser.connection === next.connection && old.browser.live?.revision === live?.revision
        && old.browser.tab?.url === next.tab?.url && old.browser.tab?.id === next.tab?.id) return old;
      return { ...old, browser: { ...next, live } };
    });
  }, []);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  useEffect(() => {
    if (!ready) return undefined;
    let disposed = false, pending = false;
    const lookup = async () => {
      if (pending) return;
      pending = true;
      try { const result = await api('/agent'); if (!disposed) { updateRun(result.run); setAgentError(''); } }
      catch (error) { if (!disposed) setAgentError(error.message); }
      finally { pending = false; }
    };
    void lookup();
    const poll = setInterval(lookup, 1200);
    return () => { disposed = true; clearInterval(poll); };
  }, [ready, updateRun]);
  const archiveUpdate = agentRun && `${agentRun.id}:${agentRun.saved}`;
  useEffect(() => {
    if (archiveUpdate && !archiveUpdate.endsWith(':0')) reload().catch(() => {});
  }, [archiveUpdate, reload]);
  useEffect(() => {
    if (!ready) return undefined;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try { await sync(revision); setBrowserFeedback(false); } catch { setBrowserFeedback(true); }
      finally { pending = false; }
    }, 1900);
    return () => clearInterval(timer);
  }, [ready, revision, sync]);
  useEffect(() => {
    const keyboard = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault(); if (ready) setDialog((old) => old?.kind === 'search' ? null : { kind: 'search' });
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [ready]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const resize = () => setAssistantVisible(!media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const updateSettings = useCallback((settings) => setData((old) => ({ ...old, settings })), []);
  const saveLive = () => { if (data?.browser?.live) setDialog({ kind: 'save', live: data.browser.live }); };
  const runBrowser = async (action) => {
    let result = await api('/browser/commands', 'POST', action);
    for (let index = 0; index < 45 && ['queued', 'running'].includes(result.status); index++) {
      await sleep(650); result = await api(`/browser/commands/${result.id}`);
    }
    if (result.status !== 'done') throw new Error(result.note || 'Keine Bestätigung von Chrome erhalten.');
    sync(revision).catch(() => {});
    if (result.note) notify(result.note);
    return result;
  };
  const connection = browserFeedback ? 'offline' : data?.browser.connection;
  const online = ['connected', 'demo'].includes(connection);
  const pageProps = { data, view, navigate, dialog: setDialog, notify };
  const page = !data ? error ? <div className="workspace-page"><ErrorLine>{error}</ErrorLine><Button onClick={() => reload().catch(() => {})}>Erneut versuchen</Button></div>
    : <div className="workspace-page"><Loading>Workspace wird geöffnet …</Loading></div>
    : view.page === 'archive' ? <ArchiveView {...pageProps} /> : view.page === 'projects' ? <ProjectsView {...pageProps} /> : view.page === 'files' ? <FilesView {...pageProps} />
      : view.page === 'code' ? <CodeView {...pageProps} />
        : view.page === 'agent' ? <ArchiveAgentView data={data} run={agentRun} statusError={agentError} onRun={updateRun} onSettings={openSettings} navigate={navigate} /> : <LiveView browser={{ ...data.browser, connection }} onSettings={openSettings} onSave={saveLive} runBrowser={runBrowser} notify={notify} />;

  return <div className={`app-shell${assistantVisible ? ' has-assistant' : ''}`}>
    <header className="topbar">
      <button className="brand" type="button" onClick={() => navigate(initialView)} title="Zum Archiv-Agenten"><Logo /><span>Kontext</span></button>
      <div className="topbar-center"><button className="global-search" type="button" aria-label="Workspace durchsuchen" disabled={!ready} onClick={() => setDialog({ kind: 'search' })}>
        <Search size={16} /><span>Workspace durchsuchen …</span><span className="key-hint"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </button></div>
      <div className="topbar-actions">
        <button type="button" className={`chrome-status pill${online ? ' live-pill' : ' neutral-pill'}`} disabled={!ready} onClick={() => openSettings('chrome')} title="Chrome-Verbindung einrichten"><StatusDot tone={online ? 'green' : 'muted'} /><span>{statusName[connection] || 'Chrome'}</span></button>
        {!assistantVisible && <IconButton icon={PanelRightOpen} label="KI-Assistent öffnen" onClick={() => setAssistantVisible(true)} className="top-icon" />}
        <IconButton icon={Settings} label="Einstellungen" className="top-icon" onClick={() => openSettings()} disabled={!ready} />
        <button className="profile-button" type="button" title="Lokales Profil" aria-label="Lokales Profil" disabled={!ready} onClick={() => openSettings('storage')}>K</button>
      </div>
    </header>
    <div className="app-body">
      <Sidebar data={data} view={view} navigate={navigate} openSettings={openSettings} openDialog={setDialog} />
      <main className="main-content" id="main">{page}</main>
      {assistantVisible && <button className="mobile-shade" onClick={() => setAssistantVisible(false)} aria-label="Assistent ausblenden" />}
      <Assistant data={data} visible={assistantVisible} notify={notify} onSettings={openSettings} onSettingsChange={updateSettings}
        onClose={() => setAssistantVisible(false)} onArchive={saveLive} onNavigate={(page) => { navigate({ page }); if (window.innerWidth <= 1000) setAssistantVisible(false); }}
        onProject={(name) => setDialog({ kind: 'project', name })} onFile={(file) => setDialog({ kind: 'file', file })} runBrowser={runBrowser} />
    </div>
    <footer className="statusbar">
      <div><span><StatusDot /> Lokaler Workspace</span><i /><span className="status-private"><ShieldCheck size={13} /> {data?.demo ? 'Demo-Modus' : 'Privat auf diesem Gerät'}</span></div>
      <div><button type="button" className="status-extension" onClick={() => openSettings('chrome')} disabled={!ready}><Chrome size={13} /> Chrome-Erweiterung</button><i /><span className="version">v0.2.0</span></div>
    </footer>
    <Dialogs key={dialog ? `${dialog.kind}-${dialog.tab || dialog.chat?.id || dialog.project?.id || dialog.file?.id || ''}` : 'closed'} config={dialog} data={data} close={() => setDialog(null)} changed={reload} notify={notify}
      navigate={navigate} openDialog={setDialog} onSettingsChange={updateSettings} />
    <Toasts toasts={toasts} dismiss={dismiss} />
  </div>;
}
