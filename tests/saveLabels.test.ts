// セーブ一覧に出す文字（GS-27 / GS-33）。
//
// 見た目だけの関数に見えるが、**一覧はここでしか読めない**——枠を選び間違えると
// 上書きしてしまうので、境目（0 分・ちょうど 1 時間・オート枠）を押さえておく。

import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_SLOT, playTimeLabel, savedAtLabel, slotLabel } from '../src/game/save';

test('オート枠は番号ではなく名前で出す（GS-33）', () => {
  strictEqual(slotLabel(AUTO_SLOT), 'オート');
  strictEqual(slotLabel(1), '1');
  strictEqual(slotLabel(3), '3');
});

test('遊んだ時間は 1 時間から「時間」を出す。分は 2 桁に揃える', () => {
  strictEqual(playTimeLabel(0), '0 分');
  strictEqual(playTimeLabel(59), '0 分');
  strictEqual(playTimeLabel(60), '1 分');
  strictEqual(playTimeLabel(3599), '59 分');
  strictEqual(playTimeLabel(3600), '1 時間 00 分');
  // 揃っていないと一覧で桁がずれて読みにくい。
  strictEqual(playTimeLabel(3600 + 120), '1 時間 02 分');
  strictEqual(playTimeLabel(36000), '10 時間 00 分');
});

test('書いた時刻。**空の枠では何も出さない**', () => {
  strictEqual(savedAtLabel(0), '');
  const at = new Date(2026, 8, 7, 9, 5).getTime();
  strictEqual(savedAtLabel(at), '9/7 09:05');
});
