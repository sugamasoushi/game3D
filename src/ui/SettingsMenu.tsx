'use client';

// 設定画面（GS-32）。**タイトルから開く単独の枠**。
//
// 中身は `menu/SettingsPage` と同じ物を使う——ゲーム中はメニューのタブ（GS-54）から
// 同じページが出る。2 か所に同じつまみを書くと、片方だけ直す事故が起きる。
//
// キーは capture 段階で止める。開いている間に歩き出さないため（会話ウィンドウと同じ）。
// カーソルはゲーム中のメニューと同じ動き（`menuNav`）。↑↓ で項目、←→ でつまみ・選ぶ箱の値、
// 決定でチェックとボタンを押す。ゲームパッドの合成キー（GS-58）も同じ道を通る。

import { useEffect, useRef } from 'react';
import { SettingsPage } from './menu/SettingsPage';
import { PICK, nearest, nudge } from './menu/menuNav';

export function SettingsMenu({ onClose }: { onClose(): void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const picks = () => [...(boxRef.current?.querySelectorAll<HTMLElement>(PICK) ?? [])];
    // 開いたら先頭にカーソルを置く。
    picks()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      // **同じ window の受け手にも渡さない。** ゲームパッドの合成キー（GS-58）は window へ直に送るので、
      // stopPropagation だけでは裏のタイトル画面の受け手まで届き、カーソルがそちらで動いてしまう。
      event.stopImmediatePropagation();
      const key = event.key;
      if (key === 'Escape') {
        closeRef.current();
        return;
      }
      const list = picks();
      const now = document.activeElement as HTMLElement | null;
      // カーソルを見失った（枠の外を押した等）ら、先頭へ戻すだけ。
      if (!now || !list.includes(now)) {
        if (key.startsWith('Arrow') || key === 'Enter' || key === ' ') list[0]?.focus();
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        nearest(now, list, key === 'ArrowDown' ? 'down' : 'up')?.focus();
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const delta = key === 'ArrowRight' ? 1 : -1;
        if (now instanceof HTMLSelectElement || (now instanceof HTMLInputElement && now.type === 'range')) nudge(now, delta);
        else nearest(now, list, key === 'ArrowRight' ? 'right' : 'left')?.focus();
      } else if (key === 'Enter' || key === ' ') {
        // 合成のキーイベントではボタンが押されない（GS-58）ので、選んでいる物を自分で押す。
        if (now.tagName === 'BUTTON' || (now instanceof HTMLInputElement && now.type === 'checkbox')) now.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="menu-back" onClick={onClose}>
      <div className="menu" ref={boxRef} onClick={(event) => event.stopPropagation()}>
        <h2 className="menu-head">設定</h2>
        <SettingsPage
          extra={
            <button type="button" data-pick onClick={onClose}>
              とじる
            </button>
          }
        />
      </div>
    </div>
  );
}
