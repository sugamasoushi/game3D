// 宝箱の開け方（GS-177 / GS-178）。
//
// 台帳に `event` を書けばそのイベント、書かなければ**台帳の文で開ける手順**をゲームが組む。
// どちらを動かすかが食い違うと「調べても何も起きない」が静かに起きる。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chestEventDef, chestEventOf, previewChests, type ChestBook } from '../src/game/chests';

const ROOT = join(import.meta.dirname, '..');
const book = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'chests.json'), 'utf8')) as ChestBook;

test('台帳が別のイベントを指していればそちら。ふだんはマップのまま（GS-177）', () => {
  previewChests({
    version: 1,
    chests: {
      宝箱_ふつう: { item: 'やくそう' },
      宝箱_罠: { item: 'やくそう', event: '宝箱_罠つき' },
      宝箱_空欄: { item: 'やくそう', event: '  ' },
    },
  });
  strictEqual(chestEventOf('宝箱_ふつう', '宝箱'), '宝箱', '書いていなければマップの Event');
  strictEqual(chestEventOf('宝箱_罠', '宝箱'), '宝箱_罠つき', '書いてあればそちらが勝つ');
  strictEqual(chestEventOf('宝箱_空欄', '宝箱'), '宝箱', '空白だけなら書いていない扱い');
  strictEqual(chestEventOf('台帳に無い', '宝箱'), '宝箱');
  // 台帳を元へ戻す（ほかのテストが実物を見るため）。
  previewChests(book);
});

test('イベントを書かなければ、台帳の文で開ける手順を組み立てる（GS-178）', () => {
  previewChests({
    version: 1,
    chests: {
      宝箱_ふつう: { item: 'やくそう' },
      宝箱_文つき: { item: 'やくそう', take: ['ひらいた！', '{アイテム} が 入っていた'], empty: ['もう空だ'], se: 'open' },
      宝箱_特殊: { item: 'やくそう', event: '宝箱_罠つき' },
    },
  });

  const plain = chestEventDef('宝箱_ふつう');
  strictEqual(plain?.trigger, 'action', '調べて動く');
  const branch = plain!.commands[0] as { type: string; when: { self?: string }; then: unknown[]; else: unknown[] };
  strictEqual(branch.type, 'if');
  strictEqual(branch.when.self, '開けた', '開けた覚えで分ける');
  deepStrictEqual(
    (branch.else as Array<{ type: string }>).map((one) => one.type),
    ['playSe', 'getItem', 'setSelfSwitch', 'message'],
    '音 → 渡す → 覚える → 文',
  );
  // 書かなければ既定の文。
  deepStrictEqual((branch.then as Array<{ talk: Array<{ lines: string[] }> }>)[0].talk[0].lines, ['からっぽだ。']);

  const written = chestEventDef('宝箱_文つき');
  const branch2 = written!.commands[0] as { then: Array<{ talk: Array<{ lines: string[] }> }>; else: Array<{ type: string; key?: string; talk?: Array<{ lines: string[] }> }> };
  deepStrictEqual(branch2.then[0].talk[0].lines, ['もう空だ'], '取得済みの文は台帳のもの');
  deepStrictEqual(branch2.else[3].talk![0].lines, ['ひらいた！', '{アイテム} が 入っていた'], '開けたときの文も台帳のもの（複数行も通る）');
  strictEqual(branch2.else[0].key, 'open', '音も台帳で変えられる');

  // イベントを指している宝箱は組み立てない（そちらを動かす）。
  strictEqual(chestEventDef('宝箱_特殊'), null);
  strictEqual(chestEventOf('宝箱_特殊', ''), '宝箱_罠つき');
  strictEqual(chestEventDef('台帳に無い'), null);
  previewChests(book);
});

test('台帳に見た目の欄は残っていない（GS-179。見た目はマップが持つ）', () => {
  const left = Object.entries(book.chests)
    .filter(([, def]) => ['closed', 'opened', 'block'].some((key) => key in def))
    .map(([id]) => id);
  deepStrictEqual(left, []);
});
