'use client';

// 漫画のようにめくるイベントイラスト（GS-188）。中身と動きは `comic.ts`。
// ここは描くのと、**読ませている間**（`read`）の入力だけを受け持つ。

import { useEffect } from 'react';
import { turnComic, useComic } from './comic';
import { useUi } from './store';

/** 次へ。旧作の右矢印・決定・→。 */
const NEXT = ['ArrowRight', 'KeyD', 'Enter', 'Space', 'KeyZ'];
/** 戻る。旧作の左矢印・取り消し・←。 */
const BACK = ['ArrowLeft', 'KeyA', 'Escape', 'KeyX', 'Backspace'];

export function ComicPager() {
  const comic = useComic((s) => s.comic);
  const reading = Boolean(comic?.reading && !comic.closing);

  useEffect(() => {
    if (!reading) return;
    const onKey = (event: KeyboardEvent) => {
      // 会話・選択肢が出ていればそちらが先（めくる間に会話を挟める）。
      const ui = useUi.getState();
      if (ui.talk || ui.choices) return;
      if (NEXT.includes(event.code)) void turnComic(1);
      else if (BACK.includes(event.code)) void turnComic(-1);
      else return;
      // ゲームの移動キーへ通さない。
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [reading]);

  if (!comic) return null;
  return (
    <div className={`comic${comic.reading ? ' reading' : ''}`}>
      {comic.pages.map((src, index) => {
        // 出ている絵は真ん中、まだの絵は左の外、閉じるときは全部右の外。
        const x = comic.closing ? '100%' : index <= comic.index ? '0' : '-100%';
        return (
          <img
            key={`${index}-${src}`}
            className="comic-page"
            src={src}
            alt=""
            draggable={false}
            style={{ transform: `translateX(${x})`, transitionDuration: `${comic.ms}ms`, zIndex: index }}
          />
        );
      })}
      {comic.reading && !comic.closing ? (
        <>
          <button
            type="button"
            className="comic-arrow left"
            aria-label="前へ"
            disabled={comic.index <= 0}
            onClick={() => void turnComic(-1)}
          >
            ◀
          </button>
          <button type="button" className="comic-arrow right" aria-label="次へ" onClick={() => void turnComic(1)}>
            ▶
          </button>
        </>
      ) : null}
    </div>
  );
}
