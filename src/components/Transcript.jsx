import { useRef, useState } from 'react';
import { Check, Code2, Copy, ExternalLink, Info, UserRound } from 'lucide-react';
import Markdown from 'react-markdown';
import gfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import powershell from 'highlight.js/lib/languages/powershell';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import { openExternal, copyText } from '../api.js';
import { AttachmentIcon, formatTime, IconButton, PlatformIcon, platformNames } from './ui.jsx';

for (const [id, grammar] of Object.entries({ javascript, typescript, python, json, css, xml, markdown, yaml, sql, bash, rust, go, java, c, cpp, csharp, powershell, ini, dockerfile, ruby, php })) {
  hljs.registerLanguage(id, grammar);
}
const aliases = { 'c++': 'cpp', 'c#': 'csharp', jsx: 'javascript', tsx: 'typescript' };
const labels = { js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  plaintext: 'Text', xml: 'HTML / XML', md: 'Markdown', 'c++': 'C++', cpp: 'C++', csharp: 'C#', ini: 'INI / TOML' };
const toText = (value) => Array.isArray(value) ? value.map(toText).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : value?.props ? toText(value.props.children) : '';

const mdComponents = {
  a: ({ href, children }) => <a href={href || '#'} onClick={(event) => { event.preventDefault(); if (href) openExternal(href); }}>{children}</a>,
  img: ({ src, alt }) => <span className="markdown-image-label"><AttachmentIcon size={13} />{src ? <a href={src} onClick={(event) => { event.preventDefault(); openExternal(src); }}>{alt || 'Bild öffnen'}</a> : alt || 'Bild'}</span>,
  table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
  pre: ({ children }) => <CodeBlock value={toText(children).replace(/\n$/, '')} language={children?.props?.className?.replace('language-', '') || ''} />,
};
export function RichText({ children }) { return <div className="rich-text"><Markdown skipHtml remarkPlugins={[gfm]} components={mdComponents}>{children || ''}</Markdown></div>; }

export function CodeBlock({ value = '', language = '', large = false, notify }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const lines = value.split('\n').length;
  const name = (Object.hasOwn(labels, language) && labels[language]) || language || 'Text';
  const grammar = Object.hasOwn(aliases, language) ? aliases[language] : language;
  let highlighted = null;
  if (value.length < 110_000 && /^[\w#+-]{1,32}$/.test(grammar) && hljs.getLanguage(grammar)) {
    try { highlighted = hljs.highlight(value, { language: grammar, ignoreIllegals: true }).value; } catch { /* show plain text */ }
  }
  return <div className={`code-block${large ? ' code-large' : ''}`}>
    <div className="code-head"><span><Code2 size={14} />{name}</span><IconButton icon={copied ? Check : Copy} size={14} className={copied ? 'copied' : ''}
      label={copied ? 'Code kopiert' : 'Code kopieren'} onClick={async () => {
        try { await copyText(value); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1400); }
        catch (error) { notify?.(error.message, 'error'); }
      }} /></div>
    <div className="code-scroll" tabIndex={0} aria-label="Codeinhalt">
      {lines <= 3000 && <div className="line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, index) => index + 1).join('\n')}</div>}
      <pre>{highlighted != null ? <code dangerouslySetInnerHTML={{ __html: highlighted || '\n' }} /> : <code>{value || ' '}</code>}{value.endsWith('\n') && ' '}</pre>
    </div>
  </div>;
}

export function Transcript({ chat, footer, actions, notify, className = '' }) {
  return <section className={`transcript card ${className}`} aria-label="Chatverlauf">
    <header className="transcript-head"><div className="transcript-titles"><h2 title={chat.title}>{chat.title}</h2><p>{chat.messages.length} {chat.messages.length === 1 ? 'Nachricht' : 'Nachrichten'} {chat.displayTime && <><span className="separator-dot">·</span> {chat.displayTime}</>}</p></div>{actions}</header>
    <div key={chat.url} className="messages scroll-region" tabIndex={0} aria-label="Nachrichten">
      {chat.truncated && <div className="inline-info"><Info size={15} /> Die Aufnahme ist möglicherweise unvollständig. Nur lesbare Teile wurden übernommen.</div>}
      {chat.messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
        {message.role === 'assistant' ? <PlatformIcon platform={chat.platform} small /> : <span className="user-avatar"><UserRound size={16} /></span>}
        <div className="message-content">
          <div className="message-meta"><strong>{message.author || (message.role === 'assistant' ? platformNames[chat.platform] || 'Assistent' : message.role === 'user' ? 'Du' : message.role === 'system' ? 'System' : 'Nicht zugeordnet')}</strong>{message.lane && <span className="lane-badge" title={message.lane}>{message.lane}</span>}{message.time && <time dateTime={message.time}>{formatTime(message.time)}</time>}</div>
          {message.blocks.map((block, index) => block.type === 'code' ? <CodeBlock key={index} value={block.text} language={block.language} notify={notify} />
            : block.type === 'attachment' ? <div className="attachment" key={index}><AttachmentIcon size={14} /><div>
              {block.url ? <button onClick={() => openExternal(block.url)}>{block.text}<ExternalLink size={12} /></button> : <span>{block.text}</span>}
              <small className="attachment-state">{block.url ? 'Nur Verweis · keine lokale Kopie' : 'Kein Anhangslink sichtbar'}</small>
            </div></div>
              : <RichText key={index}>{block.text}</RichText>)}
        </div>
      </article>)}
    </div>
    {footer && <footer className="transcript-foot">{footer}</footer>}
  </section>;
}
