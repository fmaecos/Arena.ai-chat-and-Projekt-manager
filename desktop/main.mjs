import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { chmod, copyFile, cp, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORT, webUrl } from '../server/domain.mjs';
import { startDesktopServer } from '../server/api.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'kontext://app';
const assets = resolve(root, 'dist');
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; media-src blob:; base-uri 'none'; frame-src 'none'; form-action 'none'";
const trusted = (url) => typeof url === 'string' && (url === origin || url.startsWith(`${origin}/`));
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-speech-dispatcher');
protocol.registerSchemesAsPrivileged([{ scheme: 'kontext', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

let connection;
let mainWindow;
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 800, minHeight: 610, backgroundColor: '#11111a',
    title: 'Kontext', icon: resolve(root, 'assets/icon.png'), autoHideMenuBar: true, show: false,
    webPreferences: { preload: resolve(root, 'desktop/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(`${origin}/`);
};

function registerIpc() {
  const check = (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !trusted(event.senderFrame?.url) || event.senderFrame.parent) {
      throw new Error('Ungültiger Desktop-Aufruf.');
    }
  };
  ipcMain.handle('kontext:request', async (event, method, pathname, body) => {
    check(event);
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method) || typeof pathname !== 'string'
      || !/^\/api\/[\w/-]+$/.test(pathname) || pathname.startsWith('/api/extension/')) throw new Error('Ungültige API-Anfrage.');
    const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
    const response = await fetch(`http://127.0.0.1:${PORT}${pathname}`, { method, headers, redirect: 'error', body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: response.ok, data: await response.json() };
  });
  ipcMain.handle('kontext:external', (event, url) => {
    check(event);
    const safe = webUrl(url);
    if (!safe) throw new Error('Ungültiger Link.');
    return shell.openExternal(safe);
  });
  ipcMain.handle('kontext:save', async (event, name, bytes) => {
    check(event);
    if (typeof name !== 'string' || !ArrayBuffer.isView(bytes) || bytes.byteLength > 112 * 1024 * 1024) throw new Error('Ungültiger oder zu großer Export.');
    const basename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 210).replace(/^[. ]+$|[. ]+$/g, '') || 'kontext-export';
    const result = await dialog.showSaveDialog(mainWindow, { title: 'In Datei speichern', defaultPath: join(app.getPath('downloads'), basename) });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, bytes);
    return true;
  });
  ipcMain.handle('kontext:resource', async (event, resource) => {
    check(event);
    if (!['extension', 'speech', 'data'].includes(resource)) throw new Error('Ungültiger Ordner.');
    const data = app.getPath('userData');
    let target = data;
    if (resource === 'extension') {
      target = app.isPackaged ? resolve(data, 'chrome-extension') : resolve(root, 'extension');
      // An AppImage is mounted at a different temporary path on each launch.
      // Chrome must load the extension from a stable path in the user's profile.
      if (app.isPackaged) await cp(resolve(process.resourcesPath, 'chrome-extension'), target, { recursive: true });
    }
    if (resource === 'speech') {
      target = app.isPackaged ? resolve(data, 'helpers') : resolve(root, 'scripts');
      if (app.isPackaged) {
        await mkdir(target, { recursive: true });
        await copyFile(resolve(process.resourcesPath, 'speech_server.py'), resolve(target, 'speech_server.py'));
      }
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return target;
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
  app.whenReady().then(async () => {
    const database = resolve(app.getPath('userData'), 'workspace.sqlite');
    await mkdir(dirname(database), { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await (await open(database, 'a', 0o600)).close();
      await chmod(database, 0o600);
    }
    connection = await startDesktopServer(database);
    protocol.handle('kontext', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
      try {
        const path = resolve(assets, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
        if (!path.startsWith(assets + sep)) return new Response('Forbidden', { status: 403 });
        const file = await net.fetch(pathToFileURL(path).href);
        return new Response(file.body, { status: file.status, headers: { ...Object.fromEntries(file.headers), 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    const allowedPermission = (permission, url, media) => trusted(url) && (permission === 'clipboard-sanitized-write' || permission === 'media' && media === 'audio');
    session.defaultSession.setPermissionCheckHandler((_contents, permission, url, details) => allowedPermission(permission, url, details.mediaType));
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(details.isMainFrame && allowedPermission(permission, details.requestingUrl,
        details.mediaTypes?.length === 1 ? details.mediaTypes[0] : null));
    });
    registerIpc();
    createWindow();
    app.on('activate', () => { if (!mainWindow) createWindow(); });
  }).catch((error) => {
    dialog.showErrorBox('Kontext konnte nicht starten', error.code === 'EADDRINUSE'
      ? `Der lokale Port ${PORT} ist bereits belegt. Beende den anderen Dienst und starte Kontext erneut.` : error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { connection?.stop(); connection = null; });
}
