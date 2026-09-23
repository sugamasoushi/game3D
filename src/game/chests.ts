// 宝箱の台帳（GS-135）。**マップに置いた物の `Id` で引く。**
//
// 中身（何が何個）と見た目（閉じている／開いたコマ）は**ここが正本**で、
// マップに書くのは `Id` と `Event` だけ。イベントエディタの「宝箱」で編集する。
//
// **なぜマップから出したか**——中身を直すたびにマップエディタを開くことになり、
// 話の道具（持ち物・スイッチ）を見ながら決められなかった。置き場所はマップの仕事、
// 中身はイベントの仕事、と分けた（NPC の姿を `actors.json` へ出したのと同じ考え。GS-16）。

import { assetUrl } from './assets';

/** 宝箱 1 つ。**固定か抽選かは `random` が在るかで決まる。** */
export interface ChestDef {
  /** 覚え書き。画面には出さない——台帳を読む人のためのもの。 */
  name?: string;
  /** 固定の中身（`items.json` のキー）。`random` が在ればそちらが勝つ。 */
  item?: string;
  /**
   * 抽選の候補。開けたときに**この中から 1 つ**選ぶ。
   * 空の並びは「中身なし」ではなく**書き忘れ**として扱い、知らせを出す。
   */
  random?: string[];
  /**
   * 個数。数 1 つなら固定、2 つなら**その範囲から選ぶ**（`[1, 3]` で 1〜3 個）。
   * 省くと 1 個。
   */
  num?: number | [number, number];
  /** 閉じているときのコマ番号（スプライトシートの通し番号）。 */
  closed?: number;
  /** 開いたあとのコマ番号。**取得済みならこちらで出す**。 */
  opened?: number;
}

export interface ChestBook {
  version: 1;
  chests: Record<string, ChestDef>;
}

let book: ChestBook = { version: 1, chests: {} };
let pending: Promise<void> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す。** */
export function loadChestBook(): Promise<void> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/chests.json'), { cache: 'no-store' })
    .then((response) => (response.ok ? (response.json() as Promise<Partial<ChestBook>>) : null))
    .then((file) => {
      book = { version: 1, chests: file?.chests ?? {} };
    })
    .catch((error) => {
      console.warn('[chest] 台帳を読めなかった', error);
    });
  return pending;
}

/** その名前の宝箱。無ければ null（＝ただの物）。 */
export function chestOf(id: string): ChestDef | null {
  return (id && book.chests[id]) || null;
}

/** 開けたことを覚える名前（GS-134）。**物ごとの覚え**なので、どの宝箱でも同じ名前でよい。 */
export const CHEST_OPENED = '開けた';

/**
 * 開けたときの中身を決める（GS-135）。**抽選はここで 1 回だけ**——
 * 画面側で引き直すと、文に出した名前と実際に増えた物がずれる。
 */
export function drawChest(def: ChestDef): { item: string; num: number } {
  const item = def.random?.length ? def.random[Math.floor(Math.random() * def.random.length)] : (def.item ?? '');
  if (!item) console.warn('[chest] 中身が決まらない（item も random も空）');
  const num = Array.isArray(def.num)
    ? Math.floor(Math.random() * (Math.max(def.num[0], def.num[1]) - Math.min(def.num[0], def.num[1]) + 1)) +
      Math.min(def.num[0], def.num[1])
    : (def.num ?? 1);
  return { item, num: Math.max(1, Math.trunc(num)) };
}

/** 開発中に差し替える（イベントエディタの下書き）。 */
export function previewChests(next: ChestBook): void {
  book = { version: 1, chests: next.chests ?? {} };
  pending = Promise.resolve();
}
