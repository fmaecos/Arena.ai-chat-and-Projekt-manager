import { useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Chrome, Copy, Database, Download, Ellipsis, ExternalLink, FileText, Folder, FolderOpen, FolderPlus, Link2, ListFilter, LoaderCircle, Monitor, Pencil, Plus, Radio, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { api, copyText, download, exportChat, openExternal } from '../api.js';
import { Transcript } from '../components/Transcript.jsx';
import { Button, Empty, ErrorLine, FileIcon, formatDate, formatSize, IconButton, Menu, MenuItem, modeNames, PlatformIcon, platformNames, ProjectSymbol, StatusDot } from '../components/ui.jsx';
import { useResource } from '../components/useResource.js';

export function Heading({ kicker, icon: Icon, title, description, actions, live = false }) {
  return <header className="page-heading"><div className="heading-text"><div className={`eyebrow${live ? ' live-eyebrow' : ''}`}>{live ? <StatusDot /> : Icon && <Icon size={14} />}{kicker}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function Loading({ children = 'Wird geladen …' }) { return <div className="loading" role="status"><LoaderCircle className="spin" size={18} />{children}</div>; }

export function LiveView({ browser, onSettings, onSave, runBrowser, notify }) {
  const [refreshing, setRefreshing] = useState(false);
  const viewing = browser.live;
  const isDemo = browser.connection === 'demo';
  const online = browser.connection === 'connected' || isDemo;
  const platform = viewing?.platform || browser.tab?.platform;
  const url = viewing?.url || browser.tab?.url;
  const original = () => {
    if (online && viewing) runBrowser({ type: 'focus_chat', revision: viewing.revision }).catch((error) => notify(error.message, 'error'));
    else if (url) openExternal(url);
  };
  const refresh = async () => {
    setRefreshing(true);
    try { await runBrowser({ type: 'capture' }); }
    catch (error) { notify(error.message, 'error'); }
    finally { setRefreshing(false); }
  };
  const copyUrl = async () => { try { await copyText(url); notify('Link kopiert.'); } catch (error) { notify(error.message, 'error'); } };
  return <section className="workspace-page live-page">
    <Heading live={online} icon={Radio} kicker="Browser-Spiegelung" title="Live-Chat" description="Dein aktueller Chrome-Chat, direkt in deinem Workspace."
      actions={<><IconButton icon={RefreshCw} label="Live-Chat aktualisieren" className={`outline refresh-button${refreshing ? ' refreshing' : ''}`} disabled={!online || refreshing} onClick={refresh} /><Button icon={Archive} variant="primary" className="save-button" disabled={!viewing} onClick={onSave}>Chat sichern</Button></>} />
    {(viewing || browser.tab) && <div className="source-bar card">
      <PlatformIcon platform={platform} />
      <div className="source-label"><strong>{platformNames[platform] || 'Webchat'}</strong><span>{url && new URL(url).hostname}</span></div>
      <span className={`pill source-pill ${online ? 'live-pill' : 'neutral-pill'}`}><StatusDot tone={online ? 'green' : 'muted'} />{isDemo ? 'Live-Demo' : online ? 'Live' : 'Offline'}</span>
      <IconButton icon={ExternalLink} className="outline source-open" label="Original in Chrome öffnen" onClick={original} />
    </div>}
    {viewing ? <Transcript chat={{ ...viewing, displayTime: formatDate(viewing.capturedAt, true) }} notify={notify}
      actions={<Menu icon={Ellipsis} label="Live-Chat-Optionen">{(close) => <>
        <MenuItem icon={ExternalLink} onClick={() => { close(); original(); }}>Original öffnen</MenuItem>
        <MenuItem icon={Copy} onClick={() => { close(); copyUrl(); }}>Link kopieren</MenuItem>
        <MenuItem icon={Download} onClick={() => { close(); exportChat(viewing).catch((error) => notify(error.message, 'error')); }}>Markdown exportieren</MenuItem>
        <MenuItem icon={Archive} onClick={() => { close(); onSave(); }}>Im Archiv sichern</MenuItem>
      </>}</Menu>}
      footer={<><span className="sync-label"><Link2 size={14} />{isDemo ? 'Chrome-Spiegelung · Demo' : online ? 'Mit Chrome synchronisiert' : 'Letzte Aufnahme · Chrome offline'}</span><span className="view-only"><ShieldCheck size={13} /> Nur Ansicht</span></>} />
      : <div className="card empty-live"><Empty icon={online ? Monitor : Chrome}
        title={online ? browser.tab ? 'Noch kein Verlauf sichtbar' : 'Kein aktiver Webchat' : 'Verbinde deinen Chrome-Browser'}
        footer={online ? <Button icon={RefreshCw} busy={refreshing} onClick={refresh}>Erneut prüfen</Button> : <Button icon={Chrome} variant="primary" onClick={() => onSettings('chrome')}>Chrome einrichten</Button>}>
        {online ? browser.tab ? 'Öffne einen Chat mit Nachrichten. Falls du die Erweiterung gerade installiert hast, lade die Seite in Chrome einmal neu.' : 'Wähle einen Chat in Chrome und prüfe erneut. Für laufende Vorschauen kannst du im Kontext-Seitenbereich die Live-Spiegelung aktivieren.' : 'Kopple die Kontext-Erweiterung mit der Desktop-App, um den aktiven Webchat hier zu sehen und zu archivieren.'}
      </Empty></div>}
  </section>;
}

export function ChatRows({ chats, projects, onOpen, compact = false }) {
  return <div className={`item-list${compact ? ' compact-list' : ''}`}>{chats.map((chat) => {
    const project = projects.find((item) => item.id === chat.projectId);
    return <button type="button" className="item-row" key={chat.id} onClick={() => onOpen(chat)}>
      <PlatformIcon platform={chat.platform} />
      <span className="item-copy"><strong>{chat.title}</strong><span>{platformNames[chat.platform] || 'Webchat'} <i>·</i> {chat.count} {chat.count === 1 ? 'Nachricht' : 'Nachrichten'}{chat.archive?.stage && <> <i>·</i> {chat.archive.stage}</>}</span></span>
      {chat.archive?.mode && chat.archive.mode !== 'chat' && <span className={`mode-badge ${chat.archive.mode}`}>{modeNames[chat.archive.mode]}</span>}
      {project && !compact && <span className="project-tag"><ProjectSymbol color={project.color} dot />{project.name}</span>}
      <span className="item-date">{formatDate(chat.updatedAt)}</span><ArrowUpRight className="item-arrow" size={16} />
    </button>;
  })}</div>;
}
export function ArchiveView({ data, view, navigate, dialog, notify }) {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [platform, setPlatform] = useState('');
  const [mode, setMode] = useState('');
  const item = data.chats.find((chat) => chat.id === view.id);
  const resource = useResource(view.id ? `/chats/${view.id}${view.versionId ? `/versions/${view.versionId}` : ''}` : null, item?.updatedAt);
  const versions = useResource(view.id && item?.archive?.versionCount ? `/chats/${view.id}/versions` : null, item?.updatedAt);
  const backLabel = view.from?.page === 'projects' ? 'Zum Projekt' : view.from?.page === 'agent' ? 'Zum Archivlauf' : 'Zum Chat-Archiv';
  const matching = data.chats.filter((chat) => (!project || project === (chat.projectId ?? 'none')) && (!platform || platform === chat.platform) && (!mode || mode === chat.archive?.mode)
    && `${chat.title} ${chat.excerpt} ${chat.archive?.stage || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (view.id) {
    const chat = resource.data;
    const group = data.projects.find((p) => p.id === chat?.projectId);
    return <section className="workspace-page detail-page">
      <button className="back-link" onClick={() => navigate(view.from || { page: 'archive' })}><ArrowLeft size={15} /> {backLabel}</button>
      <Heading icon={Archive} kicker="Archivierter Chat" title={chat?.title || item?.title || 'Chat'} description={group ? `${platformNames[chat.platform]} · ${group.name}` : chat ? `${platformNames[chat.platform]} · Lokal gespeichert` : 'Lokal gespeichert'}
        actions={chat && <>{!view.versionId && <Button icon={Pencil} onClick={() => dialog({ kind: 'chat-edit', chat })}>Bearbeiten</Button>}<Button icon={Download} variant="primary" onClick={() => exportChat(chat).catch((error) => notify(error.message, 'error'))}>Exportieren</Button></>} />
      {(chat?.archive || versions.data?.length > 0) && <div className="archive-meta-strip" aria-label="Archiv-Metadaten">
        {chat?.archive?.mode && <span className={`mode-badge ${chat.archive.mode}`}>{modeNames[chat.archive.mode]}</span>}
        {chat?.archive?.stage && <span className="project-tag">Phase: {chat.archive.stage}</span>}
        {chat?.archive?.lanes?.length > 0 && <span>{chat.archive.lanes.length} Antwortspuren</span>}
        {chat?.archive?.needsReview && <span>Zuordnung oder Vollständigkeit prüfen</span>}
        {versions.data?.length > 0 && <label className="select-filter"><ChevronDown size={14} /><select aria-label="Archivstand" value={view.versionId || ''} onChange={(event) => navigate({ ...view, versionId: event.target.value || undefined })}>
          <option value="">Aktueller Archivstand</option>{versions.data.map((version) => <option key={version.id} value={version.id}>{formatDate(version.capturedAt, true)}</option>)}
        </select></label>}
        {chat?.archive?.note && <p>{chat.archive.note}</p>}
      </div>}
      {resource.error ? <ErrorLine>{resource.error}</ErrorLine> : !chat ? <Loading /> : <Transcript chat={{ ...chat, displayTime: formatDate(chat.capturedAt, true) }} notify={notify}
        actions={<Menu icon={Ellipsis} label="Archiv-Chat-Optionen">{(close) => <>
          <MenuItem icon={ExternalLink} onClick={() => { close(); openExternal(chat.url); }}>Original im Browser öffnen</MenuItem>
          <MenuItem icon={Download} onClick={() => { close(); exportChat(chat, 'json').catch((error) => notify(error.message, 'error')); }}>JSON exportieren</MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => { close(); dialog({ kind: 'delete', type: 'chat', item: chat, after: () => navigate(view.from || { page: 'archive' }) }); }}>Chat löschen</MenuItem>
        </>}</Menu>}
        footer={<><span className="sync-label"><Database size={14} /> Im lokalen Archiv</span><button className="inline-button" onClick={() => openExternal(chat.url)}><ExternalLink size={13} /> Original öffnen</button></>} />}
    </section>;
  }
  return <section className="workspace-page collection-page">
    <Heading icon={Archive} kicker="Arbeitsbereich" title="Chat-Archiv" description="Gesicherte Webchats mit Nachrichten, Code und Anhangsverweisen." actions={<Button icon={Radio} onClick={() => navigate({ page: 'live' })}>Zum Live-Chat</Button>} />
    <div className="collection-toolbar">
      <label className="filter-input"><Search size={16} /><input aria-label="Archiv filtern" placeholder="Chats filtern …" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="select-filter"><Folder size={15} /><select aria-label="Nach Projekt filtern" value={project} onChange={(event) => setProject(event.target.value)}><option value="">Alle Projekte</option><option value="none">Ohne Projekt</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="select-filter"><ListFilter size={15} /><select aria-label="Nach Plattform filtern" value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">Alle Plattformen</option>{Object.entries(platformNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      {data.chats.some((chat) => chat.archive) && <label className="select-filter"><ListFilter size={15} /><select aria-label="Nach Chat-Modus filtern" value={mode} onChange={(event) => setMode(event.target.value)}><option value="">Alle Modi</option>{Object.entries(modeNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>}
    </div>
    <div className="section-caption"><h2>Gespeicherte Chats</h2><span>{matching.length} {matching.length === 1 ? 'Chat' : 'Chats'}</span></div>
    {matching.length ? <ChatRows chats={matching} projects={data.projects} onOpen={(chat) => navigate({ page: 'archive', id: chat.id })} /> : <div className="card"><Empty icon={Archive} title={data.chats.length ? 'Keine passenden Chats' : 'Dein Archiv ist leer'} compact>{data.chats.length ? 'Ändere die Filter oder suche nach einem anderen Begriff.' : 'Sichere einen Live-Chat, um ihn hier wiederzufinden.'}</Empty></div>}
  </section>;
}

export function ProjectsView({ data, view, navigate, dialog, notify }) {
  const [exporting, setExporting] = useState(false);
  const [phase, setPhase] = useState({ project: '', stage: '' });
  const project = data.projects.find((item) => item.id === view.id);
  if (view.id && project) {
    const chats = data.chats.filter((chat) => chat.projectId === project.id);
    const files = data.files.filter((file) => file.projectId === project.id);
    const selectedPhase = phase.project === project.id ? phase.stage : '';
    const shownChats = selectedPhase ? chats.filter((chat) => selectedPhase === (chat.archive?.stage || '#ohne')) : chats;
    return <section className="workspace-page collection-page project-detail">
      <button className="back-link" onClick={() => navigate({ page: 'projects' })}><ArrowLeft size={15} /> Alle Projekte</button>
      <Heading icon={Folder} kicker="Projekt" title={project.name} description={project.description || 'Chats und Dateien für dieses Projekt.'}
        actions={<><Button icon={Pencil} onClick={() => dialog({ kind: 'project', project })}>Bearbeiten</Button><Menu icon={Ellipsis} label="Projekt-Optionen">{(close) => <>
          <MenuItem icon={Download} disabled={exporting} onClick={async () => {
            close(); setExporting(true);
            try { const backup = await api(`/projects/${project.id}/export`); if (await download(JSON.stringify(backup, null, 2), `${project.name}.json`, 'application/json')) notify('Projekt exportiert.'); }
            catch (error) { notify(error.message, 'error'); } finally { setExporting(false); }
          }}>Projekt als JSON exportieren</MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => { close(); dialog({ kind: 'delete', type: 'project', item: project, after: () => navigate({ page: 'projects' }) }); }}>Projekt löschen</MenuItem>
        </>}</Menu></>} />
      <div className="section-caption"><h2>Archivierte Chats</h2><span>{shownChats.length} Chats</span></div>
      {project.stages?.length > 0 && <nav className="project-phase-nav switch-tabs" aria-label="Projektphasen">{['', ...project.stages, '#ohne'].map((stage) => <button type="button" key={stage} className={selectedPhase === stage ? 'selected' : ''} aria-pressed={selectedPhase === stage} onClick={() => setPhase({ project: project.id, stage })}>{stage === '#ohne' ? 'Ohne Phase' : stage || 'Alle Phasen'}</button>)}</nav>}
      {shownChats.length ? <ChatRows chats={shownChats} projects={data.projects} compact onOpen={(chat) => navigate({ page: 'archive', id: chat.id, from: view })} /> : <div className="card compact-empty">Beim Sichern oder Bearbeiten eines Chats kannst du dieses Projekt auswählen.</div>}
      <div className="section-caption project-files-caption"><h2>Projektdateien</h2><button className="inline-button" onClick={() => dialog({ kind: 'import', projectId: project.id })}><Plus size={15} /> Importieren</button></div>
      {files.length ? <div className="item-list compact-list">{files.slice(0, 12).map((file) => <button className="item-row" type="button" key={file.id} onClick={() => dialog({ kind: 'file', file })}>
        <span className="file-symbol"><FileIcon file={file} /></span><span className="item-copy"><strong>{file.name}</strong><span>{file.path}</span></span><span className="item-date">{formatSize(file.size)}</span><ArrowUpRight className="item-arrow" size={16} />
      </button>)}</div> : <div className="card compact-empty">Noch keine Dateien in diesem Projekt.</div>}
      <Button className="after-list" icon={FolderOpen} onClick={() => navigate({ page: 'files', projectId: project.id })}>Im Dateimanager öffnen</Button>
    </section>;
  }
  return <section className="workspace-page collection-page">
    <Heading icon={Folder} kicker="Arbeitsbereich" title="Projekte" description="Organisiere zusammengehörige Chats und Dateien an einem Ort." actions={<Button icon={Plus} variant="primary" onClick={() => dialog({ kind: 'project' })}>Neues Projekt</Button>} />
    <div className="section-caption"><h2>Deine Projekte</h2><span>{data.projects.length} {data.projects.length === 1 ? 'Projekt' : 'Projekte'}</span></div>
    {data.projects.length ? <div className="project-grid">{data.projects.map((item) => <button key={item.id} type="button" className="project-card card" onClick={() => navigate({ page: 'projects', id: item.id })}>
      <div className="project-card-top"><ProjectSymbol color={item.color} /><ArrowUpRight size={17} /></div><h2>{item.name}</h2>
      <p>{item.description || 'Keine Beschreibung'}</p><div className="project-card-foot"><span><Archive size={14} />{item.chatCount} Chats</span><span><FileText size={14} />{item.fileCount} Dateien</span></div>
    </button>)}<button type="button" className="project-card new-project-card" onClick={() => dialog({ kind: 'project' })}><FolderPlus size={23} /><span>Projekt erstellen</span></button></div>
      : <div className="card"><Empty icon={FolderPlus} title="Noch keine Projekte" footer={<Button icon={Plus} variant="primary" onClick={() => dialog({ kind: 'project' })}>Projekt erstellen</Button>}>Lege ein Projekt an, um Chats und Dateien zu gruppieren.</Empty></div>}
  </section>;
}
