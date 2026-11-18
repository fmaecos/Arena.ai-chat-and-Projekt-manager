import { createHash, randomUUID } from 'node:crypto';
import { AppError, normalizeAction, now } from './domain.mjs';

export class Channel {
  constructor(demo = false) {
    this.demo = demo;
    this.lastSeen = null;
    this.tab = null;
    this.live = null;
    this.digest = '';
    this.commands = new Map();
    this.waiters = new Set();
  }
  seen() { this.lastSeen = now(); }
  get connected() { return this.demo || (this.lastSeen && Date.now() - Date.parse(this.lastSeen) < 38_000); }
  state(paired) {
    const connection = this.demo ? 'demo' : this.connected ? 'connected' : paired ? 'offline' : 'unpaired';
    // Keep the last capture visible after a disconnect, but mark the connection as offline.
    return { connection, lastSeen: this.lastSeen, tab: this.tab, live: this.live };
  }
  setLive({ tab, chat }) {
    this.seen();
    const digest = createHash('sha256').update(JSON.stringify({ tab, chat })).digest('hex');
    if (digest === this.digest) return;
    this.digest = digest;
    this.tab = tab;
    this.live = chat ? { ...chat, revision: randomUUID(), capturedAt: chat.capturedAt || now() } : null;
  }
  reset() {
    this.lastSeen = null;
    this.tab = null;
    this.live = null;
    this.digest = '';
    for (const command of this.commands.values()) command.finish?.(false, 'Die Chrome-Verbindung wurde getrennt.');
    this.commands.clear();
    for (const settle of this.waiters) settle([]);
  }
  prune() {
    for (const [id, command] of this.commands) {
      const age = Date.now() - command.created;
      if (age > 150_000) this.commands.delete(id);
      else if (age > 25_000 && ['queued', 'running'].includes(command.status)) {
        command.status = 'error';
        command.note = 'Chrome hat nicht rechtzeitig geantwortet.';
      }
    }
  }
  enqueue(input) {
    const action = normalizeAction(input);
    if (!action || !['open_tab', 'focus_chat', 'capture'].includes(action.type)) throw new AppError(400, 'Diese Browser-Aktion wird nicht unterstützt.');
    if (!this.connected) throw new AppError(409, 'Die Chrome-Erweiterung ist derzeit nicht verbunden.');
    if (action.type === 'focus_chat' && (!this.live || input.revision !== this.live.revision)) {
      throw new AppError(409, 'Der aktive Chat hat sich geändert. Wähle die Aktion erneut.');
    }
    this.prune();
    if (this.commands.size >= 60) throw new AppError(429, 'Zu viele Browser-Aktionen. Warte einen Moment.');
    const command = { id: randomUUID(), created: Date.now(), status: 'queued', action,
      target: action.type === 'focus_chat' ? this.tab : null };
    if (this.demo) {
      command.status = 'done';
      command.note = action.type === 'capture' ? 'Demo-Chat aktualisiert.' : 'Aktion in der Vorschau simuliert. Im Desktop läuft sie in Chrome.';
      this.seen();
    }
    this.commands.set(command.id, command);
    if (this.waiters.size && command.status === 'queued') [...this.waiters][0](this.take());
    return this.command(command.id);
  }
  agentTool(runId, scope, operation, signal) {
    if (!this.connected || this.demo) return Promise.reject(new AppError(409, 'Die Chrome-Erweiterung antwortet nicht.'));
    if (signal.aborted) return Promise.reject(signal.reason);
    this.prune();
    if (this.commands.size >= 60) return Promise.reject(new AppError(429, 'Chrome kann derzeit keine weiteren Aufträge übernehmen.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (ok, note, result) => {
        this.commands.delete(id);
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (ok) resolve(result); else reject(new AppError(409, note || 'Der Browser-Schritt ist fehlgeschlagen.'));
      };
      const abort = () => finish(false, 'Der Archivlauf wurde pausiert.');
      const timer = setTimeout(() => finish(false, 'Chrome hat nicht rechtzeitig geantwortet. Öffne die freigegebene Seite erneut.'), 23_000);
      signal.addEventListener('abort', abort, { once: true });
      this.commands.set(id, { id, created: Date.now(), status: 'queued', finish,
        action: { type: 'agent_tool', runId, ...operation }, target: { id: scope.tabId, origin: scope.origin } });
      if (this.waiters.size) [...this.waiters][0](this.take());
    });
  }
  answerAgentTool(id, ok, note, result) {
    this.seen();
    const command = this.commands.get(id);
    if (command?.status === 'running' && command.finish) command.finish(ok === true, typeof note === 'string' ? note.slice(0, 300) : '', result);
  }
  take() {
    this.prune();
    const queued = [...this.commands.values()].filter((command) => command.status === 'queued').slice(0, 5);
    queued.forEach((command) => { command.status = 'running'; });
    return queued.map(({ id, action, target }) => ({ id, action, target }));
  }
  poll(response) {
    this.seen();
    const immediate = this.take();
    if (immediate.length) return Promise.resolve(immediate);
    if (this.waiters.size >= 2) throw new AppError(429, 'Es ist bereits eine Abfrage aktiv.');
    return new Promise((resolve) => {
      const complete = (value = []) => {
        clearTimeout(timer);
        response.off('close', closed);
        this.waiters.delete(complete);
        resolve(value);
      };
      const closed = () => complete();
      const timer = setTimeout(complete, 12_000);
      this.waiters.add(complete);
      response.once('close', closed);
    });
  }
  acknowledge(id, ok, note) {
    this.seen();
    const command = this.commands.get(id);
    if (command?.status === 'running' && !command.finish) {
      command.status = ok === true ? 'done' : 'error';
      command.note = typeof note === 'string' ? note.slice(0, 240) : '';
    }
  }
  command(id) {
    this.prune();
    const command = this.commands.get(id);
    if (!command) throw new AppError(404, 'Browser-Aktion nicht gefunden.');
    return { id: command.id, status: command.status, note: command.note || '' };
  }
}
