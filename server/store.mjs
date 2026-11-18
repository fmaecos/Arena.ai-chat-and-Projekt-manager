import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError, archivePath, now, PLATFORMS, PROJECT_COLORS, requiredText, text } from './domain.mjs';

const safeMime = (mime) => /^[\w.+-]+\/[\w.+-]+$/i.test(mime || '') ? mime : 'application/octet-stream';
export const fileInfo = (row) => row && ({ id: row.id, path: row.path, name: row.path.split('/').at(-1), projectId: row.project_id,
  mime: row.mime, size: row.size, createdAt: row.created_at, updatedAt: row.updated_at });
const chatInfo = (row) => row && ({ id: row.id, title: row.title, url: row.url, platform: row.platform,
  projectId: row.project_id, capturedAt: row.captured_at, createdAt: row.created_at, updatedAt: row.updated_at,
  count: row.message_count, excerpt: row.excerpt, truncated: Boolean(row.truncated),
  archive: row.archive_meta ? { ...JSON.parse(row.archive_meta), versionCount: row.version_count ?? 0 } : null });
const archiveColumns = `a.meta AS archive_meta, (SELECT count(*) FROM archive_versions v WHERE v.chat_id=c.id) AS version_count`;
function sourceKey(snapshot, explicit) {
  if (explicit) return explicit;
  const url = new URL(snapshot.url);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|ref|fbclid)$/i.test(key)) url.searchParams.delete(key);
  const root = ['/', '/app', '/new', '/chat'].includes(url.pathname);
  return `${url.href}${root ? `::${snapshot.title}::${text(snapshot.messages[0]?.blocks[0]?.text, 160)}` : ''}`;
}
const projectInfo = (row) => row && ({ id: row.id, name: row.name, description: row.description, color: row.color, createdAt: row.created_at,
  updatedAt: row.updated_at, chatCount: row.chat_count ?? 0, fileCount: row.file_count ?? 0, stages: row.stages ? JSON.parse(row.stages) : [] });

export class Store {
  constructor(filename = ':memory:', { demo = false } = {}) {
    this.db = new DatabaseSync(filename);
    this.db.function('unicode_lower', { deterministic: true }, (value) => String(value ?? '').toLowerCase());
    this.demo = demo;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, url TEXT NOT NULL, platform TEXT NOT NULL, title TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, messages TEXT NOT NULL, message_count INTEGER NOT NULL,
        excerpt TEXT NOT NULL, truncated INTEGER NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS archive_runs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS archive_details (
        chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, meta TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS archive_versions (
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        digest TEXT NOT NULL, captured_at TEXT NOT NULL, messages TEXT NOT NULL, meta TEXT NOT NULL,
        UNIQUE(chat_id, digest)
      );
      CREATE TABLE IF NOT EXISTS archive_stages (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, label TEXT NOT NULL, position INTEGER NOT NULL,
        PRIMARY KEY(project_id, label)
      );
      CREATE INDEX IF NOT EXISTS chats_project ON chats(project_id);
      CREATE INDEX IF NOT EXISTS files_project ON files(project_id);
    `);
    if (!demo && !this.setting('pairingCode')) this.rotatePairing();
  }
  close() { this.db.close(); }
  setting(key, fallback = '') { return this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback; }
  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
  rotatePairing() {
    this.setSetting('pairingCode', randomBytes(24).toString('base64url'));
    this.setSetting('extensionOrigin', '');
    return this.setting('pairingCode');
  }
  settings(includePairing = false) {
    return {
      ollamaUrl: this.setting('ollamaUrl', 'http://127.0.0.1:11434'),
      model: this.setting('model', 'qwen2.5:3b'),
      whisperUrl: this.setting('whisperUrl', 'http://127.0.0.1:17861'),
      speechMode: this.setting('speechMode', this.demo ? 'browser' : 'local'),
      speakReplies: this.setting('speakReplies') === 'true',
      voiceAutoSend: this.setting('voiceAutoSend') === 'true',
      ...(includePairing ? { pairingCode: this.setting('pairingCode'), paired: !!this.setting('extensionOrigin') } : {}),
    };
  }
  projectId(id) {
    if (!id) return null;
    if (typeof id !== 'string' || !this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) throw new AppError(400, 'Dieses Projekt existiert nicht.');
    return id;
  }
  projects() {
    return this.db.prepare(`SELECT p.*, (SELECT count(*) FROM chats WHERE project_id=p.id) AS chat_count,
      (SELECT count(*) FROM files WHERE project_id=p.id) AS file_count,
      (SELECT json_group_array(label) FROM (SELECT label FROM archive_stages WHERE project_id=p.id ORDER BY position, label)) AS stages FROM projects p ORDER BY p.updated_at DESC, p.rowid ASC`).all().map(projectInfo);
  }
  project(id) {
    const result = this.projects().find((project) => project.id === id);
    if (!result) throw new AppError(404, 'Projekt nicht gefunden.');
    return result;
  }
  saveProject(input, id = randomUUID()) {
    const existing = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    const name = requiredText(input.name ?? existing?.name, 80, 'Gib deinem Projekt einen Namen.');
    const color = input.color ?? existing?.color ?? 'violet';
    if (!PROJECT_COLORS.includes(color)) throw new AppError(400, 'Unbekannte Projektfarbe.');
    const description = text(input.description ?? existing?.description, 1000);
    this.db.prepare(`INSERT INTO projects(id,name,description,color,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, color=excluded.color, updated_at=excluded.updated_at`)
      .run(id, name, description, color, existing?.created_at || now(), now());
    return this.project(id);
  }
  deleteProject(id) {
    this.project(id);
    this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
  }
  chats(projectId) {
    const query = `SELECT c.id,c.title,c.url,c.platform,c.project_id,c.captured_at,c.created_at,c.updated_at,c.message_count,c.excerpt,c.truncated,
      ${archiveColumns} FROM chats c LEFT JOIN archive_details a ON a.chat_id=c.id`;
    return (projectId ? this.db.prepare(`${query} WHERE c.project_id=? ORDER BY c.updated_at DESC`).all(projectId)
      : this.db.prepare(`${query} ORDER BY c.updated_at DESC, c.rowid ASC`).all()).map(chatInfo);
  }
  chat(id) {
    const row = this.db.prepare(`SELECT c.*, ${archiveColumns} FROM chats c LEFT JOIN archive_details a ON a.chat_id=c.id WHERE c.id=?`).get(id);
    if (!row) throw new AppError(404, 'Chat nicht gefunden.');
    return { ...chatInfo(row), messages: JSON.parse(row.messages) };
  }
  saveChat(snapshot, options = {}) {
    const key = sourceKey(snapshot, options.sourceKey);
    const existing = this.db.prepare('SELECT id,title,project_id,created_at FROM chats WHERE source_key=?').get(key);
    if (!existing && this.demo && this.db.prepare('SELECT count(*) AS n FROM chats').get().n >= 100) throw new AppError(413, 'Das Demo-Archiv ist voll.');
    const id = existing?.id || options.id || randomUUID();
    const title = text(options.title, 240) || existing?.title || snapshot.title;
    const projectId = options.projectId === undefined ? existing?.project_id || null : this.projectId(options.projectId);
    const excerpt = text(snapshot.messages.find((message) => message.role === 'user')?.blocks.find((block) => block.type === 'text')?.text, 240);
    const capturedAt = snapshot.capturedAt ?? now();
    this.db.prepare(`INSERT INTO chats(id,source_key,url,platform,title,project_id,messages,message_count,excerpt,truncated,captured_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET url=excluded.url,title=excluded.title,
      project_id=excluded.project_id,messages=excluded.messages,message_count=excluded.message_count,excerpt=excluded.excerpt,
      truncated=excluded.truncated,captured_at=excluded.captured_at,updated_at=excluded.updated_at`)
      .run(id, key, snapshot.url, snapshot.platform, title, projectId, JSON.stringify(snapshot.messages), snapshot.messages.length,
        excerpt, Number(Boolean(snapshot.truncated)), capturedAt, existing?.created_at ?? capturedAt, options.updatedAt || now());
    return this.chat(id);
  }
  saveArchiveRun(run) {
    this.db.prepare(`INSERT INTO archive_runs(id,status,state,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,state=excluded.state,updated_at=excluded.updated_at`)
      .run(run.id, run.status, JSON.stringify(run), run.updatedAt);
  }
  latestArchiveRun() {
    const row = this.db.prepare('SELECT state FROM archive_runs ORDER BY updated_at DESC, rowid DESC LIMIT 1').get();
    return row ? JSON.parse(row.state) : null;
  }
  saveArchiveConversation(record, runId, proposedProject) {
    const address = new URL(record.url);
    const platform = Object.hasOwn(PLATFORMS, address.hostname) ? PLATFORMS[address.hostname] : 'web';
    const capture = { ...record, platform };
    const key = sourceKey(capture, address.hash ? address.href : '');
    const saveVersion = (chatId, capturedAt, messages, meta) => {
      const details = JSON.parse(meta);
      const classification = { project: details.project, stage: details.stage, mode: details.mode, lanes: details.lanes };
      const hash = createHash('sha256').update(messages).update(JSON.stringify(classification)).digest('hex');
      this.db.prepare('INSERT OR IGNORE INTO archive_versions(id,chat_id,digest,captured_at,messages,meta) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), chatId, hash, capturedAt, messages, meta);
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare(`SELECT c.id,c.messages,c.captured_at,a.meta FROM chats c
        LEFT JOIN archive_details a ON c.id=a.chat_id WHERE c.source_key=?`).get(key);
      if (previous) saveVersion(previous.id, previous.captured_at, previous.messages, previous.meta || '{}');
      let projectId;
      if (proposedProject) {
        projectId = this.db.prepare('SELECT id FROM projects WHERE unicode_lower(name)=unicode_lower(?) ORDER BY created_at LIMIT 1').get(proposedProject.name)?.id
          || this.saveProject({ name: proposedProject.name, description: proposedProject.description }).id;
        proposedProject.stages.forEach((stage, i) => this.db.prepare('INSERT OR IGNORE INTO archive_stages(project_id,label,position) VALUES(?,?,?)').run(projectId, stage, i));
      }
      const chat = this.saveChat(capture, { sourceKey: key, projectId });
      const meta = JSON.stringify({ ...record.meta, runId });
      this.db.prepare(`INSERT INTO archive_details(chat_id,meta) VALUES(?,?)
        ON CONFLICT(chat_id) DO UPDATE SET meta=excluded.meta`).run(chat.id, meta);
      saveVersion(chat.id, chat.capturedAt, JSON.stringify(chat.messages), meta);
      this.db.exec('COMMIT');
      return this.chat(chat.id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  archiveVersions(id) {
    this.chat(id);
    return this.db.prepare('SELECT v.id,v.captured_at FROM archive_versions v WHERE v.chat_id=? ORDER BY v.captured_at DESC, v.rowid DESC').all(id)
      .map((v) => ({ id: v.id, capturedAt: v.captured_at }));
  }
  archiveVersion(id, versionId) {
    const chat = this.chat(id);
    const row = this.db.prepare('SELECT * FROM archive_versions WHERE chat_id=? AND id=?').get(id, versionId);
    if (!row) throw new AppError(404, 'Archivstand nicht gefunden.');
    const messages = JSON.parse(row.messages);
    return { ...chat, capturedAt: row.captured_at, messages, count: messages.length,
      archive: { ...JSON.parse(row.meta), versionCount: chat.archive?.versionCount ?? 0 }, versionId };
  }
  editChat(id, input) {
    const chat = this.chat(id);
    const title = requiredText(input.title ?? chat.title, 240, 'Der Chat braucht einen Titel.');
    const projectId = input.projectId === undefined ? chat.projectId : this.projectId(input.projectId);
    this.db.prepare('UPDATE chats SET title=?, project_id=?, updated_at=? WHERE id=?').run(title, projectId, now(), id);
    if (chat.archive && (input.stage !== undefined || input.mode !== undefined || chat.projectId !== projectId)) {
      const { versionCount, ...old } = chat.archive;
      const stage = text(input.stage ?? (chat.projectId === projectId ? old.stage : ''), 55);
      const mode = ['chat', 'duel', 'multi', 'unknown'].includes(input.mode) ? input.mode : old.mode;
      const project = projectId ? this.project(projectId).name : '';
      const meta = { ...old, stage, mode, project, classificationEdited: true };
      if (projectId && stage) this.db.prepare('INSERT OR IGNORE INTO archive_stages(project_id,label,position) VALUES(?,?,999)').run(projectId, stage);
      this.db.prepare('UPDATE archive_details SET meta=? WHERE chat_id=?').run(JSON.stringify(meta), id);
    }
    return this.chat(id);
  }
  deleteChat(id) {
    const result = this.db.prepare('DELETE FROM chats WHERE id=?').run(id);
    if (!result.changes) throw new AppError(404, 'Chat nicht gefunden.');
  }
  files(projectId) {
    const query = 'SELECT id,path,project_id,mime,size,created_at,updated_at FROM files';
    return (projectId ? this.db.prepare(`${query} WHERE project_id=? ORDER BY path COLLATE NOCASE`).all(projectId)
      : this.db.prepare(`${query} ORDER BY path COLLATE NOCASE`).all()).map(fileInfo);
  }
  file(id) {
    const row = this.db.prepare('SELECT * FROM files WHERE id=?').get(id);
    if (!row) throw new AppError(404, 'Datei nicht gefunden.');
    return { ...fileInfo(row), data: Buffer.from(row.bytes).toString('base64') };
  }
  verifyFilePath(path, projectId, skipId) {
    if (this.db.prepare('SELECT id FROM files WHERE unicode_lower(path)=unicode_lower(?) AND project_id IS ? AND id != ?').get(path, projectId, skipId || '')) {
      throw new AppError(409, 'In diesem Projekt gibt es schon eine Datei mit diesem Pfad.');
    }
  }
  addFile(input, bytes, id = randomUUID()) {
    const path = archivePath(input.path);
    const projectId = this.projectId(input.projectId);
    this.verifyFilePath(path, projectId);
    if (this.demo && this.db.prepare('SELECT COALESCE(sum(size),0) AS size FROM files').get().size + bytes.length > 16 * 1024 * 1024) {
      throw new AppError(413, 'Das Dateilimit der Demo ist erreicht.');
    }
    this.db.prepare('INSERT INTO files(id,path,project_id,mime,size,bytes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, path, projectId, safeMime(input.mime), bytes.length, bytes, now(), now());
    return this.files().find((file) => file.id === id);
  }
  editFile(id, input) {
    const file = this.files().find((item) => item.id === id);
    if (!file) throw new AppError(404, 'Datei nicht gefunden.');
    const path = archivePath(input.path ?? file.path);
    const projectId = input.projectId === undefined ? file.projectId : this.projectId(input.projectId);
    this.verifyFilePath(path, projectId, id);
    this.db.prepare('UPDATE files SET path=?,project_id=?,updated_at=? WHERE id=?').run(path, projectId, now(), id);
    return this.files().find((item) => item.id === id);
  }
  deleteFile(id) {
    if (!this.db.prepare('DELETE FROM files WHERE id=?').run(id).changes) throw new AppError(404, 'Datei nicht gefunden.');
  }
  exportProject(id) {
    const project = this.project(id);
    const files = this.files(id);
    if (files.reduce((sum, file) => sum + file.size, 0) > 48 * 1024 * 1024) throw new AppError(413, 'Das Projekt ist für einen Sammel-Export zu groß. Lade die Dateien einzeln herunter.');
    const stages = this.db.prepare('SELECT label FROM archive_stages WHERE project_id=? ORDER BY position, label').all(id).map((row) => row.label);
    return { format: 'kontext-project-v1', exportedAt: now(), project, stages, chats: this.chats(id).map((chat) => this.chat(chat.id)),
      files: files.map((file) => this.file(file.id)) };
  }
}
