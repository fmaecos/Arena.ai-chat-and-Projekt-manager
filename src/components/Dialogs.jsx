import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, AudioLines, Check, Chrome, Copy, Database, Download, FilePlus2, Folder, FolderOpen, HardDrive, Info, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, asBase64, copyText } from '../api.js';
import { Button, ErrorLine, FileIcon, formatSize, modeNames, Modal, PlatformIcon, ProjectSymbol, projectsColors, StatusDot } from './ui.jsx';
import { downloadFile, FilePreview, isText } from '../views/Files.jsx';
import { Loading } from '../views/Workspace.jsx';

export const ProjectSelect = ({ projects, value, onChange }) => <label className="field"><span>Projekt</span><select aria-label="Projekt" value={value || ''} onChange={(event) => onChange(event.target.value)}>
  <option value="">Ohne Projekt</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
</select></label>;

function RecordDialog({ config, data, close, changed, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isProject = config.kind === 'project';
  const isFile = config.kind === 'file-edit';
  const existing = isProject ? config.project : isFile ? config.file : config.chat;
  const live = config.live;
  const [name, setName] = useState(existing?.name || existing?.title || live?.title || config.name || '');
  const [path, setPath] = useState(config.file?.path || '');
  const [projectId, setProjectId] = useState(existing?.projectId ?? (live && data.chats.find((item) => item.url === live.url && item.title === live.title)?.projectId) ?? '');
  const [stage, setStage] = useState(config.chat?.archive?.stage || '');
  const [mode, setMode] = useState(config.chat?.archive?.mode || 'unknown');
  const [description, setDescription] = useState(config.project?.description || '');
  const [color, setColor] = useState(config.project?.color || 'violet');
  const title = isProject ? existing ? 'Projekt bearbeiten' : 'Neues Projekt' : isFile ? 'Datei verschieben oder umbenennen' : live ? 'Chat sichern' : 'Archiv-Chat bearbeiten';
  const subtitle = isProject ? 'Ein gemeinsamer Ort für Chats, Dateien und Ideen.' : isFile ? 'Der Pfad ist relativ zum gewählten Projekt.'
    : live ? 'Speichere diese Aufnahme mit Nachrichten und Code in deinem lokalen Archiv.' : 'Ändere den Titel oder ordne den Chat einem Projekt zu.';
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      if (isProject) await api(existing ? `/projects/${existing.id}` : '/projects', existing ? 'PATCH' : 'POST', { name, description, color });
      else if (isFile) await api(`/files/${existing.id}`, 'PATCH', { path, projectId: projectId || null });
      else await api(existing ? `/chats/${existing.id}` : '/chats', existing ? 'PATCH' : 'POST', { title: name, projectId: projectId || null, revision: live?.revision, ...(existing?.archive ? { stage, mode } : {}) });
      await changed(); notify(isFile ? 'Datei aktualisiert.' : isProject ? existing ? 'Projekt aktualisiert.' : 'Projekt erstellt.' : live ? 'Chat im lokalen Archiv gespeichert.' : 'Chat aktualisiert.'); close();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Modal title={title} description={subtitle} onClose={close}>
    <form onSubmit={save}><div className="modal-body">
      {isFile ? <label className="field"><span>Dateipfad</span><input autoFocus required maxLength={450} placeholder="docs/notizen.md" value={path} onChange={(event) => setPath(event.target.value)} /></label>
        : <label className="field"><span>{isProject ? 'Projektname' : 'Titel'}</span><input autoFocus required maxLength={isProject ? 80 : 240} placeholder={isProject ? 'z. B. Produktplanung' : 'Name des Chats'} value={name} onChange={(event) => setName(event.target.value)} /></label>}
      {isProject ? <><label className="field"><span>Beschreibung <small>optional</small></span><textarea rows="3" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Woran arbeitest du hier?" /></label>
        <fieldset className="color-picker"><legend>Projektfarbe</legend>{Object.entries(projectsColors).map(([key, value], i) => <button key={key} type="button" className={color === key ? 'selected' : ''} style={{ '--color': value }}
          aria-label={['Violett', 'Mint', 'Bernstein', 'Blau', 'Rosa'][i]} aria-pressed={color === key} onClick={() => setColor(key)}>{color === key && <Check size={15} />}</button>)}</fieldset></>
        : <ProjectSelect projects={data.projects} value={projectId} onChange={(id) => { setProjectId(id); if (existing?.archive) setStage(''); }} />}
      {existing?.archive && <div className="field-pair"><label className="field"><span>Projektphase</span><input value={stage} maxLength={55} onChange={(event) => setStage(event.target.value)} placeholder="z. B. Review" /></label><label className="field"><span>Chat-Modus</span><select value={mode} onChange={(event) => setMode(event.target.value)}>{Object.entries(modeNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>}
      {live && <div className="inline-info"><LockKeyhole size={15} /> Der Chat bleibt lokal. Eine spätere Aufnahme derselben Unterhaltung aktualisiert den Archiveintrag.</div>}
      <ErrorLine>{error}</ErrorLine>
    </div><div className="modal-actions"><Button onClick={close}>Abbrechen</Button><Button type="submit" variant="primary" icon={isProject && !existing ? Plus : Check} busy={busy}>{isProject && !existing ? 'Projekt erstellen' : 'Speichern'}</Button></div></form>
  </Modal>;
}

function DeleteDialog({ config, close, changed, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labels = { chat: ['Chat', 'chats'], project: ['Projekt', 'projects'], file: ['Datei', 'files'] };
  const [label, path] = labels[config.type];
  async function remove() {
    setBusy(true);
    try {
      await api(`/${path}/${config.item.id}`, 'DELETE'); await changed(); config.after?.(); close(); notify(`${label} gelöscht.`);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Modal title={`${label} löschen?`} onClose={close}>
    <div className="modal-body"><p>„{config.item.name || config.item.title}“ wird aus dem Workspace gelöscht. {config.type === 'project' ? 'Die zugehörigen Chats und Dateien bleiben ohne Projektzuordnung erhalten.' : 'Diese Aktion lässt sich nicht rückgängig machen.'}</p><ErrorLine>{error}</ErrorLine></div>
    <div className="modal-actions"><Button autoFocus onClick={close}>Abbrechen</Button><Button variant="danger" icon={Trash2} busy={busy} onClick={remove}>Endgültig löschen</Button></div>
  </Modal>;
}

function ImportDialog({ config, data, close, changed, notify }) {
  const [list, setList] = useState([]);
  const [projectId, setProjectId] = useState(config.projectId || '');
  const [prefix, setPrefix] = useState(config.prefix || '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  function add(files) { setList([...files].slice(0, 200)); setError(files.length > 200 ? 'Pro Import werden höchstens 200 Dateien ausgewählt.' : ''); }
  async function save(event) {
    event.preventDefault(); if (busy || !list.length) return;
    setBusy(true); setError('');
    const failed = []; let imported = 0;
    const tail = prefix.trim().replace(/\/+$/, '');
    for (const [index, file] of list.entries()) {
      const name = file.webkitRelativePath || file.name;
      setProgress(`${index + 1} / ${list.length}`);
      try {
        if (file.size > 12 * 1024 * 1024) throw new Error('größer als 12 MB');
        await api('/files', 'POST', { path: tail ? `${tail}/${name}` : name, projectId: projectId || null, mime: file.type, data: await asBase64(file) });
        imported++;
      } catch (failure) { failed.push({ file, error: `${name}: ${failure.message}` }); }
    }
    try { if (imported) { await changed(); notify(`${imported} ${imported === 1 ? 'Datei importiert' : 'Dateien importiert'}.`); } }
    finally { setBusy(false); setProgress(''); }
    if (!failed.length) close();
    else { setList(failed.map(({ file }) => file)); setError(`${failed.slice(0, 3).map((item) => item.error).join(' · ')}${failed.length > 3 ? ` · +${failed.length - 3} weitere` : ''}`); }
  }
  return <Modal title="Dateien importieren" description="Die Dateien werden in den Workspace kopiert. Originale auf deinem Gerät bleiben unverändert." onClose={() => { if (!busy) close(); }}>
    <form onSubmit={save}><div className="modal-body">
      <div className={`dropzone${dragging ? ' dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) add(event.dataTransfer.files); }}>
        <Upload size={23} /><strong>{list.length ? `${list.length} ${list.length === 1 ? 'Datei ausgewählt' : 'Dateien ausgewählt'}` : 'Dateien hierher ziehen'}</strong>
        <span>{list.length ? `${formatSize(list.reduce((sum, f) => sum + f.size, 0))} insgesamt` : 'Bis zu 12 MB pro Datei'}</span>
        <div><Button icon={FilePlus2} onClick={() => fileInput.current?.click()} disabled={busy}>Dateien wählen</Button><Button icon={FolderOpen} onClick={() => folderInput.current?.click()} disabled={busy}>Ordner wählen</Button></div>
        <input hidden ref={fileInput} type="file" multiple onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
        <input hidden ref={folderInput} type="file" multiple webkitdirectory="" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      </div>
      <ProjectSelect projects={data.projects} value={projectId} onChange={setProjectId} />
      <label className="field"><span>Zielordner <small>optional</small></span><input value={prefix} maxLength={320} placeholder="z. B. dokumentation/" onChange={(event) => setPrefix(event.target.value)} disabled={busy} /></label>
      <ErrorLine>{error}</ErrorLine>
    </div><div className="modal-actions"><Button onClick={close} disabled={busy}>Abbrechen</Button><Button type="submit" icon={Upload} variant="primary" busy={busy} disabled={!list.length}>{progress ? `Importiere ${progress}` : 'Importieren'}</Button></div></form>
  </Modal>;
}

function FileDialog({ config, close, navigate, notify }) {
  const { file } = config;
  return <Modal title={file.name} description={`${file.path} · ${formatSize(file.size)}`} className="file-modal" onClose={close}>
    <div className="modal-body"><FilePreview file={file} notify={notify} /></div>
    <div className="modal-actions">{isText(file) && <Button onClick={() => { close(); navigate({ page: 'code', fileId: file.id }); }}>Code-Ansicht</Button>}
      <Button icon={Download} variant="primary" onClick={() => downloadFile(file).catch((error) => notify(error.message, 'error'))}>Herunterladen</Button></div>
  </Modal>;
}

function SettingsDialog({ config, data, close, onSettingsChange, notify }) {
  const [tab, setTab] = useState(config.tab || 'chrome');
  const [form, setForm] = useState(data.settings);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState(false);
  const [models, setModels] = useState(null);
  const [confirmRotation, setConfirmRotation] = useState(false);
  const connected = data.browser.connection === 'connected';
  useEffect(() => { let mounted = true; api('/settings').then((value) => {
    if (mounted) { setForm(value); setCode(value.pairingCode); setLoaded(true); }
  }).catch((failure) => { if (mounted) { setError(failure.message); setLoaded(true); } }); return () => { mounted = false; }; }, []);
  const update = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const resource = async (name) => { try { await window.kontext.showResource(name); } catch (failure) { setError(failure.message); } };
  async function rotate() {
    setBusy(true); setError('');
    try { const value = await api('/pairing/rotate', 'POST', {}); setCode(value.pairingCode); setConfirmRotation(false); notify('Neuer Kopplungscode erstellt.'); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { onSettingsChange(await api('/settings', 'PATCH', form)); notify('Einstellungen gespeichert.'); close(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <Modal title="Einstellungen" description="Verbinde Chrome und richte deinen lokalen Workspace ein." className="settings-modal" onClose={close}>
    <form onSubmit={save}>
      <div className="settings-tabs" role="tablist" aria-label="Einstellungen">
        {[['chrome', Chrome, 'Chrome'], ['assistant', Sparkles, 'KI & Sprache'], ['storage', Database, 'Speicher']].map(([key, Icon, name]) => <button type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} key={key} onClick={() => { setTab(key); setError(''); }}><Icon size={16} />{name}</button>)}
      </div>
      <div className="modal-body settings-body">
        {!loaded ? <Loading /> : tab === 'chrome' ? <>
          <div className="setting-intro"><span className="empty-icon"><Chrome size={22} /></span><div><h3>Chrome-Erweiterung</h3><p><StatusDot tone={connected || data.demo ? 'green' : 'muted'} />{data.demo ? 'Demo, nicht mit deinem Browser verbunden' : connected ? 'Mit Chrome verbunden' : 'Nicht verbunden'}</p></div></div>
          <ol className="steps"><li><span>1</span><div><strong>Erweiterung laden</strong><p>Öffne <code>chrome://extensions</code>, aktiviere den Entwicklermodus und wähle „Entpackte Erweiterung laden“.</p>{data.demo ? <a className="button secondary extension-download" href="/kontext-chrome.zip" download="kontext-chrome.zip"><Download size={15} /> Erweiterung als ZIP</a>
            : <Button icon={FolderOpen} onClick={() => resource('extension')}>Erweiterungsordner anzeigen</Button>}</div></li>
          <li><span>2</span><div><strong>Mit Kontext koppeln</strong><p>Klicke auf das Kontext-Symbol in Chrome. Der Assistent öffnet sich im Seitenbereich. Füge dort den Kopplungscode ein.</p>{code && <div className="pair-code"><code>{code}</code><Button icon={Copy} onClick={async () => { try { await copyText(code); notify('Kopplungscode kopiert.'); } catch (failure) { setError(failure.message); } }}>Kopieren</Button></div>}</div></li>
          <li><span>3</span><div><strong>Chat in Chrome öffnen</strong><p>Klicke auf das Kontext-Symbol im gewünschten Tab und starte die Erkundung. Bei der Live-Spiegelung bereits geöffnete Chats einmal neu laden.</p></div></li></ol>
          {data.demo ? <div className="inline-info"><Info size={16} /> Die Kopplung ist nur in der installierten Desktop-App verfügbar.</div> : confirmRotation ? <div className="inline-info"><span>Die aktuelle Verbindung wird getrennt.</span><Button variant="danger" busy={busy} onClick={rotate}>Code erneuern</Button><Button variant="ghost" onClick={() => setConfirmRotation(false)}>Abbrechen</Button></div> : <Button icon={RefreshCw} onClick={() => setConfirmRotation(true)}>Kopplungscode erneuern</Button>}
        </> : tab === 'assistant' ? <>
          {data.demo && <div className="inline-info"><Info size={16} /> In der Vorschau sind lokale Schnellbefehle verfügbar. Ollama und Whisper laufen auf deinem Gerät mit der Desktop-App.</div>}
          <div className="settings-section"><h3><Sparkles size={16} /> Lokales Sprachmodell</h3>
            <div className="field-pair"><label className="field"><span>Ollama-Adresse</span><input value={form.ollamaUrl || ''} disabled={data.demo} onChange={(event) => { update('ollamaUrl', event.target.value); setModels(null); }} placeholder="http://127.0.0.1:11434" /></label>
            <label className="field"><span>Modellname</span><input value={form.model || ''} disabled={data.demo} list={models?.length ? 'local-models' : undefined} onChange={(event) => update('model', event.target.value)} placeholder="qwen2.5:3b" /></label></div>
            {models?.length > 0 && <datalist id="local-models">{models.map((model) => <option key={model} value={model} />)}</datalist>}
            <Button icon={RefreshCw} busy={probe} disabled={data.demo} onClick={async () => {
              setProbe(true); setError('');
              try { const value = await api('/settings/ollama-test', 'POST', { ollamaUrl: form.ollamaUrl }); setModels(value.models); notify(value.models.length ? `Ollama erreichbar · ${value.models.length} ${value.models.length === 1 ? 'Modell' : 'Modelle'}` : 'Ollama erreichbar, aber kein Modell installiert.'); }
              catch (failure) { setError(failure.message); } finally { setProbe(false); }
            }}>Ollama prüfen</Button>
          </div>
          <div className="settings-section"><h3><AudioLines size={16} /> Spracheingabe und Ausgabe</h3>
            <label className="field"><span>Spracheingabe</span><select value={form.speechMode} onChange={(event) => update('speechMode', event.target.value)}>
              <option value="local" disabled={data.demo}>Lokales Whisper</option><option value="browser">Browser-Spracherkennung</option>
            </select></label>
            {form.speechMode === 'local' ? <><label className="field"><span>Whisper-Adresse</span><input value={form.whisperUrl || ''} onChange={(event) => update('whisperUrl', event.target.value)} placeholder="http://127.0.0.1:17861" /></label>
              <button className="inline-button" type="button" onClick={() => resource('speech')}><FolderOpen size={15} /> Ordner mit Whisper-Helfer öffnen</button></> : <p className="settings-hint">Der Browser kann Aufnahmen zur Spracherkennung an seinen Anbieter senden. Die Unterstützung hängt vom Browser ab.</p>}
            <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.speakReplies)} onChange={(event) => update('speakReplies', event.target.checked)} /> Antworten mit lokaler Systemstimme vorlesen</label>
            <label className="checkbox-field"><input type="checkbox" checked={Boolean(form.voiceAutoSend)} onChange={(event) => update('voiceAutoSend', event.target.checked)} /> Erkannten Text direkt an den Assistenten senden</label>
          </div>
        </> : <><div className="setting-intro"><span className="empty-icon"><HardDrive size={22} /></span><div><h3>{data.demo ? 'Temporärer Demo-Speicher' : 'Lokale SQLite-Datenbank'}</h3><p>{data.demo ? 'Inhalte sind Beispiele und werden nicht dauerhaft gespeichert.' : 'Daten bleiben standardmäßig auf diesem Gerät.'}</p></div></div>
          <div className="setting-stats"><span><strong>{data.chats.length}</strong> Chats</span><span><strong>{data.projects.length}</strong> Projekte</span><span><strong>{data.files.length}</strong> Dateien</span></div>
          <p className="settings-hint">Kontext speichert archivierte Chats, Projekte und importierte Dateien in <code>workspace.sqlite</code>. Für ein Backup kannst du die Datei nach dem Beenden der App kopieren.</p>
          {!data.demo && <Button icon={FolderOpen} onClick={() => resource('data')}>Datenordner anzeigen</Button>}
        </>}
        <ErrorLine>{error}</ErrorLine>
      </div>
      <div className="modal-actions"><Button onClick={close}>{tab === 'assistant' ? 'Abbrechen' : 'Schließen'}</Button>{tab === 'assistant' && <Button icon={Check} type="submit" variant="primary" disabled={!loaded} busy={busy}>Speichern</Button>}</div>
    </form>
  </Modal>;
}

function SearchDialog({ data, close, navigate, openDialog }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ query: '', result: null, error: '' });
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return undefined;
    let mounted = true;
    const timeout = setTimeout(() => {
      api('/search', 'POST', { query: trimmed }).then((result) => { if (mounted) setSearch({ query: trimmed, result }); })
        .catch((error) => { if (mounted) setSearch({ query: trimmed, error: error.message }); });
    }, 160);
    return () => { mounted = false; clearTimeout(timeout); };
  }, [trimmed]);
  const result = !trimmed ? { chats: data.chats.slice(0, 4), projects: [], files: [] } : search.query === trimmed ? search.result : null;
  const rows = [
    ...(result?.chats || []).map((chat) => ({ key: chat.id, label: chat.title, badge: 'Chat', symbol: <PlatformIcon small platform={chat.platform} />, open: () => navigate({ page: 'archive', id: chat.id }) })),
    ...(result?.projects || []).map((project) => ({ key: project.id, label: project.name, badge: 'Projekt', symbol: <ProjectSymbol color={project.color} />, open: () => navigate({ page: 'projects', id: project.id }) })),
    ...(result?.files || []).map((file) => ({ key: file.id, label: file.path, badge: 'Datei', symbol: <FileIcon file={file} />, open: () => openDialog({ kind: 'file', file }) })),
  ];
  const activate = (row) => { close(); row.open(); };
  return <Modal title="Workspace durchsuchen" className="search-modal" onClose={close}>
    <div className="modal-body">
      <label className="filter-input search-field"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} maxLength={240} aria-label="Workspace-Suchbegriff" placeholder="Chats, Projekte, Dateien …" onKeyDown={(event) => {
        if (event.key === 'Enter' && rows[0]) { event.preventDefault(); activate(rows[0]); }
      }} /></label>
      <div className="search-results scroll-region"><h3>{!trimmed ? 'Zuletzt archiviert' : 'Suchergebnisse'}</h3>
        {search.query === trimmed && search.error ? <ErrorLine>{search.error}</ErrorLine> : trimmed && !result ? <Loading /> : !rows.length ? <p>{trimmed ? 'Nichts gefunden.' : 'Hier erscheinen deine zuletzt gesicherten Chats.'}</p>
          : rows.map((row) => <button key={`${row.badge}-${row.key}`} type="button" onClick={() => activate(row)}><span className="result-symbol">{row.symbol}</span><strong>{row.label}</strong><small>{row.badge}</small><ArrowUpRight size={15} /></button>)}
      </div>
    </div>
  </Modal>;
}

export default function Dialogs({ config, data, close, changed, notify, navigate, openDialog, onSettingsChange }) {
  if (!config || !data) return null;
  const props = { config, data, close, changed, notify, navigate, openDialog, onSettingsChange };
  if (config.kind === 'delete') return <DeleteDialog {...props} />;
  if (config.kind === 'import') return <ImportDialog {...props} />;
  if (config.kind === 'file') return <FileDialog {...props} />;
  if (config.kind === 'settings') return <SettingsDialog {...props} />;
  if (config.kind === 'search') return <SearchDialog {...props} />;
  return <RecordDialog {...props} />;
}
