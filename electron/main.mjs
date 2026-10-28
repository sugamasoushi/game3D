import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import serve from 'electron-serve';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 旧 game と同じ静的配信。固定 origin にすることで IndexedDB の記録も保つ。
const loadGame = serve({ directory: 'out', hostname: 'samplegame' });

// ウィンドウの覚え（フルスクリーンか）。**最後の状態で次も開く。** 記録（IndexedDB）とは別に userData へ置く。
const windowStateFile = () => path.join(app.getPath('userData'), 'window.json');

function readWindowState() {
  try {
    const state = JSON.parse(readFileSync(windowStateFile(), 'utf8'));
    return { fullscreen: state?.fullscreen === true };
  } catch {
    return { fullscreen: false };
  }
}

function writeWindowState(state) {
  try {
    writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch (error) {
    console.warn('window.json を書けません', error);
  }
}

// 画面（設定のフルスクリーン）から切り替える口。送ってきたウィンドウを相手にする。
ipcMain.handle('fullscreen:get', (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false);
ipcMain.handle('fullscreen:set', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setFullScreen(on === true);
  return win.isFullScreen();
});

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
    fullscreen: readWindowState().fullscreen,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // F11 / Alt+Enter でフルスクリーンを切り替える。**ここで受けて止める**——画面にもメニューの
  // ショートカット（既定の F11）にも渡すと、2 回切り替わって戻ってしまう。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const f11 = input.key === 'F11' && !input.alt && !input.control && !input.meta && !input.shift;
    const altEnter = input.key === 'Enter' && input.alt && !input.control && !input.meta;
    if (!f11 && !altEnter) return;
    event.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  });
  // 切り替わったら覚えて、画面（設定の印）にも知らせる。
  const fullScreenChanged = () => {
    const on = win.isFullScreen();
    writeWindowState({ fullscreen: on });
    if (!win.webContents.isDestroyed()) win.webContents.send('fullscreen:changed', on);
  };
  win.on('enter-full-screen', fullScreenChanged);
  win.on('leave-full-screen', fullScreenChanged);

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
