// 殴られた敵の仰け反り（GS-83。旧作 `leanBack`）。**カメラから見て奥へ押されて、元の位置へ戻る**（2026-10-21）。
// 以前は上へ跳ねていた。奥行きは水平だけで、高さは変えない。

/** 仰け反りの長さ（秒）。旧作 `leanBack` と同じ。 */
export const LEAN_BACK_S = 0.2;
/** 奥へ下がる最大の距離（マス）。 */
export const LEAN_BACK_CELLS = 0.5;

/**
 * 仰け反り始めてからの割合 `k`（0〜1）のときのずれ（マス。ワールドの x・z）。
 * `yawDeg` はカメラの水平の向き（度）。奥 = カメラの向こう側（-sin, -cos）。
 * 前半で一気に下がり、後半でゆっくり戻る。範囲の外（始まる前・終わった後）はずれ無し。
 */
export function leanBackOffset(k: number, yawDeg: number, cells = LEAN_BACK_CELLS): { x: number; z: number } {
  if (!(k > 0 && k < 1)) return { x: 0, z: 0 };
  // 下がるのは最初の 3 割、残りで戻る。どちらも端でなめらか。
  const PEAK = 0.3;
  const t = k < PEAK ? k / PEAK : 1 - (k - PEAK) / (1 - PEAK);
  const amount = t * t * (3 - 2 * t) * cells;
  const yawR = (yawDeg * Math.PI) / 180;
  return { x: -Math.sin(yawR) * amount, z: -Math.cos(yawR) * amount };
}
