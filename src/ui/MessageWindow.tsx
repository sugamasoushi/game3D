'use client';

// 会話ウィンドウ。**DOM で作る**（構想 §3.1）——日本語の折り返しをブラウザに任せられる。
//
// 決定で「全部出す → 次へ」の 2 段。ツクールと同じ手触り。
// 開いているあいだは**キーをゲームへ通さない**（構想 §5.2 の入力モード）。
// 捕まえるのは capture 段階なので、ゲーム側（window の keydown）まで届かない。

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { playUi } from '../game/audio';
import { options } from '../game/options';
import { faceCount, portraitLook, scrollMs, useUi } from './store';
import { ComicPager } from './ComicPager';
import { GAME_SCREEN_WIDTH } from '../mep3d/mapCamera';

/**
 * 流れる文字の出入り（ミリ秒。GS-23）。
 * 入りは**黒からの明け**——暗幕を張る所は見せず、`暗幕がかかった画面`が現れる。
 */
const SCROLL_IN_MS = 600;
const SCROLL_OUT_MS = 800;
/** 前置きのフェードインと、背景が暗くなるまでの時間（GS-186）。旧作のエンディングと同じ 1 秒。 */
const LEAD_IN_MS = 1000;

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

/**
 * 吹き出しの寸法（GS-200 / GS-201。旧作の `BubbleTalk` と `MessageWindow.createBubbleWindow` に合わせた）。
 * 窓は **2 行**——1 行で済む会話は 1 行の丈。あふれたら 2 行ごとに止めて送る。
 *
 * 置き所は基準点（`bubbleAt`。足元から一定の画素だけ上）から決める。
 * - **上の辺は会話の 2 人で揃える**（GS-202）。喋る人と話し相手の基準点のうち**高い方**から `BUBBLE_RISE` 上。
 *   どちらが喋っても吹き出しの上の辺は同じ高さで、丈が違っても上の辺は揃う
 * - 相手と反対の側へ広げる。右へ広げるなら左の縁が基準点の `BUBBLE_SIDE` 左、左へなら右の縁が `BUBBLE_SIDE` 右
 * - 角は下の辺の**広げた側と逆へ少し寄せた所**（幅 `BUBBLE_TAIL_W`）を付け根に、基準点を指す（GS-203）。
 *   右へ広げたら左寄り（付け根の真ん中が幅の `BUBBLE_TAIL_AT`）、左へ広げたら右寄り（その反対）
 */
const BUBBLE_ROWS = 2;
const BUBBLE_RISE = 134;
const BUBBLE_SIDE = 16;
const BUBBLE_TAIL_W = 48;
const BUBBLE_TAIL_AT = 1 / 3;
/** 角の先とキャラチップの上の辺のすき間（GS-204）。 */
const BUBBLE_TIP_GAP = 2;
/** 画面の縁から離す幅。 */
const BUBBLE_MARGIN = 8;

export function MessageWindow({
  onAdvance,
  onPick,
  bubbleAt,
}: {
  onAdvance(): void;
  onPick(index: number): void;
  /** 吹き出しの角が指す所が画面のどこか（GS-23 / GS-200）。3D 側に聞く。 */
  bubbleAt(who: string): { x: number; y: number; top: number } | null;
}) {
  const talk = useUi((s) => s.talk);
  const scroll = useUi((s) => s.scroll);
  const telop = useUi((s) => s.telop);
  const choices = useUi((s) => s.choices);
  const fade = useUi((s) => s.fade);
  const fadeMs = useUi((s) => s.fadeMs);
  const portraits = useUi((s) => s.portraits);
  const dropPortrait = useUi((s) => s.dropPortrait);
  /**
   * 吹き出しの角が指す所と、広げる側（GS-200）。カメラが動くので少しずつ追う。
   * `side` は吹き出しを角から**どちらへ**広げるか。
   */
  const [head, setHead] = useState<{ x: number; y: number; top: number; side: 'left' | 'right'; level: number } | null>(null);
  /** 吹き出しを置いた所（GS-200）。大きさを測ってから画面に収めて決める。 */
  const [bubbleBox, setBubbleBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    /** 角の三点（枠の左上からの画素）。付け根の左・右と先。 */
    tail: string;
  } | null>(null);
  /** 吹き出しの窓の行数（GS-200）。1 行で済む会話は 1 行の丈。 */
  const [bubbleRows, setBubbleRows] = useState(1);
  /**
   * 流れる文字の段（GS-23）。`in` は**画面が真っ黒**で、その裏で暗幕と文字を置く。
   * `run` で黒が明けると、**暗幕が最初からかかった画面**が現れる。
   */
  const [scrollStep, setScrollStep] = useState<'in' | 'show' | 'run' | 'out'>('in');
  /**
   * 前置きのある流れる文字で、**流し始めたか**（GS-186）。途中で飛ばしたとき、
   * 流し始める前なら前置きはその場で薄れ、流している最中なら流れながら薄れる。
   */
  const [scrollMoved, setScrollMoved] = useState(false);
  /**
   * 流れる文字の**測った寸法**（GS-144）。`from` は下から出す距離（画面の高さ）、
   * `ms` は流れ切るまでの時間。行数で時間が変わるので、置いてから測って決める。
   */
  const [scrollRun, setScrollRun] = useState<{ from: number; ms: number; leadTop?: number; dist?: number } | null>(null);
  /**
   * テロップの段（GS-171）。出た瞬間は真っ黒（`run`）で、押されたら薄れる（`out`）。
   * **入りは滑らせない**——旧作も黒を一瞬で置いてから薄めていた（場面が切り替わった合図）。
   */
  const [telopStep, setTelopStep] = useState<'run' | 'out'>('run');
  const scrollBackRef = useRef<HTMLDivElement | null>(null);
  const scrollTextRef = useRef<HTMLDivElement | null>(null);
  /** 前置きの行（GS-186）。真ん中に置くために丈を測る。 */
  const scrollLeadRef = useRef<HTMLDivElement | null>(null);
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
  /**
   * ここまで打ったら止まる文字数（GS-199）。**3 行で窓が埋まったら押されるまで待つ**——
   * 巻き上げだけだと、読み終わる前に上の行が流れていってしまう。
   * -1 は「まだ測っていない」（測るまでは打たない）。
   */
  const [limit, setLimit] = useState(-1);
  /** 窓が埋まる所（文字数。GS-199）。全文を窓と同じ幅で並べて測る。 */
  const pausesRef = useRef<number[]>([]);
  if (source !== full) {
    setSource(full);
    setShown(0);
    setLimit(-1);
  }
  const done = shown >= full.length;
  /** 窓が埋まって押されるのを待っている（GS-199）。 */
  const paused = !done && limit >= 0 && shown >= limit;
  /** 次に止まる所。無ければ終わりまで。 */
  const nextLimit = (from: number) => pausesRef.current.find((at) => at > from) ?? full.length;

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

  /**
   * 窓が埋まる所を測る（GS-199）。見えない写し（`measureRef`）に**頭から何文字か**を窓と同じ幅で並べ、
   * **▼ の印も付けて**丈が 4・7・10… 行になる最初の文字数を探す（二分探し）。その文字の手前で止める。
   * 印を付けて測るのは、行末ぴったりで止めると ▼ だけが次の行へ落ち、窓が 1 行ずれるから。
   * 改行の直後で止まったときは、▼ が空の行に出る。
   * 打ちながら測らないのは、押して「窓が埋まる所まで出す」ときに止まる所が先に要るから。
   * 文字の画面上の位置（`getClientRects`）では測らない——画面ごと縮めて映しているので
   * 縮尺がかかり、隠れたタブでは 0 になる。丈（`offsetHeight`）なら縮尺に左右されない。
   */
  const measureRef = useRef<HTMLParagraphElement | null>(null);
  const bubbled = Boolean(talk?.bubble);
  useLayoutEffect(() => {
    const pauses: number[] = [];
    const mirror = measureRef.current;
    if (mirror) {
      const lineH = Number.parseFloat(window.getComputedStyle(mirror).lineHeight) || 35;
      const mark = document.createElement('span');
      mark.className = 'message-next';
      mark.textContent = '▼';
      // 吹き出しは 2 行の窓（GS-200）。▼ は文の外（右下の隅）に出すので、印なしで測る。
      const page = bubbled ? BUBBLE_ROWS : 3;
      const rowsOf = (count: number, marked = !bubbled) => {
        mirror.textContent = full.slice(0, count);
        if (marked) mirror.append(mark);
        return Math.round(mirror.offsetHeight / lineH);
      };
      if (bubbled) setBubbleRows(Math.min(BUBBLE_ROWS, Math.max(1, rowsOf(full.length, false))));
      // 行数がこれを超えたら止まる。
      let edge = page;
      let low = 0;
      while (low < full.length && rowsOf(full.length) > edge) {
        // low 文字では edge 行に収まり、high 文字ではあふれる。
        let high = full.length;
        while (high - low > 1) {
          const mid = (low + high) >> 1;
          if (rowsOf(mid) > edge) high = mid;
          else low = mid;
        }
        if (low > (pauses[pauses.length - 1] ?? 0)) pauses.push(low);
        // 次の窓は 1 枚ぶん先。空行が続いて窓 2 枚ぶん飛んでも、境目は窓の行数ごとに数える
        // （ここは印なしの丈。末尾の改行は行を増やさない）。
        edge += page;
        const rows = rowsOf(high, false);
        while (rows > edge) edge += page;
        low = high;
      }
      mirror.textContent = '';
    }
    pausesRef.current = pauses;
    setLimit(pauses[0] ?? full.length);
  }, [full, bubbled]);

  // 1 文字ずつ。**タイマーは 1 本だけ**にして、文字数ぶんの setTimeout を積まない。
  // 音も**1 文字ごと**（GS-24）。空白と改行では鳴らさない——間が空くところで
  // 音だけ続くと、何も出ていないのに喋っているように聞こえる。
  useEffect(() => {
    if (!talk || done || shown >= limit) return;
    const id = window.setTimeout(() => {
      const letter = full[shown];
      if (letter && letter.trim()) playUi('message');
      setShown(shown + 1);
      // 速さは設定から毎回読む（GS-25）。設定画面で変えたら**次の 1 文字から**効く。
    }, options.charMs);
    return () => window.clearTimeout(id);
  }, [talk, shown, done, full, limit]);

  useEffect(() => {
    setCursor(0);
  }, [choices]);

  /**
   * 押さずに送る会話（GS-172）。**文字が出そろってから**数える——
   * 出し始めから数えると、長い文ほど読む間が短くなり、行によって間が変わる。
   * 押せば今までどおり早く送れる（こちらは上のキー・クリックの道）。
   */
  useEffect(() => {
    if (!talk || talk.hold === undefined || !(done || paused)) return;
    // 窓が埋まって止まったときも、同じ間を置いて続きを打つ（GS-199）。
    const id = window.setTimeout(done ? onAdvance : () => setLimit((at) => nextLimit(at)), Math.max(0, talk.hold));
    return () => window.clearTimeout(id);
  }, [talk, done, paused, onAdvance]);

  // 押さずに消えるテロップ（GS-172）。出しておく時間が来たら薄れ始める。
  useEffect(() => {
    if (!telop || telop.hold === undefined || telopStep !== 'run') return;
    const id = window.setTimeout(() => setTelopStep('out'), Math.max(0, telop.hold));
    return () => window.clearTimeout(id);
  }, [telop, telopStep]);

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
  const pair = talk?.pair ?? '';
  const bubbleAtRef = useRef(bubbleAt);
  bubbleAtRef.current = bubbleAt;
  useLayoutEffect(() => {
    if (!anchor) {
      setHead(null);
      return;
    }
    const look = () => {
      const at = bubbleAtRef.current(anchor);
      if (!at) {
        setHead(null);
        return;
      }
      // 相手と反対の側へ広げる（GS-200。旧作の `FieldObjectCheck`）。
      // 相手が分からなければ、主人公は右・相手は左。
      const other = pair ? bubbleAtRef.current(pair) : null;
      const side: 'left' | 'right' =
        other && Math.abs(other.x - at.x) > 1 ? (other.x > at.x ? 'left' : 'right') : anchor === 'player' ? 'right' : 'left';
      // 上の辺を揃える高さ（GS-202）。2 人のうち高い方（画面の上の方）の基準点。
      const level = other ? Math.min(at.y, other.y) : at.y;
      setHead((now) =>
        now && now.x === at.x && now.y === at.y && now.top === at.top && now.side === side && now.level === level ? now : { ...at, side, level },
      );
    };
    look();
    const timer = window.setInterval(look, 100);
    return () => window.clearInterval(timer);
  }, [anchor, pair]);

  /**
   * 吹き出しを置く（GS-200）。大きさは**全文で先に決まっている**ので、出し始めから動かない。
   * 置き方と角は上の `BUBBLE_*` の説明（GS-201 / GS-202）。画面からはみ出すなら内へ寄せ、
   * 角の先は基準点を指したまま。
   */
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const box = bubbleRef.current;
    if (!box || !head) {
      setBubbleBox(null);
      return;
    }
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const want = head.side === 'right' ? head.x - BUBBLE_SIDE : head.x + BUBBLE_SIDE - width;
    const left = Math.round(Math.min(Math.max(BUBBLE_MARGIN, want), GAME_SCREEN_WIDTH - BUBBLE_MARGIN - width));
    const top = Math.round(Math.max(BUBBLE_MARGIN, head.level - BUBBLE_RISE));
    // 角（GS-203）。付け根は持ち主の側へ少し寄せる（右へ広げたら左寄り）。先は基準点。
    // 細い吹き出しでも付け根が角の丸みへ掛からないよう、縁から 12px 内に収める。
    const at = head.side === 'right' ? width * BUBBLE_TAIL_AT : width * (1 - BUBBLE_TAIL_AT);
    const baseA = Math.round(Math.min(Math.max(12, at - BUBBLE_TAIL_W / 2), Math.max(12, width - 12 - BUBBLE_TAIL_W)));
    const baseB = baseA + BUBBLE_TAIL_W;
    const tipX = Math.round(head.x - left);
    // 先はキャラチップの上の辺から `BUBBLE_TIP_GAP` 上（GS-204）。人ごとの背丈に合う。
    const tipY = Math.round(head.top - BUBBLE_TIP_GAP - top);
    const tail = `${baseA},${height - 2} ${tipX},${tipY} ${baseB},${height - 2}`;
    setBubbleBox((now) =>
      now && now.left === left && now.top === top && now.tail === tail && now.width === width && now.height === height
        ? now
        : { left, top, width, height, tail },
    );
  }, [head, full, bubbleRows]);

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
    const ms = scrollMs(from, text.offsetHeight, lineH, scroll.speed * options.scrollScale);
    // 前置き（GS-186）。前置きは真ん中、残りは画面の下の縁から。**運ぶ距離は残りが上へ抜け切るまで**——
    // 速さの物差し（1 行ぶんの時間）は今までと同じ。
    const lead = scrollLeadRef.current;
    if (scroll.lead && lead) {
      setScrollRun({ from, ms, leadTop: Math.max(0, (from - lead.offsetHeight) / 2), dist: from + text.offsetHeight });
      return;
    }
    setScrollRun({ from, ms });
  }, [scroll]);

  // 流れる文字の段送り。**整える → 濃くする → 流す → 薄れる → 次へ**。
  useEffect(() => {
    if (!scroll) {
      setScrollStep('in');
      setScrollMoved(false);
      return;
    }
    setScrollMoved(false);
    // 1 フレーム置いてから黒を明ける。同じフレームで足すと遷移が効かない。
    // 前置きがあれば、まず前置きを出す（`show`。GS-186）。
    const id = window.requestAnimationFrame(() => setScrollStep(scroll.lead ? 'show' : 'run'));
    return () => window.cancelAnimationFrame(id);
  }, [scroll]);

  // 前置き（GS-186）。**フェードインしてから `hold` だけ止め、それから流す。**
  useEffect(() => {
    if (!scroll || scrollStep !== 'show') return;
    const id = window.setTimeout(() => {
      setScrollMoved(true);
      setScrollStep('run');
    }, LEAD_IN_MS + (scroll.hold ?? 3000));
    return () => window.clearTimeout(id);
  }, [scroll, scrollStep]);

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

  // テロップ（GS-171）。**薄れ切ってから次へ**——先に進めると、次の絵が黒の裏で動いて見える。
  useEffect(() => {
    if (!telop) {
      setTelopStep('run');
      return;
    }
    if (telopStep !== 'out') return;
    const id = window.setTimeout(onAdvance, telop.ms);
    return () => window.clearTimeout(id);
  }, [telop, telopStep, onAdvance]);

  /**
   * 会話を押したとき（GS-199）。打っている途中なら**窓が埋まる所まで**出す、
   * 止まっていたら続きを打つ、出そろっていたら次へ。
   */
  const press = () => {
    if (limit < 0) return;
    if (paused) setLimit(nextLimit(limit));
    else if (!done) setShown(limit);
    else onAdvance();
  };

  const stateRef = useRef({ choices, onPick, cursor, press });
  stateRef.current = { choices, onPick, cursor, press };

  useEffect(() => {
    if (!talk && !choices && !scroll && !telop) return;
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
      // テロップも決定キーで消せる（GS-171）。クリックと同じ扱い。
      // **押して消さない指定**（GS-172）なら受けない——時間が来るまで出したまま。
      if (telop) {
        if (telop.click && DECIDE.includes(event.code)) setTelopStep('out');
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
      // 1 回目は窓が埋まる所まで出す、2 回目で続き（または次へ）。
      now.press();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [talk, choices, scroll, telop]);

  /**
   * 喋っている人（GS-170）。**その人の絵を手前に出し、ほかの人の絵は少し暗くする。**
   * 絵が重なっていても「いま誰が喋っているか」が見て分かるように——
   * 旧作は 1 枚ずつ出していたので要らなかったが、3 枚並べると誰の声か分からなくなる。
   */
  const speaker = talk?.who ?? '';
  // 暗くするのは**人の絵が 2 枚以上あるとき**だけ。1 枚しか出ていなければ暗くする意味がない
  // （場面絵・看板のような `who` の無い絵は数えない——喋らないので暗くもしない）。
  const facesOut = faceCount(portraits);

  return (
    <>
      {/*
        立ち絵（GS-20）。**暗転より下**に置く——暗転したら一緒に消えてほしい。
        入れ物で囲んであるのは、**この中だけで前後を決める**ため（GS-170。`isolation: isolate`）。
        `z-index` を絵に直に付けると、会話ウィンドウより前に出て文字が読めなくなる（実際に出た）。
      */}
      <div className="portraits">
      {portraits.map((entry) => {
        // 出入りも効果も**この 3 つの値**で決まる（GS-143）。
        // 置き場所（left / right / center）は CSS が持ち、ここは「そこからどれだけずらすか」だけ。
        const shift = entry.out ? OUT_SHIFT[entry.out] : null;
        // 喋っている人の絵は手前へ、ほかの人の絵は少し暗く（GS-170）。決め方は店（store）側。
        const { talking, dimmed } = portraitLook(entry, speaker, facesOut);
        return (
          <img
            // 名前が変わったら別の絵。**同じ名前なら差し替え**なので入りのアニメは走り直さない。
            key={entry.id}
            className={`portrait ${entry.slot}${talking ? ' talking' : ''}${dimmed ? ' dimmed' : ''}${entry.out ? ' leaving' : ''}${entry.from === 'none' ? ' instant' : ` in-${entry.from}`}`}
            src={entry.src}
            alt=""
            style={
              {
                // 置き場所からのずれ（GS-170）。**画面の幅・高さに対する割合**。
                '--ox': `${entry.x}%`,
                '--oy': `${entry.y}%`,
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
      </div>

      {/* 漫画のようにめくる絵（GS-188）。立ち絵の上・会話の下。 */}
      <ComicPager />

      {/* 暗転。会話の下に敷く。 */}
      <div className="fade" style={{ opacity: fade, transitionDuration: `${fadeMs}ms` }} />

      {/*
        テロップ（GS-171）。**画面を黒で覆って真ん中に一言**——旧作の「━ 翌朝 ━」。
        黒は一瞬で置き、押されたら文字ごと薄れて消える。立ち絵より後に描くので、
        絵が出ていても隠れる（そのために暗転よりも後ろに書かない）。
      */}
      {telop ? (
        <div
          className={`telop ${telopStep}`}
          style={
            {
              background: `rgba(0, 0, 0, ${telop.dim})`,
              transitionDuration: `${telop.ms}ms`,
              // 字の大きさ（GS-172）。書かなければ CSS の既定（56px）。
              ...(telop.size ? { '--telop-size': `${telop.size}px` } : {}),
              // 押して消さないなら**掴まない**——下の画面へも渡さないよう、覆いはそのまま。
              ...(telop.click ? {} : { cursor: 'default' }),
            } as CSSProperties
          }
          onClick={() => {
            if (telop.click) setTelopStep('out');
          }}
        >
          <div className="telop-text">
            {telop.lines.map((line, index) => (
              <p key={index}>{line || ' '}</p>
            ))}
          </div>
        </div>
      ) : null}

      {/*
        前置きのある流れる文字（GS-186。旧作のエンディング）。背景がゆっくり暗くなり、前置きが真ん中に
        フェードインで出る。止まってから、残り（画面の下の縁から入る）と一緒に上へ流れる。
        押すといつでも薄れて終わる。
      */}
      {scroll && scroll.lead ? (
        <div
          ref={scrollBackRef}
          className={`scroll-back scroll-lead-mode ${scrollStep}`}
          style={{
            background: `rgba(0, 0, 0, ${scrollStep === 'in' ? 0 : scroll.dim})`,
            transitionDuration: `${scrollStep === 'out' ? SCROLL_OUT_MS : LEAD_IN_MS}ms`,
          }}
          onClick={() => setScrollStep('out')}
        >
          <div
            className="scroll-stage"
            style={{
              transform: scrollMoved ? `translateY(${-(scrollRun?.dist ?? 0)}px)` : 'none',
              transitionDuration: `${scrollRun?.ms ?? 0}ms`,
            }}
          >
            <div
              ref={scrollLeadRef}
              className="scroll-lines scroll-lead"
              style={{ top: `${scrollRun?.leadTop ?? 0}px`, transitionDuration: `${LEAD_IN_MS}ms` }}
            >
              {scroll.lines.slice(0, scroll.lead).map((line, index) => (
                <p key={index}>{line || '\u00a0'}</p>
              ))}
            </div>
            <div ref={scrollTextRef} className="scroll-lines" style={{ top: `${scrollRun?.from ?? 720}px` }}>
              {scroll.lines.slice(scroll.lead).map((line, index) => (
                <p key={index}>{line || '\u00a0'}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* 流れる文字（GS-23）。旧作のオープニングと同じで、背景を少し暗くして下から上へ。 */}
      {scroll && !scroll.lead ? (
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

      {/*
        吹き出し（GS-23）。フィールドの立ち話はこちら。旧作の `BubbleTalk` と同じ出し方（GS-200）——
        **大きさは全文で先に決める**（打つにつれて伸びない）。幅は一番長い行、丈は 2 行まで。
        位置が決まるまでは見せない（1 フレームだけ左上に出ないように）。
      */}
      {talk && talk.bubble ? (
        <div
          ref={bubbleRef}
          className="bubble"
          style={
            {
              left: bubbleBox?.left ?? 0,
              top: bubbleBox?.top ?? 0,
              visibility: bubbleBox ? 'visible' : 'hidden',
            } as CSSProperties
          }
          onClick={press}
        >
          {/* 角（GS-201）。枠の下の辺から基準点へ。下の辺の線は付け根のあいだだけ角の色で消す。 */}
          {bubbleBox ? (
            <svg className="bubble-tail" width={bubbleBox.width} height={bubbleBox.height} aria-hidden="true">
              <polyline points={bubbleBox.tail} />
            </svg>
          ) : null}
          {talk.icon ? <img className="bubble-icon" src={talk.icon} alt="" /> : null}
          <div className="bubble-body">
            {/* 幅を決める見えない写し。全文を置くので、一番長い行の幅になる。 */}
            <p className="bubble-text bubble-sizer" aria-hidden="true">
              {full}
            </p>
            {/* 名前は出さない（GS-119）。吹き出しは角が喋っている人を指しているので要らない。 */}
            <div ref={viewRef} className="bubble-view" style={{ '--rows': bubbleRows } as CSSProperties}>
              <p
                ref={bodyRef}
                className={`bubble-text${shown === 0 ? ' at-top' : ''}`}
                style={{ transform: `translateY(${-lift}px)` }}
              >
                {full.slice(0, shown)}
              </p>
              <p ref={measureRef} className="bubble-text message-measure" aria-hidden="true" />
            </div>
          </div>
          {/* 送りの印は文の外（右下の隅）。文の中に置くと、一番長い行の後ろで折り返してしまう。 */}
          {done || paused ? <span className="message-next bubble-next">▼</span> : null}
        </div>
      ) : null}

      {talk && !talk.bubble ? (
        <div
          className="message"
          onClick={press}
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
              {done || paused ? <span className="message-next">▼</span> : null}
            </p>
            {/* 窓が埋まる所を測るための見えない写し（GS-199）。 */}
            <p ref={measureRef} className="message-body message-measure" aria-hidden="true" />
          </div>
        </div>
      ) : null}
    </>
  );
}
