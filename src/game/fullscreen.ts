// フルスクリーン。**切り替えの入口はここ 1 か所。**
//
// - Windows 版（Electron）は、プリロード（`electron/preload.cjs`）が渡す `window.desktop` でウィンドウごと切り替える。
//   最後の状態は本体が覚えていて、次の起動もその状態で開く。F11 / Alt+Enter も本体が受ける。
// - ブラウザは Fullscreen API（`requestFullscreen`）。押した・選んだ操作の中でしか切り替えられない（ブラウザの決まり）。
//   ブラウザ自身の F11 は Fullscreen API とは別物なので、ここでは触らない（画面は広がった分だけ拡大する）。

interface DesktopBridge {
  getFullScreen(): Promise<boolean>;
  setFullScreen(on: boolean): Promise<boolean>;
  /** 切り替わったら呼ぶ。返り値で外す。 */
  onFullScreen(listener: (on: boolean) => void): () => void;
}

function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as { desktop?: DesktopBridge }).desktop ?? null;
}

/** Windows 版（Electron）で動いているか。 */
export function isDesktopApp(): boolean {
  return desktop() !== null;
}

/** このブラウザ（端末）でフルスクリーンに切り替えられるか。iPhone の Safari などは切り替えられない。 */
export function fullscreenSupported(): boolean {
  if (desktop()) return true;
  if (typeof document === 'undefined') return false;
  return document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
}

/** いまフルスクリーンか。 */
export async function isFullscreen(): Promise<boolean> {
  const bridge = desktop();
  if (bridge) return bridge.getFullScreen();
  return typeof document !== 'undefined' && document.fullscreenElement !== null;
}

/** フルスクリーンにする／戻す。切り替えられなければ今のまま。返すのは切り替えた後の状態。 */
export async function setFullscreen(on: boolean): Promise<boolean> {
  const bridge = desktop();
  if (bridge) return bridge.setFullScreen(on);
  if (!fullscreenSupported()) return false;
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch (error) {
    // 操作の外から呼ばれた・拒まれたなど。遊びは止めない。
    console.warn('[fullscreen] 切り替えられません', error);
  }
  return document.fullscreenElement !== null;
}

/** 切り替える。 */
export async function toggleFullscreen(): Promise<boolean> {
  return setFullscreen(!(await isFullscreen()));
}

/** 切り替わったら知らせる（Esc で抜けた、F11 で入った、など）。返り値で外す。 */
export function onFullscreenChange(listener: (on: boolean) => void): () => void {
  const bridge = desktop();
  if (bridge) return bridge.onFullScreen(listener);
  if (typeof document === 'undefined') return () => {};
  const handler = () => listener(document.fullscreenElement !== null);
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}

let shortcutInstalled = false;

/**
 * Alt+Enter で切り替える（ブラウザ）。Windows 版は本体が受けるので、ここまで来ない。
 * Enter は決定キーでもあるので、**ほかの受け手より先に止める**（会話送り・話しかけ・選択が動かないように）。
 * window の capture で、同じ段の受け手は付けた順に呼ばれる——だから画面の部品が付けるより前（読み込み時）に付ける。
 */
export function installFullscreenShortcut(): void {
  if (shortcutInstalled || typeof window === 'undefined') return;
  shortcutInstalled = true;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || !event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || isDesktopApp()) return;
      void toggleFullscreen();
    },
    { capture: true },
  );
}
