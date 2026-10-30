// 人の台帳（GS-54）。名前・顔アイコン・立ち絵・メニュー絵を引く。
//
// 中身は旧作から持ってきた `public/data/characterdata.json` そのまま。
// これまでは GameCanvas が読んでイベントの橋へ手渡すだけだったが、
// **メニューも同じ表を引く**ようになったので、ほかの台帳（`items` / `commons`）と
// 同じ形にして 1 か所へ集める。読むのは起動時に 1 回。
//
// **持っている数や進み具合はここに入れない。** ここは「誰が居るか」だけで、
// 遊んだ結果はセーブ（`state.ts`）が持つ——同じ物を 2 か所に置かないため。

import { assetUrl } from './assets';

/** 立ち絵の置き場所（GS-20）。メニュー絵も同じ棚に居る。 */
const STAND_DIR = 'assets/img/CharaStand';
/** 顔アイコンの置き場所（GS-23）。 */
const ICON_DIR = 'assets/img/charIcon';

/** 主人公の話者キー。吹き出しとメニューの左に出す人（GS-23 と同じ約束）。 */
export const PLAYER_CHARACTER = 'meina';

/**
 * 種別（2026-10-08）。`player` は仲間として操作する人（隊列に入る・先頭になる）、
 * `npc` は操作しない人（マップに置く NPC・話者だけの人）。
 */
export type CharacterKind = 'player' | 'npc';

/** 台帳の 1 人ぶん（旧作の形）。 */
export interface CharacterEntry {
  name: string;
  kind: CharacterKind;
  /**
   * フィールドの絵（2026-10-08）。**画像のファイル名**（`spriteSheets.json` のキー。立ち姿 `actors.json` も同じキー）。
   * **無ければフィールドに出ない**（話者だけの人）。マップの NPC（`Character`）も隊列の仲間もここから絵を引く。
   * 同じ画像を何人で使ってもよい（ラミィとナーガ娘など）。
   */
  sheet?: string;
  icon?: string;
  normal?: string;
  smile?: string;
  unger?: string;
  /** メニューに出す絵（旧作の `menu_meina` など）。無ければ絵なし。 */
  menu?: string;
  talk?: string;
  /**
   * 戦闘の絵（2026-10-29 / GS-280）。`assets/img/BattleParty` からの道で、拡張子を外した名前
   * （`Battle_lamy` → `Battle_lamy.png`）。コマンド選択で左端に出す（息遣いは板の上下の伸び縮み。GS-88）。
   * 無ければ立ち絵（`normal`）。
   */
  battle?: string;
}

/** 戦闘の絵の置き場（GS-280）。 */
const BATTLE_DIR = 'assets/img/BattleParty';

/** `information` のような**人ではない行**も混じるので、値は string も受ける。 */
export type CharacterBook = Record<string, CharacterEntry | string>;

let book: CharacterBook = {};

/** 台帳を読む。**起動時に 1 回**でよい。読めなくても遊べる（名前がキーのまま出る）。 */
export async function loadCharacterBook(): Promise<CharacterBook> {
  try {
    const response = await fetch(assetUrl('data/characterdata.json'), { cache: 'no-store' });
    if (response.ok) book = (await response.json()) as CharacterBook;
  } catch {
    /* 読めなければ空のまま。 */
  }
  return book;
}

let ready: Promise<CharacterBook> | null = null;

/**
 * 台帳が読めているのを待つ（2026-10-08）。**フィールドの絵を引く前に呼ぶ**——
 * マップの組み立てが起動時の読み込みより先に走っても、NPC の絵を取りこぼさない。
 */
export function characterBookReady(): Promise<CharacterBook> {
  ready ??= loadCharacterBook();
  return ready;
}

/** その人のフィールドの絵（画像のファイル名）。台帳に無い人・絵の無い人は null。 */
export function characterSheet(who: string): string | null {
  return character(who)?.sheet || null;
}

/** 台帳に載っている人のキー（人ではない行は除く。2026-10-29 / GS-282。戦闘演出エディタが絵を選ぶ）。 */
export function characterIds(): string[] {
  return Object.keys(book).filter((key) => character(key));
}

/** 1 人ぶん。人ではない行（`information`）は null。 */
export function character(who: string): CharacterEntry | null {
  const entry = book[who];
  return entry && typeof entry === 'object' ? entry : null;
}

/** 名前。**台帳に無くてもキーをそのまま返す**（誰の話か分からなくならないように）。 */
export function characterName(who: string): string {
  return character(who)?.name ?? who;
}

/** メニューに出す絵の URL。無ければ null。 */
export function characterMenuImage(who: string): string | null {
  const menu = character(who)?.menu;
  return menu ? assetUrl(`${STAND_DIR}/${menu}.png`) : null;
}

/** 顔アイコンの URL。無ければ null。 */
/** 立ち絵（`normal`）の URL（GS-87）。戦闘の 3D の舞台に立たせる。無ければ null。 */
export function characterStand(who: string): string | null {
  const entry = character(who);
  return entry?.normal ? assetUrl(`${STAND_DIR}/${entry.normal}.png`) : null;
}

/** 戦闘の絵の道（`public/` から。GS-280）。 */
export function battleImagePath(name: string): string {
  return `${BATTLE_DIR}/${name}.png`;
}

/** 戦闘の絵の URL（GS-280）。書いていない人は null（立ち絵を使う）。 */
export function characterBattleImage(who: string): string | null {
  const name = character(who)?.battle;
  return name ? assetUrl(battleImagePath(name)) : null;
}

export function characterIcon(who: string): string | null {
  const icon = character(who)?.icon;
  return icon ? assetUrl(`${ICON_DIR}/${icon}.png`) : null;
}
