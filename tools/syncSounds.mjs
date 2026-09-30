// 音の置き場と台帳を揃える（2026-09-29）。**置いた音は全部使える**ようにする。
//
// `public/assets/sound/` に置いたのに `data/sounds.json` に載っていないファイルを、台帳へ**足す**。
// 名前はファイル名（拡張子を取り、空白は `_`、記号は落とす）。音量は 0.5。
// ループは**大きさで見当を付ける**——曲（BGM・環境音）は数百 KB を超え、効果音は小さい。
// 名前・音量・ループは台帳エディタの「音（BGM・効果音）」で直す（直した値は二度と上書きしない）。
//
// **足すだけ。** 行を消すのは台帳エディタの「削除」で、そのときはファイルも置き場から外す
// （外さないと、次に読んだときまた足されてしまう）。
// 台帳エディタとイベントエディタが、読み込むたびに呼ぶ。手で回すなら `node tools/syncSounds.mjs`。

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SOUND_FILE = /\.(mp3|ogg|wav|m4a)$/i;
/** これより大きいファイルはループ（曲）と見なす。いまの効果音は大きくても 100KB ほど。 */
const LOOP_BYTES = 500 * 1024;
const VOLUME = 0.5;

/** ファイル名から名前を作る（`The Cave.mp3` → `The_Cave`）。 */
export function soundIdOf(file) {
  return file.replace(/\.[^.]+$/, '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40) || 'sound';
}

/** 1 行に 1 つで書く（台帳エディタの `formatSoundEntries` と同じ形）。 */
function formatEntries(sounds, indent) {
  const line = (entry) => `{ ${Object.entries(entry).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')} }`;
  const rows = Object.entries(sounds).map(([id, entry]) => `${indent}  ${JSON.stringify(id)}: ${line(entry)}`);
  return rows.length ? `{\n${rows.join(',\n')}\n${indent}}` : '{}';
}

/**
 * `sounds` の値だけを差し替える。ほかの項目（`ui`・`infomation`）と、その書き方は残す。
 * 見つからなければ全体を書き直す。
 */
function replaceSounds(text, sounds) {
  const match = /\n([ \t]*)"sounds"\s*:\s*\{/.exec(text);
  if (!match) {
    const book = JSON.parse(text);
    book.sounds = sounds;
    return JSON.stringify(book, null, 2) + '\n';
  }
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return text.slice(0, start) + formatEntries(sounds, match[1]) + text.slice(end);
}

/**
 * 置き場にあって台帳に無い音を足す。足した物を `[{ id, file, loop }]` で返す（無ければ空）。
 * 台帳が無い・読めないときは何もしない（空を返す）。
 */
export function syncSounds(gameRoot) {
  const book = join(gameRoot, 'public', 'data', 'sounds.json');
  const dir = join(gameRoot, 'public', 'assets', 'sound');
  let text;
  let files;
  try {
    text = readFileSync(book, 'utf8');
    files = readdirSync(dir).filter((name) => SOUND_FILE.test(name) && !name.startsWith('.')).sort((a, b) => a.localeCompare(b, 'ja'));
  } catch {
    return [];
  }
  const parsed = JSON.parse(text);
  const sounds = { ...(parsed.sounds ?? {}) };
  const used = new Set(Object.values(sounds).map((entry) => entry?.file));
  const added = [];
  for (const file of files) {
    if (used.has(file)) continue;
    const base = soundIdOf(file);
    let id = base;
    for (let n = 2; Object.hasOwn(sounds, id); n += 1) id = `${base.slice(0, 36)}_${n}`;
    const loop = statSync(join(dir, file)).size >= LOOP_BYTES;
    sounds[id] = { file, volume: VOLUME, ...(loop ? { loop: true } : {}) };
    added.push({ id, file, loop });
  }
  if (!added.length) return [];
  const next = replaceSounds(text, sounds);
  const temp = `${book}.tmp`;
  writeFileSync(temp, next, 'utf8');
  renameSync(temp, book);
  return added;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const added = syncSounds(resolve(import.meta.dirname, '..'));
  console.log(added.length ? added.map((one) => `足した: ${one.id} ← ${one.file}${one.loop ? '（ループ）' : ''}`).join('\n') : '足す音はありません');
}
