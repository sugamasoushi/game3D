// オープニングの並び（GS-126）。
//
// 見た目そのものは試せないが、**時刻の食い違いは画面では気づきにくい**——
// 「立ち絵が背景より先に入った」「抜ける前に消えた」は 0.2 秒の差なので、目では追えない。
// 旧作の timeline（`title/view/Opening.ts`）と同じ数字になっているかをここで留める。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BACK_MS,
  CHARA_DELAY,
  CHARA_MS,
  OUT_MS,
  offsetOf,
  openingBackdrop,
  openingLength,
  openingSteps,
  type OpeningBook,
} from '../src/game/opening';

const book: OpeningBook = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'opening.json'), 'utf8'));

test('背景が先、立ち絵は 200ms 後（旧作の timeline と同じ）', () => {
  const steps = openingSteps(book);
  const first = book.cuts[0];
  const back = steps.find((step) => step.key === '0-back');
  const chara = steps.find((step) => step.key === '0-chara');
  strictEqual(back?.at, first.at);
  strictEqual(back?.ms, BACK_MS);
  strictEqual(chara?.at, first.at + CHARA_DELAY);
  strictEqual(chara?.ms, CHARA_MS);
  // 入ってくる側は背景も立ち絵も同じ。すれ違うのは**落ち着く側**のほう。
  strictEqual(back?.side, first.from);
  strictEqual(chara?.side, first.from);
});

test('抜けるのは立ち絵だけ。背景は残る（そのままタイトルの背になる）', () => {
  const steps = openingSteps(book);
  const out = steps.filter((step) => step.kind === 'out');
  strictEqual(out.length, book.cuts.length);
  deepStrictEqual(
    out.map((step) => step.part),
    out.map(() => 'chara'),
  );
  // 抜ける向きは**立っている側**。入ってきた側へ戻ると、横切った意味が消える。
  book.cuts.forEach((cut, index) => {
    const step = out.find((one) => one.cut === index);
    strictEqual(step?.at, cut.out);
    strictEqual(step?.ms, OUT_MS);
    strictEqual(step?.side, cut.stand);
  });
});

test('立ち絵は入り切ってから抜け始める。**重なると滑り込みが途中で切れる**', () => {
  for (const cut of book.cuts) strictEqual(cut.out >= cut.at + CHARA_DELAY + CHARA_MS, true, `${cut.who ?? ''} の out が早すぎる`);
});

test('長さは最後の動きが終わるところまで', () => {
  const last = Math.max(...book.cuts.map((cut) => cut.out)) + OUT_MS;
  strictEqual(openingLength(book), last);
  // 台帳が空でも 0 を返して、そのままタイトルへ進む。
  strictEqual(openingLength({ version: 1, bgm: '', title: '', cuts: [] }), 0);
});

test('画面の外へは 1 画面ぶん。左は負、右は正', () => {
  strictEqual(offsetOf('left'), -1280);
  strictEqual(offsetOf('right'), 1280);
});

test('タイトルの背は**最後の場面**の背景。絵が無ければ空', () => {
  strictEqual(openingBackdrop(book), book.cuts[book.cuts.length - 1].back);
  strictEqual(openingBackdrop({ version: 1, bgm: '', title: '', cuts: [] }), '');
});
