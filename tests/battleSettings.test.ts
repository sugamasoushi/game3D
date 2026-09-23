import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyBattleSettings, battleSettings, DEFAULT_BATTLE_SETTINGS } from '../src/game/battle/settings';

test('戦闘共通の設定は台帳の値を使い、壊れた値は既定値に戻す（GS-106）', () => {
  const applied = applyBattleSettings({ bgm: 'boss', se: { hit: 'strike', dodge: '' }, ms: { say: 1200, beat: -1, lean: 'x' }, extra: 1 });
  assert.equal(applied.bgm, 'boss');
  assert.equal(applied.se.hit, 'strike');
  assert.equal(applied.se.dodge, DEFAULT_BATTLE_SETTINGS.se.dodge);
  assert.equal(applied.ms.say, 1200);
  assert.equal(applied.ms.beat, DEFAULT_BATTLE_SETTINGS.ms.beat);
  assert.equal(applied.ms.lean, DEFAULT_BATTLE_SETTINGS.ms.lean);
  assert.equal(battleSettings(), applied);
  assert.deepEqual(applyBattleSettings(null), DEFAULT_BATTLE_SETTINGS);
  // 同梱の台帳は既定値と同じ（敵の攻めかかる音は punch。GS-113）。
  const book = JSON.parse(readFileSync(new URL('../public/data/battleSettings.json', import.meta.url), 'utf8'));
  assert.deepEqual(applyBattleSettings(book), DEFAULT_BATTLE_SETTINGS);
});
