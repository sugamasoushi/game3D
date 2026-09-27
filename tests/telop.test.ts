// テロップと「押さずに送る会話」（GS-171 / GS-172）。
//
// **止まって見える壊れ方をする。** 押して消せない指定なのに消える時間が無いと、
// 画面は真っ黒のまま何をしても進まない——遊ぶ人には「固まった」としか見えないので、
// 既定の入り方をここで留める。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { runCommands, TELOP_HOLD, TELOP_MS } from '../src/event/interpreter';
import type { EventContext } from '../src/event/interpreter';
import type { EventCommand } from '../src/event/types';

/** テロップと会話の呼ばれ方だけを控える器。 */
function stub() {
  const telops: Array<Record<string, unknown>> = [];
  const talks: Array<{ lines: string[][]; hold?: number }> = [];
  const ctx = {
    async telop(lines: string[], look: Record<string, unknown>) {
      telops.push({ lines, ...look });
    },
    async message(talk: { lines: string[] }[], _face?: string, _style?: string, hold?: number) {
      talks.push({ lines: talk.map((one) => one.lines), hold });
    },
  } as unknown as EventContext;
  return { ctx, telops, talks };
}

const run = (command: Record<string, unknown>) => [command] as unknown as EventCommand[];

test('テロップの既定は「押すまで出したまま」。黒さ 1・800ms で薄れる', async () => {
  const one = stub();
  await runCommands(run({ type: 'telop', lines: ['━ 翌朝 ━'] }), one.ctx);
  deepStrictEqual(one.telops, [{ lines: ['━ 翌朝 ━'], ms: TELOP_MS, dim: 1, size: undefined, click: true, hold: undefined }]);
});

test('押して消さない指定なら、**必ず時間で消す**（書かなければ 1000）', async () => {
  const one = stub();
  await runCommands(run({ type: 'telop', lines: ['━ 翌朝 ━'], click: false }), one.ctx);
  strictEqual(one.telops[0].click, false);
  // ここが undefined だと、押せないうえに消えない——話がそこで止まる。
  strictEqual(one.telops[0].hold, TELOP_HOLD);
});

test('時間を書けばその時間。押して消せるかとは別に効く', async () => {
  const one = stub();
  await runCommands(run({ type: 'telop', lines: ['a'], hold: 2500 }), one.ctx);
  await runCommands(run({ type: 'telop', lines: ['b'], click: false, hold: 400 }), one.ctx);
  deepStrictEqual(
    one.telops.map((entry) => [entry.click, entry.hold]),
    [
      [true, 2500],
      [false, 400],
    ],
  );
});

test('字の大きさ・消える時間・黒さは書いたとおりに渡る', async () => {
  const one = stub();
  await runCommands(run({ type: 'telop', lines: ['a'], size: 40, ms: 1200, dim: 0.7 }), one.ctx);
  deepStrictEqual(one.telops[0], { lines: ['a'], ms: 1200, dim: 0.7, size: 40, click: true, hold: undefined });
});

// 押さずに送る会話（GS-172）。旧作の「お知らせの窓」。
test('会話の「時間で消す」はそのまま画面側へ渡る。書かなければ渡さない', async () => {
  const one = stub();
  await runCommands(run({ type: 'message', talk: [{ lines: ['ラミィが仲間になった！！'] }], hold: 1500 }), one.ctx);
  await runCommands(run({ type: 'message', talk: [{ lines: ['ふつうの会話'] }] }), one.ctx);
  deepStrictEqual(
    one.talks.map((entry) => entry.hold),
    [1500, undefined],
  );
});
