// 漫画のようにめくるイベントイラスト（GS-188）。旧作 EVENT020301 の「めくる」と同じ見せ方。
//
// 1 枚目は画面の左の外から真ん中へ滑り込み、次の 1 枚が**その上へ**左から重なる。
// 戻ると一番上の 1 枚が左へ抜ける。最後の 1 枚の先へ進むと、全部が右へ抜けて終わる。
//
// 命令（`comic`）は 2 通りに使える。
// - **読ませる**（`read`）…… 遊ぶ人が → / 決定でめくり、← / 取り消しで戻る。最後までめくったら終わる
// - **書いた順にめくる**（`open` / `next` / `prev` / `close`）…… イベントが 1 枚ずつめくる。
//   めくる間に会話を挟める（絵は会話の後ろに残る）
// どれも**めくり終わりを待てる**（`wait`）。
//
// 会話ウィンドウ（`store.ts` の `UiState`）とは別の入れ物にした。会話と同時に出ていることがあり、
// 片方を消してももう片方は残る。

import { create } from 'zustand';
import { playSe } from '../game/audio';

export interface Comic {
  /** 絵の URL。並びがめくる順。 */
  pages: string[];
  /** 一番上に見えている絵の番号。-1 はまだ 1 枚も出ていない。 */
  index: number;
  /** 1 枚が滑る時間（ミリ秒）。 */
  ms: number;
  /** めくる音（音の台帳のキー）。空なら鳴らさない。 */
  se: string;
  /** 全部が右へ抜けている最中。 */
  closing: boolean;
  /** 遊ぶ人がめくる（`read`）。 */
  reading: boolean;
  /** 読み終わった知らせ（`read`）。 */
  done?: () => void;
}

export const useComic = create<{ comic: Comic | null; set(comic: Comic | null): void }>((set) => ({
  comic: null,
  set: (comic) => set({ comic }),
}));

const current = () => useComic.getState().comic;
const put = (comic: Comic | null) => useComic.getState().set(comic);
const later = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
/** 2 フレーム待つ。置いた直後に動かすと、滑らずに一瞬で移ってしまう。 */
const nextFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));

function flip(comic: Comic) {
  if (comic.se) playSe(comic.se);
}

/** 絵を出す（まだ 1 枚も見えていない）。すでに出ていれば差し替える。 */
export async function openComic(pages: string[], ms: number, se: string, reading: boolean): Promise<void> {
  put({ pages, index: -1, ms, se, closing: false, reading });
  await nextFrame();
  await turnComic(1);
}

/**
 * 1 枚めくる。`1` で次（左から重なる）、`-1` で戻る（一番上が左へ抜ける）。
 * 最後の 1 枚の先へ進むと閉じる（`closeComic`）。動いたら滑り終わりまで待つ。
 */
export async function turnComic(step: 1 | -1): Promise<void> {
  const comic = current();
  if (!comic || comic.closing) return;
  if (step === -1) {
    if (comic.index <= 0) return;
    flip(comic);
    put({ ...comic, index: comic.index - 1 });
    await later(comic.ms);
    return;
  }
  if (comic.index + 1 >= comic.pages.length) {
    await closeComic();
    return;
  }
  flip(comic);
  put({ ...comic, index: comic.index + 1 });
  await later(comic.ms);
}

/** 全部を右へ抜いて片付ける。読ませていたなら読み終わりを知らせる。 */
export async function closeComic(): Promise<void> {
  const comic = current();
  if (!comic || comic.closing) return;
  flip(comic);
  put({ ...comic, closing: true });
  await later(comic.ms);
  // 滑っている間に別の絵へ差し替わっていたら、そちらは消さない。
  if (current()?.pages === comic.pages) put(null);
  comic.done?.();
}

/** 遊ぶ人にめくらせる。今出ている絵があれば、その続きから。読み終わったら返る。 */
export function readComic(pages: string[], ms: number, se: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const shown = current();
    if (shown && !shown.closing && pages.length === 0) {
      put({ ...shown, reading: true, done: resolve });
      return;
    }
    void openComic(pages, ms, se, true).then(() => {
      const opened = current();
      if (opened) put({ ...opened, done: resolve });
      else resolve();
    });
  });
}

/** イベントの終わり（片付け）。滑らせずに消す。待っている `read` も解く。 */
export function clearComic(): void {
  const comic = current();
  put(null);
  comic?.done?.();
}
