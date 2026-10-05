'use client';

// おまけの中身を見せる（GS-212）。旧作 `title/view/Omake.ts` の `playVideo`。
// 何を見せるかは台帳（`data/omake.json`）、一覧はタイトル（`TitleScreen`）が出す。
//
// - 絵（`image`）…… 押すと閉じる
// - 動画（`video`）…… 曲を止めて流し、終わって 1 秒置いてから曲を戻す（旧作と同じ）。押すと飛ばせる
// - めくる絵（`pages`）…… イベントの `comic`（GS-188）と同じ見せ方。→ / 決定で次、← / 取り消しで戻る
//
// イベントの `comic`（`ComicPager`）は使い回さない。あちらは会話ウィンドウの層にあり、
// タイトルの下に隠れる。見た目（`.comic-*`）だけ共用する。

import { useCallback, useEffect, useRef, useState } from 'react';
import { assetUrl } from '../game/assets';
import { playBgm, playSe, stopBgm } from '../game/audio';
import type { OmakeItem } from '../game/omake';

/** めくる絵が 1 枚滑る時間（旧作 500ms）。 */
const PAGE_MS = 500;
/** めくる音（`sounds.json`）。旧作の SE_cardTurnOver。 */
const PAGE_SE = 'cardTurnOver';
/** 動画が終わってから曲を戻すまで（旧作 1000ms）。 */
const VIDEO_AFTER_MS = 1000;
/** 動画の前に曲を絞る時間。 */
const BGM_FADE_MS = 400;

const NEXT = ['ArrowRight', 'KeyD', 'Enter', 'Space', 'KeyZ'];
const BACK = ['ArrowLeft', 'KeyA', 'Escape', 'KeyX', 'Backspace'];

export function OmakeViewer({ item, bgm, onDone }: { item: OmakeItem; bgm: string; onDone(): void }) {
  const files = item.files.map((file) => assetUrl(file));
  if (item.kind === 'video') return <OmakeVideo src={files[0]} bgm={bgm} onDone={onDone} />;
  if (item.kind === 'pages') return <PageViewer pages={files} mode="stack" onDone={onDone} />;
  return <OmakeImage src={files[0]} onDone={onDone} />;
}

/**
 * 見ている間のキー。**タイトルのキー（上下・決定）へ通さない**——
 * 窓の取り込み段階で受けて止める（`ComicPager` と同じ）。
 */
function useKeys(onKey: (code: string) => void) {
  const ref = useRef(onKey);
  ref.current = onKey;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) ref.current(event.code);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);
}

function OmakeImage({ src, onDone }: { src: string; onDone(): void }) {
  useKeys((code) => {
    if (NEXT.includes(code) || BACK.includes(code)) onDone();
  });
  return (
    <div className="omake-view" onClick={onDone}>
      <img className="omake-image" src={src} alt="" draggable={false} />
    </div>
  );
}

function OmakeVideo({ src, bgm, onDone }: { src: string; bgm: string; onDone(): void }) {
  const ended = useRef(false);
  const finish = useCallback(
    (wait: number) => {
      if (ended.current) return;
      ended.current = true;
      window.setTimeout(() => {
        if (bgm) playBgm(bgm);
        onDone();
      }, wait);
    },
    [bgm, onDone],
  );
  useEffect(() => {
    stopBgm(BGM_FADE_MS);
  }, []);
  useKeys((code) => {
    if (BACK.includes(code) || code === 'Enter' || code === 'Space') finish(0);
  });
  return (
    <div className="omake-view" onClick={() => finish(0)}>
      <video
        className="omake-video"
        src={src}
        autoPlay
        playsInline
        onEnded={() => finish(VIDEO_AFTER_MS)}
        onError={() => finish(0)}
      />
    </div>
  );
}

/**
 * めくる絵。旧作は 1 枚目で ← を押しても何もしなかったので、ここでも戻らない（閉じない）。
 *
 * - `stack`（おまけのイベント02。旧作 `Omake.ts`）…… 次の 1 枚が左から**上へ重なる**。最後の先で全部が右へ抜ける
 * - `slide`（マニュアル。旧作 `Manual.ts`）…… 見ていた 1 枚が右へ抜け、次の 1 枚が左から入る。
 *   戻ると見ていた 1 枚が左へ抜け、前の 1 枚が右から戻る
 */
export function PageViewer({ pages, mode, onDone }: { pages: string[]; mode: 'stack' | 'slide'; onDone(): void }) {
  const [index, setIndex] = useState(-1);
  const [closing, setClosing] = useState(false);
  const busy = useRef(false);

  const turn = useCallback(
    (step: 1 | -1) => {
      if (busy.current || closing) return;
      if (step === -1 && index <= 0) return;
      playSe(PAGE_SE);
      busy.current = true;
      window.setTimeout(() => {
        busy.current = false;
      }, PAGE_MS);
      if (step === 1 && index + 1 >= pages.length) {
        setClosing(true);
        window.setTimeout(onDone, PAGE_MS);
        return;
      }
      setIndex(index + step);
    },
    [closing, index, pages.length, onDone],
  );

  // 置いた直後に動かすと滑らずに移るので、2 フレーム待ってから 1 枚目を出す。
  useEffect(() => {
    let id = window.requestAnimationFrame(() => {
      id = window.requestAnimationFrame(() => turn(1));
    });
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeys((code) => {
    if (NEXT.includes(code)) turn(1);
    else if (BACK.includes(code)) turn(-1);
  });

  return (
    <div className="omake-view">
      <div className="comic reading">
        {pages.map((src, at) => {
          const x =
            mode === 'stack'
              ? closing ? '100%' : at <= index ? '0' : '-100%'
              : at < index || (closing && at === index) ? '100%' : at === index ? '0' : '-100%';
          return (
            <img
              key={`${at}-${src}`}
              className="comic-page"
              src={src}
              alt=""
              draggable={false}
              style={{ transform: `translateX(${x})`, transitionDuration: `${PAGE_MS}ms`, zIndex: at }}
            />
          );
        })}
        {!closing ? (
          <>
            <button type="button" className="comic-arrow left" aria-label="前へ" disabled={index <= 0} onClick={() => turn(-1)}>
              ◀
            </button>
            <button type="button" className="comic-arrow right" aria-label="次へ" onClick={() => turn(1)}>
              ▶
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
