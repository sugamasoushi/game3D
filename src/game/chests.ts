// 宝箱の台帳（GS-135）。**マップに置いた物の `Id` で引く。**
//
// 中身（何が何個）と開け方（イベント・文）は**ここが正本**。イベントエディタの「宝箱」で編集する。
//
// **見た目は台帳に書かない**（GS-179）。閉じた形・開いた形はマップエディタで同じマスに重ねて置き、
// ゲームは開けた覚えで出し入れする（`openedLayers.ts`）。マップに書くのは `Id` と、
// 開いた形のレイヤーの `Opened` だけ——どちらもプレハブが持っているので、置けば付く。
//
// **なぜマップから出したか**——中身を直すたびにマップエディタを開くことになり、
// 話の道具（持ち物・スイッチ）を見ながら決められなかった。置き場所はマップの仕事、
// 中身はイベントの仕事、と分けた（NPC の姿を `actors.json` へ出したのと同じ考え。GS-16）。

import type { EventDef } from '../event/types';
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
  /**
   * **その宝箱だけ別のイベントで開ける**（GS-177 / GS-178）。イベント id をそのまま書く。
   * 罠の箱・鍵の要る箱のように、**台帳の文だけでは書けない**もの用。
   *
   * **省くと「なし」**——ゲームが決まった手順（音 → 渡す → 覚える → 文）で開ける。
   * ふだんはこちら。**マップの `Event` は「調べられる物か」を決めるだけ**で、
   * 何が動くかは台帳が決める（同じことが 2 か所に書けると必ず食い違う）。
   */
  event?: string;
  /** 開けたときの文（GS-178）。省くと既定文。`{アイテム}` は中身の名前に変わる。 */
  take?: string[];
  /** 取得済みのときの文（GS-178）。省くと既定文。 */
  empty?: string[];
  /** 開けたときの音（GS-178）。省くと `chest`。 */
  se?: string;
  /**
   * **マップに入るたびに戻る**（GS-180。`chestVisit.ts`）。開けた覚えがセーブに残らず、
   * 出て戻ればまた閉じて中身が入っている。`random` と合わせると毎回引き直し。
   * 同じ `Id` を何か所にも置くと、入るたびにどこか 1 か所にだけ出る。
   */
  respawn?: boolean;
  /** 入るたびに出る確率（0〜1。GS-180）。`respawn` のときだけ効く。省くと必ず出る。 */
  chance?: number;
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

/** その宝箱を開けるイベント id（GS-177）。台帳が指していなければマップのまま。 */
export function chestEventOf(id: string, fallback: string): string {
  return chestOf(id)?.event?.trim() || fallback;
}

/** 書かなかったときの文（GS-178）。**空の宝箱で無言にならない**ようにする。 */
export const CHEST_TAKE_LINES = ['{アイテム} を 手に入れた！'];
export const CHEST_EMPTY_LINES = ['からっぽだ。'];
/** 書かなかったときの音。 */
export const CHEST_SE = 'chest';

/**
 * 台帳だけで開ける宝箱の手順を組み立てる（GS-178）。**イベントを書かなくてよくする**ためのもの。
 *
 * 中身はこれまで 0101 に置いていた共通イベントと同じ——
 * 「開けた覚え」で分け、まだなら 音 → 渡す → 覚える → 文、済みなら文だけ。
 * **同じ形を人が書いても動く**ので、特別な宝箱は `event` で自分のイベントを指す。
 *
 * `event` を指している宝箱は null（そちらを動かす）。台帳に無い名前も null。
 */
export function chestEventDef(id: string): EventDef | null {
  const def = chestOf(id);
  if (!def || def.event?.trim()) return null;
  const take = def.take?.length ? def.take : CHEST_TAKE_LINES;
  const empty = def.empty?.length ? def.empty : CHEST_EMPTY_LINES;
  return {
    // 見分けが付く名前にしておく（知らせや覚えに出る）。覚えの行き先は物の `Id` なので混ざらない。
    id: `宝箱:${id}`,
    trigger: 'action',
    commands: [
      {
        type: 'if',
        when: { self: CHEST_OPENED },
        then: [{ type: 'message', talk: [{ lines: empty }] }],
        else: [
          { type: 'playSe', key: def.se?.trim() || CHEST_SE },
          // 中身は台帳が決める（`id` を空にすると起こした物の中身。GS-132）。
          { type: 'getItem', id: '', count: undefined },
          { type: 'setSelfSwitch', key: CHEST_OPENED, value: true },
          { type: 'message', talk: [{ lines: take }] },
        ],
      },
    ],
  };
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
