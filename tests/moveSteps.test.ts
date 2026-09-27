// 「移動（方向指定）」の歩き方（GS-158）。
//
// **画面では「なんとなく違う所に居る」としか見えない。** 前後左右を取り違えても、
// 1 歩目で折り返しても、動いてはいるので気づきにくい。歩く向きの並びをここで留める。

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { runCommands } from '../src/event/interpreter';
import type { EventContext } from '../src/event/interpreter';
import type { ActorRef, EventCommand, Step } from '../src/event/types';

/** 歩いた向きを控えるだけの器。**歩くたびに向きが変わる**ところまで真似る。 */
function stub(facing: Step = 'down') {
  const steps: Step[] = [];
  /** カメラ追従の切り替え（GS-165）。**呼ばれた順に**控える。 */
  const follows: boolean[] = [];
  /** 足踏みの指示（GS-168 / GS-169）。**どの口を叩いたか**を控える。 */
  const marches: string[] = [];
  let now = facing;
  let asked = 0;
  const ctx = {
    cameraFollow(on: boolean) {
      follows.push(on);
    },
    async stepInPlace(target: ActorRef, dir: Step | undefined, count: number, run: boolean) {
      marches.push(`踏む ${target} ${dir ?? 'そのまま'} ${count}${run ? ' 走る' : ''}`);
    },
    keepStepInPlace(target: ActorRef, dir: Step | undefined, run: boolean) {
      marches.push(`ずっと ${target} ${dir ?? 'そのまま'}${run ? ' 走る' : ''}`);
    },
    stopStepInPlace(target: ActorRef) {
      marches.push(`止める ${target}`);
    },
    async step(_target: ActorRef, dir: Step) {
      steps.push(dir);
      // ふつうの歩きは進む方を向く。ここが「1 歩ごとに解き直す」と折り返す仕掛け。
      now = dir;
    },
    facingOf: () => {
      asked += 1;
      return now;
    },
    routeTo: () => ['up', 'up', 'left'] as Step[],
  } as unknown as EventContext;
  return { ctx, steps, follows, marches, asked: () => asked };
}

const move = (cmd: Partial<EventCommand> & Record<string, unknown>): EventCommand[] =>
  [{ type: 'move', target: 'player', ...cmd }] as unknown as EventCommand[];

test('行き先（座標）で書いた「移動」は、今までどおり道順をそのまま歩く', async () => {
  const one = stub();
  await runCommands(move({ to: { x: 3, y: 0, z: 1 } }), one.ctx);
  deepStrictEqual(one.steps, ['up', 'up', 'left']);
  strictEqual(one.asked(), 0, '座標で書いたときは向きを聞かない');
});

test('向きと歩数で書くと、**曲がらずまっすぐ**その数だけ歩く', async () => {
  const one = stub();
  await runCommands(move({ dir: 'left', cells: 3 }), one.ctx);
  deepStrictEqual(one.steps, ['left', 'left', 'left']);
  // マス数を省いたら 1 マス。
  const two = stub();
  await runCommands(move({ dir: 'up' }), two.ctx);
  deepStrictEqual(two.steps, ['up']);
});

test('前後左右（relative）は**向いている方から見た向き**に直す', async () => {
  // 下を向いている人の「前」は画面の下、「後ろ」は上、「右」は画面の左。
  const cases: Array<[Step, Step, Step]> = [
    ['down', 'up', 'down'],
    ['down', 'down', 'up'],
    ['down', 'right', 'left'],
    ['down', 'left', 'right'],
    ['up', 'up', 'up'],
    ['up', 'down', 'down'],
    ['left', 'up', 'left'],
    ['left', 'right', 'up'],
    ['right', 'down', 'left'],
  ];
  for (const [facing, relative, want] of cases) {
    const one = stub(facing);
    await runCommands(move({ dir: relative, cells: 1, relative: true }), one.ctx);
    deepStrictEqual(one.steps, [want], `${facing} を向いて ${relative}`);
  }
});

test('前後左右は**動き出す前に 1 度だけ**解く（「後ろへ 3 マス」が折り返さない）', async () => {
  const one = stub('up');
  await runCommands(move({ dir: 'down', cells: 3, relative: true }), one.ctx);
  // 上を向いている人の後ろ＝画面の下。3 マスとも同じ向き。
  deepStrictEqual(one.steps, ['down', 'down', 'down']);
  strictEqual(one.asked(), 1, '向きを聞くのは 1 回だけ');
});

// カメラ追従（GS-166）。**別の命令**で切り替える——移動の欄に付けると、
// 「置き直す」を 2 つ並べたときに 2 つ目の「追う」で画面が跳ね返ってしまう。
test('「移動」はカメラ追従を触らない。切り替えるのは「カメラ追従」の命令だけ', async () => {
  const one = stub();
  await runCommands(move({ dir: 'down', cells: 2 }), one.ctx);
  deepStrictEqual(one.follows, [], '移動そのものは追従を触らない');

  const two = stub();
  await runCommands(
    [
      { type: 'cameraFollow', on: false },
      { type: 'move', target: 'player', dir: 'down', cells: 2 },
      { type: 'cameraFollow', on: true },
    ] as unknown as EventCommand[],
    two.ctx,
  );
  deepStrictEqual(two.follows, [false, true], '書いた所だけが効く');
  deepStrictEqual(two.steps, ['down', 'down']);
});

// その場で足踏み（GS-168 / GS-169）。**画面では「動いていない」としか見えない**ので、
// どの口を叩いたか（数えて踏む／ずっと／止める）をここで留める。
test('足踏みは既定 4 歩。歩数を書けばその数だけ', async () => {
  const one = stub();
  await runCommands([{ type: 'stepInPlace', target: 'player' }] as unknown as EventCommand[], one.ctx);
  await runCommands(
    [{ type: 'stepInPlace', target: 'npc:x', dir: 'up', steps: 8, run: true }] as unknown as EventCommand[],
    one.ctx,
  );
  deepStrictEqual(one.marches, ['踏む player そのまま 4', '踏む npc:x up 8 走る']);
});

test('「ずっと」は数えず、**待たない**（止めるまで踏み続ける）', async () => {
  const one = stub();
  await runCommands(
    [
      { type: 'stepInPlace', target: 'npc:x', always: true },
      { type: 'stepInPlace', target: 'npc:x', stop: true },
    ] as unknown as EventCommand[],
    one.ctx,
  );
  deepStrictEqual(one.marches, ['ずっと npc:x そのまま', '止める npc:x']);
});

test('「止める」は歩数や「ずっと」が残っていても**止める方が勝つ**', async () => {
  // 欄を消し忘れたまま「止める」に入れ替えたとき、踏み直してしまわないように。
  const one = stub();
  await runCommands(
    [{ type: 'stepInPlace', target: 'npc:x', dir: 'down', steps: 4, always: true, stop: true }] as unknown as EventCommand[],
    one.ctx,
  );
  deepStrictEqual(one.marches, ['止める npc:x']);
});
