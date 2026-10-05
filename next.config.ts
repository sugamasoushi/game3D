// Next の設定。**静的書き出し**（`out/`）にしておく——これで Vercel も Electron も同じ物を配れる。
// Electron は electron/main.mjs から同じ out/ を配信する。

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 3D の初期化を 2 回走らせない。canvas を持つので二重マウントは無駄が大きい。
  reactStrictMode: false,
  devIndicators: false,
  /** 静的書き出し。サーバを持たない＝どこにでも置ける。 */
  output: 'export',
  /** 書き出しでは Next の画像最適化が使えない。 */
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
