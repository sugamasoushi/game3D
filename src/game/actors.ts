// キャラの立ち姿（スプライトシート）の台帳（GS-16）。
//
// **絵の割り付けはデータで決める。** 行の並び・歩きのコマ・静止コマは `public/data/actors.json`、
// 横に何コマ・縦に何行あるか・足元の補正（2026-10-11 から）は `spriteSheets.json` が持つ。追加するのに TS を触らなくてよくするため。
//
// **キーは画像のファイル名**（2026-10-08。`spriteSheets.json` のキーと同じ。1 画像 1 行）。
// 立ち姿は**絵の設定だけ**を持つ——誰がこの絵を使うかはキャラクター（`characterdata.json` の `sheet`）、
// どう出てどう動くかは NPC の設定の台帳（`mapNpcs.json`。マップ＋1 体）。同じ絵を何人で使っても絵の設定は 1 つ。
// 行が無い画像も、区切りさえあれば既定の並び（下・左・右・上）で出せる。

import { assetUrl } from './assets';
import type { ActorSheet, Facing } from './player';
import { loadSpriteSheets, sheetUrl, spriteSheet } from './spriteSheets';

/** `actors.json` の 1 行（キーは画像のファイル名）。 */
export interface ActorEntry {
  /** 行の並び。省略すると 下・左・右・上。 */
  order?: Facing[];
  /** 歩きの見せ方（GS-47）。止まり絵のコマと 1 コマの秒数。 */
  walk?: { stand?: number; ms?: number };
  /** 静止コマの名前（GS-47）。宝箱の開閉など、向きを持たない物用。 */
  poses?: Record<string, number>;
}

/** `actors.json` の中身。 */
export interface ActorFile {
  actors: Record<string, ActorEntry>;
}

/** 読んだ台帳（画像のファイル名 → 絵の設定）。区切りは引くときに足す。 */
export type ActorBook = Record<string, ActorEntry>;

let pending: Promise<ActorBook> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**——マップを移るたびに取り直さない。区切りの台帳も一緒に待つ。 */
export function loadActorBook(): Promise<ActorBook> {
  if (pending) return pending;
  pending = Promise.all([fetch(assetUrl('data/actors.json')), loadSpriteSheets()])
    .then(([response]) => (response.ok ? (response.json() as Promise<ActorFile>) : null))
    .then((file) => file?.actors ?? {})
    .catch((error) => {
      // 読めなくても止めない。区切りだけで出す。
      console.warn('[actors] 台帳を読めなかった', error);
      return {} as ActorBook;
    });
  return pending;
}

/**
 * 画像の絵（区切り＋絵の設定）。**区切りが無ければ null**——1 コマの大きさも並びも分からず、出せない。
 * 立ち姿の行は無くてもよい（既定の並びで出す）。
 */
export function actorSheet(book: ActorBook, sheet: string): ActorSheet | null {
  const cut = spriteSheet(sheet);
  if (!cut) return null;
  const entry = book[sheet];
  return {
    url: sheetUrl(sheet),
    cols: cut.columns,
    rows: cut.rows,
    framePx: [cut.frameWidth, cut.frameHeight],
    ...(entry?.order ? { order: entry.order } : {}),
    ...(entry?.walk ? { walk: entry.walk } : {}),
    ...(cut.footPx !== undefined ? { footPx: cut.footPx } : {}),
    ...(entry?.poses ? { poses: entry.poses } : {}),
  };
}
