// 置いてある物の台帳を作る（GS-26 / DEC-374）。**探して確かめるのをやめる。**
//
// ゲームは「この絵の法線マップは在るか」「このマップにイベント JSON は在るか」を、
// **取得して確かめて**いた。無ければ 404 が返るだけ——のはずが、
// **Next の開発サーバは 404 に HTML を組み立てて返す**ので 1 本 100〜500ms かかる。
// 法線マップの候補は 1 枚につき 3 本あり、マップ 1 枚で 50 本を超える。
// 実測で HomeForest の組み立てが **32 秒**になっていた（Vite の 404 は 4ms なのでエディタでは出ない）。
//
// ここで**在るファイルの一覧**を書き出しておけば、ゲームは 1 本も無駄に取りに行かない。
// 本番（静的書き出し）でも無駄な要求がそのぶん消える。
//
// **ファイルを足したら回すこと**（`npm run index:files`）。`npm run check:assets` が古さを教える。
//
// 使い方: node tools/fileIndex.mjs

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'data', 'files.json');

/** Windows の区切り。台帳では / に揃える。 */
const SEP = String.fromCharCode(92);
/** 絵として扱う拡張子。 */
const IMAGE = /\.(png|jpg|jpeg|webp)$/i;

/** 法線マップを探す場所。ここの下にしか置かない。 */
const NORMAL_DIRS = ['assets/tilesets_normal', 'assets/tilesets'];
/** イベント JSON の置き場所。 */
const EVENT_DIR = 'data/events';

/** 下まで全部数える。 */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const asPublicPath = (full) => relative(PUBLIC, full).split(SEP).join('/');

/** 法線マップ。`tilesets/` の下は `_normal` が付くものだけ拾う。 */
const normals = [];
for (const dir of NORMAL_DIRS) {
  for (const full of walk(join(PUBLIC, dir))) {
    if (!IMAGE.test(full)) continue;
    const rel = asPublicPath(full);
    if (rel.startsWith('assets/tilesets/') && !/_normal\.[^.]+$/i.test(rel)) continue;
    normals.push(rel);
  }
}
normals.sort();

/** イベント JSON。名前はマップのファイル名から `.json` を取ったもの。 */
const events = walk(join(PUBLIC, EVENT_DIR))
  .filter((full) => full.endsWith('.json'))
  .map((full) => asPublicPath(full).slice(`${EVENT_DIR}/`.length).replace(/\.json$/i, ''))
  .sort();

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      infomation: '置いてある物の一覧（DEC-374）。node tools/fileIndex.mjs で作り直す。',
      normals,
      events,
    },
    null,
    2,
  )}\n`,
);
console.log(`法線 ${normals.length} 枚 / イベント ${events.length} 本を data/files.json に書いた。`);
