// 描画モード（GS-173）。**重い描画を間引く道は 1 本だけ**、を留める。
//
// 間違えたときの見え方が厄介で、「スマホだけ真っ暗」「切ったのに軽くならない」の
// どちらも画面からは原因が分からない。表（`HEAVY_DRAWS`）と入口（`heavyOn`）の
// 食い違いをここで落とす。

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { options, setOptions } from '../src/game/options';
import { drawMode, guessDrawMode, heavyOn, HEAVY_DRAWS, type HeavyDraw } from '../src/game/quality';

const kinds = Object.keys(HEAVY_DRAWS) as HeavyDraw[];

afterEach(() => {
  setOptions({ drawMode: 'auto' });
});

test('高負荷では**全部出す**。表に何を足しても間引かれない', () => {
  setOptions({ drawMode: 'high' });
  strictEqual(drawMode(), 'high');
  deepStrictEqual(
    kinds.map((kind) => heavyOn(kind)),
    kinds.map(() => true),
  );
});

test('低負荷で落とすのは**表で `light: false` と書いたものだけ**', () => {
  setOptions({ drawMode: 'light' });
  strictEqual(drawMode(), 'light');
  for (const kind of kinds) {
    strictEqual(heavyOn(kind), HEAVY_DRAWS[kind].light, `${kind} は表のとおりに出し入れする`);
  }
});

test('低負荷では配置光源と水面の映り込みを出さない（いまの取り決め）', () => {
  setOptions({ drawMode: 'light' });
  strictEqual(heavyOn('pointLights'), false);
  strictEqual(heavyOn('mirror'), false);
});

test('自動は端末から見当を付ける。**見当が付かないときは重いほうで出す**', () => {
  setOptions({ drawMode: 'auto' });
  // 画面の無い所（このテスト）では `window` が無い。絵が消えるより重いほうがまし。
  strictEqual(guessDrawMode(), 'high');
  strictEqual(drawMode(), 'high');
});

test('知らない値を覚えていても自動に落ちる（壊れた設定で真っ暗にしない）', () => {
  setOptions({ drawMode: 'めちゃ綺麗' as unknown as 'high' });
  // `setOptions` は素通しだが、**読み直しの入口**（`loadOptions`）で落とす決まり。
  // ここでは「表に無い値でも `heavyOn` が出す側に倒れる」ことを見る。
  ok(heavyOn('pointLights'), '知らないモードは高負荷と同じ扱い');
  setOptions({ drawMode: 'auto' });
  strictEqual(options.drawMode, 'auto');
});

test('表の中身は画面に出すので、名前と説明が空でない', () => {
  for (const kind of kinds) {
    ok(HEAVY_DRAWS[kind].label.trim(), `${kind} に名前がない`);
    ok(HEAVY_DRAWS[kind].note.trim(), `${kind} に説明がない`);
  }
});
