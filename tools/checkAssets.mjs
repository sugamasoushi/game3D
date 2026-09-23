// マップが要る絵が `public/` に揃っているか調べる（GS-15）。
//
// 絵はマップエディタが保存・登録のときに写す（GS-100）が、**写し漏れは画面で気づきにくい**ので見張りを残す——
// タイルは白いまま出るし、背景は黙って消えるだけで、エラーも出ない。
// `npm run check:assets` で先に気づけるようにする。
//
// 使い方: node tools/checkAssets.mjs

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EDITOR_DIR, editorRoot, looksLikeEditor } from './folders.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const MAPS = join(PUBLIC, 'mapdata');
const ACTORS = join(PUBLIC, 'data', 'actors.json');
/** スプライトシートの台帳（GS-121）。絵は `assets/spritesheet/` にしか置かない。 */
const SHEETS = join(PUBLIC, 'data', 'spriteSheets.json');
const SHEET_DIR = 'assets/spritesheet';
const CHARACTERS = join(PUBLIC, 'data', 'characterdata.json');
const SOUNDS = join(PUBLIC, 'data', 'sounds.json');
/** オープニングの絵（GS-126）。**抜けても黙って何も出ないだけ**なので、ここで見る。 */
const OPENING = join(PUBLIC, 'data', 'opening.json');
/** 敵の立ち絵（GS-60）。人と同じ棚（CharaStand）に居る。 */
const ENEMIES = join(PUBLIC, 'data', 'enemies.json');
/** 文字（GS-20）。無いと黙って別のフォントで出る。 */
const FONTS = ['assets/fonts/PixelMplus10-Regular.ttf', 'assets/fonts/PixelMplus10-Bold.ttf'];

/** `assets/...` も `/assets/...` も `public/` からの相対として見る。 */
const publicPath = (src) => join(PUBLIC, src.replace(/^\/+/, ''));

let missing = 0;
let checked = 0;

for (const file of readdirSync(MAPS).filter((name) => name.endsWith('.json'))) {
  const map = JSON.parse(readFileSync(join(MAPS, file), 'utf8'));
  const want = new Set();

  // タイルセットの絵。法線は在れば使う程度なので見ない。
  for (const texture of map.assets?.textures ?? []) {
    // 1x1 の単色は組み込み。ファイルは要らない。
    if (!texture.src || texture.src === 'solid-1x1.png') continue;
    want.add(texture.src);
  }
  // 書き割り（空の絵）。
  const sky = map.view?.backdrop?.src;
  if (sky) want.add(`assets/backscreen/${sky}`);
  // 置いた 3D。
  for (const layer of map.layers ?? []) {
    for (const model of layer.models ?? []) {
      if (model.file) want.add(`assets/models/${model.file}`);
    }
  }
  // 立っている人の絵（GS-148）。オブジェクトの `Sprite`（`pipo-charachip030.png#32x32#1`）。
  //
  // **エディタの自動写し（GS-100）はここを写さない。** タイルや 3D は写るのに
  // キャラの絵だけエディタ側にしか無い、という形になりやすく、
  // ゲームでは**その人が出ないだけ**（絵の要求が 404 になる）で何も言われない。
  for (const layer of map.layers ?? []) {
    for (const object of layer.objects ?? []) {
      for (const property of object.properties ?? []) {
        if (property.name !== 'Sprite' || typeof property.value !== 'string') continue;
        const sheet = property.value.split('#')[0].trim();
        if (sheet) want.add(`${SHEET_DIR}/${sheet}`);
      }
    }
  }

  const gone = [...want].filter((src) => !existsSync(publicPath(src)));
  checked += want.size;
  if (gone.length) {
    missing += gone.length;
    console.log(`✗ ${file}`);
    for (const src of gone) console.log(`    ${src}`);
  } else {
    console.log(`✓ ${file}  (${want.size} 個)`);
  }
}

// スプライトシート（GS-121）。**キーがそのままファイル名**で、置き場所は 1 か所だけ。
const sheetBook = existsSync(SHEETS) ? JSON.parse(readFileSync(SHEETS, 'utf8')).sheets ?? {} : {};
if (existsSync(SHEETS)) {
  const gone = Object.keys(sheetBook).filter((file) => !existsSync(publicPath(`${SHEET_DIR}/${file}`)));
  checked += Object.keys(sheetBook).length;
  if (gone.length) {
    missing += gone.length;
    console.log('✗ data/spriteSheets.json');
    for (const file of gone) console.log(`    ${SHEET_DIR}/${file}`);
  } else {
    console.log(`✓ data/spriteSheets.json  (${Object.keys(sheetBook).length} 枚)`);
  }
}

// キャラの絵（GS-16 / GS-121）。無いと**白い板**が立つだけで、原因が分かりにくい。
// `sheet` は**台帳のキー**（ファイル名）なので、置き場所を足してから見る。
if (existsSync(ACTORS)) {
  const book = JSON.parse(readFileSync(ACTORS, 'utf8'));
  const gone = [];
  for (const [key, entry] of Object.entries(book.actors ?? {})) {
    checked += 1;
    if (!existsSync(publicPath(`${SHEET_DIR}/${entry.sheet}`))) gone.push(`${key}: ${SHEET_DIR}/${entry.sheet}`);
    // 絵は在っても台帳に無ければ、コマの大きさが分からず 1 枚絵のまま出る。
    else if (!sheetBook[entry.sheet]) gone.push(`${key}: ${entry.sheet} がスプライトシートの台帳に無い`);
  }
  if (gone.length) {
    missing += gone.length;
    console.log('✗ data/actors.json');
    for (const line of gone) console.log(`    ${line}`);
  } else {
    console.log(`✓ data/actors.json  (${Object.keys(book.actors ?? {}).length} 人)`);
  }
}

// 立ち絵（GS-20）。`characterdata.json` の normal / smile / unger と、顔アイコン。
if (existsSync(CHARACTERS)) {
  const book = JSON.parse(readFileSync(CHARACTERS, 'utf8'));
  const gone = [];
  let shown = 0;
  for (const [key, entry] of Object.entries(book)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const face of ['normal', 'smile', 'unger', 'menu']) {
      if (!entry[face]) continue;
      shown += 1;
      const src = `assets/img/CharaStand/${entry[face]}.png`;
      if (!existsSync(publicPath(src))) gone.push(`${key}.${face}: ${src}`);
    }
    if (entry.icon) {
      shown += 1;
      const src = `assets/img/charIcon/${entry.icon}.png`;
      if (!existsSync(publicPath(src))) gone.push(`${key}.icon: ${src}`);
    }
  }
  checked += shown;
  if (gone.length) {
    missing += gone.length;
    console.log('✗ data/characterdata.json');
    for (const line of gone) console.log(`    ${line}`);
  } else {
    console.log(`✓ data/characterdata.json  (立ち絵とアイコン ${shown} 枚)`);
  }
}

// 敵の立ち絵（GS-60）。無いと戦闘で名前だけが並ぶ——絵が抜けても止まらないので気づきにくい。
if (existsSync(ENEMIES)) {
  const book = JSON.parse(readFileSync(ENEMIES, 'utf8')).enemies ?? {};
  const gone = [];
  let shown = 0;
  for (const [key, entry] of Object.entries(book)) {
    if (!entry?.image) continue;
    shown += 1;
    const src = `assets/img/CharaStand/${entry.image}.png`;
    if (!existsSync(publicPath(src))) gone.push(`${key}: ${src}`);
  }
  checked += shown;
  if (gone.length) {
    missing += gone.length;
    console.log('✗ data/enemies.json');
    for (const line of gone) console.log(`    ${line}`);
  } else {
    console.log(`✓ data/enemies.json  (敵の立ち絵 ${shown} 枚)`);
  }
}

// 音（GS-21）。台帳に書いたファイルが在るか。
if (existsSync(SOUNDS)) {
  const book = JSON.parse(readFileSync(SOUNDS, 'utf8')).sounds ?? {};
  const gone = [];
  for (const [key, entry] of Object.entries(book)) {
    checked += 1;
    const src = `assets/sound/${entry.file}`;
    if (!existsSync(publicPath(src))) gone.push(`${key}: ${src}`);
  }
  if (gone.length) {
    missing += gone.length;
    console.log('✗ data/sounds.json');
    for (const line of gone) console.log(`    ${line}`);
  } else {
    console.log(`✓ data/sounds.json  (${Object.keys(book).length} 音)`);
  }
}

// オープニングの絵（GS-126）。背景と立ち絵。**タイトルの背にもなる**ので、抜けると真っ黒になる。
if (existsSync(OPENING)) {
  const cuts = JSON.parse(readFileSync(OPENING, 'utf8')).cuts ?? [];
  const gone = [];
  let shown = 0;
  for (const [index, cut] of cuts.entries()) {
    for (const src of [cut.back, cut.chara]) {
      if (!src) continue;
      shown += 1;
      if (!existsSync(publicPath(src))) gone.push(`${index}（${cut.who ?? ''}）: ${src}`);
    }
  }
  checked += shown;
  if (gone.length) {
    missing += gone.length;
    console.log('✗ data/opening.json');
    for (const line of gone) console.log(`    ${line}`);
  } else {
    console.log(`✓ data/opening.json  (${cuts.length} 場面・絵 ${shown} 枚)`);
  }
}

// 法線マップの台帳（DEC-374）。**古いと無い絵を取りに行く**ので、ここで気づけるようにする。
{
  const indexPath = join(PUBLIC, 'data', 'files.json');
  const listed = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')).normals ?? [] : null;
  if (listed === null) {
    missing += 1;
    console.log('✗ data/files.json が無い（npm run index:files）');
  } else {
    const gone = listed.filter((src) => !existsSync(publicPath(src)));
    checked += listed.length;
    if (gone.length) {
      missing += gone.length;
      console.log('✗ data/files.json（台帳が古い。npm run index:files）');
      for (const src of gone) console.log(`    ${src}`);
    } else {
      console.log(`✓ data/files.json  (法線 ${listed.length} 枚)`);
    }
  }
}

// フォント。
{
  const gone = FONTS.filter((src) => !existsSync(publicPath(src)));
  checked += FONTS.length;
  if (gone.length) {
    missing += gone.length;
    console.log('✗ フォント');
    for (const src of gone) console.log(`    ${src}`);
  } else {
    console.log(`✓ フォント  (${FONTS.length} 個)`);
  }
}

// マップの写し忘れ（GS-56）。**黙って失敗するのを見える形にする**——
// エディタで置いた入口を踏んでも何も起きず、エラーも出ない、が実際に起きた。
// **止めはしない。** 描いている途中に食い違っているのは当たり前なので、知らせるだけ。
{
  const editor = editorRoot();
  const source = join(editor, 'public', 'mapdata');
  if (!looksLikeEditor(editor)) {
    console.log(`· 隣の「${EDITOR_DIR}」が見つからないので、マップの写し忘れは見ていません。`);
  } else {
    const book = join(PUBLIC, 'data', 'maps.json');
    const ledger = existsSync(book) ? JSON.parse(readFileSync(book, 'utf8')).maps ?? {} : {};
    const stale = [];
    for (const name of new Set(Object.values(ledger).map((entry) => entry.file).filter(Boolean))) {
      const from = join(source, name);
      const to = join(MAPS, name);
      if (!existsSync(from)) continue;
      if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to))) stale.push(name);
    }
    if (stale.length) {
      console.log(`· エディタ側と違うマップが ${stale.length} 枚（npm run sync:maps）`);
      for (const name of stale) console.log(`    ${name}`);
    } else {
      console.log('✓ マップはエディタ側と同じ');
    }
  }
}

console.log(missing ? `\n足りない絵が ${missing} 個。エディタ側の public/assets から写す。` : `\n全部そろっている（${checked} 個）。`);
process.exit(missing ? 1 : 0);
