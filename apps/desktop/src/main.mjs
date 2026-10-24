// FlexPOS desktop shell: runs the API server in-process and shows the web app.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = (...p) => (app.isPackaged ? join(process.resourcesPath, ...p) : join(here, '..', '..', ...p));

if (!app.requestSingleInstanceLock()) app.quit();

function freePort(preferred) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => {
      const t = createServer();
      t.listen(0, () => {
        const { port } = t.address();
        t.close(() => resolve(port));
      });
    });
    s.listen(preferred, '0.0.0.0', () => s.close(() => resolve(preferred)));
  });
}

let win = null;
let server = null;

async function start() {
  const dataDir = join(app.getPath('userData'), 'data');
  // LAN client mode: this till uses another machine's server.
  const cfgFile = join(dataDir, 'config.json');
  let url;
  const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : null;
  if (cfg?.mode === 'client' && cfg.hostUrl) {
    url = cfg.hostUrl;
  } else {
    const serverEntry = app.isPackaged ? join(app.getAppPath(), 'server', 'main.js') : join(here, '..', '..', 'server', 'dist', 'main.js');
    const { startServer } = await import(pathToFileURL(serverEntry).href);
    const port = await freePort(4100);
    server = await startServer({
      port,
      dataDir,
      webDir: app.isPackaged ? join(app.getAppPath(), 'web') : res('web', 'dist'),
      fontsDir: app.isPackaged ? join(app.getAppPath(), 'server', 'fonts') : join(here, '..', '..', 'server', 'dist', 'fonts'),
      logger: false,
    });
    url = `http://localhost:${port}`;
  }

  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f6f5f1',
    title: 'FlexPOS',
    autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith(url)) return { action: 'allow' };
    void shell.openExternal(u);
    return { action: 'deny' };
  });
  await win.loadURL(url).catch(async () => {
    await dialog.showMessageBox({ type: 'error', title: 'FlexPOS', message: `เชื่อมต่อเครื่อง Host ไม่ได้ (${url})`, detail: 'ตรวจสอบว่าเครื่อง Host เปิดอยู่และอยู่ในเครือข่ายเดียวกัน แล้วเปิดโปรแกรมใหม่' });
  });
}

/** Silent/system printing for USB and Bluetooth printers installed in Windows. */
ipcMain.handle('flexpos:print', async (_e, html, opts) => {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`));
  await new Promise((resolve, reject) => {
    w.webContents.print(
      { silent: !!opts?.silent, deviceName: opts?.deviceName || undefined, printBackground: true, margins: { marginType: 'none' }, pageSize: opts?.pageWidthMm && opts.pageWidthMm < 200 ? { width: opts.pageWidthMm * 1000, height: 297000 } : 'A4' },
      (ok, reason) => (ok || reason === 'cancelled' ? resolve() : reject(new Error(reason))),
    );
  }).finally(() => w.close());
});

ipcMain.handle('flexpos:printers', async () => (win ? win.webContents.getPrintersAsync() : []));

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('window-all-closed', async () => {
  if (server) await server.close().catch(() => undefined);
  app.quit();
});

Menu.setApplicationMenu(null);
app.whenReady().then(start).catch(async (e) => {
  await dialog.showMessageBox({ type: 'error', title: 'FlexPOS', message: 'เปิดโปรแกรมไม่สำเร็จ', detail: String(e?.stack ?? e) });
  app.quit();
});
