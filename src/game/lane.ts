// マスの揃え（GS-240。旧 GS-116 の `laneSlip` を Rapier の問い合わせで作り直したもの）。
//
// ほぼ縦か横に歩いていて、**前が塞がっている**のに**今居るマスの列の中央なら進める**とき、
// 横（進む向きと直角）へ中央まで寄せる量を返す。寄せる動きも Rapier の体で動かすので壁には食い込まない。
// 1 マス幅の通路へ少しずれて入ろうとしたとき、引っかからずに吸い込まれる。
// 広い所（今の横位置のまま進める所）では何もしない。人は見ない（地形だけ）。

/** 前を見る距離（マス。体の半径の外側）。 */
const LANE_PROBE = 0.25;
/** 「ほぼ縦か横に歩いている」とみなす割合。斜め歩きでは寄せない。 */
const LANE_AXIS = 0.7;
/** 前を見る・寄せる先を見るときに体を浮かせる高さ（マス）。坂の上りを「塞がっている」と取り違えないため。 */
const LANE_LIFT = 0.25;
/**
 * 「今の横位置のまま進めるか」を見るときに体を太らせる量（マス）。体はマスとほぼ同じ幅の四角（GS-241）で、
 * Rapier は面から隙間（0.02）を空けて止めるので、**ほぼ真ん中まで寄せないと 1 マス幅には入れない**。
 */
const LANE_MARGIN = 0.03;

export interface LaneQuery {
  unit: number;
  /** 体の幅の半分（マス）。 */
  half: number;
  /** その足元（ワールド）に、幅の半分が `half`（マス）の体が地形と重ならずに入るか。 */
  fits(wx: number, wy: number, wz: number, half: number): boolean;
}

/**
 * 横へ寄せる量（ワールド）。寄せないなら null。
 * `move` は歩く向き（長さは問わない）、`speed` はこのフレームに進む距離（ワールド）——寄せる量もこれを超えない。
 */
export function laneNudge(
  position: { x: number; y: number; z: number },
  move: { x: number; z: number },
  speed: number,
  query: LaneQuery,
): { x: number; z: number } | null {
  const { unit } = query;
  const length = Math.hypot(move.x, move.z);
  if (length < 1e-6 || speed <= 0) return null;
  const alongX = Math.abs(move.x) >= Math.abs(move.z);
  const major = alongX ? move.x : move.z;
  if (Math.abs(major) < LANE_AXIS * length) return null;
  const dir = Math.sign(major);
  const y = position.y + LANE_LIFT * unit;
  const reach = (query.half + LANE_PROBE) * unit;
  const side = alongX ? position.z : position.x;
  const center = (Math.floor(side / unit) + 0.5) * unit;
  const offset = center - side;
  if (Math.abs(offset) < 0.001 * unit) return null;
  const main = alongX ? position.x : position.z;
  const at = (m: number, cross: number, half: number) =>
    alongX ? query.fits(m, y, cross, half) : query.fits(cross, y, m, half);
  // 今の横位置のまま（少し太らせても）進めるなら寄せない。
  if (at(main + dir * reach, side, query.half + LANE_MARGIN)) return null;
  // 列の中央なら進め、そこまで横へ動ける。
  if (!at(main + dir * reach, center, query.half) || !at(main, center, query.half)) return null;
  const step = Math.sign(offset) * Math.min(Math.abs(offset), speed);
  return alongX ? { x: 0, z: step } : { x: step, z: 0 };
}
