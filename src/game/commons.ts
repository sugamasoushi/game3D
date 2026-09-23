// 共通イベントの台帳（GS-44）。**何度も使う命令の並びに名前を付ける。**
//
// 「宝箱を開ける」「宿屋に泊まる」のような手順は、置くたびに同じ命令を書き写すことになる。
// 写しが増えると、直すときに全部を探して回ることになる——名前で呼べば 1 か所で済む。
//
// 置き場所は `public/data/commonEvents.json`。ほかの台帳（`maps` / `actors` / `sounds`）と
// 同じ形にしてある。**増やすのはファイルに 1 つ足すだけ**で、TS は触らない。
//
// マップのイベント（`data/events/<マップ>.json`）とは別物で、**どのマップからでも呼べる**。

import { assetUrl } from './assets';
import type { EventCommand } from '../event/types';

/** 台帳の 1 本ぶん。 */
export interface CommonEvent {
  /** 人が見る名前。エディタの一覧に出す。 */
  name: string;
  commands: EventCommand[];
}

interface CommonBook {
  commons: Record<string, CommonEvent>;
}

let book: CommonBook = { commons: {} };
let loaded = false;

/**
 * 台帳を読む。**起動時に 1 回**でよい。
 * 無くても遊べる（共通イベントを使っていないゲームもある）ので、読めなければ空のまま。
 */
export async function loadCommonBook(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const response = await fetch(assetUrl('data/commonEvents.json'), { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as Partial<CommonBook>;
    if (data && typeof data === 'object' && data.commons) book = { commons: data.commons };
  } catch {
    /* 読めなければ空のまま。呼ばれたときにコンソールへ出るので気づける。 */
  }
}

/**
 * 名前で引く。無ければ null。
 * **黙って何もしないのは避ける**——呼んだのに動かない理由が分からなくなるので、
 * 呼ぶ側（`uiEventContext`）でコンソールに出す。
 */
export function commonEvent(id: string): EventCommand[] | null {
  return book.commons[id]?.commands ?? null;
}

/** 一覧（id と名前）。イベントエディタが選ばせるのに使う。 */
export function commonList(): Array<{ id: string; name: string }> {
  return Object.entries(book.commons).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}
