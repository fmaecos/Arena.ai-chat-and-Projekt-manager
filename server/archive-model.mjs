import { AppError, text, webUrl } from './domain.mjs';

export const ARCHIVE_LIMIT = 120;
export const MODES = ['chat', 'duel', 'multi', 'unknown'];
export const ROLES = ['user', 'assistant', 'system', 'unknown'];
export const runningPhases = new Set(['exploring', 'revising', 'archiving']);
const forbiddenLabel = /^(?:delete|remove|löschen|abmelden|sign out|log out|account settings|kontoeinstellungen|checkout|download)(?:$|\s)/iu;
const forbidden = /^(?:log[-_ ]?in|log[-_ ]?out|sign[-_ ]?in|sign[-_ ]?out|oauth|auth|account|password|api|billing|payment|checkout|settings|admin|delete|remove|revoke|unsubscribe|reset|cancel|löschen|abmelden|konto|zahlung)$/iu;

export function archiveUrl(value, origin) {
  const url = webUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) return '';
  try { if (`${decodeURIComponent(parsed.pathname)}/${decodeURIComponent(parsed.hash).replace(/^#/, '')}`.split('/').some((part) => forbidden.test(part))) return ''; } catch { return ''; }
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:utm_\w+|fbclid|gclid|ref)$/i.test(key)) parsed.searchParams.delete(key);
    if (/token|password|session|api[_-]?key|signature/i.test(key) || /^(?:action|op|command)$/i.test(key) && forbidden.test(parsed.searchParams.get(key))) return '';
  }
  return parsed.href;
}

export function agentScope(value) {
  if (!Number.isSafeInteger(value?.tabId) || value.tabId < 0 || typeof value.origin !== 'string') throw new AppError(400, 'Wähle zuerst einen aktiven HTTPS-Tab in Chrome.');
  const url = archiveUrl(value.url, value.origin);
  if (!url) throw new AppError(400, 'Die aktuelle Seite kann nicht für einen Archivlauf freigegeben werden.');
  return { tabId: value.tabId, origin: value.origin, url, title: text(value.title, 200) };
}

export function normalizeObservation(raw, origin) {
  const url = archiveUrl(raw?.url, origin);
  if (!url) throw new AppError(409, 'Der Tab hat die freigegebene Archivseite verlassen oder fordert eine Anmeldung.');
  const refs = new Set();
  const targets = (Array.isArray(raw.targets) ? raw.targets.slice(0, 480) : []).flatMap((node) => {
    if (!/^[a-z0-9-]{1,70}$/i.test(node?.ref || '') || refs.has(node.ref) || !['link', 'expand', 'scroll'].includes(node.kind)) return [];
    const label = text(node.label, 240);
    if (node.kind !== 'scroll' && (!label || forbiddenLabel.test(label))) return [];
    const href = node.kind === 'link' ? archiveUrl(node.href, origin) : '';
    if (node.kind === 'link' && !href) return [];
    refs.add(node.ref);
    return [{ ref: node.ref, kind: node.kind, label, href, context: text(node.context, 240), group: text(node.group, 140),
      canUp: node.canUp === true, canDown: node.canDown === true }];
  });
  const seen = new Set();
  let truncated = raw.truncated === true;
  let budget = 1_020_000;
  const candidates = Array.isArray(raw.blocks) ? raw.blocks : [];
  if (candidates.length > 1400) truncated = true;
  const blocks = candidates.slice(0, 1400).flatMap((block) => {
    if (!/^[a-z0-9-]{1,70}$/i.test(block?.id || '') || seen.has(block.id) || !['text', 'code', 'attachment'].includes(block.type)) return [];
    const source = typeof block.text === 'string' ? block.text : '';
    const value = source.slice(0, Math.min(64_000, budget));
    if (source.length > value.length) truncated = true;
    if (!value.trim()) return [];
    budget -= value.length;
    seen.add(block.id);
    return [{ id: block.id, type: block.type, text: value, language: text(block.language, 32), url: block.type === 'attachment' ? webUrl(block.url) : '',
      role: ROLES.includes(block.role) ? block.role : 'unknown', group: text(block.group, 100), author: text(block.author, 96), lane: text(block.lane, 96),
      region: text(block.region, 120), x: Number.isFinite(block.x) ? Math.max(0, Math.min(100, block.x)) : null,
      time: typeof block.time === 'string' && Number.isFinite(Date.parse(block.time)) ? new Date(block.time).toISOString() : null,
      heading: block.heading === true }];
  });
  return { url, title: text(raw.title, 240), targets, blocks, truncated, ready: raw.ready !== false };
}

export function normalizePlan(input, catalog) {
  const known = new Map(catalog.map((item) => [item.id, item]));
  const selected = new Set();
  const blocked = new Set(Array.isArray(input?.exclude) ? input.exclude : []);
  const groups = new Set((Array.isArray(input?.groups) ? input.groups : []).filter((key) => typeof key === 'string'));
  const ids = Array.isArray(input?.items) ? input.items.slice(0, ARCHIVE_LIMIT) : [];
  for (const item of ids) if (known.has(typeof item === 'string' ? item : item?.id)) selected.add(typeof item === 'string' ? item : item.id);
  for (const item of catalog) if (item.family && groups.has(item.family)) selected.add(item.id);
  const assignments = new Map(ids.filter((entry) => entry && typeof entry === 'object').map((entry) => [entry.id, entry]));
  const names = new Set();
  const projects = (Array.isArray(input?.projects) ? input.projects.slice(0, 20) : []).flatMap((project) => {
    const name = text(project?.name, 80);
    const key = name.toLowerCase();
    if (!key || names.has(key)) return [];
    names.add(key);
    return [{ name, description: text(project.description, 530), stages: [...new Set((Array.isArray(project.stages) ? project.stages : []).map((value) => text(value, 55)).filter(Boolean))].slice(0, 12) }];
  });
  const items = [...selected].filter((id) => !blocked.has(id)).slice(0, ARCHIVE_LIMIT).map((id) => {
    const candidate = known.get(id);
    const assignment = assignments.get(id);
    const project = projects.find((p) => p.name.toLowerCase() === text(assignment?.project, 80).toLowerCase());
    const stage = project?.stages.find((s) => s.toLowerCase() === text(assignment?.stage, 55).toLowerCase());
    return { id, label: candidate.label, url: candidate.url, context: candidate.context, project: project?.name || '', stage: stage || '',
      mode: MODES.includes(assignment?.mode) ? assignment.mode : 'unknown' };
  });
  if (!items.length) throw new AppError(409, 'Das Modell hat noch keine belegten Chat-Ziele vorgeschlagen. Öffne den Verlauf in Chrome oder gib einen genaueren Hinweis.');
  return { caption: text(input?.caption, 150) || 'Archivplan', explanation: text(input?.explanation, 1500), structure: text(input?.structure, 1600),
    caution: text(input?.caution, 700), projects, items };
}

// The model labels and groups original evidence. It never supplies the message text written to SQLite.
export function buildArchiveRecord(observation, decision, item, plan) {
  const blocks = observation.blocks;
  if (decision?.isConversation === false || !blocks.length) return null;
  const position = new Map(blocks.map((block, i) => [block.id, i]));
  const groups = new Map();
  for (const [i, entry] of (Array.isArray(decision?.messages) ? decision.messages.slice(0, blocks.length) : []).entries()) {
    const first = position.get(entry?.first);
    const last = position.get(entry?.last || entry?.first);
    if (!ROLES.includes(entry?.role) || first == null || last == null || last < first) continue;
    for (let j = first; j <= last; j++) {
      if (!groups.has(j)) groups.set(j, { key: `m-${i}`, role: entry.role, lane: text(entry.lane, 96), author: text(entry.author, 96) });
    }
  }
  if (!blocks.some((block) => ['user', 'assistant'].includes(block.role)) && ![...groups.values()].some((entry) => ['user', 'assistant'].includes(entry.role))) return null;
  let previous;
  const messages = [];
  let uncertain = false;
  for (const [index, block] of blocks.entries()) {
    const inferred = groups.get(index);
    const role = block.role !== 'unknown' ? block.role : inferred?.role || 'unknown';
    const lane = block.lane || inferred?.lane || '';
    const author = block.author || inferred?.author || '';
    const key = `${block.group || inferred?.key || 'ungrouped'}|${role}|${lane}|${author}`;
    if (role === 'unknown') uncertain = true;
    if (!previous || previous.key !== key) {
      previous = { key, message: { id: `message-${index + 1}`, role, author, lane, time: block.time, blocks: [] } };
      messages.push(previous.message);
    }
    if (!previous.message.time) previous.message.time = block.time;
    previous.message.blocks.push(block.type === 'code' ? { type: 'code', text: block.text, language: block.language }
      : block.type === 'attachment' ? { type: 'attachment', text: block.text, url: block.url } : { type: 'text', text: block.text });
  }
  const lanes = [...new Set(messages.map((m) => m.lane).filter(Boolean))];
  const mode = MODES.includes(decision?.mode) && decision.mode !== 'unknown' ? decision.mode
    : item.mode !== 'unknown' ? item.mode : lanes.length > 1 ? 'multi' : 'unknown';
  const project = plan.projects.find((p) => p.name === item.project)
    || plan.projects.find((p) => p.name.toLowerCase() === text(decision?.project, 80).toLowerCase());
  const stage = project?.stages.find((s) => s === item.stage)
    || project?.stages.find((s) => s.toLowerCase() === text(decision?.stage, 55).toLowerCase()) || '';
  const observedTitle = text(observation.title, 240);
  const generic = /^(?:arena(?:\.ai| ai)?|lmarena|chatgpt|claude|gemini|new chat|neuer chat)$/i.test(observedTitle);
  const missingLanes = ['duel', 'multi'].includes(mode) && lanes.length < 2;
  return { title: observedTitle && !generic ? observedTitle : item.label, url: item.url, messages, truncated: observation.truncated,
    meta: { mode, stage, project: project?.name || '', lanes, needsReview: uncertain || missingLanes || mode === 'unknown' || !project || !stage || observation.truncated,
      note: text(decision?.note, 520) || (missingLanes ? 'Antwortspuren sind im sichtbaren Verlauf nicht eindeutig getrennt.' : ''), origin: new URL(item.url).origin } };
}
