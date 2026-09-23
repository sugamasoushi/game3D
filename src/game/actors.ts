// キャラの立ち姿（スプライトシート）の台帳（GS-16）。
//
// **絵の割り付けはデータで決める。** どのキャラがどのシートを使い、
// 横に何コマ・縦に何行あるかは `public/data/actors.json` が持つ。
// 追加するのに TS を触らなくてよくするため——NPC を増やすのは人の仕事なので。
//
// 会話用の `characterdata.json`（名前・立ち絵・アイコン）とは**別の台帳**にする。
// 同じキーで引けるようにしてあるが、絵の都合と喋りの都合を混ぜない。

import { assetUrl } from './assets';
import { ACTOR_SHEET, type ActorSheet, type Facing } from './player';
import { loadSpriteSheets, sheetUrl, spriteSheet } from './spriteSheets';
import type { SpriteRef } from './npcs';

/** 台帳にも大きさにも手掛かりが無いときの並び。ツクール系の標準（横 3 × 縦 4）。 */
const GUESS_COLS = 3;
const GUESS_ROWS = 4;

/** `actors.json` の 1 人ぶん。 */
interface ActorEntry {
  /**
   * 絵のファイル名（`assets/spritesheet/` の中。GS-121）。
   * 1 コマの大きさ・横のコマ数・縦の行数は `spriteSheets.json` が持つ。
   */
  sheet: string;
  /** 行の並び。省略すると 下・左・右・上。 */
  order?: Facing[];
  /** 歩きの見せ方（GS-47）。止まり絵のコマと 1 コマの秒数。 */
  walk?: { stand?: number; ms?: number };
  /** 足元が 1 コマの下端から何画素上にあるか（GS-52）。絵をそのぶん下げる。 */
  footPx?: number;
  /** 静止コマの名前（GS-47）。宝箱の開閉など、向きを持たない物用。 */
  poses?: Record<string, number>;
  /**
   * 勝手にうろつく（GS-48）。**キャラの性質**として台帳が持ち、
   * マップのプロパティ `Wander` で個体ごとに上書きできる。
   */
  wander?: WanderDef;
}

/**
 * うろつき方（GS-48 / GS-50）。**マス単位では動かない。**
 * 旧作は ±20px（チップ 32px の 0.6 マスぶん）を 1 秒かけて動いていた。
 * マス単位で 1 歩ずつ動かすと、歩幅も速さも大きすぎて「うろつき」に見えない。
 */
export interface WanderDef {
  /** 立ち止まっている時間（ミリ秒）。`[最短, 最長]` から毎回抽選する。 */
  ms?: [number, number];
  /** 置いた場所から離れてよい距離（マス）。0 で動かない。 */
  range?: number;
  /** 1 回に動く距離の上限（マス）。毎回 0 とこの間で抽選する。 */
  step?: number;
  /** その距離を歩くのにかける時間（ミリ秒）。速さはここから決まる。 */
  walkMs?: number;
}

/** うろつきの既定（GS-50）。旧作の「±20px を 1 秒、1.7〜3.3 秒休む」に合わせた。 */
export const WANDER_DEFAULT: Required<WanderDef> = {
  ms: [1700, 3300],
  range: 2,
  // 一度に歩くマス数（GS-117）。**1 マス単位**——半端に歩くとマスの端に立ち、
  // 塞ぐマス（人はマス 1 つ。GS-35）と絵の立ち位置が食い違って、話しかけられなくなる。
  step: 1,
  walkMs: 1000,
};

/** `actors.json` の中身。 */
interface ActorFile {
  actors: Record<string, ActorEntry>;
}

export type ActorBook = Record<string, ActorSheet>;

/**
 * うろつき方だけは**絵とは別に持つ**（GS-48）。`ActorSheet` は絵の話に閉じておきたい
 * ——プレイヤーも同じ型を使うので、そちらに「うろつく」が混ざると意味が濁る。
 */
let wanders: Record<string, WanderDef | undefined> = {};

/**
 * そのキャラのうろつき方。台帳に無ければ null（うろつかない）。
 *
 * **引き当て方は `sheetOf` と同じ**（GS-48）。マップが「キャラ画像」で置いた NPC は
 * キーが絵のファイル名（`chicken_walk`）になり、台帳の名前（`grandpa`）と食い違う。
 * 絵は同じなのにうろつき方だけ引けない、という取りこぼしを防ぐ。
 */
export function wanderOf(book: ActorBook, key: string, sprite?: SpriteRef): WanderDef | null {
  const named = wanders[key];
  if (named) return named;
  if (!sprite) return null;
  const tail = `/${sprite.file}`;
  const same = Object.entries(book).find(([, entry]) => entry.url.endsWith(tail));
  return (same && wanders[same[0]]) ?? null;
}

let pending: Promise<ActorBook> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**——マップを移るたびに取り直さない。 */
export function loadActorBook(): Promise<ActorBook> {
  if (pending) return pending;
  // 区切りは画像の台帳から引く（GS-121）。攻撃の絵と同じ台帳。
  pending = Promise.all([fetch(assetUrl('data/actors.json')), loadSpriteSheets()])
    .then(([response]) => (response.ok ? (response.json() as Promise<ActorFile>) : null))
    .then((file) => {
      const book: ActorBook = {};
      wanders = {};
      for (const [key, entry] of Object.entries(file?.actors ?? {})) {
        const cut = spriteSheet(entry.sheet);
        if (!cut) {
          // 区切りが無ければ**出せない**——1 コマの大きさも並びも分からない。
          console.warn(`[actors] 画像の区切りが台帳（spriteSheets.json）にありません: ${entry.sheet}`);
          continue;
        }
        book[key] = {
          url: sheetUrl(entry.sheet),
          cols: cut.columns,
          rows: cut.rows,
          framePx: [cut.frameWidth, cut.frameHeight],
          order: entry.order,
          walk: entry.walk,
          footPx: entry.footPx,
          poses: entry.poses,
        };
        wanders[key] = entry.wander;
      }
      return book;
    })
    .catch((error) => {
      // 読めなくても止めない。既定のシートで出す。
      console.warn('[actors] 台帳を読めなかった', error);
      return {} as ActorBook;
    });
  return pending;
}

/**
 * キーから絵を引く。**知らないキーでも黙って落とさない**——
 * 既定のシートで出して、コンソールに書いておく。
 * 姿が違うことには気づけるが、キャラが消えると原因を探しにくい。
 *
 * `sprite` はエディタの「キャラ画像」が書いた指定（GS-18）。台帳に無い絵でも、
 * **ファイル名と 1 コマの大きさが分かれば出せる**。並び（横のコマ数・行の順）は
 * 絵からは分からないので、台帳に同じファイルが在ればそちらを使い、無ければ標準で見なす。
 */
export function sheetOf(book: ActorBook, key: string, sprite?: SpriteRef): ActorSheet {
  const named = book[key];
  if (named) return named;
  if (sprite) {
    // 台帳に**同じ絵**が別の名前で入っていることがある（chicken_walk＝じいちゃん）。
    // 並びはそちらが正しいので、ファイル名で引き当てる。
    const tail = `/${sprite.file}`;
    const same = Object.values(book).find((entry) => entry.url.endsWith(tail));
    if (same) return same;
    // 立ち姿の台帳に無くても、画像の区切りがあれば出せる（GS-121）。
    const cut = spriteSheet(sprite.file);
    if (cut) {
      return {
        url: sheetUrl(sprite.file),
        cols: cut.columns,
        rows: cut.rows,
        framePx: [cut.frameWidth, cut.frameHeight],
      };
    }
    if (sprite.framePx) {
      console.warn(
        `[actors] 画像の区切りが台帳にない絵: ${sprite.file}（横 ${GUESS_COLS} × 縦 ${GUESS_ROWS} と見なす）`,
      );
      return {
        url: sheetUrl(sprite.file),
        cols: GUESS_COLS,
        rows: GUESS_ROWS,
        framePx: sprite.framePx,
      };
    }
  }
  console.warn(`[actors] 絵が登録されていない: ${key}（既定の絵で出す）`);
  return ACTOR_SHEET;
}
