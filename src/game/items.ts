// 持ち物の台帳（GS-46）。**何が在るかはデータで決める。**
//
// ほかの台帳（`maps` / `actors` / `sounds` / `commonEvents`）と同じ形にしてある。
// 増やすのは `public/data/items.json` に 1 つ足すだけで、TS は触らない。
//
// **持っている数は台帳ではなくセーブが持つ**（`state.items`）。
// 台帳は「名前と説明」だけ——同じ物を 2 か所に置かないため。

import type { SkillRange } from './battle/height';
import { assetUrl } from './assets';
import { canCraft, craftInto, craftNeeds, craftsUsing, type ItemCraft } from './craft';

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
}

/**
 * 身に着ける物（GS-67）。**置き場所（`slot`）は 1 つにつき 1 個**。
 * 増えるのは物理攻撃力・物理防御力・魔法攻撃力・魔法防御力・速さだけ——満タンの HP を装備で変えると、
 * 外した瞬間に「いまの HP が満タンを超える」始末を毎回することになる。
 */
export interface ItemEquip {
  slot: string;
  /** 物理攻撃力。 */
  attack?: number;
  /** 物理防御力。 */
  guard?: number;
  /** 魔法攻撃力（2026-11-07）。 */
  magic?: number;
  /** 魔法防御力（2026-11-07）。 */
  magicGuard?: number;
  speed?: number;
  /**
   * 武器で殴ったときの見せ方（2026-10-28 / GS-273）。書いた項目だけ、戦闘共通の「通常攻撃（味方の素手）」を差し替える。
   * 武器（`slot: "weapon"`）にだけ意味がある。
   */
  strike?: ItemStrike;
}

/** 武器の通常攻撃の絵と音。 */
export interface ItemStrike {
  /** 出す絵（`effects.json` のキー）。 */
  effect?: string;
  /** 鳴らす音（`sounds.json` のキー）。 */
  se?: string;
  /**
   * 通常攻撃の直接・対空（2026-10-31 / GS-294。`melee` 直接 / `ranged` 対空）。書かなければ直接。
   * 弓や投げ物を `ranged` にすると、飛ぶ敵・高台の相手にも軽くならずに入る。
   */
  range?: SkillRange;
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
  /**
   * 作り方（2026-11-03）。**作られる側に書く**——`from` の材料をそろえて持っていれば、
   * メニューの「アイテム」で材料を選んで「つくる」から 1 個作れる（`craft.ts`）。
   */
  craft?: ItemCraft;
  /** 図鑑に載せるか（2026-11-04）。`false` で載せない（試し用の物など）。書かなければ載せる。 */
  codex?: boolean;
}

export interface ItemBook {
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

/**
 * 持ち物の種類（2026-10-29）。使える物（`use`）は道具、身に着ける物（`equip`）は装備、
 * どちらも無い物は**大事な物**（鍵や手紙）。両方あれば道具。台帳エディタの「持ち物」の分け方と同じ。
 */
export type ItemKind = '道具' | '装備' | '大事な物';

export function itemKindOf(def: ItemDef | undefined): ItemKind {
  return def?.use ? '道具' : def?.equip ? '装備' : '大事な物';
}

export function itemKind(id: string): ItemKind {
  return itemKindOf(book.items[id]);
}

/**
 * 台帳の 1 つぶんの買値。**大事な物は値段が書いてあっても 0**——店に並ばないし売れない
 * （「大事な物を売ってしまった」を防ぐ。2026-10-29）。値段の無い物も 0。
 */
export function priceOf(def: ItemDef | undefined): number {
  if (itemKindOf(def) === '大事な物') return 0;
  const price = def?.price;
  return typeof price === 'number' && price > 0 ? Math.round(price) : 0;
}

/** 買値。売り買いできない物（値段の無い物・大事な物）は 0。 */
export function itemPrice(id: string): number {
  return priceOf(book.items[id]);
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

/** 台帳の全部（図鑑・「つくる」の一覧が並び順と作り方を読む。2026-11-04）。 */
export function itemBook(): Record<string, ItemDef> {
  return book.items;
}

/** 一覧（id と名前）。イベントエディタに渡す。 */
export function itemList(): Array<{ id: string; name: string }> {
  return Object.entries(book.items).map(([id, entry]) => ({ id, name: entry.name ?? id }));
}

/** `id` を材料にする物（作られる側の id。2026-11-03）。無ければ空。 */
export function itemCraftsUsing(id: string): string[] {
  return craftsUsing(book.items, id);
}

/** 作るのに要る材料（id → 数）。作り方の無い物は空。 */
export function itemCraftNeeds(id: string): Map<string, number> {
  return craftNeeds(book.items[id]);
}

/** いまの持ち物で `id` を作れるか。 */
export function itemCanCraft(items: Map<string, number>, id: string): boolean {
  return canCraft(items, book.items[id]);
}

/** `id` を `made` 個（既定 1）作る。材料が足りなければ何も動かさず false。 */
export function craftItem(items: Map<string, number>, id: string, made = 1): boolean {
  return craftInto(items, id, book.items[id], made);
}
