// EXE を作る（`npm run electron:build` / `electron:pack` の後半。2026-10-31）。
// EXE のファイル名（electron-builder の `productName`）を、ゲームの題名（`opening.json` の `title`）にして electron-builder を呼ぶ。
// 引数はそのまま electron-builder へ渡す。題名の決まりは `src/game/gameTitle.ts` の写し。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

/** 題名。台帳が無い・空なら既定（`DEFAULT_TITLE`）。 */
function gameTitle() {
  try {
    const title = JSON.parse(readFileSync(new URL('../public/data/opening.json', import.meta.url), 'utf8')).title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  } catch {
    // 下の既定へ。
  }
  return 'ちょっとだけ RPG';
}

/** ファイル名に使えない文字は `_` に（Windows）。 */
export const fileSafe = (text) => text.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '') || 'game';

const productName = fileSafe(gameTitle());
console.log(`EXE の名前: ${productName}`);
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...process.argv.slice(2), `-c.productName=${productName}`], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
