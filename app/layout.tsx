// 画面の外枠。ゲームは 1 画面だけなので、ここでは字と背景だけ決める。

import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SampleGame',
  description: '3D Map Editor で作ったマップで遊ぶ',
};

// ゲームビュー（5926）の index.html と同じ（GS-09）。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
