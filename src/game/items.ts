// 持ち物の台帳（GS-46）。**何が在るかはデータで決める。**
//
// ほかの台帳（`maps` / `actors` / `sounds` / `commonEvents`）と同じ形にしてある。
// 増やすのは `public/data/items.json` に 1 つ足すだけで、TS は触らない。
//
// **持っている数は台帳ではなくセーブが持つ**（`state.items`）。
// 台帳は「名前と説明」だけ——同じ物を 2 か所に置かないため。

import { assetUrl } from './assets';

/**
 * 使ったときの効き目（GS-64）。**書いてある物だけが「使える物」**——
 * 鍵や手紙のように持っているだけの物は `use` を書かない。
 */
export interface ItemUse {
  /** どこで使えるか。省略は `both`。 */
  where?: 'field' | 'battle' | 'both';
  /** 戻る HP。`"full"` で満タンまで。 */
  hp?: number | 'full';
  /** 戻る MP。`"full"` で満タンまで。 */
  mp?: number | 'full';
  /**
   * 消す状態異常（GS-69）。**戦いのあいだの物**なので、`where` は `battle` にする。
   * 歩いているときは状態異常そのものが無い（戦いが終われば消える）。
   */
  cure?: string[];
  /** 使ったときに出す一言。無ければ「○○ を つかった」だけ。 */
  say?: string;
  /** 使ったときの音（`sounds.json` のキー）。 */
  se?: string;
}

/**
 * 身に着ける物（GS-67）。**置き場所（`slot`）は 1 つにつき 1 個**。
 * 増えるのは攻撃・守り・速さだけ——満タンの HP を装備で変えると、
 * 外した瞬間に「いまの HP が満タンを超える」始末を毎回することになる。
 */
export interface ItemEquip {
  slot: string;
  attack?: number;
  guard?: number;
  speed?: number;
}

/** 台帳の 1 つぶん。 */
export interface ItemDef {
  /** 画面に出す名前。 */
  name: string;
  /** 説明文。持ち物の一覧に出す。 */
  text?: string;
  /** 使えるなら効き目。無ければ**持っているだけの物**。 */
  use?: ItemUse;
  /**
   * 店の値段（GS-66）。**書いていない物は売り買いできない**——
   * 鍵や手紙に値段を付けないことで「大事な物を売ってしまった」を防ぐ。
   */
  price?: number;
  /** 身に着けられるなら、その置き場所と増える数（GS-67）。 */
  equip?: ItemEquip;
}

interface ItemBook {
  items: Record<string, ItemDef>;
}

let book: ItemBook = { items: {} };
let loaded = false;

/** 台帳を読む。**起動時に 1 回**でよい。無くても遊べる。 */
export async function loadItemBook(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const response = await fetch(assetUrl('data/items.json'), { cache: 'no-store' });
    if (!response.ok) return;
    const data = (await response.json()) as Partial<ItemBook>;
    if (data && typeof data === 'object' && data.items) book = { items: data.items };
  } catch {
    /* 読めなければ空のまま。持っている数はセーブ側にあるので消えない。 */
  }
}

/**
 * 名前を引く。**台帳に無くても id をそのまま返す。**
 * 台帳から消しただけで持ち物が化けると、記録を読み直したときに何を持っていたか分からなくなる。
 */
export function itemName(id: string): string {
  return book.items[id]?.name ?? id;
}

/** 説明。無ければ空。 */
export function itemText(id: string): string {
  return book.items[id]?.text ?? '';
}

/**
 * 使ったときの効き目。**使えない物は null**。
 * `where` を渡すと、そこで使える物だけ返す（戦闘用の一覧を作るのに使う）。
 */
export function itemUse(id: string, where?: 'field' | 'battle'): ItemUse | null {
  const use = book.items[id]?.use;
  if (!use) return null;
  if (!where) return use;
  const at = use.where ?? 'both';
  return at === 'both' || at === where ? use : null;
}

/** 身に着けられる物か。無ければ null。 */
export function itemEquip(id: string): ItemEquip | null {
  return book.items[id]?.equip ?? null;
}

/** 買値。売り買いできない物は 0。 */
export function itemPrice(id: string): number {
  const price = book.items[id]?.price;
  return typeof price === 'number' && price > 0 ? Math.round(price) : 0;
}

/**
 * 売値。**買値の半分**（切り捨て）。売れない物は 0。
 * 半分にするのは旧作でも定番の置き方で、**買い直すと損をする**ぶんが
 * 「持ち物を選ぶ」ことの重みになる。
 */
export function itemSellPrice(id: string): number {
  return Math.floor(itemPrice(id) / 2);
}

/** 台帳に載っているか。道具（`check.mjs`）と同じ判断を画面でも使う。 */
export function knownItem(id: string): boolean {
  return Boolean(book.items[id]);
}

/** 一覧（id と名前）。イベントエディタに渡す。 */
export function itemList(): Array<{ id: string; name: string }> {
  return Object.entries(book.items).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}
