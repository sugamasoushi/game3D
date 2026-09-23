// フラグの向き（GS-147）。**旧作と同じ**——true＝まだ動ける／false＝もう動かない。
//
// **書いていないフラグは true。** ここが false だと 1 回きりのイベントが 1 度も動かない
// （条件が `is: true` なので、誰も立てていない＝動けない、になる）。
// 旧作の `EventFlagData.getFlag` も既定 true で、`savedata.json` に `false` と
// 書いた物だけ止めていた。画面では「イベントが始まらない」としか見えないので、ここで留める。

import { strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { canRun } from '../src/event/interpreter';
import type { EventContext } from '../src/event/interpreter';
import type { EventDef } from '../src/event/types';
import { newState, switchOn } from '../src/game/state';

test('書いていないフラグは **true（まだ動ける）**', () => {
  const state = newState();
  strictEqual(switchOn(state, 'EVENT010201'), true);
  state.switches.set('EVENT010201', false);
  strictEqual(switchOn(state, 'EVENT010201'), false, '寝かせたら動かない');
  state.switches.set('EVENT010201', true);
  strictEqual(switchOn(state, 'EVENT010201'), true);
});

test('1 回きりのイベントは、初回は動いて 2 回目は動かない', () => {
  const state = newState();
  // `canRun` が見るのは `getSwitch` だけ。ほかは使わないので空の器で足りる。
  const ctx = { getSwitch: (key: string) => switchOn(state, key), getSelfSwitch: () => false } as unknown as EventContext;
  const event: EventDef = {
    id: 'EVENT010201',
    trigger: 'touch',
    when: [{ switch: 'EVENT010201', is: true }],
    commands: [],
  };
  strictEqual(canRun(event, ctx), true, '**初回は必ず動く**（書いていなければ動ける）');
  state.switches.set('EVENT010201', false);
  strictEqual(canRun(event, ctx), false, '寝かせたあとは動かない');
});

test('前提つきのイベントは、相手が寝てから動く', () => {
  const state = newState();
  const ctx = { getSwitch: (key: string) => switchOn(state, key), getSelfSwitch: () => false } as unknown as EventContext;
  // 「EVENT010301 が済んだ（＝false）」かつ「自分はまだ（＝true）」のとき動く。
  const event: EventDef = {
    id: 'EVENT010302',
    trigger: 'touch',
    when: [
      { switch: 'EVENT010301', is: false },
      { switch: 'EVENT010302', is: true },
    ],
    commands: [],
  };
  strictEqual(canRun(event, ctx), false, '相手がまだ済んでいないうちは動かない');
  state.switches.set('EVENT010301', false);
  strictEqual(canRun(event, ctx), true);
});

test('セルフフラグは**逆向き**。未設定は false（まだ開けていない）', () => {
  const state = newState();
  strictEqual(state.self.get('どこか/宝箱/開けた') ?? false, false);
});
