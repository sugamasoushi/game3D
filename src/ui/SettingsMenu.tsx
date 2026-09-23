'use client';

// 設定画面（GS-32）。**タイトルから開く単独の枠**。
//
// 中身は `menu/SettingsPage` と同じ物を使う——ゲーム中はメニューのタブ（GS-54）から
// 同じページが出る。2 か所に同じつまみを書くと、片方だけ直す事故が起きる。
//
// キーは capture 段階で止める。開いている間に歩き出さないため（会話ウィンドウと同じ）。

import { useEffect } from 'react';
import { SettingsPage } from './menu/SettingsPage';

export function SettingsMenu({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="menu-back" onClick={onClose}>
      <div className="menu" onClick={(event) => event.stopPropagation()}>
        <h2 className="menu-head">設定</h2>
        <SettingsPage
          extra={
            <button type="button" onClick={onClose}>
              とじる（Esc）
            </button>
          }
        />
      </div>
    </div>
  );
}
