// マップの台帳（GS-17 / GS-21）。id → ファイル名と、そのマップの音。
//
// マップの id は英小文字の名前（`home`・`forest_mansion`）で、ファイル名は `<id>.json`（GS-254。
// それまでは `0101_home.json` のような番号＋名前で、行き先を番号で書いていた）。行き先は id で書く（`MapMove = "home_forest"`）。
// 静的書き出しではフォルダの中身を数えられないので、**台帳を 1 枚持つ**。
//
// 台帳に無い名前は、そのまま `<名前>.json` を試す（音は無し）。

import { assetUrl } from './assets';

/** 台帳の 1 行。 */
export interface MapEntry {
  /** `public/mapdata/` の中のファイル名。 */
  file: string;
  /** そのマップで流す曲（`sounds.json` のキー）。 */
  bgm?: string;
  /** 環境音（滝・風など）。曲と別に流し続ける。 */
  bgs?: string;
  /**
   * 戦闘の背景（GS-79）。`battlefields.json` のキー。
   * `BattleStage=true` の点が無い場合は、未指定なら既定の2D背景を使う。
   */
  battleField?: string;
  /**
   * 3D舞台設定。場所は `BattleStage=true` の点。formationsは通常戦闘でランダム選択する候補。
   * カメラ演出は持たない（GS-97）——戦闘演出の割り当て（`battlePresentation.json`）と二重にかかった。
   */
  battleStage?: { formations?: string[] };
  /** 時間帯（GS-223）。台帳エディタの「マップ構成」で直す。 */
  time?: MapTimeDef;
}

/**
 * マップの時間帯の決まり（GS-223）。
 * 朝・昼・夕・夜のうち、このマップで**使わない**（マップエディタで「このマップで使う」を外した・無い）時間帯の代わり。
 */
export interface MapTimeDef {
  /**
   * 使わない時間帯 → 代わりに出す時間帯（光のプリセットの id）。書かなければ基準の光。
   * 例 `{ "morning": "day", "evening": "night" }`。代わりの先もこのマップで使う時間帯であること（使わなければ基準）。
   * **時間が変わっても代わりの見た目のまま**（朝のあいだずっと昼の見た目）。
   */
  fallback?: Record<string, string>;
  /** このマップに居るあいだは時計を進めない（洞窟・屋内など）。 */
  stopClock?: boolean;
}

export interface MapFile {
  maps: Record<string, MapEntry>;
}

let pending: Promise<Record<string, MapEntry>> | null = null;
/** 読み終えた台帳（同期で引くため。`knownMapKeyForFile`）。読む前は空。 */
let loaded: Record<string, MapEntry> = {};

/** 台帳を読む。**1 回だけ読んで使い回す**。 */
export function loadMapIndex(): Promise<Record<string, MapEntry>> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/maps.json'))
    .then((response) => (response.ok ? (response.json() as Promise<MapFile>) : null))
    .then((file) => file?.maps ?? {})
    .catch((error) => {
      console.warn('[maps] 台帳を読めなかった', error);
      return {};
    })
    .then((maps) => {
      loaded = maps;
      return maps;
    });
  return pending;
}

/**
 * 行き先の書き方 → 台帳の 1 行。
 * 台帳に無ければ、書かれたものをそのままファイル名として使う（音は無し）。
 */
export async function mapEntryOf(name: string): Promise<MapEntry> {
  const key = name.replace(/\.json$/i, '');
  const index = await loadMapIndex();
  return index[key] ?? { file: `${key}.json` };
}

/** 読むファイル名だけが要るとき。 */
export async function mapFileOf(name: string): Promise<string> {
  return (await mapEntryOf(name)).file;
}

/**
 * `mapKeyForFile` の同期版。**台帳を読み終えてから**呼ぶ（マップを組んだあとなら読んである）。
 * 画面側が NPC の設定（`mapNpcs.json`）を引くのに使う。
 */
export function knownMapKeyForFile(file: string): string | null {
  return Object.entries(loaded).find(([, entry]) => entry.file === file)?.[0] ?? null;
}

/**
 * セーブに書くマップの id。台帳の id（`home_forest`）、台帳に無ければ `.json` を外したファイル名。
 * **`_` で切らない**——id の `_` は名前の一部（番号＋名前のファイル名だった頃の切り方で `home` になっていた）。
 */
export function saveMapId(maps: Record<string, MapEntry>, file: string): string {
  return Object.entries(maps).find(([, entry]) => entry.file === file)?.[0] ?? file.replace(/\.json$/i, '');
}

/** 読み終えた台帳で `saveMapId` を引く。**台帳を読み終えてから**呼ぶ。 */
export function knownSaveMapId(file: string): string {
  return saveMapId(loaded, file);
}

/** ファイル名から台帳の id（`home_forest`）を逆に引く。台帳に無ければ null。NPC の設定（`mapNpcs.json`）を引くのに使う。 */
export async function mapKeyForFile(file: string): Promise<string | null> {
  const index = await loadMapIndex();
  return Object.entries(index).find(([, entry]) => entry.file === file)?.[0] ?? null;
}

/** ファイル名から台帳の 1 行を逆に引く（ビューが自分でマップを移したとき）。 */
export async function entryForFile(file: string): Promise<MapEntry | null> {
  const index = await loadMapIndex();
  const hit = Object.values(index).find((entry) => entry.file === file);
  return hit ?? null;
}
