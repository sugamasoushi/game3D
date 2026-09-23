// カメラ演出が使う画面イラストの台帳。演出はファイルパスではなく、このIDだけを持つ。
import { assetUrl } from './assets';

export interface IllustrationEntry { name: string; src: string }
export interface IllustrationBook { version: 1; illustrations: Record<string, IllustrationEntry> }

let book: IllustrationBook = { version: 1, illustrations: {} };
let pending: Promise<void> | undefined;

export function loadIllustrations(): Promise<void> {
  return pending ??= fetch(assetUrl('data/illustrations.json'), { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error('イラスト台帳を読めません');
    book = await response.json() as IllustrationBook;
  }).catch((error) => {
    pending = undefined;
    throw error;
  });
}

export function illustrationImage(id: string): string {
  const entry = book.illustrations[id];
  if (!entry) return '';
  return assetUrl(entry.src);
}
