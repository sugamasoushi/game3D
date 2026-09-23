import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTION_BUTTONS, FACE_BUTTONS, directionKeys } from '../src/ui/VirtualPad';

test('仮想十字パッドは8方向を持つ', () => {
  const buttons = DIRECTION_BUTTONS.filter((button) => button.codes.length);
  strictEqual(buttons.length, 8);
  deepStrictEqual([...buttons.find((button) => button.name === '左上')!.codes], ['ArrowUp', 'ArrowLeft']);
  deepStrictEqual([...buttons.find((button) => button.name === '右下')!.codes], ['ArrowDown', 'ArrowRight']);
});

test('斜めは歩行中だけ2軸。選択画面では上下1回に絞る', () => {
  deepStrictEqual(directionKeys(['ArrowUp', 'ArrowLeft'], true), ['ArrowUp', 'ArrowLeft']);
  deepStrictEqual(directionKeys(['ArrowUp', 'ArrowLeft'], false), ['ArrowUp']);
  deepStrictEqual(directionKeys(['ArrowDown', 'ArrowRight'], false), ['ArrowDown']);
});

test('右パッドは決定・取消・メニュー・走るを既存のキーへ流す', () => {
  const byName = Object.fromEntries(FACE_BUTTONS.map((button) => [button.name, button.code]));
  strictEqual(byName.決定, 'Enter');
  strictEqual(byName.取り消し, 'Escape');
  strictEqual(byName.メニュー, 'Escape');
  strictEqual(byName.走る, 'ShiftLeft');
});
