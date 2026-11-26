const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let win;
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return {}; }
}
function validUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(u.protocol) ? u.toString().replace(/\/$/, '') : null;
  } catch { return null; }
}
function openSetup(message = '') {
  win.loadFile(path.join(__dirname, 'setup.html'), { query: { message } });
}
async function openGame(url) {
  await win.loadURL(url);
}
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 850, minWidth: 900, minHeight: 620,
    backgroundColor: '#0a0a12',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  });
  const configured = validUrl(readConfig().serverUrl || process.env.GRENA_SERVER_URL);
  if (configured) openGame(configured).catch(() => openSetup('No se pudo conectar. Comprueba la dirección del servidor.'));
  else openSetup();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}
ipcMain.handle('save-server-url', async (_, value) => {
  const serverUrl = validUrl(value);
  if (!serverUrl) return { ok: false, error: 'Escribe una dirección válida que empiece por https:// o http://.' };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ serverUrl }, null, 2));
  try { await openGame(serverUrl); return { ok: true }; }
  catch { return { ok: false, error: 'No se pudo abrir el servidor. Revisa la dirección e inténtalo de nuevo.' }; }
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
