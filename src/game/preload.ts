import { assetUrl } from './assets';

const images = new Map<string, Promise<void>>();

/** 画像の取得とデコードが終わるまで待つ。同じ画像は二度読まない。 */
export function preloadImage(path: string): Promise<void> {
  const src = path.startsWith('/') || /^https?:/i.test(path) ? path : assetUrl(path);
  const cached = images.get(src);
  if (cached) return cached;
  const pending = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const decoded = image.decode?.();
      if (decoded) void decoded.catch(() => undefined).then(() => resolve());
      else resolve();
    };
    image.onerror = () => reject(new Error(`画像を読めません: ${src}`));
    image.src = src;
  }).catch((error) => {
    images.delete(src);
    throw error;
  });
  images.set(src, pending);
  return pending;
}

export async function preloadImages(paths: string[]): Promise<void> {
  await Promise.all([...new Set(paths.filter(Boolean))].map(preloadImage));
}

export async function preloadFonts(): Promise<void> {
  if ('fonts' in document) await document.fonts.ready;
}

/**
 * 画像を待つのは長くてもこれだけ（ミリ秒）。通信が遅い・名前を間違えた絵で
 * イベントが止まり続けないように、過ぎたら諦めて先へ進む（絵は届きしだい出る）。
 */
export const IMAGE_WAIT_MS = 1500;

/** 画像の取得とデコードを待つ。ただし `limit` を過ぎたら待たない。失敗しても投げない。 */
export function readyImages(paths: string[], limit = IMAGE_WAIT_MS): Promise<void> {
  const loading = preloadImages(paths).catch((error) => console.warn('[preload]', error));
  return Promise.race([loading, new Promise<void>((resolve) => setTimeout(resolve, limit))]);
}

/**
 * 画面に描き終わるまで待つ（2 フレーム）。デコードが済んでいても、`<img>` が載ってから
 * 実際に画面へ出るまで 1〜2 フレームかかる。隠れたタブでは `requestAnimationFrame` が
 * 止まるので、時間でも抜ける。
 */
export function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = setTimeout(resolve, 100);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(done);
      resolve();
    }));
  });
}
