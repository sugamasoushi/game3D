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
