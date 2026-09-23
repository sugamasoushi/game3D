// キャライラストの出し入れと効果（GS-20 / GS-31 / GS-143）。
//
// **並び順まで見る。** 見た目の話に見えるが、並びが変わると React が `<img>` を
// DOM 上で動かし、入りのアニメが走り直す——消すはずの絵が画面の外から現れ直す。
// 実際に出た不具合なので、ここで固定しておく。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useUi } from '../src/ui/store';

const ids = () => useUi.getState().portraits.map((entry) => entry.id);
const marks = () => useUi.getState().portraits.map((entry) => `${entry.id}${entry.out ? `:出${entry.out}` : ''}`);
const one = (id: string) => useUi.getState().portraits.find((entry) => entry.id === id);
/** 画面位置を名前にして置く（`id` を書かないときのふるまい）。 */
const put = (slot: string, src: string, from: 'left' | 'right' | 'top' | 'bottom' | 'none' = 'left') =>
  useUi.getState().showPortrait({ id: slot, slot, src, from });

beforeEach(() => {
  useUi.setState({ portraits: [] });
});

test('置いた順に並ぶ', () => {
  put('left', 'a.png');
  put('right', 'b.png');
  deepStrictEqual(ids(), ['left', 'right']);
});

test('消す指示は印を付けるだけ。**並びは変えない**（GS-31 の落とし穴）', () => {
  put('left', 'a.png');
  put('right', 'b.png');
  useUi.getState().hidePortrait('left');
  // 末尾へ積み直すと、ここが ['right', 'left:出left'] になる。それが不具合の正体だった。
  deepStrictEqual(marks(), ['left:出left', 'right']);
});

test('出ていく先は**入ってきた側**。向きを書けばそちらへ', () => {
  put('left', 'a.png', 'right');
  useUi.getState().hidePortrait('left');
  strictEqual(one('left')?.out, 'right', '入ってきた側へ帰る');
  useUi.setState({ portraits: [] });
  put('center', 'b.png', 'left');
  useUi.getState().hidePortrait('center', 'bottom');
  strictEqual(one('center')?.out, 'bottom');
});

test('印を付けただけでは消えない。外すのは dropPortrait', () => {
  put('left', 'a.png');
  useUi.getState().hidePortrait('left');
  strictEqual(useUi.getState().portraits.length, 1);
  useUi.getState().dropPortrait('left');
  deepStrictEqual(ids(), []);
});

test('滑らせない絵（from: none）はその場で外す', () => {
  put('left', 'a.png', 'none');
  useUi.getState().hidePortrait('left');
  deepStrictEqual(ids(), []);
});

test('出ていく途中でも、同じ名前で置けば差し替わる', () => {
  put('left', 'a.png');
  useUi.getState().hidePortrait('left');
  put('left', 'b.png');
  strictEqual(useUi.getState().portraits.length, 1);
  strictEqual(one('left')?.src, 'b.png');
  // 印は落ちていること。残っていると置いた直後に出ていってしまう。
  strictEqual(one('left')?.out, undefined);
});

test('居ない絵を消しても何も起きない', () => {
  put('left', 'a.png');
  useUi.getState().hidePortrait('right');
  deepStrictEqual(marks(), ['left']);
});

test('イベント終わりの片付けは全部に印を付ける。並びはそのまま', () => {
  put('left', 'a.png');
  put('center', 'b.png');
  put('right', 'c.png', 'right');
  useUi.getState().clearPortraits();
  deepStrictEqual(marks(), ['left:出left', 'center:出left', 'right:出right']);
});

// ---- 名前を付けて重ねる（GS-143）-------------------------------------------

test('同じ場所に**名前違いで何枚でも**置ける。消すのは指した 1 枚だけ', () => {
  const show = useUi.getState().showPortrait;
  show({ id: 'ラミィ', slot: 'left', src: 'a.png', from: 'left' });
  show({ id: '回想', slot: 'left', src: 'b.png', from: 'top' });
  deepStrictEqual(ids(), ['ラミィ', '回想']);
  useUi.getState().hidePortrait('回想', 'top');
  deepStrictEqual(marks(), ['ラミィ', '回想:出top']);
});

test('効果は指した絵にだけ効く', () => {
  const show = useUi.getState().showPortrait;
  show({ id: 'a', slot: 'left', src: 'a.png' });
  show({ id: 'b', slot: 'right', src: 'b.png' });
  useUi.getState().fxPortrait('a', { opacity: 0.4, ms: 200 });
  strictEqual(one('a')?.opacity, 0.4);
  strictEqual(one('a')?.ms, 200);
  strictEqual(one('b')?.opacity, 1, 'もう 1 枚は触らない');
});

test('揺らすたびに通し番号が進む。**同じ揺れを続けて出せる**', () => {
  put('left', 'a.png');
  const before = one('left')?.shakeAt ?? 0;
  useUi.getState().fxPortrait('left', { shake: 8, ms: 300 });
  strictEqual(one('left')?.shake, 8);
  strictEqual(one('left')?.shakeAt, before + 1);
  useUi.getState().fxPortrait('left', { shake: 8, ms: 300 });
  strictEqual(one('left')?.shakeAt, before + 2, '番号が進まないとアニメが走り直さない');
  // 濃さだけ変えたときは番号を進めない（揺れをやり直させない）。
  useUi.getState().fxPortrait('left', { opacity: 0.5 });
  strictEqual(one('left')?.shakeAt, before + 2);
});

test('知らない名前に効果をかけても、出ている絵は変わらない', () => {
  put('left', 'a.png');
  useUi.getState().fxPortrait('居ない', { opacity: 0 });
  strictEqual(one('left')?.opacity, 1);
  deepStrictEqual(ids(), ['left']);
});

test('大きさは**効果でだけ**変わる。置いた絵はいつも 1 倍（GS-145）', () => {
  put('left', 'a.png');
  strictEqual(one('left')?.scale, 1, '素の大きさは画面側（.portrait の丈）が決める');
  useUi.getState().fxPortrait('left', { scale: 2, ms: 300 });
  strictEqual(one('left')?.scale, 2);
  // 揺らしても大きさは残る。CSS のアニメ側に scale を入れていないと、
  // 揺れているあいだだけ元の大きさに戻ってしまう（実際に踏んだ穴）。
  useUi.getState().fxPortrait('left', { shake: 8 });
  strictEqual(one('left')?.scale, 2);
  // 同じ名前で置き直したら 1 倍から。別の絵に前の効果を引き継がせない。
  put('left', 'b.png');
  strictEqual(one('left')?.scale, 1);
});

test('左右反転は置くときに決める。既定は反転なし（GS-146）', () => {
  put('left', 'a.png');
  strictEqual(one('left')?.flip, false);
  useUi.getState().showPortrait({ id: 'right', slot: 'right', src: 'b.png', from: 'none', flip: true });
  strictEqual(one('right')?.flip, true, '右に置いた絵を左向きにできる');
  // 置き直せば向きも置き直し。前の絵の向きを引きずらない。
  useUi.getState().showPortrait({ id: 'right', slot: 'right', src: 'c.png', from: 'none' });
  strictEqual(one('right')?.flip, false);
});

test('片付けの速さは**いつも 280ms**。最後にかけた効果の時間を引きずらない', () => {
  put('left', 'a.png');
  put('right', 'b.png', 'right');
  // ゆっくり薄くしたあとにイベントが終わる、という場面。
  useUi.getState().fxPortrait('left', { opacity: 0.3, ms: 2000 });
  useUi.getState().clearPortraits();
  deepStrictEqual(
    useUi.getState().portraits.map((entry) => entry.ms),
    [280, 280],
    '1 枚だけ長く残ると、取り残されたように見える',
  );
});
