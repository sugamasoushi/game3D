// 画面（ゲーム）へ渡す口。**フルスクリーンだけ**を出す（Node の機能は渡さない）。
// sandbox: true のプリロードは CommonJS で書く（.cjs）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getFullScreen: () => ipcRenderer.invoke('fullscreen:get'),
  setFullScreen: (on) => ipcRenderer.invoke('fullscreen:set', Boolean(on)),
  onFullScreen: (listener) => {
    const handler = (_event, on) => listener(Boolean(on));
    ipcRenderer.on('fullscreen:changed', handler);
    return () => ipcRenderer.removeListener('fullscreen:changed', handler);
  },
});
