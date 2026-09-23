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

/** 台帳の 1 人ぶん（旧作の形）。 */
export interface CharacterEntry {
  name: string;
  icon?: string;
  normal?: string;
  smile?: string;
  unger?: string;
  /** メニューに出す絵（旧作の `menu_meina` など）。無ければ絵なし。 */
  menu?: string;
  talk?: string;
}

/** `infomation` のような**人ではない行**も混じるので、値は string も受ける。 */
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

/** 1 人ぶん。人ではない行（`infomation`）は null。 */
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

export function characterIcon(who: string): string | null {
  const icon = character(who)?.icon;
  return icon ? assetUrl(`${ICON_DIR}/${icon}.png`) : null;
}
