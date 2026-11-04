'use client';

// マップ名のテロップ（2026-11-04）。マップを移って読み込みが終わったら、画面の上のほうに名前を出す。
//
// **フェードイン → 少し見せる → フェードアウト** は CSS の 1 本のアニメーション（`.map-title`）。
// 同じマップへ続けて入り直したときも出し直せるよう、`serial` を key にして毎回作り直す。
// 消えたら（`animationend`）親に知らせて片付ける。

export function MapTitle({ text, serial, onDone }: { text: string; serial: number; onDone(): void }) {
  return (
    <div key={serial} className="map-title" aria-live="polite" onAnimationEnd={onDone}>
      <span className="map-title-text">{text}</span>
    </div>
  );
}
