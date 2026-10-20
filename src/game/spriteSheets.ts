// スプライトシート（コマに区切って使う画像）の台帳（GS-121）。
//
// **区切りは画像が持つ。** キャラの立ち姿（`actors.json`）も攻撃の絵（`effects.json`）も、
// 画像の名前だけを書いて、1 コマの大きさ・横のコマ数・縦の行数はここから引く——
// 同じ画像をキャラと攻撃の両方で使っても、区切りを二度書かずに済む。
//
// 画像の置き場は `assets/spritesheet/` の 1 か所（GS-121）。その中はフォルダに分けてよく、台帳のキーはそこからの道（GS-258）。

import { assetUrl } from './assets';

/** 画像の置き場。**ここ 1 か所**。 */
export const SHEET_DIR = 'assets/spritesheet';

/** 画像 1 枚のコマの区切り。 */
export interface SpriteSheetDef {
  /** 1 コマの大きさ（px）。 */
  frameWidth: number;
  frameHeight: number;
  /** 横のコマ数（これで折り返す）。 */
  columns: number;
  /** 縦の行数。 */
  rows: number;
  /**
   * 足元が 1 コマの下端から何画素上にあるか（GS-52）。人の絵として立てるときだけ、絵をそのぶん下げる。
   * 余白は**画像の性質**なので区切りと一緒に持つ（2026-10-11）。立ち姿の行が無い画像にも効く。
   */
  footPx?: number;
}

let sheets: Record<string, SpriteSheetDef> = {};
let pending: Promise<void> | undefined;

/** 台帳を読む。**1 回だけ読んで使い回す**。 */
export function loadSpriteSheets(): Promise<void> {
  return (pending ??= fetch(assetUrl('data/spriteSheets.json'))
    .then((response) => (response.ok ? (response.json() as Promise<{ sheets?: Record<string, SpriteSheetDef> }>) : null))
    .then((file) => {
      if (file?.sheets) sheets = file.sheets;
    })
    .catch((error) => {
      // 読めなくても止めない。区切りの分からない画像は出さないだけ。
      console.warn('[spriteSheets] 台帳を読めなかった', error);
      pending = undefined;
    }));
}

/** その画像の区切り。台帳に無ければ null。 */
export function spriteSheet(file: string): SpriteSheetDef | null {
  return sheets[file] ?? null;
}

/** 画像の URL。名前は `assets/spritesheet/` からの道（フォルダの中なら `chara/meina_01.png`。GS-258）。 */
export function sheetUrl(file: string): string {
  // 絵はフォルダに分けてよい（GS-258。`chara/meina_01.png`）。`/` は残して 1 段ずつ符号化する。
  return assetUrl(`${SHEET_DIR}/${file.split('/').map(encodeURIComponent).join('/')}`);
}

/** 台帳の中身（編集用の入口から差し替えるときだけ使う）。 */
export function previewSpriteSheets(next: Record<string, SpriteSheetDef>): void {
  sheets = structuredClone(next);
}
