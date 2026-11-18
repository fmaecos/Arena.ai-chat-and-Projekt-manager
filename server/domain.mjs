export const PORT = 17654;
export const MAX_FILE = 12 * 1024 * 1024;
export const MAX_AUDIO = 6 * 1024 * 1024;
export const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
export const PROJECT_COLORS = ['violet', 'mint', 'amber', 'blue', 'rose'];
export const PLATFORMS = {
  'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'claude.ai': 'claude',
  'gemini.google.com': 'gemini', 'arena.ai': 'arena', 'lmarena.ai': 'arena',
};

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const now = () => new Date().toISOString();
export const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function requiredText(value, max, error) {
  const result = text(value, max);
  if (!result) throw new AppError(400, error);
  return result;
}

export function webUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function localUrl(value) {
  const trimmed = text(value, 200);
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error();
    return url.origin;
  } catch { throw new AppError(400, 'Verwende eine lokale Adresse mit Port, z. B. http://127.0.0.1:11434.'); }
}

export function archivePath(value) {
  const path = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
  if (!path || path.length > 450 || path.split('/').some((part) => !part.trim() || part.length > 160
    || part === '.' || part === '..' || /[\u0000-\u001f<>:"|?*]/.test(part))) {
    throw new AppError(400, 'Ungültiger Dateipfad. Verwende einen relativen Pfad wie docs/notizen.md.');
  }
  return path;
}

export function decodeData(value, limit) {
  if (typeof value !== 'string') throw new AppError(400, 'Die Daten fehlen.');
  if (value.length > Math.ceil(limit / 3) * 4) throw new AppError(413, 'Die Datei oder Aufnahme ist zu groß.');
  if (value.length % 4 !== 0 || !/^[\da-zA-Z+/]*={0,2}$/.test(value)) throw new AppError(400, 'Ungültige Dateidaten.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit) throw new AppError(413, 'Die Datei oder Aufnahme ist zu groß.');
  return bytes;
}

export function normalizeCapture(input) {
  if (!input || input.tab === null) return { tab: null, chat: null };
  const tab = input.tab;
  const url = webUrl(tab?.url);
  const hostname = url && new URL(url).hostname;
  const platform = url.startsWith('https:') && Object.hasOwn(PLATFORMS, hostname) ? PLATFORMS[hostname] : null;
  if (!platform || !Number.isSafeInteger(tab?.id) || tab.id < 0 || !Number.isSafeInteger(tab?.windowId)) {
    return { tab: null, chat: null };
  }
  const safeTab = { id: tab.id, windowId: tab.windowId, url, platform, title: text(tab.title, 240) };
  // Limit cumulative text independently of message count; keep the latest part of very long chats.
  let budget = 980_000;
  let truncated = Boolean(input.chat?.truncated) || (input.chat?.messages?.length ?? 0) > 350;
  const messages = (Array.isArray(input.chat?.messages) ? input.chat.messages.slice(-350) : []).reverse().flatMap((message, index) => {
    if (!['user', 'assistant'].includes(message?.role)) return [];
    if (budget < 1) { truncated = true; return []; }
    const inputBlocks = Array.isArray(message.blocks) ? message.blocks : [];
    if (inputBlocks.length > 75) truncated = true;
    const blocks = inputBlocks.slice(0, 75).flatMap((block) => {
      const raw = typeof block?.text === 'string' ? block.text : '';
      const value = raw.slice(0, Math.min(52_000, budget));
      if (value.length < raw.length) truncated = true;
      budget -= value.length;
      if (block?.type === 'attachment') return [{ type: 'attachment', text: text(value, 300) || 'Anhang', url: webUrl(block.url) }];
      if (!value.trim()) return [];
      return [block.type === 'code' ? { type: 'code', text: value, language: text(block.language, 32).toLowerCase() } : { type: 'text', text: value }];
    });
    if (!blocks.length) return [];
    const time = typeof message.time === 'string' && !Number.isNaN(Date.parse(message.time)) ? new Date(message.time).toISOString() : null;
    return [{ id: `${index}-${text(message.id, 80)}`, role: message.role, author: text(message.author, 50), time, blocks }];
  }).reverse();
  const title = text(input.chat?.title, 240) || safeTab.title || 'Neuer Chat';
  return { tab: safeTab, chat: messages.length ? { url, platform, title, messages, truncated } : null };
}

export function normalizeAction(value) {
  if (!value || typeof value !== 'object') return null;
  switch (value.type) {
    case 'open_tab': {
      const url = webUrl(value.url);
      return url ? { type: 'open_tab', url } : null;
    }
    case 'navigate_workspace': return ['live', 'archive', 'projects', 'files', 'code'].includes(value.page)
      ? { type: 'navigate_workspace', page: value.page } : null;
    case 'new_project': return { type: 'new_project', name: text(value.name, 80) };
    case 'focus_chat':
    case 'capture':
    case 'archive_chat': return { type: value.type };
    default: return null;
  }
}
