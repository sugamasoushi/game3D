// マップの台帳（GS-17 / GS-21）。番号 → ファイル名と、そのマップの音。
//
// マップは `0101_home.json` のように**番号＋名前**で置く（旧作と同じ並べ方）。
// 行き先は番号だけで書きたい（`MapMove = "0102"`）ので、ここで引き当てる。
// 静的書き出しではフォルダの中身を数えられないので、**台帳を 1 枚持つ**。
//
// 番号を使わないなら、ファイル名をそのまま書いてもよい（台帳に無ければ `<名前>.json` を試す）。

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
}

interface MapFile {
  maps: Record<string, MapEntry>;
}

let pending: Promise<Record<string, MapEntry>> | null = null;

/** 台帳を読む。**1 回だけ読んで使い回す**。 */
export function loadMapIndex(): Promise<Record<string, MapEntry>> {
  if (pending) return pending;
  pending = fetch(assetUrl('data/maps.json'))
    .then((response) => (response.ok ? (response.json() as Promise<MapFile>) : null))
    .then((file) => file?.maps ?? {})
    .catch((error) => {
      console.warn('[maps] 台帳を読めなかった', error);
      return {};
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

/** ファイル名から台帳の 1 行を逆に引く（ビューが自分でマップを移したとき）。 */
export async function entryForFile(file: string): Promise<MapEntry | null> {
  const index = await loadMapIndex();
  const hit = Object.values(index).find((entry) => entry.file === file);
  return hit ?? null;
}
