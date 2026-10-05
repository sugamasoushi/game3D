// おまけ（GS-212）。台帳の絵・動画が揃っているか、読めない項目を落とすか。
//
// 絵が抜けていても画面では黒いまま何も出ないだけなので、ここで留める。

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { saneOmake } from '../src/game/omake';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const raw = JSON.parse(readFileSync(join(PUBLIC, 'data', 'omake.json'), 'utf8'));

test('台帳の項目は全部読め、使う物が public に在る', () => {
  const book = saneOmake(raw);
  strictEqual(book.items.length, raw.items.length);
  for (const item of book.items) {
    for (const file of item.files) ok(existsSync(join(PUBLIC, file)), `${item.label}: ${file}`);
  }
});

test('マニュアル（GS-213）のアイコンと 3 枚が public に在る', () => {
  const manual = saneOmake(raw).manual;
  ok(manual, 'manual が読めない');
  strictEqual(manual.pages.length, 3);
  for (const file of [manual.icon, ...manual.pages]) ok(existsSync(join(PUBLIC, file)), file);
});

test('アイコンかページが無いマニュアルは出さない', () => {
  strictEqual(saneOmake({ items: [], manual: { icon: 'a.png', pages: [] } }).manual, undefined);
  strictEqual(saneOmake({ items: [], manual: { pages: ['a.png'] } }).manual, undefined);
});

test('読めない項目は落とす', () => {
  const book = saneOmake({
    items: [
      { label: '絵', kind: 'image', files: ['a.png'] },
      { label: '種類が無い', files: ['a.png'] },
      { label: '知らない種類', kind: 'sound', files: ['a.mp3'] },
      { label: '中身が無い', kind: 'pages', files: [] },
    ],
  });
  deepStrictEqual(
    book.items.map((item) => item.label),
    ['絵'],
  );
});
