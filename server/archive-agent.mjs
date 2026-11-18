import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError, now, requiredText, text } from './domain.mjs';
import { agentScope, buildArchiveRecord, normalizeObservation, normalizePlan, runningPhases } from './archive-model.mjs';
import { localAgentModel } from './agent-model.mjs';

const validId = (value) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const defaultPurpose = 'Untersuche den sichtbaren Chatverlauf und die Projekte. Schlage ein Archiv nach Projekten, Phasen und Chat-Modi vor.';
const previews = (blocks, max, chars) => {
  const sample = blocks.length <= max ? blocks : Array.from({ length: max }, (_, i) => blocks[Math.floor(i * (blocks.length - 1) / (max - 1))]);
  return sample.map(({ id, type, role, group, author, lane, x, region, heading, text: content }) => ({ id, type, role, group, author, lane, x, region, heading, sample: content.slice(0, chars) }));
};
const routeFamily = (url, zone) => {
  const parsed = new URL(url);
  const directory = parsed.pathname.split('/').slice(0, -1).join('/');
  const query = [...new Set([...parsed.searchParams.keys()])].sort().join(',');
  return `${zone}::${directory}::${query}::${parsed.hash ? 'fragment' : ''}`;
};
const contentKey = ({ type, text: value, role, author, lane }) => `${type}\0${role}\0${author}\0${lane}\0${value}`;

function mergeEarlier(older, latest) {
  const left = older.blocks.map(contentKey);
  const right = latest.blocks.map(contentKey);
  for (let overlap = Math.min(left.length, right.length); overlap > 0; overlap--) {
    if (!left.slice(-overlap).every((value, i) => value === right[i])) continue;
    if (overlap === left.length) return null;
    let budget = 1_020_000;
    const all = [...older.blocks, ...latest.blocks.slice(overlap)];
    const blocks = all.slice(-1400).reverse().filter((block) => (budget -= block.text.length) >= 0).reverse();
    return { ...latest, blocks: blocks.map((block, i) => ({ ...block, id: `b${i + 1}` })),
      truncated: older.truncated || latest.truncated || all.length !== blocks.length };
  }
  return null;
}

export class ArchiveAgent {
  constructor(store, channel, fetcher, { browse, decide } = {}) {
    this.store = store;
    this.browse = browse || ((run, operation, signal) => channel.agentTool(run.id, run.scope, operation, signal));
    this.decide = decide || localAgentModel(store, fetcher);
    this.control = null;
    this.conversations = 0;
    this.run = store.latestArchiveRun();
    if (this.run && runningPhases.has(this.run.status)) {
      this.run.resumeStage = this.run.status;
      this.run.status = 'paused';
      this.run.notice = 'Der Desktop wurde neu gestartet. Öffne die freigegebene Seite in Chrome und setze den Lauf fort.';
      this.persist(this.run);
    }
  }
  persist(run) { run.updatedAt = now(); this.store.saveArchiveRun(run); }
  event(run, line) { run.log = [...run.log.slice(-19), { time: now(), text: line }]; this.persist(run); }
  state() {
    if (!this.run) return null;
    const { id, status, scope, purpose, plan, planVersion, items, current, notice, updatedAt, log, catalog, resumeStage } = this.run;
    return { id, status, origin: scope.origin, purpose, plan, planVersion, items, current, notice, updatedAt, log, resumeStage, observedCount: catalog.length,
      saved: items.filter((item) => item.status === 'saved').length, skipped: items.filter((item) => item.status === 'skipped').length };
  }
  checkId(id) {
    if (!this.run || id !== this.run.id) throw new AppError(404, 'Dieser Archivlauf ist nicht mehr aktiv. Aktualisiere die Ansicht.');
    return this.run;
  }
  setScope(run, scope) {
    const checked = agentScope(scope);
    if (checked.origin !== run.scope.origin) throw new AppError(409, `Öffne für diesen Lauf wieder ${run.scope.origin} in Chrome.`);
    run.scope = checked;
  }
  launch(run, task) {
    const controller = new AbortController();
    this.control = controller;
    void Promise.resolve().then(() => task(controller.signal)).catch((error) => {
      if (controller.signal.aborted || this.run !== run) return;
      if (!(error instanceof AppError)) console.error('Kontext Archiv-Agent:', error);
      run.resumeStage = run.status;
      run.status = 'paused';
      run.notice = error instanceof AppError ? error.message : 'Der Archivlauf wurde unterbrochen. Bereits gesicherte Chats bleiben erhalten.';
      this.event(run, run.notice);
    }).finally(() => { if (this.control === controller) this.control = null; });
  }
  start(input) {
    if (this.run && (runningPhases.has(this.run.status) || ['review', 'paused'].includes(this.run.status))) {
      if (input.replace !== true || runningPhases.has(this.run.status)) throw new AppError(409, 'Beende oder verwerfe zuerst den bestehenden Archivlauf.');
    }
    if (!this.store.demo && !validId(input.id)) throw new AppError(400, 'Ungültiger Archivlauf. Öffne Chrome erneut.');
    const scope = agentScope(input.scope);
    const run = { id: input.id || randomUUID(), scope, purpose: text(input.prompt, 4000) || defaultPurpose, status: 'exploring',
      plan: null, catalog: [], items: [], log: [], current: '', notice: '', resumeStage: '', updatedAt: now() };
    this.run = run;
    this.event(run, `Seite freigegeben: ${new URL(scope.origin).hostname}`);
    this.launch(run, (signal) => this.explore(run, signal));
    return this.state();
  }
  async step(run, operation, signal) {
    signal.throwIfAborted();
    const result = await this.browse(run, operation, signal);
    signal.throwIfAborted();
    return normalizeObservation(result, run.scope.origin);
  }
  catalog(run, page) {
    const known = new Map(run.catalog.map((item) => [item.url, item]));
    const found = [...page.targets.filter((node) => node.kind === 'link').map(({ href, label, context, group }) => ({ url: href, label, context, zone: group || context })),
      { url: page.url, label: page.title || 'Aktuelle Seite', context: page.blocks.some((b) => b.role === 'assistant' || b.role === 'user')
        ? 'Geöffnete Seite (Nachrichten erkannt)' : 'Geöffnete Seite', zone: '' }];
    for (const item of found) {
      if (known.has(item.url) || run.catalog.length >= 420) continue;
      const entry = { id: `c${run.catalog.length + 1}`, url: item.url, label: item.label, context: item.context, familyKey: routeFamily(item.url, item.zone) };
      known.set(entry.url, entry); run.catalog.push(entry);
    }
    const counts = new Map();
    for (const item of run.catalog) counts.set(item.familyKey, (counts.get(item.familyKey) || 0) + 1);
    const groups = new Map();
    for (const item of run.catalog) {
      if (!groups.has(item.familyKey)) groups.set(item.familyKey, `g${groups.size + 1}`);
      item.family = counts.get(item.familyKey) > 2 ? groups.get(item.familyKey) : '';
    }
    return known;
  }
  planContext(run, page) {
    const recent = run.catalog.slice(-200);
    return { goal: run.purpose, page: { url: page.url, title: page.title, loaded: page.ready, sample: previews(page.blocks, 25, 90),
      tools: page.targets.filter((target) => target.kind !== 'link').slice(0, 65), links: recent.filter((item) => page.targets.some((node) => node.href === item.url)).map((item) => item.id) },
      catalog: recent.map(({ id, label, url, context, family }) => [id, label.slice(0, 100), url.slice(run.scope.origin.length, run.scope.origin.length + 100), context.slice(0, 70), family]),
      previous: run.log.slice(-5).map((entry) => entry.text), limit: 'Arbeite nur mit beobachteten Referenzen.' };
  }
  async explore(run, signal) {
    let page = await this.step(run, { kind: 'inspect' }, signal);
    const attempted = new Set();
    for (let count = 0; count < 12; count++) {
      this.catalog(run, page);
      this.persist(run);
      const output = await this.decide('plan', this.planContext(run, page), signal);
      signal.throwIfAborted();
      if (output.tool === 'propose') { this.acceptPlan(run, output); return; }
      if (output.tool === 'ask') throw new AppError(409, text(output.message, 550) || 'Der Agent braucht Hilfe beim Öffnen des Chatverlaufs.');
      const candidate = run.catalog.find((item) => item.id === output.ref);
      const target = page.targets.find((node) => node.ref === output.ref);
      let operation;
      let label;
      if (output.tool === 'open' && candidate) { operation = { kind: 'open', url: candidate.url }; label = `Öffne: ${candidate.label}`; }
      if (output.tool === 'expand' && target?.kind === 'expand') { operation = { kind: 'expand', ref: target.ref, from: page.url }; label = `Klappe auf: ${target.label}`; }
      if (output.tool === 'scroll' && target?.kind === 'scroll' && ['up', 'down', 'top', 'bottom'].includes(output.direction)) {
        operation = { kind: 'scroll', ref: target.ref, from: page.url, direction: output.direction }; label = `Prüfe weiteren Verlauf: ${target.label}`;
      }
      const fingerprint = JSON.stringify([output.tool, page.url, candidate?.url || target?.label, output.direction, page.targets.filter((node) => node.kind === 'link').map((node) => node.href)]);
      if (!operation || attempted.has(fingerprint)) throw new AppError(409, 'Der Agent hat keinen neuen, zulässigen Navigationsschritt gefunden. Öffne den Chatverlauf und versuche es erneut.');
      attempted.add(fingerprint);
      this.event(run, label);
      page = await this.step(run, operation, signal);
    }
    throw new AppError(409, 'Die Erkundung ist nach 12 Schritten pausiert. Sie kann auf der aktuellen Seite fortgesetzt werden.');
  }
  acceptPlan(run, output) {
    const plan = normalizePlan(output, run.catalog);
    run.plan = plan; run.planVersion = randomUUID(); run.status = 'review'; run.notice = ''; run.resumeStage = '';
    this.event(run, `Archivplan für ${plan.items.length} ${plan.items.length === 1 ? 'Chat' : 'Chats'} erstellt. Noch nichts gespeichert.`);
  }
  revise(input) {
    const run = this.checkId(input.id);
    if (run.status !== 'review') throw new AppError(409, 'Der Plan kann nur vor der Freigabe geändert werden.');
    if (!run.planVersion || run.planVersion !== input.planVersion) throw new AppError(409, 'Der Archivplan hat sich geändert. Prüfe den aktuellen Plan.');
    const instruction = requiredText(input.prompt, 4000, 'Beschreibe, was am Plan geändert werden soll.');
    run.status = 'revising'; run.notice = '';
    this.event(run, 'Der Archivplan wird überarbeitet.');
    this.launch(run, async (signal) => {
      const output = await this.decide('revise', { instruction, goal: run.purpose,
        previous: run.plan, catalog: run.catalog.slice(-250).map(({ id, label, context, family }) => [id, label, context, family]) }, signal);
      signal.throwIfAborted();
      this.acceptPlan(run, output);
    });
    return this.state();
  }
  approve(input) {
    const run = this.checkId(input.id);
    if (run.status !== 'review') throw new AppError(409, 'Es liegt kein freigabefähiger Archivplan vor.');
    if (!run.planVersion || run.planVersion !== input.planVersion) throw new AppError(409, 'Der Archivplan hat sich geändert. Prüfe die neue Auswahl vor der Freigabe.');
    if (!Array.isArray(input.ids) || !input.ids.length) throw new AppError(400, 'Wähle mindestens einen Chat aus.');
    const selected = new Set(input.ids);
    const items = run.plan.items.filter((item) => selected.has(item.id));
    if (items.length !== selected.size) throw new AppError(400, 'Mindestens ein Chat gehört nicht zum angezeigten Plan.');
    this.setScope(run, input.scope);
    run.items = items.map((item) => ({ ...item, status: 'pending' }));
    run.status = 'archiving'; run.notice = '';
    this.event(run, `${items.length} ${items.length === 1 ? 'Chat freigegeben' : 'Chats freigegeben'}.`);
    this.launch(run, (signal) => this.archive(run, signal));
    return this.state();
  }
  pause(input, reason = 'Der Archivlauf wurde pausiert.') {
    const run = this.checkId(input.id);
    if (!runningPhases.has(run.status)) return this.state();
    this.control?.abort(new AppError(409, reason));
    run.resumeStage = run.status;
    run.status = 'paused'; run.notice = reason;
    this.event(run, reason);
    return this.state();
  }
  disconnect(reason) {
    if (this.run && runningPhases.has(this.run.status)) this.pause({ id: this.run.id }, reason);
  }
  resume(input) {
    const run = this.checkId(input.id);
    if (run.status !== 'paused') throw new AppError(409, 'Dieser Lauf ist nicht pausiert.');
    this.setScope(run, input.scope);
    if (run.resumeStage === 'revising' && run.plan) {
      run.status = 'review'; run.notice = ''; this.persist(run); return this.state();
    }
    const archiving = run.resumeStage === 'archiving' && run.items.length;
    run.status = archiving ? 'archiving' : 'exploring';
    if (!archiving && text(input.prompt, 2000)) run.purpose = text(`${run.purpose}\nHinweis: ${input.prompt}`, 5800);
    run.notice = '';
    this.event(run, 'Lauf fortgesetzt.');
    this.launch(run, (signal) => archiving ? this.archive(run, signal) : this.explore(run, signal));
    return this.state();
  }
  async archive(run, signal) {
    for (const item of run.items.filter((entry) => ['pending', 'reading'].includes(entry.status))) {
      signal.throwIfAborted();
      item.status = 'reading';
      run.current = item.label;
      this.event(run, `Lese: ${item.label}`);
      await this.step(run, { kind: 'open', url: item.url }, signal);
      let page;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await delay(850, undefined, { signal });
        page = await this.step(run, { kind: 'read', from: item.url }, signal);
        if (page.url === item.url && page.ready && page.blocks.length) break;
      }
      if (page.url !== item.url) throw new AppError(409, 'Der Tab zeigt nicht mehr das freigegebene Chat-Ziel. Prüfe in Chrome, ob der Chat erreichbar ist.');
      const classify = async () => {
        if (!page.blocks.length || !page.ready) return { isConversation: false };
        const result = await this.decide('classify', { goal: run.purpose, title: page.title, target: item, projects: run.plan.projects,
          evidenceCount: page.blocks.length, evidence: previews(page.blocks, 95, 170), truncated: page.truncated }, signal);
        signal.throwIfAborted();
        return result;
      };
      let decision = await classify();
      if (decision.needEarlier === true) {
        const more = page.targets.find((node) => node.kind === 'expand' && /earlier|older|previous|ältere|vorherige|frühere/i.test(node.label)
          && /messag|nachricht|antwort/i.test(node.label));
        const scroll = page.targets.find((node) => node.kind === 'scroll' && node.canUp && /main|artikel|inhalt|chat|conversation/i.test(`${node.context} ${node.label}`));
        if (more || scroll) {
          await this.step(run, more ? { kind: 'expand', ref: more.ref, from: page.url }
            : { kind: 'scroll', ref: scroll.ref, from: page.url, direction: 'up' }, signal);
          const earlier = await this.step(run, { kind: 'read', from: item.url }, signal);
          const merged = earlier.url === item.url && mergeEarlier(earlier, page);
          if (merged) { page = merged; decision = await classify(); }
          else page.truncated = true;
        } else page.truncated = true;
      }
      if (decision.needEarlier === true) page.truncated = true;
      const record = buildArchiveRecord(page, decision, item, run.plan);
      if (!record) {
        item.status = 'skipped'; item.note = 'Kein eindeutig identifizierbarer, sichtbarer Chatverlauf.';
        this.event(run, `Übersprungen: ${item.label}`);
        continue;
      }
      signal.throwIfAborted();
      const chat = this.store.saveArchiveConversation(record, run.id, run.plan.projects.find((project) => project.name === record.meta.project));
      item.status = 'saved'; item.chatId = chat.id; item.count = chat.count;
      item.stage = chat.archive.stage; item.mode = chat.archive.mode; item.project = chat.archive.project;
      item.note = chat.archive.needsReview ? 'Zuordnung oder Vollständigkeit prüfen.' : '';
      this.event(run, `Gesichert: ${item.label} · ${chat.count} Nachrichten`);
    }
    run.status = 'done'; run.current = ''; run.notice = ''; run.resumeStage = '';
    this.event(run, 'Archivlauf abgeschlossen.');
  }
  async talk(input) {
    const message = requiredText(input.prompt, 10000, 'Gib zuerst eine Nachricht ein.');
    if (this.conversations >= 2) throw new AppError(429, 'Der Assistent verarbeitet gerade andere Nachrichten.');
    const state = this.state();
    const scope = input.scope ? agentScope(input.scope) : null;
    const actions = [];
    if (scope && (!state || state.status === 'done')) actions.push('explore');
    if (state?.status === 'review') actions.push('revise');
    let page;
    if (input.page != null) {
      if (!scope) throw new AppError(400, 'Für Seitenfragen muss der aktive Tab freigegeben sein.');
      const snapshot = normalizeObservation(input.page, scope.origin);
      if (snapshot.url !== scope.url) throw new AppError(409, 'Die Seite hat sich vor dem Lesen geändert.');
      page = { origin: scope.origin, title: snapshot.title, partial: true,
        sample: previews(snapshot.blocks, 36, 220), links: snapshot.targets.filter((target) => target.kind === 'link').slice(0, 40)
          .map(({ label, context }) => ({ label, context })) };
    }
    const history = (Array.isArray(input.history) ? input.history.slice(-10) : []).flatMap((turn) => ['user', 'assistant'].includes(turn?.role) ? [{ role: turn.role, content: text(turn.content, 1000) }] : []);
    this.conversations++;
    try {
      const output = await this.decide('talk', { message, history, actions, page, run: state && { origin: state.origin, goal: state.purpose,
        status: state.status, saved: state.saved, skipped: state.skipped, plan: state.plan && { caption: state.plan.caption, projects: state.plan.projects, count: state.plan.items.length } } }, AbortSignal.timeout(120_000));
      return { reply: text(output.reply, 8000) || 'Das Sprachmodell hat keinen Antworttext geliefert.', proposal: actions.includes(output.proposal) ? output.proposal : null };
    } finally { this.conversations--; }
  }
}
