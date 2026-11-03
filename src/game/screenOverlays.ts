// 画面の重ね表示（GS-300・GS-301）。**ゲームの状態**で画面全体にかぶせる表示。
//
// 似た物が 2 つあるので持ち場を分けておく。
// - **画面エフェクト**（`mep3d/screenEffects.ts`）: マップが持つ画作り（霧・差し込む光・揺れ）。
//   エディタで置いて、WebGL で描く。マップに居るあいだずっと出る。
// - **画面の重ね表示**（ここ）: ゲームの都合で出したり消したりする合図（危険域・毒・瀕死など）。
//   マップのデータは持たず、ゲームの側が「いま出す／出さない」を決める。
//   描くのは **canvas の上の CSS の板**（`ScreenOverlayLayer`）——3D の描き方と関わらないので、
//   戦闘の画面や品質設定に引きずられず、足すのも CSS とここに 1 行足すだけで済む。
//
// 種類を足すときは: ここに名前と出す場面を足す → `globals.css` に `.screen-overlay--<名前>` を書く →
// ゲームの側で `useUi.getState().setScreenOverlay('<名前>', true/false)` を呼ぶ。
// 重なり順はこの並び順（後ろほど上）。
//
// **出す場面**（`scene`）: 旗が立っていても、その場面でなければ出さない。
// たとえば危険域の旗は戦闘中も立ったまま（枠の中で戦闘が始まる）だが、戦闘の画面には出さない。

/** どの画面で出すか。`field` は歩いている画面、`battle` は戦闘の画面。 */
export type ScreenOverlayScene = 'field' | 'battle';

export const SCREEN_OVERLAYS = [
  // ランダムエンカウントの枠の中（GS-299）。画面の縁を赤く脈打たせる。
  { kind: 'danger', scene: 'field' },
  // 戦闘で味方全体の HP が 1 割未満（GS-301）。見た目は `danger` と同じ。
  { kind: 'pinch', scene: 'battle' },
] as const satisfies readonly { kind: string; scene: ScreenOverlayScene }[];

export type ScreenOverlayKind = (typeof SCREEN_OVERLAYS)[number]['kind'];

/** 味方全体の HP がこの割合**未満**なら `pinch` を出す（GS-301）。 */
export const PINCH_HP_RATE = 0.1;

/**
 * 味方全体の HP の割合が `PINCH_HP_RATE` 未満か（GS-301）。
 * **全員の今の HP の合計 ÷ 全員の最大 HP の合計**で見る（倒れた人も 0 として数に入る）。味方が居なければ false。
 */
export function partyInPinch(members: readonly { hp: number; maxHp: number }[]): boolean {
  const max = members.reduce((sum, one) => sum + Math.max(0, one.maxHp), 0);
  if (max <= 0) return false;
  const now = members.reduce((sum, one) => sum + Math.max(0, one.hp), 0);
  return now / max < PINCH_HP_RATE;
}
