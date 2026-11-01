// ゲームの題名（2026-10-31）。**正本はオープニングの台帳 `opening.json` の `title`**（台帳エディタの「オープニング・おまけ」）。
// タイトル画面の文字・ブラウザのタブ・ホーム画面のアプリ名・Electron の窓の名前・EXE のファイル名に使う。
// 読む所: 画面は `opening.ts`、タブとアプリ名は `app/gameTitle.ts`、窓は `electron/main.mjs`、EXE は `tools/electronBuild.mjs`。
// 窓と EXE の側は JS なので同じ決まりを手で写している。決まりを変えたらそちらも直す。

/** 台帳が無い・題名が空のときの題名。 */
export const DEFAULT_TITLE = 'ちょっとだけ RPG';

/** 台帳（`opening.json` の中身）から題名を取る。空白だけ・文字でないなら既定。前後の空白は落とす。 */
export function titleOf(book: unknown): string {
  const title = (book as { title?: unknown } | null | undefined)?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_TITLE;
}
