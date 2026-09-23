// [凍結 BPE-15] 戦闘演出エディタの味方ごとのカメラ割り当て（BPE-12）の試験。
// 引き当て（`battlePresentationBinding`）をコメントアウトしたので、試験も外して残す。
import test from 'node:test';

test.skip('[凍結 BPE-15] コマンド画面は何人目の割り当てを優先し、無ければ全員共通を使う（BPE-12）', () => {});

// import test from 'node:test';
// import assert from 'node:assert/strict';
// import { battlePresentationBinding, previewBattlePresentation } from '../src/game/battle/presentation';

// test('コマンド画面は何人目の割り当てを優先し、無ければ全員共通を使う（BPE-12）', () => {
  // previewBattlePresentation({
    // version: 1,
    // bindings: {
      // 'command.attack.open': 'common_cue',
      // 'command.attack.open@2': 'second_cue',
      // 'battle.start': 'start_cue',
    // },
  // });
  // assert.deepEqual(battlePresentationBinding('command.attack.open', 2), { key: 'command.attack.open@2', cue: 'second_cue' });
  // assert.deepEqual(battlePresentationBinding('command.attack.open', 1), { key: 'command.attack.open', cue: 'common_cue' });
  // assert.deepEqual(battlePresentationBinding('command.attack.open'), { key: 'command.attack.open', cue: 'common_cue' });
  // // 人ごとに分けない契機は、何人目を渡しても共通のキーだけを見る。
  // assert.deepEqual(battlePresentationBinding('battle.start', 2), { key: 'battle.start', cue: 'start_cue' });
  // assert.deepEqual(battlePresentationBinding('command.skill.open', 3), { key: 'command.skill.open', cue: '' });
// });
