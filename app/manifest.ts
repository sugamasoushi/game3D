// ホーム画面に置いたときのアプリの情報（`/manifest.webmanifest`）。2026-10-31 に `public/manifest.webmanifest` から移した——
// 名前を題名の台帳（`opening.json` の `title`）から取るため。中身はそれまでと同じ。

import type { MetadataRoute } from 'next';
import { readGameTitle } from './gameTitle';

/** 静的書き出し（`output: 'export'`）では、書き出しのときに作る。 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  const title = readGameTitle();
  return {
    name: title,
    short_name: title,
    description: '3D Map Editor で作ったRPG',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#000000',
    theme_color: '#191970',
    // それまでの `"purpose": "any maskable"` と同じ（Next の型は 1 つずつなので 2 つに分けた）。
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
