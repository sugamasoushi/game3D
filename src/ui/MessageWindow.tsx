'use client';

// 会話ウィンドウ。**DOM で作る**（構想 §3.1）——日本語の折り返しをブラウザに任せられる。
//
// 決定で「全部出す → 次へ」の 2 段。ツクールと同じ手触り。
// 開いているあいだは**キーをゲームへ通さない**（構想 §5.2 の入力モード）。
// 捕まえるのは capture 段階なので、ゲーム側（window の keydown）まで届かない。

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { playUi } from '../game/audio';
import { options } from '../game/options';
import { scrollMs, useUi } from './store';

/**
 * 流れる文字の出入り（ミリ秒。GS-23）。
 * 入りは**黒からの明け**——暗幕を張る所は見せず、`暗幕がかかった画面`が現れる。
 */
const SCROLL_IN_MS = 600;
const SCROLL_OUT_MS = 800;

/** 画面の外へ運ぶ距離。縦横で変える——縦は絵の丈ぶん、横は幅ぶん外へ出す。 */
const OUT_SHIFT: Record<string, { x: string; y: string }> = {
  left: { x: '-160%', y: '0' },
  right: { x: '160%', y: '0' },
  top: { x: '0', y: '-140%' },
  bottom: { x: '0', y: '140%' },
};

/** 決定・キャンセルに使うキー。移動キーは選択肢の上下に使う。 */
const DECIDE = ['Enter', 'Space', 'KeyZ'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];

export function MessageWindow({
  onAdvance,
  onPick,
  headAt,
}: {
  onAdvance(): void;
  onPick(index: number): void;
  /** 吹き出しを出す相手の頭が画面のどこか（GS-23）。3D 側に聞く。 */
  headAt(who: string): { x: number; y: number } | null;
}) {
  const talk = useUi((s) => s.talk);
  const scroll = useUi((s) => s.scroll);
  const choices = useUi((s) => s.choices);
  const fade = useUi((s) => s.fade);
  const fadeMs = useUi((s) => s.fadeMs);
  const portraits = useUi((s) => s.portraits);
  const dropPortrait = useUi((s) => s.dropPortrait);
  /** 吹き出しの置き所。カメラが動くので少しずつ追う。 */
  const [head, setHead] = useState<{ x: number; y: number } | null>(null);
  /**
   * 流れる文字の段（GS-23）。`in` は**画面が真っ黒**で、その裏で暗幕と文字を置く。
   * `run` で黒が明けると、**暗幕が最初からかかった画面**が現れる。
   */
  const [scrollStep, setScrollStep] = useState<'in' | 'run' | 'out'>('in');
  /**
   * 流れる文字の**測った寸法**（GS-144）。`from` は下から出す距離（画面の高さ）、
   * `ms` は流れ切るまでの時間。行数で時間が変わるので、置いてから測って決める。
   */
  const [scrollRun, setScrollRun] = useState<{ from: number; ms: number } | null>(null);
  const scrollBackRef = useRef<HTMLDivElement | null>(null);
  const scrollTextRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(0);
  const [cursor, setCursor] = useState(0);
  const full = (talk?.lines ?? []).join('\n');
  /**
   * いま数えている文（GS-146）。**描く前に巻き戻す**。
   *
   * `useEffect` で 0 に戻していたころは、次の人の会話が始まる**1 フレームだけ**
   * 前の文字数ぶんが画面に出ていた——3 行ぶんが一瞬出てから消えて打ち直るので、
   * 「押した瞬間に文字が勝手に動いた」ように見えていた。旧作と同じで、
   * **次の人の会話は必ず空から**始める。
   */
  const [source, setSource] = useState(full);
  if (source !== full) {
    setSource(full);
    setShown(0);
  }
  const done = shown >= full.length;

  /**
   * 文字の巻き上げ（GS-146）。窓は 3 行ぶんしか見せず、**あふれたぶんだけ上へ寄せる**。
   * 行数では数えず**実際の丈**を測る——長い行は折り返して 1 行が 2 行になるので、
   * 書いた行数では足りない。
   */
  const [lift, setLift] = useState(0);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  useLayoutEffect(() => {
    const view = viewRef.current;
    const body = bodyRef.current;
    if (!view || !body) {
      setLift(0);
      return;
    }
    // **行の高さの倍数で寄せる。** 端数で止めると上の行が途中で切れて見える
    // （▼ の印だけで 4px あふれることがあり、そのぶんが常に切れていた）。
    const line = Number.parseFloat(window.getComputedStyle(body).lineHeight) || 35;
    const over = body.offsetHeight - view.clientHeight;
    setLift(over > 0 ? Math.round(over / line) * line : 0);
  }, [shown, full]);

  // 1 文字ずつ。**タイマーは 1 本だけ**にして、文字数ぶんの setTimeout を積まない。
  // 音も**1 文字ごと**（GS-24）。空白と改行では鳴らさない——間が空くところで
  // 音だけ続くと、何も出ていないのに喋っているように聞こえる。
  useEffect(() => {
    if (!talk || done) return;
    const id = window.setTimeout(() => {
      const letter = full[shown];
      if (letter && letter.trim()) playUi('message');
      setShown(shown + 1);
      // 速さは設定から毎回読む（GS-25）。設定画面で変えたら**次の 1 文字から**効く。
    }, options.charMs);
    return () => window.clearTimeout(id);
  }, [talk, shown, done, full]);

  useEffect(() => {
    setCursor(0);
  }, [choices]);

  // 出ていく立ち絵は、**外へ出切ってから**消す（GS-31）。
  // 画面から出た時点で消せば、途中で切れて見えることはない。
  useEffect(() => {
    const going = portraits.filter((entry) => entry.out);
    if (!going.length) return;
    const timers = going.map((entry) => window.setTimeout(() => dropPortrait(entry.id), entry.ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [portraits, dropPortrait]);

  /**
   * 吹き出しの位置。**出ている間だけ**測る。カメラが動くので少しの間追い続ける。
   *
   * 測るのは `useLayoutEffect`——**描く前**に位置を決めるため（GS-51）。
   * `useEffect` だと 1 フレームだけ位置が無いまま描かれ、
   * 逃げ場の「画面の真ん中」に**最初の吹き出しだけ**出てから飛んでいた。
   */
  const anchor = talk?.bubble ?? '';
  useLayoutEffect(() => {
    if (!anchor) {
      setHead(null);
      return;
    }
    const look = () => setHead(headAt(anchor));
    look();
    const timer = window.setInterval(look, 100);
    return () => window.clearInterval(timer);
  }, [anchor, headAt]);

  /**
   * 流す前に**寸法を測る**（GS-144）。速さは 1 行ぶんの時間で決めるので、
   * 「画面の高さ ＋ 文字の高さ」が分からないと総時間が出ない。
   * 折り返した行も丈に入るよう、行数ではなく**実際の高さ**を測る。
   */
  useLayoutEffect(() => {
    const back = scrollBackRef.current;
    const text = scrollTextRef.current;
    if (!scroll || !back || !text) {
      setScrollRun(null);
      return;
    }
    const from = back.clientHeight;
    const lineH = Number.parseFloat(window.getComputedStyle(text).lineHeight) || 40;
    // 遊ぶ人の好み（設定の「流れる文字」）を掛ける。**流し始めに 1 回だけ読む**——
    // 流している間は設定を開けないので、途中で速さが変わることはない。
    setScrollRun({ from, ms: scrollMs(from, text.offsetHeight, lineH, scroll.speed * options.scrollScale) });
  }, [scroll]);

  // 流れる文字の段送り。**整える → 濃くする → 流す → 薄れる → 次へ**。
  useEffect(() => {
    if (!scroll) {
      setScrollStep('in');
      return;
    }
    // 1 フレーム置いてから黒を明ける。同じフレームで足すと遷移が効かない。
    const id = window.requestAnimationFrame(() => setScrollStep('run'));
    return () => window.cancelAnimationFrame(id);
  }, [scroll]);

  useEffect(() => {
    if (!scroll || scrollStep !== 'run' || !scrollRun) return;
    // 数えるのは**明けてから**。入りのぶん最後が切れないように。
    const id = window.setTimeout(() => setScrollStep('out'), scrollRun.ms);
    return () => window.clearTimeout(id);
  }, [scroll, scrollStep, scrollRun]);

  useEffect(() => {
    if (!scroll || scrollStep !== 'out') return;
    const id = window.setTimeout(onAdvance, SCROLL_OUT_MS);
    return () => window.clearTimeout(id);
  }, [scroll, scrollStep, onAdvance]);

  const stateRef = useRef({ done, choices, onAdvance, onPick, cursor });
  stateRef.current = { done, choices, onAdvance, onPick, cursor };

  useEffect(() => {
    if (!talk && !choices && !scroll) return;
    const onKey = (event: KeyboardEvent) => {
      const now = stateRef.current;
      // ここで止めるので、ゲームの移動キーには届かない。
      event.preventDefault();
      event.stopPropagation();
      // 流れる文字は決定キーで飛ばす（旧作と同じ）。薄れてから次へ進む。
      if (scroll) {
        if (DECIDE.includes(event.code)) setScrollStep('out');
        return;
      }
      if (now.choices) {
        if (UP.includes(event.code)) setCursor((n) => (n + now.choices!.length - 1) % now.choices!.length);
        else if (DOWN.includes(event.code)) setCursor((n) => (n + 1) % now.choices!.length);
        else if (DECIDE.includes(event.code)) {
          playUi('decide');
          now.onPick(now.cursor);
        }
        return;
      }
      if (!DECIDE.includes(event.code)) return;
      // 1 回目は全部出す、2 回目で次へ。
      if (!now.done) setShown(full.length);
      else now.onAdvance();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [talk, choices, scroll, full.length]);

  return (
    <>
      {/* 立ち絵（GS-20）。**暗転より下**に置く——暗転したら一緒に消えてほしい。 */}
      {portraits.map((entry) => {
        // 出入りも効果も**この 3 つの値**で決まる（GS-143）。
        // 置き場所（left / right / center）は CSS が持ち、ここは「そこからどれだけずらすか」だけ。
        const shift = entry.out ? OUT_SHIFT[entry.out] : null;
        return (
          <img
            // 名前が変わったら別の絵。**同じ名前なら差し替え**なので入りのアニメは走り直さない。
            key={entry.id}
            className={`portrait ${entry.slot}${entry.out ? ' leaving' : ''}${entry.from === 'none' ? ' instant' : ` in-${entry.from}`}`}
            src={entry.src}
            alt=""
            style={
              {
                // **単位を付けて置く。** `calc(0 - 14px)` は単位なしの 0 と混ぜられず、
                // 丸ごと捨てられて揺れが効かなくなる（実測）。
                '--dx': shift?.x ?? '0px',
                '--dy': shift?.y ?? '0px',
                '--shake': `${entry.shake}px`,
                // 大きさは効果でだけ動く（GS-145）。軸は足元（CSS の `transform-origin`）。
                '--zoom': `${entry.scale}`,
                // 左右反転（GS-146）。同じ軸で裏返すので立ち位置は動かない。
                '--flip': entry.flip ? '-1' : '1',
                '--ms': `${entry.ms}ms`,
                opacity: entry.opacity,
                // 揺れは**かけ直すたびに走り直させる**。同じ名前のままだと CSS が動かさないので、
                // 中身の同じアニメを 2 つ用意して、かけた回数の偶奇で当てる名前を替える。
                animationName: entry.shake > 0 ? `portrait-shake-${entry.shakeAt % 2 ? 'a' : 'b'}` : undefined,
              } as CSSProperties
            }
          />
        );
      })}

      {/* 暗転。会話の下に敷く。 */}
      <div className="fade" style={{ opacity: fade, transitionDuration: `${fadeMs}ms` }} />

      {/* 流れる文字（GS-23）。旧作のオープニングと同じで、背景を少し暗くして下から上へ。 */}
      {scroll ? (
        <div
          ref={scrollBackRef}
          className={`scroll-back ${scrollStep}`}
          style={{
            background: `rgba(0, 0, 0, ${scroll.dim})`,
            transitionDuration: `${SCROLL_OUT_MS}ms`,
          }}
          onClick={() => setScrollStep('out')}
        >
          {/* 出る位置も時間も**測ってから**入れる（GS-144）。 */}
          <div
            ref={scrollTextRef}
            className="scroll-text"
            style={
              {
                '--scroll-from': `${scrollRun?.from ?? 720}px`,
                animationDuration: `${scrollRun?.ms ?? 0}ms`,
              } as CSSProperties
            }
          >
            {scroll.lines.map((line, index) => (
              <p key={index}>{line || '\u00a0'}</p>
            ))}
          </div>
          {/*
            黒の覆い。**暗幕を張る所を見せない**ための物（GS-23）。
            置いた瞬間は真っ黒で、その裏で暗幕と文字が揃う。明けると
            「暗幕が最初からかかった画面」が現れる。
          */}
          <div className="scroll-cover" style={{ transitionDuration: `${SCROLL_IN_MS}ms` }} />
        </div>
      ) : null}

      {choices ? (
        <div className="choices">
          {choices.map((label, index) => (
            <button
              key={label}
              type="button"
              className={index === cursor ? 'on' : ''}
              onMouseEnter={() => setCursor(index)}
              onClick={() => {
                playUi('decide');
                onPick(index);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* 吹き出し（GS-23）。フィールドの立ち話はこちら。頭の上に出す。 */}
      {talk && talk.bubble ? (
        <div
          className="bubble"
          style={head ? { left: head.x, top: head.y } : { left: '50%', top: '55%' }}
          onClick={() => {
            if (!done) setShown(full.length);
            else onAdvance();
          }}
        >
          {talk.icon ? <img className="bubble-icon" src={talk.icon} alt="" /> : null}
          <div className="bubble-body">
            {/* 名前は出さない（GS-119）。吹き出しは角が喋っている人を指しているので要らない。 */}
            <p className="bubble-text">
              {full.slice(0, shown)}
              {done ? <span className="message-next">▼</span> : null}
            </p>
          </div>
        </div>
      ) : null}

      {talk && !talk.bubble ? (
        <div
          className="message"
          onClick={() => {
            if (!done) setShown(full.length);
            else onAdvance();
          }}
        >
          {talk.name ? <div className="message-name">{talk.name}</div> : null}
          {/* 3 行の窓（GS-146）。あふれたら中身を上へ巻き上げる——窓の丈は変えない。 */}
          <div ref={viewRef} className="message-view">
            <p
              ref={bodyRef}
              // 空にした瞬間は**滑らせない**。戻りを滑らせると、次の人の 1 行目が
              // 下から降りてくるように見える。
              className={`message-body${shown === 0 ? ' at-top' : ''}`}
              style={{ transform: `translateY(${-lift}px)` }}
            >
              {full.slice(0, shown)}
              {done ? <span className="message-next">▼</span> : null}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
