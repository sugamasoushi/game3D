/**
 * コマンド戦闘へ入る・出るときの場面転換（2026-11-09）。
 *
 * 入る: 白く光って集中線が走り、斜めの帯が左右から交互に飛び込んで画面を断ち切る（`cover`）。
 * 覆っているあいだに戦闘の画面へ替え、帯は**同じ向きのまま走り抜けて**戦闘を見せる（`reveal`）。
 * 出る: 黒へフェードアウトして（`exitFade`）、フィールドへ戻してからフェードインする（`exitReturn`）。
 *
 * 時間と帯の並びはここだけで決める。絵は `ui/battle/BattleTransition.tsx`、CSS は `globals.css` の `.battle-wipe`。
 */

/** 帯の数。画面を斜めに切る本数。 */
export const BATTLE_WIPE_BARS = 7;

export const BATTLE_WIPE_MS = {
  /** 最初の白い光。 */
  flash: 150,
  /** 帯 1 本が端から端まで走る時間（入る）。 */
  barIn: 230,
  /** 帯 1 本が走り抜ける時間（見せる）。 */
  barOut: 260,
  /** 帯ごとのずれ（入る）。最後の帯は `stagger × (本数 - 1)` 遅れて出る。 */
  staggerIn: 28,
  /** 帯ごとのずれ（見せる）。 */
  staggerOut: 22,
  /** 覆ったあと、戦闘の画面を組むのに待つ時間。 */
  hold: 60,
  /** 戦闘が終わって黒くなるまで。 */
  exitFade: 400,
  /** フィールドへ戻って明るくなるまで。 */
  exitReturn: 400,
} as const;

export type BattleWipeBar = {
  /** 飛び込んでくる側。走り抜けるのも同じ向き（左から来たら右へ抜ける）。 */
  from: 'left' | 'right';
  /** 走り出すまでの遅れ（ミリ秒）。 */
  delayIn: number;
  delayOut: number;
};

/**
 * 帯の並び（上から順）。向きは交互、**真ん中から外へ順に**走らせる——
 * 上から順だと幕を引くように見えて速さが出ない。
 */
export function battleWipeBars(count = BATTLE_WIPE_BARS): BattleWipeBar[] {
  const n = Math.max(1, Math.floor(count));
  const middle = (n - 1) / 2;
  // 真ん中からの近さで順番を決める（同じ近さなら上が先）。
  const order = Array.from({ length: n }, (_, index) => index)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
  const rank = new Map(order.map((index, place) => [index, place]));
  return Array.from({ length: n }, (_, index) => {
    const place = rank.get(index) ?? 0;
    return {
      from: index % 2 === 0 ? 'left' : 'right',
      delayIn: place * BATTLE_WIPE_MS.staggerIn,
      delayOut: place * BATTLE_WIPE_MS.staggerOut,
    };
  });
}

/** 画面がすっかり覆われるまで（最後の帯が走り終わるまで）。 */
export function battleWipeCoverMs(count = BATTLE_WIPE_BARS): number {
  return Math.max(...battleWipeBars(count).map((bar) => bar.delayIn)) + BATTLE_WIPE_MS.barIn;
}

/** 帯がすっかり抜けて戦闘が見えるまで。 */
export function battleWipeRevealMs(count = BATTLE_WIPE_BARS): number {
  return Math.max(...battleWipeBars(count).map((bar) => bar.delayOut)) + BATTLE_WIPE_MS.barOut;
}
