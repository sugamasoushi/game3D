'use client';

// 戦闘の画面（GS-60）。**流れは持たない**——進めるのは `battle/flow.ts` で、
// ここは「見せる」と「選ばせる」だけ。会話ウィンドウ（`MessageWindow`）と
// メニュー（`Menu`）の関係と同じ分け方。
//
// **面子（`Fighter`）は React の外（`useRef`）に置く。** HP は 1 手ごとに動くので、
// 状態にすると打ち合いのたびに木を作り直すことになる。動いたことは
// `tick` を 1 つ進めて知らせる（プレイヤー座標を store に置かないのと同じ考え）。
//
// キーはメニューと同じ約束: ↑↓ で選ぶ／Enter で決定／Esc で 1 つ戻る。
// **合成のキーイベント（ゲームパッド。GS-58）ではボタンが押されない**ので、
// 選んでいる物を自分で `click()` する。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ailmentDef,
  battleFieldImages,
  battleFieldSky,
  effectDef,
  effectImage,
  effectList,
  enemyImage,
  skillDef,
  type EffectDef,
} from '../../game/battle/book';
import { AilTags } from '../AilTags';
import { enemyFighters, enemyIdOf, gainExp, partyFighters, writeBack } from '../../game/battle/party';
import { skillName } from '../../game/battle/book';
import { runBattle, type BattleAction, type BattleOutcome, type BattleSpoils } from '../../game/battle/flow';
import { alive, type Fighter } from '../../game/battle/rules';
import { characterIcon, characterName, characterStand } from '../../game/characters';
import { STAGE_LUNGE_DELAY_S, STAGE_LUNGE_S, type BattleFigure, type BattleStageSpec, type FigurePose } from '../../game/GameView';
import { spendItem, type GameState } from '../../game/state';
import { itemName, itemUse } from '../../game/items';
import { wouldHelp } from '../../game/battle/heal';
import { playSe, stopBgm } from '../../game/audio';
import { DEV_MODE } from '../../game/devMode';
import { battleSettings } from '../../game/battle/settings';
import type { BattlePresentationContext, BattlePresentationHook } from '../../game/battle/presentation';

// 間（1 行を読ませる・数が動く・当たった印・仰け反り・敵が攻めかかる・「何も持ってない！」）と
// 敵の攻撃音・レベルが上がった音は、戦闘共通の台帳（`battleSettings.json`。GS-106）が持つ。
// 当たった印は**数が動く間より長く**——次の行が出た後も少し残るほうが、何が起きたか追いやすい。
/**
 * 当たった印の動きが終わるまで（GS-85）。**CSS の長さと同じにする**——
 * 点滅（`mep-flicker` 400ms）・回復（`mep-healed` 400ms）・かわす（`mep-jolt` 300ms）・状態異常（`mep-ailed` 400ms）。
 * ここで待ってから帯を動かすので、点滅と帯が重ならない。
 */
const HIT_WAIT: Record<'damage' | 'heal' | 'miss' | 'ailment', number> = {
  damage: 400,
  heal: 400,
  miss: 300,
  ailment: 400,
};
/** ゲーム画面の大きさ（`.screen` と同じ。GS-123 の枠の判定に使う）。 */
const SCREEN = { width: 1280, height: 720 };

/**
 * その枠が画面に収まっているか（GS-123）。
 * **3D の板がカメラのすぐ手前や背後にあると、投影した枠が桁違いに大きくなる**（実測: 幅 128959px）。
 * そういうときは板に重ねず、画面の決まった場所へ出す。
 */
const onScreen = (rect?: FigureRect | null): boolean =>
  !!rect && rect.width > 0 && rect.height > 0 && rect.width <= SCREEN.width && rect.height <= SCREEN.height
  && rect.left > -SCREEN.width && rect.left < SCREEN.width * 2 && rect.top > -SCREEN.height && rect.top < SCREEN.height * 2;

/** 画面ゆれの長さ（CSS の `mep-shake` と同じ）。揺れの途中で次へ進まないように待つ（GS-109）。 */
const SHAKE_MS = 260;
/** 3D の舞台に立たせる味方の立ち絵の高さ（マス。GS-87）。絵の大きさがまちまちなので揃える。 */
const PARTY_FIGURE_CELLS = 2.2;

/** 舞台の板が画面のどこにあるか（画素）。 */
type FigureRect = { left: number; top: number; width: number; height: number };

/**
 * 3D の舞台（GS-87）。**画面（DOM）は描かず、ゲームの 3D に頼む口**。
 * ゲーム本体が `GameView` から作って渡す。渡されなければ今までどおり絵を画面に並べる。
 */
export interface BattleStage {
  /** マップに書いた舞台（GS-89）。書いていなければ null で、背景の絵で戦う。 */
  spec(): BattleStageSpec | null;
  show(spec: BattleStageSpec, figures: BattleFigure[]): void;
  hide(): void;
  rect(id: string): FigureRect | null;
  pose(id: string, pose: FigurePose): void;
}

/**
 * いま何を選んでいるか。**戻れる**ように段で持つ（Esc で 1 つ戻る）。
 *
 * 並びは旧作のまま（GS-80）——**隊列ぜんぶの命令**（`BattleSelectWindow`）を先に選び、
 * 「戦う」を選んだら**1 人ずつ**攻め方（`AttackSelectWindow`）を選ぶ。
 */
type Stage =
  /** 隊列の命令: 戦う / オート / アイテム / 逃げる。**ターンの頭だけ**出る。 */
  | { kind: 'party' }
  /** 攻め方: 攻撃 / 特技 / 魔法。**その人の顔の近く**に出る。 */
  | { kind: 'attack' }
  | { kind: 'skills'; group: string }
  /** 持ち物の一覧（GS-64）。 */
  | { kind: 'items' }
  /** 敵を選ぶ。`skill` が null なら素手。 */
  | { kind: 'target'; skill: string | null }
  /** 味方を選ぶ（持ち物の使い先）。 */
  | { kind: 'friend'; item: string };

/** 攻め方の並び（旧作 `AttackSelectWindow.column` と同じ）。 */
const ATTACK_COMMANDS: Array<{ label: string; group: string | null }> = [
  { label: '攻撃', group: null },
  { label: '特技', group: '特技' },
  { label: '魔法', group: '魔法' },
];


/** オートの手（GS-80）。**生きている敵から 1 体を無作為に**（旧作 `getPlayerAutoAttackTarget`）。 */
function autoAttack(fighters: Fighter[], random: () => number): BattleAction {
  const foes = fighters.filter((who) => who.side === 'enemy' && alive(who));
  const foe = foes[Math.floor(random() * foes.length)] ?? foes[0];
  return { kind: 'attack', target: foe?.id ?? '' };
}

/** 戦闘で使える持ち物（GS-64）。`[id, 個数]` の並び。 */
function battleItems(state: GameState): Array<[string, number]> {
  return [...state.items.entries()].filter(([id, count]) => count > 0 && itemUse(id, 'battle'));
}

/** いま出している当たりの印（GS-68）。`seq` はやり直しの合図。 */
interface HitMark {
  id: string;
  amount: number;
  kind: 'damage' | 'heal' | 'miss' | 'ailment';
  seq: number;
}

/**
 * 浮かぶ字（GS-68 / GS-69）。数・かわした・状態異常の名前。
 * 状態異常はかかった直後に呼ばれるので、**いちばん後ろに足された物**がそれ。
 */
function popText(mark: HitMark, who: Fighter): string {
  if (mark.kind === 'miss') return 'かわした';
  if (mark.kind === 'ailment') {
    const id = who.ailments[who.ailments.length - 1];
    return id ? (ailmentDef(id)?.name ?? id) : '';
  }
  return String(mark.amount);
}

/**
 * 絵を先に読んでおく（GS-85）。**読み終わる約束を持ち回す**——初めて使う絵は
 * 読み込みのあいだに出す時間が過ぎてしまい、動きの途中で次（点滅）が始まっていた。
 */
const imageReady = new Map<string, Promise<void>>();
function preload(src: string): Promise<void> {
  let ready = imageReady.get(src);
  if (!ready) {
    ready = new Promise<void>((resolve) => {
      const img = new Image();
      // 読めなくても止めない（絵なしで進む）。
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = src;
    });
    imageReady.set(src, ready);
  }
  return ready;
}

/** 画面に出している HP・MP の控え（GS-85）。 */
function snapshot(list: Fighter[]): Record<string, { hp: number; mp: number }> {
  return Object.fromEntries(list.map((who) => [who.id, { hp: who.hp, mp: who.mp }]));
}

/**
 * 技の絵（GS-83）。コマを並べた 1 枚絵を**1 コマずつめくり、大きさを伸ばす**。
 * CSS の `steps()` は 1 行の絵しかめくれない（風の刃は 5×2 コマ）ので、ここで書き換える。
 */
function EffectSprite({ def }: { def: EffectDef }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const [first, last] = def.frames;
    const count = Math.max(1, last - first + 1);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      const frame = first + (Math.floor((t * def.fps) / 1000) % count);
      el.style.backgroundPosition = `${-(frame % def.columns) * def.frameWidth}px ${
        -Math.floor(frame / def.columns) * def.frameHeight
      }px`;
      if (def.scale && def.scaleMs) {
        const [from, to] = def.scale;
        const leg = (t % (def.yoyo ? def.scaleMs * 2 : def.scaleMs)) / def.scaleMs;
        const k = def.yoyo && leg > 1 ? 2 - leg : leg;
        el.style.transform = `translate(-50%, -50%) scale(${from + (to - from) * k})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [def]);
  return (
    <div
      ref={ref}
      className="battle-fx"
      style={{ width: def.frameWidth, height: def.frameHeight, backgroundImage: `url("${effectImage(def)}")` }}
      aria-hidden
    />
  );
}

/**
 * 選ぶ一覧（GS-80）。**同じ見た目を 3 か所（隊列の命令・攻め方・技と持ち物）で使う**ので、
 * ここ 1 つにまとめる。`active` が偽なら沈めて、押せなくする（旧作の `move()` と同じ扱い）。
 */
function Picks({
  rows,
  at,
  setAt,
  active = true,
}: {
  rows: Pick[];
  at: number;
  setAt(index: number): void;
  active?: boolean;
}) {
  return (
    <ul className="battle-picks">
      {rows.map((row, index) => (
        <li key={row.label}>
          <button
            type="button"
            // **選んでいる行は明るく、ほかは沈める**（旧作と同じ見せ方。GS-77）。
            className={[active && index === at ? 'on' : '', row.disabled ? 'off' : ''].filter(Boolean).join(' ')}
            disabled={row.disabled || !active}
            // 触ったら**そこへカーソルを移してから**決める。
            // 番号を動かさないと、次に ↑↓ を押したとき別の場所から動き出す。
            onMouseEnter={() => setAt(index)}
            onClick={() => {
              setAt(index);
              row.go();
            }}
          >
            <span className="battle-cursor" aria-hidden>
              ▶
            </span>
            {row.label}
            {row.note ? <span className="battle-note">{row.note}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** かかっている状態異常の札。**戦闘の外（メニュー）と同じ物**を使う（GS-71）。 */
function AilmentTags({ who }: { who: Fighter }) {
  return <AilTags ids={who.ailments} />;
}

/** 並べる 1 行。 */
interface Pick {
  label: string;
  /**
   * 名前の右に小さく出す字（MP・個数）。**名前とつなげて 1 本の文字列にしない**——
   * 同じ大きさで並べると窓がそのぶん広くなり、隊列の窓を押し狭める。
   */
  note?: string;
  disabled?: boolean;
  /**
   * 相手を選ぶ段のとき、その相手（`Fighter.id`）。**文字ではなく絵で選ばせる**ので、
   * どの絵を点滅させるかを知るのに要る（GS-78）。
   */
  foe?: string;
  go(): void;
}

export function BattleView({
  enemies,
  field,
  scene3d,
  state,
  onPresentation,
  signal,
  onEnd,
}: {
  /** 出す敵（台帳の id）。同じ id を並べれば 2 体出る。 */
  enemies: string[];
  /**
   * 背景（GS-79 / GS-94）。`battlefields.json` のキー。呼び出し側は未指定を既定の hill に解決する。
   * 裏で動いている画面の上に半透明の黒を敷いて「同じ場所で戦っている」ように見せる。
   */
  field?: string;
  /**
   * 3D の舞台（GS-87）。背景がマップの 3D（`view: "map"`）で場所を持つとき、
   * 敵と味方を立ち絵の板としてマップに立たせる。
   */
  scene3d?: BattleStage;
  /** 遊んでいる記録。仲間の HP をここから作り、終わったら書き戻す。 */
  state: GameState;
  /** 戦闘の意味を持つ契機だけを通知する。どの演出を使うかはゲーム側の台帳が決める。 */
  onPresentation?(hook: BattlePresentationHook, context?: BattlePresentationContext): void;
  /** デバッグ用の強制終了。通常のゲーム進行では渡されない。 */
  signal?: AbortSignal;
  onEnd(outcome: BattleOutcome, spoils: BattleSpoils): void;
}) {
  const presentationRef = useRef(onPresentation);
  presentationRef.current = onPresentation;
  // 面子は 1 回だけ作る。**描き直しでは作り直さない**（作り直すと HP が満タンに戻る）。
  const fightersRef = useRef<Fighter[] | null>(null);
  if (!fightersRef.current) fightersRef.current = [...partyFighters(state), ...enemyFighters(enemies)];
  const fighters = fightersRef.current;
  /**
   * 画面に出している HP・MP（GS-85）。**`update()` のときだけ実際の値へ寄せる**——
   * 式は当たった瞬間に HP を減らすので、そのまま描くと点滅と帯の動きが同時に始まる。
   * 「絵 → 点滅 → 帯 → 文」の順に見せるため、帯と数と倒れた印はこの控えから描く。
   */
  const [shown, setShown] = useState(() => snapshot(fighters));
  const hpOf = (who: Fighter) => shown[who.id]?.hp ?? who.hp;
  const mpOf = (who: Fighter) => shown[who.id]?.mp ?? who.mp;

  const [tick, setTick] = useState(0);
  const [line, setLine] = useState('');
  /** 手を聞かれている味方。null なら聞かれていない。 */
  const [asking, setAsking] = useState<Fighter | null>(null);
  /**
   * 命令と隊列の窓を出したか（GS-79）。**一度出したら消さない**——
   * 出だしの一文（「〇〇が あらわれた！」）のあいだだけ引っ込めておき、
   * 手を聞かれたところで出す。以降は敵の手番でも枠を残す（旧作と同じ）。
   */
  const [opened, setOpened] = useState(false);
  /**
   * このターン手を聞く人（GS-81）。`flow.ts` がまとめて渡してくる。
   * 並び順に 1 人ずつ聞き、**決めた手は選び終わるまでここに溜める**——
   * 溜めておくから ✖ で前の人へ戻れる（旧作の `previousTurn` と同じ）。
   */
  const membersRef = useRef<Fighter[]>([]);
  /** 決めた手と、**それを決めた段**。戻ったときにその段から選び直させる。 */
  const decidedRef = useRef<Array<{ action: BattleAction; stage: Stage }>>([]);
  /** 全員ぶん決まったら `flow.ts` へ渡す口。 */
  const finishRef = useRef<((orders: Map<string, BattleAction>) => void) | null>(null);
  /** 一言だけ出して消す札（「何も持ってない！」）。出来事の窓を借りる。 */
  const flashRef = useRef<number | null>(null);
  /** 当たった印（GS-68）。1 手ずつ進むので、出ているのは 1 つでよい。 */
  const [hit, setHit] = useState<HitMark | null>(null);
  /** いま出している技の絵（GS-83）。`seq` は同じ絵を続けて出すときの作り直しの合図。 */
  const [fx, setFx] = useState<{ seq: number; foe: string; def: EffectDef } | null>(null);
  const fxSeqRef = useRef(0);
  /** 仰け反っている敵（GS-83。旧作 `leanBack`）。 */
  const [lean, setLean] = useState<string | null>(null);
  /** 攻めかかっている敵（GS-83。旧作 `attackTween`）。 */
  const [lunge, setLunge] = useState<string | null>(null);
  /** 画面ゆれ（GS-83。旧作は敵が攻めかかるたびにカメラを揺らす）。 */
  const [quake, setQuake] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'party' });
  /**
   * いま選んでいる番号（GS-77）。**DOM の焦点ではなく数で持つ**——
   * 焦点は「押せるボタン」だけを辿るので、押せない行（MP 不足の技）を飛ばしてしまい、
   * 一覧のどこに居るのか分からなくなる。カーソル（▶）もこの番号で出す。
   */
  const [at, setAt] = useState(0);

  /** いま出している行を飛ばす関数。決定キーが押したら呼ぶ。 */
  const skipRef = useRef<(() => void) | null>(null);

  const party = fighters.filter((who) => who.side === 'party');
  const foes = fighters.filter((who) => who.side === 'enemy');
  /**
   * 3D の舞台（GS-87 / GS-89）。**マップに舞台が書いてあるときだけ**（マップのプロパティ `BattleStage`）。
   * 開いたときに 1 回だけ聞く——戦いの途中でマップは変わらない。
   */
  const [stageSpec] = useState(() => scene3d?.spec() ?? null);
  const on3d = !!stageSpec;
  /** 板の画面位置。毎フレーム見て、変わったときだけ描き直す。 */
  const [rects, setRects] = useState<Record<string, FigureRect>>({});

  // 3D の舞台（GS-87）。**開いたら立たせ、閉じたら片付ける**。
  useEffect(() => {
    if (!scene3d || !stageSpec) return;
    const figures: BattleFigure[] = [
      ...party.map((who) => ({
        id: who.id,
        side: 'party' as const,
        image: characterStand(who.id) ?? characterIcon(who.id) ?? '',
        height: PARTY_FIGURE_CELLS,
      })),
      ...foes.map((foe) => ({ id: foe.id, side: 'enemy' as const, image: enemyImage(enemyIdOf(foe)) ?? '', height: 0 })),
    ].filter((figure) => figure.image);
    scene3d.show(stageSpec, figures);
    let raf = 0;
    let last = '';
    const tick = () => {
      const next: Record<string, FigureRect> = {};
      // 敵の板に加えて**味方の板**も測る（GS-123）。敵の素手の絵を味方の上に出すのに要る。
      for (const foe of [...foes, ...party]) {
        const rect = scene3d.rect(foe.id);
        if (rect) {
          next[foe.id] = {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }
      }
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setRects(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      scene3d.hide();
    };
    // 面子と場所は最初の 1 回しか使わない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 戦闘演出エディタの試し再生（GS-105）。開発中だけ、**先頭の生きている敵**へ技の絵を出す。
  // 戦いの進行（`act`）は通さない——HP も手番も動かさず、絵と音だけ見せる。
  useEffect(() => {
    if (!DEV_MODE) return;
    let timer = 0;
    const onPreview = (event: Event) => {
      const def = (event as CustomEvent<{ def?: EffectDef }>).detail?.def;
      const foe = fighters.find((who) => who.side === 'enemy' && alive(who));
      if (!def || !foe) return;
      void preload(effectImage(def)).then(() => {
        if (def.se) playSe(def.se);
        fxSeqRef.current += 1;
        const seq = fxSeqRef.current;
        setFx({ seq, foe: foe.id, def });
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setFx((now) => (now?.seq === seq ? null : now)), def.ms);
      });
    };
    window.addEventListener('battle-effect-preview', onPreview);
    return () => {
      window.removeEventListener('battle-effect-preview', onPreview);
      window.clearTimeout(timer);
    };
    // 面子は最初の 1 回しか作らない（`fightersRef`）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 攻撃の絵を先に読んでおく（GS-85）。1 手目から動きが途切れないように。
  useEffect(() => {
    for (const def of effectList()) void preload(effectImage(def));
  }, []);

  // 戦いは 1 回だけ始める。**描き直しでは走らせない**（面子を ref に置くのと同じ理由）。
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const aborted = () => new Error('デバッグ戦闘を強制終了しました');
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (work: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          skipRef.current = null;
          work();
        };
        const onAbort = () => finish(() => reject(aborted()));
        const timer = window.setTimeout(() => {
          finish(resolve);
        }, ms);
        skipRef.current = () => finish(resolve);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });

    void (async () => {
      try {
        if (signal?.aborted) return;
        presentationRef.current?.('battle.start');
        const { outcome, spoils } = await runBattle(fighters, {
        // 文は**出して、一定時間で消す**（GS-79。旧作 `BattleMessageWindow.messageOutput` と同じ）。
        // 出したままにすると、命令を選んでいるあいだも 1 つ前の出来事が居座る。
        say: async (text) => {
          setLine(text);
          await wait(battleSettings().ms.say);
          setLine('');
        },
        // 帯を動かすのは**ここだけ**（GS-85）。帯の動き（200ms）が終わるまで待つ。
        update: async () => {
          setShown(snapshot(fighters));
          setTick((now) => now + 1);
          await wait(battleSettings().ms.beat);
        },
        // 手は**全員ぶんまとめて**聞く（GS-81）。ターンの頭は隊列の命令から。
        commands: (members) =>
          new Promise<Map<string, BattleAction>>((resolve, reject) => {
            const onAbort = () => {
              finishRef.current = null;
              reject(aborted());
            };
            if (signal?.aborted) { onAbort(); return; }
            signal?.addEventListener('abort', onAbort, { once: true });
            membersRef.current = members;
            decidedRef.current = [];
            finishRef.current = (orders) => {
              signal?.removeEventListener('abort', onAbort);
              finishRef.current = null;
              setAsking(null);
              resolve(orders);
            };
            setOpened(true);
            setAsking(members[0] ?? null);
            setStage({ kind: 'party' });
          }),
        // 攻めかかる見せ場（GS-83）。**決定キーで飛ばせる**（`wait` と同じ）——
        // 何度も見る動きなので、急いでいるときに待たせない。
        act: async (attacker, defender, skill) => {
          presentationRef.current?.(attacker.side === 'party' ? 'action.party.start' : 'action.enemy.start', { subject: attacker.id });
          const normal = battleSettings().normalAttack;
          if (attacker.side === 'party') {
            // 味方: 相手の上に技の絵、相手は仰け反る（旧作 `PlayerAttack`）。
            // 素手の攻撃の絵は台帳から（GS-123）。空なら絵を出さない。
            const key = skill?.effect ?? normal.party.effect;
            const def = key ? effectDef(key) : null;
            setLean(defender.id);
            window.setTimeout(() => setLean((now) => (now === defender.id ? null : now)), battleSettings().ms.lean);
            if (!def) {
              await wait(battleSettings().ms.lean);
              return;
            }
            // **絵を読み終えてから**出す（GS-85）。初めて使う絵でも、動きを最後まで見せる。
            await preload(effectImage(def));
            if (signal?.aborted) throw aborted();
            // 音は台帳の指定を先に見る（素手のとき）。空なら絵の側の音（GS-123）。
            const sound = skill ? def.se : (normal.party.se || def.se);
            if (sound) playSe(sound);
            fxSeqRef.current += 1;
            setFx({ seq: fxSeqRef.current, foe: defender.id, def });
            await wait(def.ms);
            setFx(null);
            return;
          }
          // 敵: 攻めかかって、画面が揺れる（旧作 `EnemyAttack`）。
          // 攻めかかる動きは**少し待ってから**始まる（`STAGE_LUNGE_DELAY_S`）。音と揺れはその瞬間に合わせる（GS-109）——
          // 先に鳴らすと、音だけが動きより早く聞こえる。
          const lungeDelayMs = STAGE_LUNGE_DELAY_S * 1000;
          // 敵の攻撃にも絵を出せる（GS-125）。技は `skills.json` の `effect`、素手は戦闘共通の通常攻撃（敵）。
          // **決めていなければ出さない**（音だけ）。出す先は殴られた味方。
          const foeKey = skill ? skill.effect ?? '' : normal.enemy.effect;
          const foeDef = foeKey ? effectDef(foeKey) : null;
          if (foeDef) await preload(effectImage(foeDef));
          if (signal?.aborted) throw aborted();
          setLunge(attacker.id);
          await wait(lungeDelayMs);
          playSe(skill?.se ?? (normal.enemy.se || battleSettings().se.enemyAttack));
          setQuake(true);
          if (foeDef) {
            fxSeqRef.current += 1;
            setFx({ seq: fxSeqRef.current, foe: defender.id, def: foeDef });
          }
          // 残りの間。**攻めかかる動きと揺れが終わるまで**は待つ（GS-110）——味方の点滅は動きの後。
          await wait(Math.max(SHAKE_MS, STAGE_LUNGE_S * 1000, battleSettings().ms.enemyAct - lungeDelayMs, foeDef ? foeDef.ms : 0));
          if (foeDef) setFx(null);
          setLunge(null);
          setQuake(false);
        },
        // 勝ち負けが決まった瞬間に曲を止める（GS-85）。逃げたときは呼ばれない。
        decided: () => { if (signal?.aborted) throw aborted(); stopBgm(); },
        // 音は台帳から（GS-21）。知らないキーは `audio.ts` が印を出す。
        se: (key) => { if (signal?.aborted) throw aborted(); playSe(key); },
        // 当たった印（GS-68）。**時間で消す**——次の手が来る前に消えていてよい。
        hit: async (id, amount, kind) => {
          setHit((now) => ({ id, amount, kind, seq: (now?.seq ?? 0) + 1 }));
          window.setTimeout(() => setHit((now) => (now && now.id === id ? null : now)), battleSettings().ms.hit);
          // **点滅が終わるまで待つ**（GS-85）。帯と文はそのあと。
          await wait(HIT_WAIT[kind]);
        },
        // 持ち物を減らすのはここ（記録を持っているのがこの画面）。
        spendItem: (id) => {
          if (signal?.aborted) throw aborted();
          const ok = spendItem(state, id);
          if (ok) setTick((now) => now + 1);
          return ok;
        },
        random: () => { if (signal?.aborted) throw aborted(); return Math.random(); },
      });
      if (signal?.aborted) return;
      presentationRef.current?.(`battle.${outcome}` as BattlePresentationHook);
      // 減った HP を記録へ戻す。**負けたときも戻す**——倒れたまま次へ行くのではなく、
      // このあとタイトルへ帰るだけなので、記録が食い違わないほうがよい。
      writeBack(state, fighters);
      if (outcome === 'win') {
        // 取り分をここで入れる（GS-63）。**記録を持っているのはこの画面**なので、
        // 「経験は戦闘画面、お金は外」と分けると足し忘れる側ができる。
        state.gold += spoils.gold;
        const say = async (text: string) => {
          setLine(text);
          setTick((now) => now + 1);
          await wait(battleSettings().ms.say);
          setLine('');
        };
        for (const { who, news } of gainExp(state, spoils.exp)) {
          for (const step of news) {
            playSe(battleSettings().se.levelUp);
            await say(`${characterName(who)} は レベル ${step.level} に あがった！`);
            for (const id of step.learned) await say(`${skillName(id)} を おぼえた！`);
          }
        }
      }
      setTick((now) => now + 1);
      if (outcome !== 'lose') {
        setLine(outcome === 'win' ? 'たたかいに かった！' : 'うまく にげきれた！');
        await wait(battleSettings().ms.say);
      }
      onEnd(outcome, spoils);
      } catch (error) {
        if (!signal?.aborted) throw error;
      }
    })();
    // 面子と `state` は最初の 1 回しか使わない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** いまの段。戻る処理と「決めた段」を覚えるのに使う（描き直しを待たずに読める）。 */
  const stageRef = useRef(stage);
  stageRef.current = stage;
  /** 戻る演出の直後だけ、戻り先の「開く」演出を重ねない。 */
  const suppressStagePresentationRef = useRef(false);

  /**
   * いまの人の手を決めて、次の人へ進む（GS-81）。**最後の人なら全員ぶんを渡す**。
   * 2 人目からは攻め方（攻撃 / 特技 / 魔法）を直に聞く（旧作と同じ）。
   */
  const decide = useCallback((action: BattleAction) => {
    const members = membersRef.current;
    const done = decidedRef.current;
    if (!finishRef.current || !members[done.length]) return;
    presentationRef.current?.('command.confirm', { subject: members[done.length]?.id });
    done.push({ action, stage: stageRef.current });
    const next = members[done.length];
    if (next) {
      setAsking(next);
      setStage({ kind: 'attack' });
      return;
    }
    presentationRef.current?.('command.party.complete');
    finishRef.current(new Map(done.map((one, index) => [members[index]!.id, one.action])));
  }, []);

  /** 1 つの命令で**全員ぶん**が決まるとき（逃げる・オート）。 */
  const decideAll = useCallback((orders: Map<string, BattleAction>) => {
    presentationRef.current?.('command.confirm');
    presentationRef.current?.('command.party.complete');
    finishRef.current?.(orders);
  }, []);

  /** 一言だけ出して消す（旧作の `messageOutput`）。出来事の窓を借りる。 */
  const flash = useCallback((text: string, ms: number) => {
    setLine(text);
    if (flashRef.current) window.clearTimeout(flashRef.current);
    flashRef.current = window.setTimeout(() => {
      flashRef.current = null;
      setLine('');
    }, ms);
  }, []);

  /**
   * 隊列の命令（GS-80）。**中身はいつも同じ 4 つ**——旧作と同じで、
   * 選べないときも消さずに沈める（「アイテム」は持っていなくても出し、押すと一言だけ返す）。
   */
  const partyRows = useMemo<Pick[]>(
    () => [
      { label: '戦う', go: () => setStage({ kind: 'attack' }) },
      {
        // オートは**そのターンだけ**（旧作も `TurnFinish` で降ろしている）。
        // 全員が生きている敵を無作為に殴る——手はここで全員ぶん決まる。
        label: 'オート',
        go: () =>
          decideAll(new Map(membersRef.current.map((who) => [who.id, autoAttack(fighters, Math.random)]))),
      },
      {
        label: 'アイテム',
        go: () => {
          // 旧作と同じで**空でも項目は出す**。押したら一言だけ返して、その場に留まる。
          if (battleItems(state).length === 0) flash('何も持ってない！', battleSettings().ms.noItem);
          else setStage({ kind: 'items' });
        },
      },
      {
        // 逃げるのは**隊列ごと**。先頭の人の手として渡す（成否は速さ比べ。GS-60）。
        label: '逃げる',
        go: () => {
          const head = membersRef.current[0];
          if (head) decideAll(new Map([[head.id, { kind: 'run' }]]));
        },
      },
    ],
    [fighters, state, flash, decideAll],
  );

  /** いま選べる並び。段によって中身が変わる。 */
  const picks = useMemo<Pick[]>(() => {
    if (!asking) return [];
    const known = state.members.get(asking.id)?.skills ?? [];

    if (stage.kind === 'party') return partyRows;

    if (stage.kind === 'attack') {
      // 攻め方は**いつも 3 つ**（旧作と同じ）。覚えていない種類は消さずに沈める——
      // 数が人によって変わると、同じ場所を押しても違う物が出ることになる。
      return ATTACK_COMMANDS.map(({ label, group }) => ({
        label,
        disabled: group ? !known.some((id) => skillDef(id)?.kind === group) : false,
        go: () => {
          if (!group) setStage({ kind: 'target', skill: null });
          else setStage({ kind: 'skills', group });
        },
      }));
    }

    if (stage.kind === 'skills') {
      const group = stage.group;
      return known
        .filter((id) => skillDef(id)?.kind === group)
        .map((id) => {
          const skill = skillDef(id);
          return {
            // **払えない技も出す**（消すと「覚えたはずの技が無い」に見える）。押せなくするだけ。
            label: skill?.name ?? id,
            note: skill?.mp ? `MP ${skill.mp}` : undefined,
            disabled: !skill || asking.mp < skill.mp,
            go: () => {
              if (!skill) return;
              // 守り・避けは相手を選ばない。
              if (skill.type !== 'attack') decide({ kind: 'skill', skill: id });
              else setStage({ kind: 'target', skill: id });
            },
          };
        });
    }

    if (stage.kind === 'items') {
      return battleItems(state).map(([id, count]) => ({
        label: itemName(id),
        note: `×${count}`,
        go: () => {
          // 使い先が 1 人なら選ばせない。増えたときだけ選ぶ段へ進む。
          const alive1 = party.filter(alive);
          if (alive1.length <= 1) decide({ kind: 'item', id, target: (alive1[0] ?? asking).id });
          else setStage({ kind: 'friend', item: id });
        },
      }));
    }

    if (stage.kind === 'friend') {
      const id = stage.item;
      const use = itemUse(id, 'battle');
      return party.filter(alive).map((one) => ({
        label: one.name,
        // **効かない相手には使わせない**（数だけ減って何も起きないのが一番困る）。
        disabled: !use || !wouldHelp(one, one.stats, use),
        go: () => decide({ kind: 'item', id, target: one.id }),
      }));
    }

    const skill = stage.skill;
    return foes
      .filter(alive)
      .map((foe) => ({
        label: foe.name,
        foe: foe.id,
        go: () =>
          decide(
            skill ? { kind: 'skill', skill, target: foe.id } : { kind: 'attack', target: foe.id },
          ),
      }));
  }, [asking, stage, state, foes, party, partyRows, decide]);

  /**
   * 1 つ戻る（GS-80 / GS-81）。**開いた順に 1 段ずつ**戻る。
   * 攻め方から戻ると、1 人目なら隊列の命令へ、2 人目以降なら**前の人が最後に選んだ段**へ
   * 戻り、その人の手は取り消す（旧作の `previousTurn` ＋ `pop` と同じ）。
   * 隊列の命令からは戻らない——**戦闘からは Esc で抜けられない。**
   */
  const back = useCallback(() => {
    const now = stageRef.current;
    if (now.kind === 'party') return;
    presentationRef.current?.('command.back');
    suppressStagePresentationRef.current = true;
    if (now.kind === 'attack') {
      const done = decidedRef.current;
      const last = done.pop();
      if (!last) {
        setStage({ kind: 'party' });
        return;
      }
      setAsking(membersRef.current[done.length] ?? null);
      setStage(last.stage);
      return;
    }
    if (now.kind === 'skills') setStage({ kind: 'attack' });
    else if (now.kind === 'items') setStage({ kind: 'party' });
    else if (now.kind === 'friend') setStage({ kind: 'items' });
    else {
      // 相手を選ぶ段は、素手なら攻め方へ、技なら技の一覧へ戻る。
      const group = now.skill ? skillDef(now.skill)?.kind : null;
      setStage(group ? { kind: 'skills', group } : { kind: 'attack' });
    }
  }, []);

  // 段が変わったら先頭へ戻す。**残すと**別の一覧の途中を指したままになる。
  useEffect(() => {
    setAt(0);
  }, [asking, stage]);

  /** 段が開いた契機。戻るときは `command.back` を優先して、直後の段の演出を重ねない。 */
  useEffect(() => {
    if (!asking) return;
    if (suppressStagePresentationRef.current) {
      suppressStagePresentationRef.current = false;
      return;
    }
    const hook: BattlePresentationHook =
      stage.kind === 'party' ? 'command.party.open'
        : stage.kind === 'attack' ? 'command.attack.open'
          : stage.kind === 'items' ? 'command.item.open'
            : stage.kind === 'target' ? 'target.enemy.open'
              : stage.kind === 'friend' ? 'target.friend.open'
                : stage.group === '魔法' ? 'command.magic.open' : 'command.skill.open';
    // 何人目かも渡す（BPE-12）。味方ごとの割り当てがあればそちらを使う。
    const slot = membersRef.current.indexOf(asking) + 1;
    presentationRef.current?.(hook, slot > 0 ? { subject: asking.id, slot } : { subject: asking.id });
  }, [asking, stage]);

  /** 同じ段の中で選択だけが動いたときに通知する。段を開いた直後の先頭位置は含めない。 */
  const cursorStageRef = useRef('');
  const cursorAtRef = useRef(0);
  useEffect(() => {
    if (!asking || picks.length === 0) return;
    const stageKey = `${asking.id}:${stage.kind}:${stage.kind === 'skills' ? stage.group : ''}`;
    if (cursorStageRef.current !== stageKey) {
      cursorStageRef.current = stageKey;
      // 段が変わると直後に先頭へ戻る。前の段の番号はカーソル移動として扱わない。
      cursorAtRef.current = 0;
      return;
    }
    if (cursorAtRef.current !== at) {
      presentationRef.current?.(stage.kind === 'target' || stage.kind === 'friend'
        ? 'cursor.target.change' : 'cursor.command.change', { subject: asking.id });
    }
    cursorAtRef.current = at;
  }, [asking, at, picks.length, stage]);

  useEffect(() => {
    /** 選べる行へ動かす。**押せない行は飛ばす**が、居場所は番号で持つ。 */
    const step = (delta: number) => {
      if (picks.length === 0) return;
      setAt((now) => {
        let next = now;
        for (let i = 0; i < picks.length; i += 1) {
          next = (next + delta + picks.length) % picks.length;
          if (!picks[next]?.disabled) return next;
        }
        return now;
      });
    };

    const onKey = (event: KeyboardEvent) => {
      // **戦闘中はキーを通さない。** 通すと後ろで人が歩く（GS-59 と同じ穴）。
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        back();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'Enter' || event.key === ' ') {
        // 文を読んでいる途中なら飛ばす。手を選んでいるなら決める。
        if (skipRef.current) {
          skipRef.current();
          return;
        }
        const row = picks[at];
        if (row && !row.disabled) row.go();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [back, picks, at]);

  // 舞台の板へ見せ方を渡す（GS-87）。点滅・仰け反り・攻めかかり・選ばれている・倒れた。
  // 描き直すたびに渡す（軽い。板の側は立ち上がりだけを見る）。
  useEffect(() => {
    if (!scene3d || !stageSpec) return;
    for (const foe of foes) {
      scene3d.pose(foe.id, {
        picking: picks[at]?.foe === foe.id,
        flash: !!hit && hit.id === foe.id && hit.kind === 'damage',
        lean: lean === foe.id,
        lunge: lunge === foe.id,
        gone: hpOf(foe) <= 0,
      });
    }
    for (const who of party) {
      scene3d.pose(who.id, {
        flash: !!hit && hit.id === who.id && hit.kind === 'damage',
        gone: hpOf(who) <= 0,
        // コマンドを選んでいる味方は画面の左端へ立つ（GS-103）。
        commanding: asking?.id === who.id,
      });
    }
  });

  /** 用意した背景の絵（奥から手前）。3D舞台が有効なら使わない。 */
  // 3D の舞台で戦うときは**絵を敷かない**（マップの 3D をそのまま見せる。GS-89）。
  const backs = useMemo(() => (field && !on3d ? battleFieldImages(field) : []), [field, on3d]);
  /** 絵のうしろに敷く空（旧作の丘は上側が透けている）。 */
  const sky = field && !on3d ? battleFieldSky(field) : '';

  return (
    <div
      className={
        [
          'battle',
          // 用意した背景を敷くときは**下地の黒を外す**（GS-79）。絵の上に黒を重ねると濁る。
          backs.length > 0 ? 'has-back' : '',
          on3d ? 'has-3d' : '',
          // 揺らすのは**敵が攻めかかったとき**（GS-83。旧作 `EnemyAttack` のカメラゆれ）。
          // 食らったときにも揺らすと、1 手で 2 回揺れて目が疲れる。
          quake ? 'shake' : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
      data-tick={tick}
      // 攻めかかる動きの遅れと長さ（GS-110）。2D の CSS もコードの値で動かす。
      style={{ '--lunge-delay': `${STAGE_LUNGE_DELAY_S * 1000}ms`, '--lunge-ms': `${STAGE_LUNGE_S * 1000}ms` } as CSSProperties}
    >
      {backs.length > 0 ? (
        <div className="battle-stage" style={sky ? { background: sky } : undefined} aria-hidden>
          {backs.map((src) => (
            <img key={src} src={src} alt="" />
          ))}
        </div>
      ) : null}

      <div className={on3d ? 'battle-field on3d' : 'battle-field'}>
        {foes.map((foe) => {
          const src = enemyImage(enemyIdOf(foe));
          const mark = hit && hit.id === foe.id ? hit : null;
          // 相手を選んでいる最中は、**選んでいる 1 体だけ点滅**させる（GS-78）。
          // 文字の一覧ではなく絵で選ばせるので、どれを狙っているかは絵で示すしかない。
          const picking = picks[at]?.foe === foe.id;
          // **マウスでも選べる**（GS-83）。触れたら点滅をそこへ移し、押したら決める。
          const pickIndex = picks.findIndex((row) => row.foe === foe.id);
          const pickable = stage.kind === 'target' && pickIndex >= 0;
          return (
            <div
              key={foe.id}
              // 3D の舞台では**板の位置へ重ねる**（GS-87）。絵は 3D 側が描くので、ここは帯と数字と当たり。
              style={
                on3d
                  ? rects[foe.id]
                    ? {
                        left: rects[foe.id]!.left,
                        top: rects[foe.id]!.top,
                        width: rects[foe.id]!.width,
                        height: rects[foe.id]!.height,
                      }
                    : { display: 'none' }
                  : undefined
              }
              onMouseEnter={pickable ? () => setAt(pickIndex) : undefined}
              onClick={
                pickable
                  ? () => {
                      setAt(pickIndex);
                      picks[pickIndex]?.go();
                    }
                  : undefined
              }
              className={[
                'battle-foe',
                on3d ? 'on3d' : '',
                hpOf(foe) > 0 ? '' : 'gone',
                picking ? 'picking' : '',
                pickable ? 'pickable' : '',
                lean === foe.id ? 'lean' : '',
                lunge === foe.id ? 'lunge' : '',
                // **倒れた相手には印を出さない**（消えていく絵の上で数字が跳ねると読めない）。
                mark && hpOf(foe) > 0 ? `hit-${mark.kind}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {mark ? (
                <span key={mark.seq} className={`battle-pop pop-${mark.kind}`}>
                  {popText(mark, foe)}
                </span>
              ) : null}
              {/*
               * 体力は**絵の上**（GS-78）。名前は出さない——出来事は下の窓が言うので、
               * 絵の横に名前を並べると同じことを 2 か所で言うことになる。
               */}
              <div className="battle-bar">
                <span style={{ width: `${Math.max(0, (hpOf(foe) / foe.stats.hp) * 100)}%` }} />
              </div>
              <AilmentTags who={foe} />
              {on3d ? null : src ? <img src={src} alt={foe.name} /> : <span className="battle-foe-name">{foe.name}</span>}
              {/* 技の絵（GS-83）。**敵の絵の真ん中**に重ねる。 */}
              {fx && fx.foe === foe.id ? <EffectSprite key={fx.seq} def={fx.def} /> : null}
            </div>
          );
        })}
        {/*
         * 敵の素手の攻撃の絵（GS-123）。**殴られた味方の板の上**に重ねる。
         * 味方は敵と違って並べた枠を持たないので、板の画面位置へ直に置く。
         * 3D の舞台のときだけ——2D の戦闘では味方の絵が画面に無い。
         */}
        {fx && !foes.some((foe) => foe.id === fx.foe) ? (
          <div
            className={onScreen(rects[fx.foe]) ? 'battle-party-fx' : 'battle-party-fx loose'}
            style={onScreen(rects[fx.foe]) ? {
              left: rects[fx.foe]!.left,
              top: rects[fx.foe]!.top,
              width: rects[fx.foe]!.width,
              height: rects[fx.foe]!.height,
            } : undefined}
          >
            <EffectSprite key={fx.seq} def={fx.def} />
          </div>
        ) : null}
      </div>

      {/*
       * 命令と隊列は**出だしの一文のあいだだけ**引っ込める（GS-78 → GS-79）。
       * 「文が出ている → 命令と顔が出る」の順に見せたいだけなので、
       * 一度出したら敵の手番でも消さない——出し入れを繰り返すと画面が忙しい。
       */}
      <div className={opened ? 'battle-bottom' : 'battle-bottom hidden'}>
        {/*
         * 命令の窓は**文が出ているあいだ引っ込める**（GS-79）。
         * 旧作は出来事の窓（深度 9999999）が同じ場所に重なる作りで、遊ぶ側には
         * 「文が出る → 消える → 命令が出る」と見える。隊列の窓はそのまま残す。
         */}
        {/*
         * 左の窓は**隊列の命令だけ**（GS-80。旧作の `BattleSelectWindow`）。
         * 攻め方を選んでいるあいだも**消さずに沈める**（旧作の `move()` と同じ）——
         * いま何の途中なのかが分かるし、窓が消えたり出たりしない。
         */}
        <div
          className={[
            'battle-command',
            line ? 'hidden' : '',
            asking && stage.kind === 'party' ? '' : 'dim',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Picks rows={partyRows} at={at} setAt={setAt} active={!!asking && stage.kind === 'party'} />
        </div>
        <ul className="battle-party">
          {party.map((who) => {
            const icon = characterIcon(who.id);
            const mark = hit && hit.id === who.id ? hit : null;
            // 点滅は**「戦う」を押してから**（旧作も `Battle_Select_Submit` で始める）。
            // 隊列の命令を選んでいるあいだは、まだ誰の番でもない。
            const acting = asking?.id === who.id && stage.kind !== 'party';
            return (
              <li
                key={who.id}
                className={[hpOf(who) > 0 ? '' : 'gone', mark ? `hit-${mark.kind}` : ''].filter(Boolean).join(' ')}
              >
                {mark ? (
                  <span key={mark.seq} className={`battle-pop pop-${mark.kind}`}>
                    {popText(mark, who)}
                  </span>
                ) : null}
                {/*
                 * 手を聞かれている人の顔を**点滅**させる（GS-78）。
                 * 旧作と同じ手（明るさ 255↔128 を 400ms で往復）——
                 * 仲間が増えたとき「いま誰が選んでいるのか」が名前だけだと分かりにくい。
                 */}
                {icon ? <img className={acting ? 'acting' : ''} src={icon} alt="" /> : null}
                {/*
                 * 攻め方（攻撃 / 特技 / 魔法）は**その人の顔の近く**に出す（GS-80）。
                 * 旧作も同じ置き方（顔の右 200px・隊列の窓より 75px 上）で、
                 * 「いま誰の番か」を窓の位置そのもので示している。
                 */}
                {acting && stage.kind === 'attack' ? (
                  <div className="battle-attack">
                    <Picks rows={picks} at={at} setAt={setAt} />
                    <button type="button" className="battle-close" onClick={back} aria-label="もどる">
                      ✖
                    </button>
                  </div>
                ) : null}
                {/*
                 * 数は**帯の上に重ねる**（GS-79）。旧作も帯と数を同じ場所に描いていた。
                 * 横に並べると 1 人ぶんの幅が伸びて、仲間が増えたときに収まらない。
                 * HP は**4 割を切ると赤**（旧作と同じ）——数を読む前に危ないと分かる。
                 */}
                <dl className="battle-stats">
                  {/* 名前は**レベルの上**（GS-84）。顔だけだと、仲間が増えたとき誰なのか分かりにくい。 */}
                  <dt className="battle-name">{who.name}</dt>
                  <dt>Lv</dt>
                  <dd>{who.stats.level}</dd>
                  <dt>HP</dt>
                  <dd>
                    <span className={hpOf(who) / who.stats.hp <= 0.4 ? 'battle-gauge low' : 'battle-gauge'}>
                      <span style={{ width: `${Math.max(0, (hpOf(who) / who.stats.hp) * 100)}%` }} />
                      <b>
                        {hpOf(who)} / {who.stats.hp}
                      </b>
                    </span>
                  </dd>
                  <dt>MP</dt>
                  <dd>
                    <span className="battle-gauge mp">
                      <span
                        style={{ width: `${who.stats.mp > 0 ? Math.max(0, (mpOf(who) / who.stats.mp) * 100) : 0}%` }}
                      />
                      <b>
                        {mpOf(who)} / {who.stats.mp}
                      </b>
                    </span>
                  </dd>
                </dl>
                <AilmentTags who={who} />
              </li>
            );
          })}
        </ul>
      </div>

      {/*
       * 相手を選んでいるあいだの一言（GS-80）。旧作 `EnemySelectWindow` と同じ文で、
       * 同じ場所（画面の真ん中・下の帯のすぐ上）に出す。**一覧は出さない**——
       * どれを狙っているかは絵の点滅が示す。
       */}
      {asking && stage.kind === 'target' ? (
        <div className="battle-aim">
          獲物はあいつだ！！
          {/* 戻る ✖（GS-90）。攻め方・技の窓と同じ置き方。Esc と同じく 1 段戻る。 */}
          <button type="button" className="battle-close" onClick={back} aria-label="もどる">
            ✖
          </button>
        </div>
      ) : null}

      {/*
       * 技・持ち物・使い先の一覧（GS-80）。**下の帯いっぱいの窓**に 2 列で出す
       * （旧作 `MagicSkillSelectWindow` / `ItemSelectWindow` と同じ置き方・同じ余白 200px）。
       * 命令の窓より上に重ねるので、開いているあいだは下の段が隠れる。
       */}
      {asking && (stage.kind === 'skills' || stage.kind === 'items' || stage.kind === 'friend') ? (
        <div className="battle-list">
          <p className="battle-ask">
            {stage.kind === 'friend' ? 'だれに つかう？' : `${asking.name} の ${stage.kind === 'items' ? 'どうぐ' : stage.group}`}
          </p>
          <Picks rows={picks} at={at} setAt={setAt} />
          <button type="button" className="battle-close" onClick={back} aria-label="もどる">
            ✖
          </button>
        </div>
      ) : null}

      {/*
       * 出来事の 1 行（GS-79）。**命令の窓と同じ場所に重ねる**（旧作と同じ置き方）。
       * 文があるときだけ出し、`say` が一定時間で消す——画面のいちばん下には置かない。
       */}
      {line ? <div className="battle-message">{line}</div> : null}
    </div>
  );
}
