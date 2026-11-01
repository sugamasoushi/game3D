// 画面の外枠。ゲームは 1 画面だけなので、ここでは字と背景だけ決める。

import type { Metadata, Viewport } from 'next';
import { readGameTitle } from './gameTitle';
import './globals.css';

/** 題名は台帳（`opening.json` の `title`）から（2026-10-31）。`next dev` では読み直すたびに読む。 */
export function generateMetadata(): Metadata {
  const title = readGameTitle();
  return {
    title,
    description: '3D Map Editor で作ったマップで遊ぶ',
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icon.svg' },
    appleWebApp: { capable: true, title, statusBarStyle: 'black-translucent' },
  };
}

// もとはゲームビュー（2026-10-06 に削除）の index.html と同じ（GS-09）。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
