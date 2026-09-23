// エディタで作ったマップをゲームへ写す（GS-56）。
//
// マップは 3D マップエディタ（5925）が `public/mapdata/` に書き、ゲームは**自分の**
// `public/mapdata/` しか読まない。同じ物が 2 つあるのは
// **ゲームを単体で持ち出せるようにする**ため（zip で渡しても、別の PC でも動く）。
// その代わり、エディタで保存しただけでは**ゲームに反映されない**。
//
// **黙って失敗するのが厄介なところ。** マップに入口を置いてゲームで踏んでも、
// 写していなければ何も起きず、エラーも出ない（実測で 1 度やった）。だから写した物を 1 行ずつ出す。
//
// **写すのは台帳（`public/data/maps.json`）に載っているマップだけ。** エディタ側には
// `untitled.json` や `trial.json` のような下書きが溜まる。全部持って行くと、
// ゲームのフォルダが**遊ばないマップ**で埋まる。どれを使うかを決めるのは台帳（GS-17）。
//
// **絵は写さない。** 足りない絵は `npm run check:assets` が名前を挙げる（GS-15）——
// 「教える役」と「黙って埋める役」を混ぜると、写し漏れに気づけなくなる。
// 絵はマップエディタの保存・登録のときに写り、写した名前が画面に出る（GS-100）。この道具は写さない。
//
// 使い方:
//   node tools/syncMaps.mjs              隣の 3D Map Editor から写す
//   node tools/syncMaps.mjs ../別の場所   場所を指定する
//   node tools/syncMaps.mjs --dry        写さずに、写る物だけ挙げる

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EDITOR_DIR, EDITOR_ENV, GAME_ROOT, editorRoot, looksLikeEditor } from './folders.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const FROM = editorRoot(args.find((value) => !value.startsWith('--')));
const TO = join(GAME_ROOT, 'public', 'mapdata');

if (!looksLikeEditor(FROM)) {
  console.error(`マップエディタが見つかりません: ${FROM}`);
  console.error(`  隣の「${EDITOR_DIR}」を見ています。名前が違うなら:`);
  console.error('    node tools/syncMaps.mjs ../<エディタのフォルダ>');
  console.error(`  または環境変数 ${EDITOR_ENV} で。`);
  process.exit(1);
}

const SOURCE = join(FROM, 'public', 'mapdata');
if (!existsSync(TO)) mkdirSync(TO, { recursive: true });

// 台帳（GS-17）。ここに載っているファイルだけを写す。
const LEDGER = join(GAME_ROOT, 'public', 'data', 'maps.json');
if (!existsSync(LEDGER)) {
  console.error(`マップの台帳がありません: ${LEDGER}`);
  process.exit(1);
}
const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')).maps ?? {};
const maps = [...new Set(Object.values(ledger).map((entry) => entry.file).filter(Boolean))].sort();
if (maps.length === 0) {
  console.error(`台帳にマップが 1 枚も載っていません: ${LEDGER}`);
  process.exit(1);
}

/** 中身が同じか。**時刻では見ない**——写しただけで時刻は変わるので。 */
const same = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b));

let copied = 0;
let skipped = 0;
let lost = 0;
for (const name of maps) {
  const from = join(SOURCE, name);
  const to = join(TO, name);
  // 台帳に載っているのにエディタ側に無い。**黙って飛ばさない**——
  // 名前を打ち間違えたのか、まだ描いていないのか、ここでしか気づけない。
  if (!existsSync(from)) {
    lost += 1;
    console.log(`✗ エディタ側に無い  ${name}`);
    continue;
  }
  if (same(from, to)) {
    skipped += 1;
    continue;
  }
  const label = existsSync(to) ? '更新' : '新規';
  const when = new Date(statSync(from).mtime).toLocaleString('ja-JP');
  console.log(`${dry ? '· ' : '→ '}${label}  ${name}  (${when})`);
  if (!dry) copyFileSync(from, to);
  copied += 1;
}

console.log('');
console.log(`${FROM}`);
console.log(`  ==> ${TO}`);
console.log(`台帳の ${maps.length} 枚を見ました。`);
if (lost > 0) console.log(`${lost} 枚がエディタ側にありません（maps.json の file を確かめてください）。`);
if (copied === 0) {
  console.log(`変わったマップはありません（${skipped} 枚とも同じ）。`);
} else if (dry) {
  console.log(`${copied} 枚が写ります。実際に写すには --dry を外してください。`);
} else {
  console.log(`${copied} 枚写しました。ブラウザを再読み込みすれば効きます（再起動は要りません）。`);
  console.log('新しい絵を使ったマップなら、絵を写してから npm run index:files → npm run check:assets。');
}
process.exit(lost ? 1 : 0);
