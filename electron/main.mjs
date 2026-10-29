import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import serve from 'electron-serve';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 旧 game と同じ静的配信。固定 origin にすることで IndexedDB の記録も保つ。
const loadGame = serve({ directory: 'out', hostname: 'samplegame' });

// ゲームの画面は 1280×720 が基準（`GameCanvas` の `--game-scale`）。窓の中身をこの大きさにし、
// 窓の大きさは変えさせない（縮めると画面も縮み、最大化しても拡大はしないので、等倍のまま出すため）。
// 大きく遊びたいときはフルスクリーン（F11 / Alt+Enter / 設定）。**起動はいつも窓**（前回の状態は覚えない）。
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

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
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: true,
    title: 'SampleGame',
    autoHideMenuBar: true,
    backgroundColor: '#000000',
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
  // 切り替わったら画面（拡大と設定の印）に知らせる。大きさを変えられない窓では Windows で
  // enter/leave-full-screen が来ないことがあるので、大きさが変わったときにも見て、変わった時だけ送る。
  let lastFull = win.isFullScreen();
  const fullScreenChanged = () => {
    const on = win.isFullScreen();
    if (on === lastFull) return;
    lastFull = on;
    if (!win.webContents.isDestroyed()) win.webContents.send('fullscreen:changed', on);
  };
  win.on('enter-full-screen', fullScreenChanged);
  win.on('leave-full-screen', fullScreenChanged);
  win.on('resize', fullScreenChanged);

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
