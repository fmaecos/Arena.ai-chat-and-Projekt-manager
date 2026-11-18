// A single, provider-independent browser tool. Loaded only in a user-authorized tab's isolated world.
(() => {
  if (globalThis.KontextArchivePage) return;
  const references = new Map();
  const nodeKeys = new WeakMap();
  let keyCount = 0;
  let scanCount = 0;
  const sensitive = /^(?:log[-_ ]?in|log[-_ ]?out|sign[-_ ]?in|sign[-_ ]?out|oauth|auth|account|password|api|billing|payment|checkout|settings|admin|delete|remove|revoke|unsubscribe|reset|cancel|löschen|abmelden|konto|zahlung)$/iu;
  const destructiveLabel = /^(?:delete|remove|löschen|abmelden|sign out|log out|account settings|kontoeinstellungen|checkout|download)(?:$|\s)/iu;
  const modifyingControl = /(?:^|[^\p{L}])(?:delete|remove|reset|clear|send|submit|rename|edit|save|download|log out|sign out|settings|löschen|leeren|senden|umbenennen|bearbeiten|speichern|abmelden|einstellungen)(?:$|[^\p{L}])/iu;
  const hidden = '[hidden], [aria-hidden="true"], [inert], .sr-only, .visually-hidden';
  const ignored = `script, style, svg, template, noscript, canvas, input, textarea, select, [contenteditable="true"], [role="textbox"], [type="password"], ${hidden}`;
  const outside = 'nav, aside, footer, header[role="banner"], [role="navigation"], [role="complementary"], [role="contentinfo"], [role="dialog"], form';
  const messageHints = '[data-message-author-role], [data-message-role], [data-role="user"], [data-role="assistant"], [data-role="system"], [data-message-id], [itemprop="message"], [aria-label*=" message" i], [aria-label*="nachricht von" i]';
  const hints = 'nav, aside, section, [role="navigation"], [role="region"], [role="list"], [role="group"], [role="main"], main, article';
  const typography = /^[Hh][1-6]$/;
  const inlines = new Set(['A', 'ABBR', 'B', 'BR', 'CITE', 'CODE', 'DEL', 'EM', 'I', 'KBD', 'MARK', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'WBR']);
  const clip = (value, size = 220) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, size) : '';
  const nodeKey = (node) => { if (!nodeKeys.has(node)) nodeKeys.set(node, `m${++keyCount}`); return nodeKeys.get(node); };

  function safeHref(value, sameOrigin = false) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, location.href);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      if (sameOrigin) {
        if (url.protocol !== 'https:' || url.origin !== location.origin || `${decodeURIComponent(url.pathname)}/${decodeURIComponent(url.hash).replace(/^#/, '')}`.split('/').some((part) => sensitive.test(part))) return '';
        for (const key of [...url.searchParams.keys()]) {
          if (/token|password|session|api[_-]?key|signature/i.test(key) || /^(?:action|op|command)$/i.test(key) && sensitive.test(url.searchParams.get(key))) return '';
          if (/^(?:utm_\w+|fbclid|gclid|ref)$/i.test(key)) url.searchParams.delete(key);
        }
      }
      return url.href;
    } catch { return ''; }
  }
  const labelOf = (node, size) => clip(node?.getAttribute('aria-label') || node?.getAttribute('title') || node?.innerText || node?.textContent, size);
  const headingOf = (node) => {
    const ids = node?.getAttribute('aria-labelledby');
    return clip(node?.getAttribute('aria-label') || ids?.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
      || [...(node?.children || [])].find((child) => typography.test(child.tagName))?.textContent, 110);
  };
  const area = (node) => {
    const regions = [];
    for (let parent = node.closest(hints); parent && regions.length < 4; parent = parent.parentElement?.closest(hints)) {
      const label = headingOf(parent);
      if (label) regions.push(label);
      else if (['NAV', 'ASIDE', 'MAIN', 'ARTICLE'].includes(parent.tagName)) regions.push(parent.tagName.toLowerCase());
    }
    return regions.filter((value, i) => regions.indexOf(value) === i).reverse().join(' › ').slice(0, 210);
  };
  const shown = (node, cache) => {
    if (!node || !node.isConnected || node.matches(hidden)) return false;
    const closed = node.parentElement?.closest('details:not([open])');
    if (closed && ![...closed.children].some((child) => child.tagName === 'SUMMARY' && child.contains(node))) return false;
    if (cache.has(node)) return cache.get(node);
    const css = getComputedStyle(node);
    const visible = css.display !== 'none' && css.visibility !== 'hidden' && css.visibility !== 'collapse' && css.contentVisibility !== 'hidden'
      && (!node.parentElement || shown(node.parentElement, cache));
    cache.set(node, visible);
    return visible;
  };
  const captureAllowed = (node, cache) => !node.closest(ignored) && shown(node, cache);
  const siteList = /chat|histor|verlauf|project|projekt|conversation|gespr[äa]ch|thread|antwort|messages|nachrichten/i;
  const readOnlyExpand = /(?:^(?:show|view|see|open|load|expand)\s+(?:(?:more|older|earlier|all|previous|the|[0-9]+)\s+)*(?:chats?|conversations?|projects?|history|messages?|threads?)\b|^(?:mehr|weitere|ältere|alle|vorherige|frühere)\s+(?:chats?|nachrichten|projekte|gespr[äa]che|unterhaltungen)|^(?:chat[- ]?verlauf|verlauf|chat[- ]?liste|projekte|gespr[äa]che|unterhaltungen|[äa]ltere nachrichten)\s+(?:anzeigen|[öo]ffnen|laden|einblenden)|^(?:chat[- ]?verlauf|verlauf|chat history|conversation history|history|projects|projekte|conversations|unterhaltungen)$)/iu;
  const more = /^(?:show more|load more|weiter(?:e)? anzeigen|mehr (?:anzeigen|laden)|nächste seite|next page)$/iu;
  function expandKind(node, label, context) {
    if (!label || destructiveLabel.test(label) || modifyingControl.test(label) || node.form || node.closest('form, [role="dialog"], [download], [contenteditable="true"]')
      || node.matches('[disabled], [aria-disabled="true"], [type="submit"], [type="reset"]')) return '';
    if (node.tagName === 'SUMMARY' && node.parentElement?.tagName === 'DETAILS' && !node.parentElement.open && (siteList.test(label) || siteList.test(context))) return 'details';
    if (node.getAttribute('aria-expanded') === 'true') return '';
    const namedSidebar = /^(?:(?:open|expand|show|toggle) (?:the )?(?:history|chat )?(?:sidebar|navigation)|(?:seitenleiste|navigation|verlaufsleiste) (?:öffnen|einblenden))$/iu;
    const controls = node.getAttribute('aria-controls');
    const target = controls ? document.getElementById(controls) : null;
    const opensNavigation = node.getAttribute('aria-expanded') === 'false' && namedSidebar.test(label)
      && (!target || target.matches('nav, aside, [role="navigation"], [role="complementary"]') || siteList.test(headingOf(target)));
    if (opensNavigation || readOnlyExpand.test(label) || (more.test(label) && siteList.test(context))) return 'button';
    return '';
  }
  function discover(cache, track) {
    if (track) references.clear();
    const prefix = track ? `s${++scanCount}-` : 'context-';
    const result = [];
    const emit = (node, item, action) => {
      const ref = `${prefix}${result.length + 1}`;
      if (track) references.set(ref, { node, kind: item.kind, action });
      result.push({ ...item, ref });
    };
    const visited = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (result.length >= 410) break;
      const raw = anchor.getAttribute('href');
      if (!raw || raw === '#' || anchor.closest('form,[role="dialog"],[download]') || !captureAllowed(anchor, cache)) continue;
      const url = safeHref(anchor.href, true);
      const label = labelOf(anchor, 190);
      if (!url || visited.has(url) || !label || destructiveLabel.test(label)) continue;
      const context = area(anchor);
      if (anchor.closest(messageHints)) continue;
      visited.add(url);
      const list = anchor.closest('nav, aside, ul, ol, [role="list"], [role="navigation"], section, main');
      emit(anchor, { kind: 'link', href: url, label, context, group: headingOf(list) || context });
    }
    for (const node of document.querySelectorAll('details > summary, button, [role="button"]')) {
      if (result.length >= 455) break;
      if (!captureAllowed(node, cache)) continue;
      const label = labelOf(node, 170);
      const context = area(node);
      const action = expandKind(node, label, context);
      if (action) emit(node, { kind: 'expand', label, context }, action);
    }
    const scrollSet = new Set([document.scrollingElement]);
    for (const outer of document.querySelectorAll('main, aside, nav, [role="main"], [role="region"], [role="log"], section, [class*="scroll"], [class*="overflow"], [style*="overflow"]')) {
      if (scrollSet.size >= 24) break;
      if (outer.clientHeight >= 70 && outer.scrollHeight > outer.clientHeight + 20 && /auto|scroll/i.test(getComputedStyle(outer).overflowY)) scrollSet.add(outer);
    }
    for (const node of scrollSet) {
      if (!node || node.scrollHeight <= node.clientHeight + 15 || !shown(node, cache)) continue;
      const context = area(node);
      emit(node, { kind: 'scroll', label: context || (node === document.scrollingElement ? 'Seiteninhalt' : 'Scrollbereich'), context,
        canUp: node.scrollTop > 12, canDown: node.scrollTop + node.clientHeight < node.scrollHeight - 12 });
    }
    return result;
  }
  function explicitRole(node) {
    const data = node.getAttribute('data-message-author-role') || node.getAttribute('data-message-role') || node.getAttribute('data-role');
    if (['user', 'assistant', 'system'].includes(data)) return data;
    if (['bot', 'model', 'ai'].includes(data)) return 'assistant';
    const accessible = node.getAttribute('aria-label') || '';
    if (/^(?:user message|message from (?:you|user)|nachricht von dir)(?:$|[ :])/i.test(accessible)) return 'user';
    if (/^(?:assistant message|model message|response from|nachricht vom assistenten)(?:$|[ :])/i.test(accessible)) return 'assistant';
    return '';
  }

  function read(root, cache, lightweight) {
    const blocks = [];
    const markerCache = new WeakMap();
    let budget = lightweight ? 12_000 : 900_000;
    const maxBlocks = lightweight ? 46 : 1350;
    let truncated = false;
    let visited = 0;
    const meta = (node) => {
      if (markerCache.has(node)) return markerCache.get(node);
      let role = '', author = '', lane = '', group = '', time = null;
      let parent = node;
      for (let i = 0; parent && i < 11; parent = parent.parentElement, i++) {
        const explicit = explicitRole(parent);
        if (explicit && !role) role = explicit;
        if (!group && (explicit || parent.matches('[data-message-id], [itemprop="message"], [role="article"]'))) {
          group = nodeKey(parent);
          time = (parent.matches('time[datetime]') ? parent : parent.querySelector('time[datetime]'))?.getAttribute('datetime') || null;
        }
        author ||= clip(parent.getAttribute('data-model-name') || parent.getAttribute('data-model') || parent.getAttribute('data-author'), 95);
        const semanticLane = parent.getAttribute('data-lane') || parent.getAttribute('data-side') || parent.getAttribute('data-response-index');
        const namedLane = headingOf(parent);
        lane ||= clip(semanticLane || (/^(?:model|modell|answer|antwort|response|side|seite)\s+(?:[a-z]|\d+)\b/i.test(namedLane) ? namedLane : ''), 95);
      }
      const rect = node.getBoundingClientRect();
      const data = { role: role || 'unknown', author, lane, group, time, region: area(node), x: Math.round(100 * rect.left / Math.max(1, innerWidth)) };
      markerCache.set(node, data);
      return data;
    };
    const add = (node, type, value, extra = {}) => {
      if (!value || !value.trim()) return;
      const limit = Math.min(64_000, budget);
      if (blocks.length >= maxBlocks || budget <= 0) { truncated = true; return; }
      if (value.length > limit) truncated = true;
      budget -= Math.min(limit, value.length);
      blocks.push({ id: `b${blocks.length + 1}`, type, text: value.slice(0, limit), ...meta(node), ...extra });
    };
    const inline = (item, depth = 0, preserve = false, plain = false) => {
      if (depth > 26 || ++visited > 48_000) { truncated = true; return ''; }
      if (item.nodeType === Node.TEXT_NODE) return preserve ? (item.nodeValue || '') : (item.nodeValue || '').replace(/\s+/g, ' ');
      if (item.nodeType !== Node.ELEMENT_NODE || !captureAllowed(item, cache) || item.matches('button, img, a[download], [role="button"]')) return '';
      if (item.tagName === 'BR') return '\n';
      const body = [...item.childNodes].map((child) => inline(child, depth + 1, preserve, plain)).join('');
      if (plain || !body.trim()) return body;
      if (item.tagName === 'A') {
        const url = safeHref(item.getAttribute('href'));
        return url ? `[${body.trim().replace(/[\[\]]/g, '\\$&')}](<${url.replace(/[<>]/g, encodeURIComponent)}>)` : body;
      }
      if (item.tagName === 'CODE') return `${'`'.repeat(1 + Math.max(0, ...(body.match(/`+/g) || []).map((part) => part.length)))}${body}${'`'.repeat(1 + Math.max(0, ...(body.match(/`+/g) || []).map((part) => part.length)))}`;
      const marker = ['B', 'STRONG'].includes(item.tagName) ? '**' : ['I', 'EM'].includes(item.tagName) ? '*' : item.tagName === 'DEL' || item.tagName === 'S' ? '~~' : '';
      return marker ? `${body.match(/^\s*/)[0]}${marker}${body.trim()}${marker}${body.match(/\s*$/)[0]}` : body;
    };
    const attachment = (node) => {
      const inner = node.matches('img, a[download]') ? node : node.querySelector('a[download],a[href],img') || node;
      const source = inner.getAttribute('href') || inner.getAttribute('src');
      const label = clip(inner.getAttribute('download') || inner.getAttribute('alt') || node.getAttribute('aria-label') || node.textContent || (source ? 'Bild oder Datei' : ''), 300);
      if (label && !/^(avatar|user icon|profile|logo|model icon|profilbild)\b/i.test(label)) add(node, 'attachment', label, { url: source ? safeHref(source) : '' });
    };
    const walk = (node, depth = 0) => {
      if (++visited > 48_000 || depth > 90 || blocks.length >= maxBlocks || budget <= 0) { truncated = true; return; }
      if (!captureAllowed(node, cache) || (node !== root && node.matches(outside)) || node.matches('button, [role="button"]:not(a), menu, [role="menu"]')) return;
      const tag = node.tagName;
      if (tag === 'PRE') {
        const code = [...node.querySelectorAll('code, [data-code-block]')].find((child) => captureAllowed(child, cache)) || node;
        const language = code.getAttribute('data-language') || node.getAttribute('data-language') || code.getAttribute('class')?.match(/(?:lang|language)-([\w#+-]+)/)?.[1] || '';
        add(code, 'code', inline(code, 0, true, true), { language });
        return;
      }
      if (node.matches('img[src], a[download], [data-attachment], [data-file-name], [data-testid*="attachment" i]')) { attachment(node); return; }
      if (tag === 'TABLE') {
        const rows = [...node.querySelectorAll('tr')].slice(0, 250).map((row) => [...row.children].filter((child) => child.matches('th,td'))
          .map((cell) => inline(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' ')));
        if (rows[0]?.length) add(node, 'text', `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map((row) => `| ${row.join(' | ')} |`).join('\n')}`);
        return;
      }
      const style = getComputedStyle(node);
      let paragraph = '';
      const prefix = typography.test(tag) ? `${'#'.repeat(Number(tag.slice(1)))} ` : tag === 'LI' ? '- ' : tag === 'BLOCKQUOTE' ? '> ' : '';
      const flush = () => { if (paragraph.trim()) add(node, 'text', `${prefix}${paragraph.trim()}`, { heading: typography.test(tag) }); paragraph = ''; };
      const preserve = ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(style.whiteSpace);
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { paragraph += inline(child, 0, preserve); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const inlineOnly = inlines.has(child.tagName) && !child.querySelector('pre, table, ul, ol, p, img[src], a[download], [data-message-id], [data-attachment]');
        if (inlineOnly && !child.matches('a[download], [data-attachment], [data-file-name], [data-testid*="attachment" i]')) paragraph += inline(child, 0, preserve);
        else { flush(); walk(child, depth + 1); }
      }
      flush();
    };
    walk(root);
    return { blocks, truncated };
  }

  async function run(operation) {
    const url = safeHref(location.href, true);
    if (!url || operation.origin !== location.origin || (operation.from && operation.from !== url)) throw Error('Die freigegebene Seite hat sich verändert.');
    if (operation.kind === 'expand' || operation.kind === 'scroll') {
      const entry = references.get(operation.ref);
      if (entry?.kind !== operation.kind || !shown(entry.node, new WeakMap())) throw Error('Das Element ist nicht mehr sichtbar. Prüfe den geöffneten Verlauf.');
      const { node, action } = entry;
      if (operation.kind === 'scroll') {
        const direction = operation.direction;
        if (!['up', 'down', 'top', 'bottom'].includes(direction)) throw Error('Unzulässige Scrollrichtung.');
        const value = direction === 'top' ? 0 : direction === 'bottom' ? node.scrollHeight : node.scrollTop + node.clientHeight * (direction === 'up' ? -.85 : .85);
        node.scrollTo({ top: value, behavior: 'instant' });
      } else {
        if (expandKind(node, labelOf(node), area(node)) !== action) throw Error('Nur sichtbar beschriftete Verlaufselemente können geöffnet werden.');
        if (action === 'details') node.parentElement.open = true;
        else node.click();
      }
      await new Promise((resolve) => setTimeout(resolve, 480));
    }
    const current = safeHref(location.href, true);
    if (!current || operation.origin !== location.origin) throw Error('Die Seite hat den erlaubten Bereich verlassen.');
    const cache = new WeakMap();
    const root = [...document.querySelectorAll('main, [role="main"]')].find((node) => shown(node, cache)) || document.body;
    const { blocks, truncated } = root ? read(root, cache, operation.kind !== 'read') : { blocks: [], truncated: false };
    const heading = root && [...root.querySelectorAll('h1')].find((node) => captureAllowed(node, cache));
    const title = clip(heading?.innerText || document.title, 240);
    const targets = discover(cache, operation.kind !== 'context');
    return { url: current, title, ready: document.readyState !== 'loading' && root?.getAttribute('aria-busy') !== 'true', targets, blocks, truncated };
  }
  globalThis.KontextArchivePage = { run };
})();
