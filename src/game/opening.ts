// オープニング（GS-126）。**旧作 `title/view/Opening.ts` の作り直し。**
//
// 旧作は 2 人の立ち絵とその「家」の絵を左右から滑り込ませ、少し見せてから
// 両端へ抜けさせていた（Phaser の timeline）。同じ並びを **台帳**（`data/opening.json`）に置く——
// 絵を差し替えるのに TS を触らなくてよくするため（`illustrations.json` と同じ考え）。
//
// ここが持つのは**いつ・どこから・どこへ**だけ。実際に動かすのは `ui/Opening.tsx`。

import { assetUrl } from './assets';

/** 滑り込む向き。画面のどちら側から入ってくるか。 */
export type Side = 'left' | 'right';

/** 台帳の 1 場面。「その人の家の絵」と「立ち絵」が 1 組で動く。 */
export interface OpeningCut {
  /** 誰の場面か。画面には出さない——台帳を読む人のための覚え書き。 */
  who?: string;
  /** 背景（`public/` からの道）。1280×720 を想定。 */
  back: string;
  /** 立ち絵（`public/` からの道）。 */
  chara: string;
  /** どちら側から入ってくるか。 */
  from: Side;
  /** 立ち絵が落ち着く側。旧作では入ってきた側と**逆**（すれ違うように見せる）。 */
  stand: Side;
  /** 背景が入り始める時刻（ミリ秒。オープニングの頭から数える）。 */
  at: number;
  /** 立ち絵が抜け始める時刻（ミリ秒）。 */
  out: number;
}

export interface OpeningBook {
  version: 1;
  /** タイトルで流す曲（`sounds.json` のキー）。空なら鳴らさない。 */
  bgm: string;
  /** タイトルに出す名前。 */
  title: string;
  cuts: OpeningCut[];
}

/**
 * 台帳が無い・読めないときの中身。**オープニングが無いだけで遊べなくなってはいけない。**
 * 絵が 1 枚も無いので、画面はすぐタイトルへ進む。
 */
export const DEFAULT_OPENING: OpeningBook = { version: 1, bgm: 'opening', title: 'ちょっとだけ RPG', cuts: [] };

/** 旧作の timeline から写した刻み（ミリ秒）。**台帳では変えない**——動きの手触りそのもの。 */
export const BACK_MS = 200;
/** 背景が入ってから立ち絵が続くまでの間。 */
export const CHARA_DELAY = 200;
export const CHARA_MS = 500;
/** 抜けるのにかける時間。 */
export const OUT_MS = 400;
/** 立ち絵を背景より少し下げる（旧作の `+100`）。足元を切って、寄っているように見せる。 */
export const CHARA_DROP = 100;

/**
 * 動き方（CSS の easing）。旧作の Phaser の名前を右に書いた。
 * `back.in` は**いったん逆へ引いてから飛ぶ**ので、抜けるときに勢いが出る。
 */
export const EASE_BACK = 'ease-out'; /* Power2 */
export const EASE_IN = 'cubic-bezier(0.075, 0.82, 0.165, 1)'; /* circ.out */
export const EASE_OUT = 'cubic-bezier(0.6, -0.28, 0.735, 0.045)'; /* back.in */

/** 画面の幅（DEC-162）。**1 画面ぶん**ずらせば、絵の大きさに関わらず画面の外へ出る。 */
export const SCREEN_W = 1280;

/** その側の画面外までの距離（px）。左なら負、右なら正。 */
export const offsetOf = (side: Side): number => (side === 'left' ? -SCREEN_W : SCREEN_W);

/** 動かす 1 枚。`ui/Opening.tsx` はこれを順に `element.animate()` へ渡すだけ。 */
export interface OpeningStep {
  /** どの絵か。`${場面の番号}-back` / `-chara` / `-out`。 */
  key: string;
  /** 何番目の場面か。 */
  cut: number;
  /** 背景か立ち絵か。 */
  part: 'back' | 'chara';
  /** 入るのか抜けるのか。 */
  kind: 'in' | 'out';
  /** 始まる時刻（ミリ秒）。 */
  at: number;
  /** かける時間（ミリ秒）。 */
  ms: number;
  /** 動き方（CSS）。 */
  ease: string;
  /** 画面のどちら側へ（`in` なら来る側、`out` なら去る側）。 */
  side: Side;
}

/**
 * 台帳から動きの並びを作る（GS-126）。**時刻の計算はここだけ**——
 * 画面側は「いつ何を動かすか」を考えない。
 *
 * 旧作の並び（1 人ぶん）:
 * 1. 家の絵が `at` から 200ms で入る
 * 2. 立ち絵が `at + 200` から 500ms で入る
 * 3. 立ち絵が `out` から 400ms で抜ける（家の絵は**残る**。そのままタイトルの背になる）
 */
export function openingSteps(book: OpeningBook): OpeningStep[] {
  const steps: OpeningStep[] = [];
  book.cuts.forEach((cut, index) => {
    steps.push({ key: `${index}-back`, cut: index, part: 'back', kind: 'in', at: cut.at, ms: BACK_MS, ease: EASE_BACK, side: cut.from });
    steps.push({
      key: `${index}-chara`,
      cut: index,
      part: 'chara',
      kind: 'in',
      at: cut.at + CHARA_DELAY,
      ms: CHARA_MS,
      ease: EASE_IN,
      side: cut.from,
    });
    steps.push({ key: `${index}-out`, cut: index, part: 'chara', kind: 'out', at: cut.out, ms: OUT_MS, ease: EASE_OUT, side: cut.stand });
  });
  return steps;
}

/** 最後の動きが終わる時刻（ミリ秒）。絵が 1 枚も無ければ 0。 */
export function openingLength(book: OpeningBook): number {
  return openingSteps(book).reduce((end, step) => Math.max(end, step.at + step.ms), 0);
}

/** タイトルの背にする絵（`public/` からの道）。**最後の場面の背景がそのまま残る**（旧作と同じ）。 */
export function openingBackdrop(book: OpeningBook): string {
  return book.cuts.length ? book.cuts[book.cuts.length - 1].back : '';
}

let book: OpeningBook = DEFAULT_OPENING;
let pending: Promise<OpeningBook> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す。** */
export function loadOpening(): Promise<OpeningBook> {
  if (pending) return pending;
  // `no-store`——台帳を書き換えて読み直したとき、**古い並びのまま動かない**ように
  // （`illustrations.json` と同じ扱い）。読むのは起動に 1 回だけなので重くならない。
  pending = fetch(assetUrl('data/opening.json'), { cache: 'no-store' })
    .then((response) => (response.ok ? (response.json() as Promise<Partial<OpeningBook>>) : null))
    .then((file) => {
      book = {
        version: 1,
        bgm: typeof file?.bgm === 'string' ? file.bgm : DEFAULT_OPENING.bgm,
        title: typeof file?.title === 'string' && file.title ? file.title : DEFAULT_OPENING.title,
        cuts: Array.isArray(file?.cuts) ? file.cuts : [],
      };
      return book;
    })
    .catch((error) => {
      console.warn('[opening] 台帳を読めなかった', error);
      return book;
    });
  return pending;
}

/** いまの台帳。読み終える前は既定（絵なし）。 */
export function openingBook(): OpeningBook {
  return book;
}
