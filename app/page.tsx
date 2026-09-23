'use client';

// 入口。**3D はサーバでは動かせない**ので、`ssr: false` で読み込みを止める。
// （three.js と WebGL は window が要る。旧作も Phaser を同じやり方で載せていた）

import dynamic from 'next/dynamic';

const GameCanvas = dynamic(() => import('../src/ui/GameCanvas'), {
  ssr: false,
  loading: () => <div className="notice">起動中…</div>,
});

export default function Page() {
  return <GameCanvas />;
}
