// アセットの置き場所を**ここ 1 か所**に集める。
//
// 土台（Next / Electron / 配信先）が変わると変わるのは**ベースの URL だけ**なので、
// 直書きを散らさずここへ通す。今はどれも根（`/`）に置くので素通し。
// 例: GitHub Pages のようにサブパスへ置くときは `NEXT_PUBLIC_BASE_PATH` を足す。

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** `public/` の中のファイルへの URL。先頭の `/` は付けても付けなくてもよい。 */
export function assetUrl(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, '')}`;
}

/**
 * マップ JSON。名前は `public/mapdata/` からの道で拡張子まで（`home.json`・`village/home.json`）。
 * フォルダ分け（GS-257）があるので、`/` は区切りのまま残して 1 段ずつ符号化する。
 */
export function mapUrl(name: string): string {
  return assetUrl(`mapdata/${name.split('/').map(encodeURIComponent).join('/')}`);
}

/** 最初に開くマップの id（GS-02）。ファイルは台帳（`maps.json`）から引く——フォルダへ移しても変えなくてよい（GS-257）。 */
export const START_MAP_ID = 'home';
