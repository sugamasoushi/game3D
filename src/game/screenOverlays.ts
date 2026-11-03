// 画面の重ね表示（GS-300）。**ゲームの状態**で画面全体にかぶせる表示。
//
// 似た物が 2 つあるので持ち場を分けておく。
// - **画面エフェクト**（`mep3d/screenEffects.ts`）: マップが持つ画作り（霧・差し込む光・揺れ）。
//   エディタで置いて、WebGL で描く。マップに居るあいだずっと出る。
// - **画面の重ね表示**（ここ）: ゲームの都合で出したり消したりする合図（危険域・毒・瀕死など）。
//   マップのデータは持たず、ゲームの側が「いま出す／出さない」を決める。
//   描くのは **canvas の上の CSS の板**（`ScreenOverlayLayer`）——3D の描き方と関わらないので、
//   戦闘の画面や品質設定に引きずられず、足すのも CSS とここに 1 行足すだけで済む。
//
// 種類を足すときは: ここに名前を足す → `globals.css` に `.screen-overlay--<名前>` を書く →
// ゲームの側で `useUi.getState().setScreenOverlay('<名前>', true/false)` を呼ぶ。
// 重なり順はこの並び順（後ろほど上）。

export const SCREEN_OVERLAY_KINDS = [
  // ランダムエンカウントの枠の中（GS-299）。画面の縁を赤く脈打たせる。
  'danger',
] as const;

export type ScreenOverlayKind = (typeof SCREEN_OVERLAY_KINDS)[number];
