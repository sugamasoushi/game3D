// ゲームの題名を台帳から読む（サーバ側。2026-10-31）。ブラウザのタブ（`layout.tsx`）とホーム画面のアプリ名（`manifest.ts`）。
// 静的書き出しでは書き出しのときに 1 回、`next dev` では頼まれるたびに読むので、台帳エディタで変えて読み直せば出る。
// 決まりは `src/game/gameTitle.ts`。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { titleOf } from '../src/game/gameTitle';

export function readGameTitle(): string {
  try {
    return titleOf(JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'opening.json'), 'utf8')));
  } catch {
    // 台帳が無い・壊れているときも、画面と同じ既定の題名で出す（壊れは Game Checker が知らせる）。
    return titleOf(null);
  }
}
