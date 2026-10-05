// 条件命令の `else if`（GS-196）。**最初に当たった枝だけ**動き、どれにも当たらなければ `else`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommands, type EventContext } from '../src/event/interpreter';
import type { EventCommand } from '../src/event/types';

/** フラグと変数だけ持つ道具立て。`script` の id で、どの枝が動いたかを数える。 */
const contextOf = (switches: Record<string, boolean>, variables: Record<string, number>, ran: string[]) =>
  ({
    getSwitch: (key: string) => switches[key] ?? true,
    getSelfSwitch: () => false,
    getVariable: (key: string) => variables[key] ?? 0,
    script: async (id: string) => {
      ran.push(id);
    },
  }) as unknown as EventContext;

const branchy: EventCommand = {
  type: 'if',
  when: { switch: 'A', is: false },
  then: [{ type: 'script', id: '1' }],
  elif: [
    { when: { variable: 'n', op: '>=', value: 3 }, then: [{ type: 'script', id: '2' }] },
    { when: { switch: 'B' }, then: [{ type: 'script', id: '3' }] },
  ],
  else: [{ type: 'script', id: 'else' }],
};

test('if / else if / else は上から順に見て、最初に当たった枝だけ動く', async () => {
  const run = async (switches: Record<string, boolean>, variables: Record<string, number>) => {
    const ran: string[] = [];
    await runCommands([branchy], contextOf(switches, variables, ran));
    return ran;
  };
  assert.deepEqual(await run({ A: false }, { n: 5 }), ['1'], '条件 1 に当たれば後ろは見ない');
  assert.deepEqual(await run({ A: true }, { n: 5 }), ['2']);
  assert.deepEqual(await run({ A: true, B: true }, { n: 0 }), ['3']);
  assert.deepEqual(await run({ A: true, B: false }, { n: 0 }), ['else'], 'どれにも当たらなければ上記以外');
});

test('条件の並びは全部満たしたときだけ当たり（&&。GS-197）', async () => {
  const run = async (switches: Record<string, boolean>, n: number) => {
    const ran: string[] = [];
    await runCommands(
      [
        {
          type: 'if',
          when: [{ switch: 'A', is: false }, { variable: 'n', op: '>=', value: 3 }],
          then: [{ type: 'script', id: 'both' }],
          elif: [{ when: [{ switch: 'B' }], then: [{ type: 'script', id: 'B' }] }],
          else: [{ type: 'script', id: 'else' }],
        },
      ],
      contextOf(switches, { n }, ran),
    );
    return ran;
  };
  assert.deepEqual(await run({ A: false }, 5), ['both']);
  assert.deepEqual(await run({ A: false, B: false }, 1), ['else'], '片方だけでは当たらない');
  assert.deepEqual(await run({ A: true, B: true }, 5), ['B']);
});

test('elif を書かない今までの if はそのまま動く', async () => {
  const ran: string[] = [];
  await runCommands(
    [{ type: 'if', when: { switch: 'A' }, then: [{ type: 'script', id: 'then' }], else: [{ type: 'script', id: 'else' }] }],
    contextOf({ A: false }, {}, ran),
  );
  assert.deepEqual(ran, ['else']);
});
