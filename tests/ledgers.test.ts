// 台帳の設定値（2026-09-22）。**手で書いた値も検査する。**
//
// 台帳エディタ（5931）は保存のときに `validate.mjs` を通すが、
// **手で書き換えた台帳は誰も見ていない**——`actors.json` に 2 人を直に足したときも、
// 画面が出るまで正しいか分からなかった。同じ検査をここでも回して `npm test` で気づけるようにする。
//
// **台帳エディタが無くても落ちない。** ゲームは単体で持ち出せる約束（GS-56）なので、
// 隣のフォルダが無ければこのテストは飛ばす。

import { strictEqual } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'public', 'data');
const SHEET_DIR = join(ROOT, 'public', 'assets', 'spritesheet');
const VALIDATE = join(ROOT, '..', 'Ledger Editor', 'validate.mjs');
const read = (name: string) => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

interface Validators {
  validateSpriteSheetBook(book: unknown, options?: unknown): unknown;
  validateActorBook(book: unknown, options?: unknown): unknown;
  validateBattleSettings(book: unknown, options?: unknown): unknown;
  validateUiSounds(ui: unknown, options?: unknown): unknown;
}

test('台帳の値が台帳エディタの検査を通る（区切り・立ち姿・戦闘の設定・UI の音）', async (t) => {
  if (!existsSync(VALIDATE)) {
    t.skip('隣に台帳エディタが無いので飛ばします');
    return;
  }
  const { validateSpriteSheetBook, validateActorBook, validateBattleSettings, validateUiSounds } = (await import(
    pathToFileURL(VALIDATE).href
  )) as Validators;
  const files = readdirSync(SHEET_DIR).filter((name) => /\.(png|webp)$/i.test(name));
  const sheets = read('spriteSheets.json').sheets ?? {};
  const sounds = new Set(Object.keys(read('sounds.json').sounds ?? {}));
  const effects = new Set(Object.keys(read('effects.json').effects ?? {}));
  // 区切り → 立ち姿の順。立ち姿は区切りを見るので、先に区切りが正しいことを確かめる。
  validateSpriteSheetBook({ sheets }, { files });
  validateActorBook({ actors: read('actors.json').actors ?? {} }, { files, sheets });
  const battle = read('battleSettings.json');
  validateBattleSettings(battle, { sounds, effects });
  if (battle.ui) validateUiSounds(battle.ui, { sounds });
});

test('置いてある絵が全部そろっている（tools/checkAssets.mjs）', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'checkAssets.mjs')], { encoding: 'utf8' });
  // 落ちたときは**道具の言い分をそのまま**出す。どの絵が足りないかはあちらが知っている。
  strictEqual(run.status, 0, `\n${run.stdout}${run.stderr}`);
});
