// 宝箱の台帳（GS-135）。
//
// **抽選は画面では確かめにくい。** 何度も開け直せないし、たまたま同じ物が続くこともある。
// 決め方そのものをここで留める——候補の外は出ない、個数は範囲に収まる、固定はそのまま。

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { drawChest, type ChestBook } from '../src/game/chests';

const ROOT = join(import.meta.dirname, '..');
const book = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'chests.json'), 'utf8')) as ChestBook;
const items = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'items.json'), 'utf8')).items));

test('決まった物はそのまま出る。個数を書かなければ 1 個', () => {
  deepStrictEqual(drawChest({ item: 'やくそう', num: 2 }), { item: 'やくそう', num: 2 });
  deepStrictEqual(drawChest({ item: 'やくそう' }), { item: 'やくそう', num: 1 });
});

test('抽選は**候補の外を出さない**。1 つしか無ければいつもそれ', () => {
  const candidates = ['やくそう', 'どく消し', 'ばんそうこう'];
  for (let i = 0; i < 200; i += 1) ok(candidates.includes(drawChest({ random: candidates }).item));
  strictEqual(drawChest({ random: ['やくそう'] }).item, 'やくそう');
});

test('個数の範囲は**両端を含み、外へは出ない**。逆さに書いても直す', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 300; i += 1) {
    const { num } = drawChest({ item: 'やくそう', num: [2, 4] });
    ok(num >= 2 && num <= 4, `範囲の外が出た: ${num}`);
    seen.add(num);
  }
  deepStrictEqual([...seen].sort(), [2, 3, 4], '両端も真ん中も出る');
  // 大小が逆でも同じ範囲として扱う（書き間違いで 0 個にしない）。
  for (let i = 0; i < 50; i += 1) {
    const { num } = drawChest({ item: 'やくそう', num: [4, 2] });
    ok(num >= 2 && num <= 4);
  }
});

test('抽選が固定より勝つ。**両方書いてあっても迷わない**', () => {
  strictEqual(drawChest({ item: 'やくそう', random: ['どく消し'] }).item, 'どく消し');
});

test('中身が決まらなければ空を返す（画面側が何も増やさない）', () => {
  strictEqual(drawChest({}).item, '');
  strictEqual(drawChest({ random: [] }).item, '');
});

test('台帳に書いてある中身は、持ち物の台帳に在るものだけ', () => {
  const gone: string[] = [];
  for (const [id, def] of Object.entries(book.chests ?? {})) {
    for (const one of def.random ?? []) if (!items.has(one)) gone.push(`${id}: ${one}`);
    if (def.item && !items.has(def.item)) gone.push(`${id}: ${def.item}`);
  }
  deepStrictEqual(gone, []);
});

test('コマ番号は 0 以上。**負の数は絵が出ない**', () => {
  const gone: string[] = [];
  for (const [id, def] of Object.entries(book.chests ?? {})) {
    for (const [name, frame] of [
      ['closed', def.closed],
      ['opened', def.opened],
    ] as const) {
      if (frame !== undefined && (!Number.isInteger(frame) || frame < 0)) gone.push(`${id}.${name}: ${frame}`);
    }
  }
  deepStrictEqual(gone, []);
});
