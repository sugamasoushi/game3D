// 隣のフォルダの名前（GS-56）。**名前を書くのはここだけ。**
//
// このゲームのフォルダ名は変わることがある（`SampleGame` → 本当の題名）。
// 名前を道具のあちこちに散らすと、変えたときに 1 つ取り残して
// **黙って動かなくなる**——今回「マップに置いたのに移動できない」で 1 度やった。
//
// **中の構成は変わらない前提。** `public/mapdata` や `public/data/events` の
// 並びはここでは扱わない——変えるならそちらは各道具の仕事。
//
// このゲーム側は**自分の居場所から辿る**ので、フォルダ名を変えても何も起きない。
// 名前が要るのは**隣のエディタ**を指すときだけ。

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** このゲームの根（`tools/` の 1 つ上）。フォルダ名に依らない。 */
export const GAME_ROOT = resolve(import.meta.dirname, '..');

/** 隣に置いてある 3D マップエディタのフォルダ名。**変わったらここを直す。** */
export const EDITOR_DIR = '3D Map Editor';

/** その名前を上書きする環境変数。一時的に別の場所を見たいとき用。 */
export const EDITOR_ENV = 'MAP_EDITOR_DIR';

/**
 * マップエディタの根を決める。**引数 → 環境変数 → 隣の `EDITOR_DIR`** の順。
 * イベントエディタが相手のゲームを決めるのと同じ順番にしてある。
 */
export function editorRoot(argument) {
  return resolve(argument ?? process.env[EDITOR_ENV] ?? join(GAME_ROOT, '..', EDITOR_DIR));
}

/**
 * そこが本当にマップエディタか。**目印は `public/mapdata`。**
 * 見当違いの場所を指したまま「0 個写した」と言われると、原因が分からない。
 */
export function looksLikeEditor(root) {
  return existsSync(join(root, 'public', 'mapdata'));
}
