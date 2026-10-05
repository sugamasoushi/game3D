// 仮想パッドの表示（GS-214）。既定は自動で、スマホでないと出さない。設定で必ず上書きできる。

import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_OPTIONS, virtualPadShown } from '../src/game/options';

test('既定は自動', () => {
  strictEqual(DEFAULT_OPTIONS.virtualPad, 'auto');
});

test('表示・非表示は端末に関わらず従う。自動は PC（ここはブラウザの外）では出さない', () => {
  strictEqual(virtualPadShown('on'), true);
  strictEqual(virtualPadShown('off'), false);
  strictEqual(virtualPadShown('auto'), false);
});
