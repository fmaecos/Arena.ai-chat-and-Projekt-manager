import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ChevronRight, Code2, Download, Ellipsis, FileArchive, FileBox, Folder, FolderOpen, ListFilter, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { api, bytesFromBase64, download } from '../api.js';
import { CodeBlock } from '../components/Transcript.jsx';
import { Button, Empty, ErrorLine, FileIcon, formatDate, formatSize, languageOf, Menu, MenuItem, ProjectSymbol } from '../components/ui.jsx';
import { useResource } from '../components/useResource.js';
import { Heading, Loading } from './Workspace.jsx';

export const isText = (file) => Boolean(languageOf(file.name) || file.mime?.startsWith('text/') || /^application\/(json|xml|javascript|yaml)$/.test(file.mime));
export const downloadFile = async (file) => {
  const full = file.data !== undefined ? file : await api(`/files/${file.id}`);
  return download(bytesFromBase64(full.data), full.name, full.mime);
};

export function FilesView({ data, view, navigate, dialog, notify }) {
  const [query, setQuery] = useState('');
  const [prefix, setPrefix] = useState('');
  const [order, setOrder] = useState('name');
  const projectId = view.projectId ?? '';
  const fileMatches = data.files.filter((file) => (!projectId || (file.projectId || 'none') === projectId) && (!query.trim() || file.path.toLowerCase().includes(query.trim().toLowerCase())) && (query.trim() || file.path.startsWith(prefix)));
  const folders = [...new Set(fileMatches.flatMap((file) => {
    const rest = file.path.slice(prefix.length);
    return !query.trim() && rest.includes('/') ? [rest.split('/')[0]] : [];
  }))].sort((a, b) => a.localeCompare(b, 'de'));
  const visible = fileMatches.filter((file) => query.trim() || !file.path.slice(prefix.length).includes('/')).sort((a, b) => order === 'latest'
    ? b.updatedAt.localeCompare(a.updatedAt) : order === 'size' ? b.size - a.size : a.name.localeCompare(b.name, 'de'));
  const crumbs = prefix.split('/').filter(Boolean);
  return <section className="workspace-page collection-page">
    <Heading icon={FolderOpen} kicker="Arbeitsbereich" title="Dateimanager" description="Importiere und verwalte Dateien in deinem lokalen Workspace."
      actions={<Button icon={Upload} variant="primary" onClick={() => dialog({ kind: 'import', projectId: projectId === 'none' ? '' : projectId, prefix })}>Dateien importieren</Button>} />
    <div className="collection-toolbar">
      <label className="filter-input"><Search size={16} /><input aria-label="Dateien filtern" placeholder="Dateien filtern …" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="select-filter"><ListFilter size={15} /><select aria-label="Dateien nach Projekt filtern" value={projectId} onChange={(event) => { setPrefix(''); navigate({ page: 'files', projectId: event.target.value }); }}><option value="">Alle Projekte</option><option value="none">Ohne Projekt</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="select-filter"><ArrowDownUp size={15} /><select aria-label="Dateien sortieren" value={order} onChange={(event) => setOrder(event.target.value)}><option value="name">Nach Name</option><option value="latest">Zuletzt bearbeitet</option><option value="size">Nach Größe</option></select></label>
    </div>
    <div className="section-caption file-caption"><nav aria-label="Dateipfad" className="breadcrumbs"><button onClick={() => { setPrefix(''); setQuery(''); }}>Workspace</button>{crumbs.map((crumb, index) => <span key={index}><ChevronRight size={14} /><button onClick={() => { setPrefix(`${crumbs.slice(0, index + 1).join('/')}/`); setQuery(''); }}>{crumb}</button></span>)}</nav><span>{fileMatches.length} {fileMatches.length === 1 ? 'Datei' : 'Dateien'}</span></div>
    {folders.length || visible.length ? <div className="files-table card">
      <div className="file-table-head file-table-grid"><span>Name</span><span>Projekt</span><span>Größe</span><span>Geändert</span><span></span></div>
      {folders.map((folder) => <div className="file-table-row file-table-grid" key={folder}>
        <button type="button" className="file-name" onClick={() => setPrefix(`${prefix}${folder}/`)}><span className="file-symbol folder-color"><Folder size={18} /></span><strong>{folder}</strong></button><span>–</span><span>–</span><span>–</span><button className="folder-chevron" type="button" title={`Ordner ${folder} öffnen`} onClick={() => setPrefix(`${prefix}${folder}/`)}><ChevronRight size={16} /></button>
      </div>)}
      {visible.map((file) => {
        const project = data.projects.find((p) => p.id === file.projectId);
        return <div className="file-table-row file-table-grid" key={file.id}>
          <button type="button" className="file-name" onClick={() => dialog({ kind: 'file', file })} title={file.path}><span className="file-symbol"><FileIcon file={file} /></span><span><strong>{file.name}</strong>{Boolean(query.trim() && file.path.includes('/')) && <small>{file.path}</small>}</span></button>
          <span title={project?.name}>{project ? <><ProjectSymbol dot color={project.color} /> {project.name}</> : '–'}</span><span>{formatSize(file.size)}</span><span>{formatDate(file.updatedAt)}</span>
          <Menu icon={Ellipsis} label={`Aktionen für ${file.name}`}>{(close) => <>
            <MenuItem icon={Download} onClick={() => { close(); downloadFile(file).catch((error) => notify(error.message, 'error')); }}>Herunterladen</MenuItem>
            {isText(file) && <MenuItem icon={Code2} onClick={() => { close(); navigate({ page: 'code', fileId: file.id }); }}>In Code-Ansicht öffnen</MenuItem>}
            <MenuItem icon={Pencil} onClick={() => { close(); dialog({ kind: 'file-edit', file }); }}>Umbenennen / verschieben</MenuItem>
            <MenuItem icon={Trash2} danger onClick={() => { close(); dialog({ kind: 'delete', type: 'file', item: file }); }}>Datei löschen</MenuItem>
          </>}</Menu>
        </div>;
      })}
    </div> : <div className="card"><Empty icon={FolderOpen} compact title={query ? 'Keine passenden Dateien' : 'Keine Dateien in dieser Ansicht'} footer={!query && <Button icon={Upload} onClick={() => dialog({ kind: 'import', projectId: projectId === 'none' ? '' : projectId, prefix })}>Dateien auswählen</Button>}>{query ? 'Suche nach einem anderen Dateinamen oder Pfad.' : 'Dateien und Ordner kannst du von deinem Gerät importieren.'}</Empty></div>}
  </section>;
}

const MAX_PREVIEW = 550_000;
const images = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
export function FilePreview({ file, notify }) {
  const previewable = (isText(file) && file.size <= MAX_PREVIEW) || images.has(file.mime);
  const resource = useResource(previewable ? `/files/${file.id}` : null, file.updatedAt);
  const full = resource.data;
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!full || !images.has(full.mime)) { setUrl(''); return undefined; }
    const object = URL.createObjectURL(new Blob([bytesFromBase64(full.data)], { type: full.mime }));
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [full]);
  if (resource.error) return <ErrorLine>{resource.error}</ErrorLine>;
  if (!previewable) return <Empty icon={FileArchive} title="Keine Vorschau verfügbar" compact>Du kannst die Originaldatei herunterladen.</Empty>;
  if (!full) return <Loading />;
  if (images.has(full.mime)) return url ? <img className="file-preview-image" src={url} alt={file.name} /> : <Loading />;
  return <CodeBlock value={new TextDecoder().decode(bytesFromBase64(full.data))} language={languageOf(file.name)} large notify={notify} />;
}

export function CodeView({ data, view, navigate, notify }) {
  const [tab, setTab] = useState('files');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState('');
  const metadata = useResource(tab === 'chats' ? '/snippets' : null, data.chats.map((chat) => chat.updatedAt).join('|'));
  const live = data.browser.live;
  const liveSources = useMemo(() => (live?.messages || []).flatMap((message, i) => message.blocks.flatMap((block, j) => block.type === 'code' ? [{ key: `live-${i}-${j}`, title: live.title, detail: `Live-Chat · Block ${j + 1}`, value: block.text, language: block.language }] : [])), [live]);
  const toFileSource = (file) => ({ key: file.id, title: file.name, detail: file.path, file, language: languageOf(file.name) || 'plaintext' });
  const all = (tab === 'chats' ? [...liveSources, ...(metadata.data || []).map((item) => ({ ...item, key: `${item.chatId}-${item.messageIndex}-${item.blockIndex}`,
    detail: `Archiv · Nachricht ${item.messageIndex + 1}, Block ${item.blockIndex + 1}` }))] : data.files.filter(isText).map(toFileSource));
  const visible = all.filter((item) => `${item.title} ${item.detail} ${item.language}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find((item) => item.key === (tab === 'files' && view.fileId ? view.fileId : chosen)) || visible[0];
  const tooBig = selected?.file?.size > MAX_PREVIEW;
  const resource = useResource(selected?.file && !tooBig ? `/files/${selected.file.id}` : selected?.chatId ? `/chats/${selected.chatId}` : null, selected?.file?.updatedAt);
  const value = useMemo(() => selected?.value ?? (resource.data && (selected?.file ? new TextDecoder().decode(bytesFromBase64(resource.data.data))
    : resource.data.messages[selected?.messageIndex]?.blocks[selected?.blockIndex]?.text)), [selected?.value, selected?.file?.id, selected?.messageIndex, selected?.blockIndex, resource.data]);
  return <section className="workspace-page collection-page code-page">
    <Heading icon={Code2} kicker="Arbeitsbereich" title="Code-Ansicht" description="Lies Dateien und Code aus deinen Chats mit Syntaxhervorhebung." actions={<Button icon={FolderOpen} onClick={() => navigate({ page: 'files' })}>Dateimanager</Button>} />
    <div className="switch-tabs" role="tablist" aria-label="Codequellen">
      <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'selected' : ''} onClick={() => { setTab('files'); setQuery(''); }}>Dateien</button>
      <button type="button" role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'selected' : ''} onClick={() => { setTab('chats'); setQuery(''); }}>Chat-Snippets</button>
    </div>
    <div className="code-workspace card"><div className="code-tree">
      <label className="filter-input"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code suchen …" aria-label="Codequellen filtern" /></label>
      {metadata.error && tab === 'chats' && <ErrorLine>{metadata.error}</ErrorLine>}
      <div className="code-tree-list scroll-region">{visible.map((item) => <button type="button" className={`code-source${item.key === selected?.key ? ' selected' : ''}`} key={item.key} title={item.detail}
        onClick={() => { setChosen(item.key); if (tab === 'files') navigate({ page: 'code', fileId: item.key }); }}><Code2 size={16} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div>
    </div><div className="code-document">
      {selected ? <><header><div><h2>{selected.title}</h2><p>{selected.detail}</p></div>{selected.file && <Button icon={Download} onClick={() => downloadFile(selected.file).catch((error) => notify(error.message, 'error'))}>Download</Button>}</header>
        {tooBig ? <Empty icon={FileBox} title="Datei zu groß für die Vorschau" compact>Lade die Datei herunter, um sie in einem lokalen Editor zu öffnen.</Empty>
          : resource.error ? <ErrorLine>{resource.error}</ErrorLine> : value == null ? <Loading /> : <CodeBlock key={selected.key} value={value} language={selected.language} large notify={notify} />}</>
        : <Empty icon={Code2} title={query ? 'Keine Treffer' : 'Kein Code verfügbar'} compact>{query ? 'Versuche einen anderen Namen.' : 'Importiere eine Code-Datei oder archiviere einen Chat mit Code.'}</Empty>}
    </div></div>
  </section>;
}
