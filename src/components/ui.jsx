import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, File, FileCode2, FileImage, FileText, LoaderCircle, MessageCircle, Paperclip, X } from 'lucide-react';
import logo from '../../assets/icon.svg';

export const projectsColors = {
  violet: '#aa8cf6', mint: '#5ed7ab', amber: '#efb56d', blue: '#6db6fc', rose: '#ed87ae',
};
export const platformNames = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', arena: 'Arena', web: 'Webchat' };
export const modeNames = { chat: 'Chat', duel: 'Duell', multi: 'Multi-Chat', unknown: 'Modus offen' };

export function Logo({ size = 34 }) { return <img src={logo} className="logo" alt="" width={size} height={size} />; }

function PlatformGlyph({ platform, size }) {
  if (platform === 'chatgpt') return <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {Array.from({ length: 6 }, (_, i) => <path key={i} transform={`rotate(${i * 60} 16 16)`} d="M10.9 12.9V8.2c0-3.1 2.6-5.5 5.8-5.5 2.3 0 4.1 1.2 5 3.1M11 10l5-2.9 5.2 3v6" />)}
  </svg>;
  if (platform === 'claude') return <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" fill="none" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true">
    {[0, 30, 60, 90, 120, 150].map((angle) => <path key={angle} transform={`rotate(${angle} 12 12)`} d="M12 3.2v17.6" />)}
  </svg>;
  if (platform === 'gemini') return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><path d="M12 1.5c.9 6 4.5 9.6 10.5 10.5C16.5 12.9 12.9 16.5 12 22.5 11.1 16.5 7.5 12.9 1.5 12 7.5 11.1 11.1 7.5 12 1.5Z" /></svg>;
  if (platform === 'arena') return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 19 8.5-14.5L20.5 19H3.5ZM8 14.5h8" /></svg>;
  return <MessageCircle size={size} />;
}
export function PlatformIcon({ platform, small = false }) {
  return <span className={`platform-icon platform-${platform || 'unknown'}${small ? ' small' : ''}`}><PlatformGlyph platform={platform} size={small ? 18 : 24} /></span>;
}
export function ProjectSymbol({ color = 'violet', dot = false }) {
  return <span aria-hidden="true" className={dot ? 'project-dot' : 'project-symbol'} style={{ '--project-color': projectsColors[color] ?? projectsColors.violet }} />;
}
export function StatusDot({ tone = 'green' }) { return <span className={`status-dot ${tone}`} aria-hidden="true" />; }
export const IconButton = ({ icon: Icon, label, className = '', size = 17, ...props }) => (
  <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={size} /></button>
);
export function Button({ icon: Icon, variant = 'secondary', className = '', children, busy = false, ...props }) {
  return <button type="button" className={`button ${variant} ${className}`} {...props} disabled={props.disabled || busy}>
    {busy ? <LoaderCircle className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}{children && <span>{children}</span>}
  </button>;
}
export function Menu({ icon: Icon, label, align = 'end', className = '', children }) {
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className={`menu-wrap ${className}`} ref={root}>
    <IconButton icon={Icon} label={label} aria-expanded={open} onClick={() => setOpen(!open)} />
    {open && <div className={`menu-pop ${align}`}>{children(() => setOpen(false))}</div>}
  </div>;
}
export function MenuItem({ icon: Icon, children, onClick, danger, ...props }) {
  return <button type="button" className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick} {...props}>{Icon && <Icon size={15} />}{children}</button>;
}
export function Modal({ title, description, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-frame">
      <div className="modal-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><IconButton icon={X} label="Dialog schließen" onClick={onClose} /></div>
      {children}
    </div>
  </dialog>;
}
export function ErrorLine({ children }) { return children ? <div className="error-line" role="alert"><CircleAlert size={15} /> <span>{children}</span></div> : null; }
export function Empty({ icon: Icon, title, children, footer, compact = false }) {
  return <div className={`empty-state${compact ? ' compact' : ''}`}>
    <div className="empty-icon"><Icon size={25} /></div><h2>{title}</h2>{children && <p>{children}</p>}{footer}
  </div>;
}
export function Toasts({ toasts, dismiss }) {
  return <div className="toast-stack" aria-live="polite">{toasts.map(({ id, message, tone }) => <div className={`toast ${tone || ''}`} key={id}>
    {tone === 'error' ? <CircleAlert size={17} /> : <Check size={17} />}<span>{message}</span><IconButton icon={X} label="Meldung schließen" onClick={() => dismiss(id)} size={13} />
  </div>)}</div>;
}
export const AttachmentIcon = Paperclip;

export function FileIcon({ file, size = 18 }) {
  const Icon = file.mime?.startsWith('image/') ? FileImage : languageOf(file.name) ? FileCode2 : file.mime?.startsWith('text/') ? FileText : File;
  return <Icon size={size} />;
}
export function formatDate(value, withTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return withTime ? `Heute, ${time}` : 'Heute';
  const day = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return withTime ? `${day}, ${time}` : day;
}
export const formatTime = (value) => value ? new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
export function formatSize(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  if (value >= 1024) return `${(value / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;
  return `${value} B`;
}
export const languages = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', json: 'json', css: 'css', scss: 'css', html: 'xml', svg: 'xml', xml: 'xml', md: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql',
  sh: 'bash', bash: 'bash', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'cpp', cs: 'csharp', ps1: 'powershell', toml: 'ini', ini: 'ini',
  dockerfile: 'dockerfile', dockerignore: 'plaintext', txt: 'plaintext', log: 'plaintext', csv: 'plaintext', tsv: 'plaintext', env: 'ini', rb: 'ruby', php: 'php', svelte: 'xml', vue: 'xml' };
export const languageOf = (name = '') => {
  const extension = name.toLowerCase().split('.').at(-1);
  return Object.hasOwn(languages, extension) ? languages[extension] : '';
};
