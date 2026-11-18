let demoKey;
function sessionKey() {
  if (demoKey) return demoKey;
  try { demoKey = sessionStorage.getItem('kontext-demo'); } catch { /* storage can be disabled */ }
  if (!demoKey || !/^[a-f0-9]{32}$/.test(demoKey)) {
    demoKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem('kontext-demo', demoKey); } catch { /* keep in memory */ }
  }
  return demoKey;
}

export async function api(path, method = 'GET', body) {
  let result;
  if (window.kontext) result = await window.kontext.request(method, `/api${path}`, body);
  else {
    const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Kontext-Demo': sessionKey() },
      cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
    result = { ok: response.ok, data: await response.json().catch(() => ({})) };
  }
  if (!result.ok) throw new Error(result.data?.error || 'Die Verbindung zum Workspace ist fehlgeschlagen.');
  return result.data;
}

export function openExternal(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    if (window.kontext) window.kontext.openExternal(url.href).catch(console.error);
    else window.open(url.href, '_blank', 'noopener,noreferrer');
  } catch { /* unsupported URL */ }
}

export async function copyText(value) {
  try { await navigator.clipboard.writeText(value); }
  catch {
    const field = document.createElement('textarea');
    field.value = value;
    field.style.cssText = 'position:fixed;top:0;left:-1000px;opacity:0;';
    const active = document.activeElement;
    (document.querySelector('dialog[open]') || document.body).append(field);
    field.select();
    const success = document.execCommand('copy');
    field.remove();
    active?.focus?.();
    if (!success) throw new Error('Der Text konnte nicht kopiert werden.');
  }
}

export function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onabort = reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.readAsDataURL(blob);
  });
}
export function bytesFromBase64(data) {
  return typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(data) : Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

export async function download(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.kontext) return window.kontext.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') || 'kontext-export';
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  return true;
}

export async function exportChat(chat, format = 'markdown') {
  if (format === 'json') return download(JSON.stringify(chat, null, 2), `${chat.title}.json`, 'application/json');
  const lines = [`# ${chat.title}`, chat.url, `Aufnahme: ${chat.capturedAt}`, ...(chat.archive ? [`Projekt: ${chat.archive.project || 'offen'} · Phase: ${chat.archive.stage || 'offen'} · Modus: ${chat.archive.mode || 'offen'}`] : []), ...(chat.truncated ? ['Hinweis: Die Aufnahme ist möglicherweise unvollständig.'] : [])];
  for (const message of chat.messages) {
    lines.push(`## ${message.author || (message.role === 'user' ? 'Du' : message.role === 'assistant' ? 'Assistent' : 'Nicht zugeordnet')}${message.lane ? ` · ${message.lane}` : ''}${message.time ? ` · ${new Date(message.time).toLocaleString('de-DE')}` : ''}`);
    for (const block of message.blocks) {
      if (block.type === 'code') {
        const fence = '`'.repeat(Math.max(3, ...Array.from(block.text.matchAll(/`+/g), ([part]) => part.length + 1)));
        lines.push(`${fence}${block.language.replace(/[^\w#+-]/g, '')}\n${block.text}\n${fence}`);
      } else if (block.type === 'attachment') lines.push(`Anhang: ${block.text}${block.url ? ` (${block.url}; nur Verweis)` : ' (kein verfügbarer Link)'}`);
      else lines.push(block.text);
    }
  }
  return download(lines.join('\n\n'), `${chat.title}.md`, 'text/markdown;charset=utf-8');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
