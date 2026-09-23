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

/** マップ JSON。名前は拡張子まで（`home.json`）。 */
export function mapUrl(name: string): string {
  return assetUrl(`mapdata/${encodeURIComponent(name)}`);
}

/** 最初に開くマップ。旧作の「家」に当たる（GS-02）。 */
export const START_MAP = '0101_home.json';
