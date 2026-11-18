(() => {
  const platforms = {
    'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'claude.ai': 'claude',
    'gemini.google.com': 'gemini', 'arena.ai': 'arena', 'lmarena.ai': 'arena',
  };
  const variants = {
    chatgpt: {
      messages: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
      role: (node) => node.getAttribute('data-message-author-role'),
      body: (node) => node,
      title: 'nav a[aria-current="page"]',
    },
    claude: {
      messages: '[data-testid="user-message"], [data-testid="assistant-message"], .font-claude-response, .standard-markdown',
      role: (node) => node.matches('[data-testid="user-message"]') ? 'user' : 'assistant',
      body: (node) => node,
      title: 'a[aria-current="page"]',
    },
    gemini: {
      messages: 'user-query, model-response, [data-test-id="user-query"], [data-test-id="model-response"]',
      role: (node) => node.matches('user-query, [data-test-id="user-query"]') ? 'user' : 'assistant',
      body: (node, role) => role === 'user' ? node.querySelector('.query-text, .query-content') || node : node.querySelector('.model-response-text, .markdown') || node,
      title: '[data-test-id="conversation"][aria-selected="true"]',
    },
    arena: {
      messages: '[data-role="user"], [data-role="assistant"], [data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"], [data-testid="user-message-content"], [data-testid="assistant-message-content"], [data-message-role="user"], [data-message-role="assistant"]',
      role: (node) => node.getAttribute('data-message-author-role') || node.getAttribute('data-message-role') || node.getAttribute('data-role') || (node.getAttribute('data-testid')?.startsWith('user-') ? 'user' : 'assistant'),
      body: (node) => node,
      title: 'a[aria-current="page"]',
    },
  };
  const skip = 'button, input, textarea, select, svg, script, style, nav, [role="button"]:not(a), [hidden], [aria-hidden="true"], .sr-only, .visually-hidden, [data-testid="message-feedback"]';
  const attachmentSelector = '[data-testid*="attachment"], [data-test-id*="attachment"], [data-testid="file-preview"], [data-testid="file-name"], [data-test-id="uploaded-file"], .file-chip, a[download], img[src]';
  const blockTags = new Set(['P', 'DIV', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  function webUrl(value, base) {
    if (!value) return '';
    try {
      const url = new URL(value, base);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function visible(root, node) {
    return !node.closest('[hidden], [aria-hidden="true"], [inert], [style*="display: none"]') && (root === node || root.contains(node));
  }

  function blocksOf(root, pageUrl, captureState, attachmentRoot) {
    const blocks = [];
    let buffer = '';
    const append = (line) => { buffer += line; };
    const flush = () => {
      const text = buffer.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (text) blocks.push({ type: 'text', text });
      buffer = '';
    };
    const plain = (node) => (node.textContent || '').trim();
    const link = (node, label) => {
      const url = webUrl(node.getAttribute('href'), pageUrl);
      return url ? `[${(label.trim() || url).replace(/[\[\]]/g, '\\$&')}](<${url.replace(/[<>]/g, encodeURIComponent)}>)` : label;
    };
    const inline = (node) => {
      if (node.nodeType === 3) return (node.nodeValue || '').replace(/\s+/g, ' ');
      if (node.nodeType !== 1 || node.matches(skip)) return '';
      if (node.tagName === 'BR') return '\n';
      const value = [...node.childNodes].map(inline).join('');
      if (node.tagName === 'A') return link(node, value);
      if (node.tagName === 'CODE') {
        const fence = '`'.repeat(Math.max(1, ...(value.match(/`+/g) || []).map((part) => part.length + 1)));
        return `${fence}${value}${fence}`;
      }
      if (['STRONG', 'B', 'EM', 'I', 'DEL', 'S'].includes(node.tagName) && value.trim()) {
        const marker = ['B', 'STRONG'].includes(node.tagName) ? '**' : ['S', 'DEL'].includes(node.tagName) ? '~~' : '*';
        return `${value.match(/^\s*/)[0]}${marker}${value.trim()}${marker}${value.match(/\s*$/)[0]}`;
      }
      return value;
    };
    const walk = (node) => {
      if (node.nodeType === 3) {
        const value = node.nodeValue || '';
        return append(node.parentElement?.closest('.whitespace-pre-wrap, .whitespace-pre-line, [style*="white-space: pre"]')
          ? value.replace(/\r\n?/g, '\n') : value.replace(/\s+/g, ' '));
      }
      if (node.nodeType !== 1 || node.matches(skip)) return;
      const tag = node.tagName;
      if (tag === 'PRE') {
        const code = node.querySelector('code') || node.querySelector('[data-code-block]') || node;
        const language = (code.className?.match?.(/(?:language|lang)-([\w#+-]+)/) || [])[1]
          || code.getAttribute('data-language') || node.getAttribute('data-language') || '';
        const value = (code.textContent || '').replace(/^\n|\n$/g, '');
        if (value.trim()) { flush(); blocks.push({ type: 'code', language, text: value }); }
        return;
      }
      if (tag === 'TABLE') {
        const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].filter((cell) => ['TH', 'TD'].includes(cell.tagName)).map((cell) => inline(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')));
        if (rows.length && rows[0].length) append(`\n\n| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map((row) => `| ${row.join(' | ')} |`).join('\n')}\n\n`);
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        append('\n');
        [...node.children].filter((child) => child.tagName === 'LI').forEach((child, index) => {
          append(tag === 'OL' ? `${index + 1}. ` : '- ');
          [...child.childNodes].forEach(walk);
          append('\n');
        });
        append('\n');
        return;
      }
      if (tag === 'BR') return append('\n');
      if (tag === 'HR') return append('\n\n---\n\n');
      if (tag === 'IMG' || node.matches('a[download]')) return;
      if (tag === 'A' || ['CODE', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S'].includes(tag)) return append(inline(node));
      if (/^H[1-6]$/.test(tag)) return append(`\n\n${'#'.repeat(Number(tag.at(-1)))} ${inline(node).trim()}\n\n`);
      if (tag === 'BLOCKQUOTE' && !node.querySelector('pre')) return append(`\n\n> ${inline(node).trim()}\n\n`);
      if (blockTags.has(tag) && buffer.trim() && node !== root) append('\n\n');
      [...node.childNodes].forEach(walk);
      if (blockTags.has(tag) && buffer.trim()) append('\n\n');
    };
    walk(root);
    flush();

    const attachmentKeys = new Set();
    for (const node of attachmentRoot.querySelectorAll(attachmentSelector)) {
      if (!visible(attachmentRoot, node)) continue;
      const outer = node.parentElement?.closest(attachmentSelector);
      if (outer && attachmentRoot.contains(outer)) continue;
      const item = node.matches('img') ? node : node.querySelector('a[download], a[href], img') || node;
      const src = item.getAttribute('href') || item.getAttribute('src');
      const url = webUrl(src, pageUrl);
      const label = (item.getAttribute('download') || item.getAttribute('alt') || node.getAttribute('aria-label') || plain(node) || (src ? 'Bild oder Datei' : '')).trim().slice(0, 300);
      if (!label || /^(avatar|profile icon|user icon|logo)$/i.test(label)) continue;
      const key = url || label;
      if (!attachmentKeys.has(key)) { blocks.push({ type: 'attachment', text: label, url }); attachmentKeys.add(key); }
    }
    if (blocks.length > 75) captureState.truncated = true;
    return blocks.slice(0, 75);
  }

  function capture(document, location) {
    const platform = Object.hasOwn(platforms, location.hostname) ? platforms[location.hostname] : null;
    if (!platform) return null;
    const variant = variants[platform];
    const matches = [...document.querySelectorAll(variant.messages)].filter((node) => visible(document.body, node)
      && !node.parentElement?.closest(variant.messages));
    const state = { truncated: matches.length > 350 };
    let budget = 930_000;
    const messages = matches.slice(-350).reverse().flatMap((node, index) => {
      const role = variant.role(node);
      if (!['user', 'assistant'].includes(role)) return [];
      if (!budget) { state.truncated = true; return []; }
      const blocks = blocksOf(variant.body(node, role), location.href, state, node).flatMap((block) => {
        const value = block.text.slice(0, Math.min(budget, 52_000));
        if (value.length < block.text.length) state.truncated = true;
        budget -= value.length;
        return value ? [{ ...block, text: value }] : [];
      });
      if (!blocks.length) return [];
      const id = node.getAttribute('data-message-id') || node.id || String(index);
      const time = (node.matches('time[datetime]') ? node : node.querySelector('time[datetime]'))?.getAttribute('datetime') || null;
      const author = node.getAttribute('data-model-name') || node.closest('[data-model-name]')?.getAttribute('data-model-name') || '';
      return [{ id, role, time, author, blocks }];
    }).reverse();
    const selected = document.querySelector(variant.title)?.textContent?.trim();
    const cleaned = document.title.replace(/\s*[-–|]\s*(ChatGPT|Claude|Gemini|LMArena|Arena)\s*$/i, '').trim();
    const first = messages.find((message) => message.role === 'user')?.blocks.find((block) => block.type === 'text')?.text;
    const title = selected || (cleaned && !/^(ChatGPT|Claude|Gemini|Google Gemini|LMArena|Arena|New chat|Neuer Chat)$/i.test(cleaned) ? cleaned : first?.split('\n')[0]?.slice(0, 90)) || 'Neuer Chat';
    return { title: title.slice(0, 240), messages, truncated: state.truncated };
  }
  globalThis.KontextAdapters = { capture };
})();
