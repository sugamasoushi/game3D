import { app, BrowserWindow, dialog } from 'electron';
import serve from 'electron-serve';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 旧 game と同じ静的配信。固定 origin にすることで IndexedDB の記録も保つ。
const loadGame = serve({ directory: 'out', hostname: 'samplegame' });

async function createWindow() {
  if (!existsSync(path.join(app.getAppPath(), 'out', 'index.html'))) {
    throw new Error('out/index.html がありません。先に npm run build を実行してください。');
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'SampleGame',
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol !== 'app:' || target.hostname !== 'samplegame') event.preventDefault();
  });
  await loadGame(win);
}

function startupError(error) {
  console.error(error);
  dialog.showErrorBox('SampleGame を起動できません', error.message);
  app.quit();
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.mapeditor3d.samplegame');
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(startupError);
  });
}).catch(startupError);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
