// 敵シンボルに触れたか（GS-209）。**マスで数える**——体が四角になって（GS-116）相手のマスの手前で止まるので、
// 中心どうしの距離では届かない。同じマスに居るか、どちらかが相手の方を向いて体の端が相手のマスに接しているとき触れた。
// 隣の列をすれ違うだけ（向いていない）では触れない。
// **角どうしでも触れる**（2026-10-20）。前は横を「中心が相手のマスの幅に入っていること」で見ていたので、
// 列が少しずれて相手の角に止められると、ぶつかって進めないのに戦闘が始まらなかった。

/**
 * 敵シンボルに触れたと見なす、体の端と相手のマスとの隙間（マス。GS-209）。
 * 当たりで止まると隙間はほぼ 0。浮動小数のずれと、うろつく相手が離れかけた瞬間のぶんだけ見る。
 */
export const SYMBOL_TOUCH = 0.1;
/** 角で触れたと見なす横の重なり（マス）。これより浅いのは触れていない（面がぴったり並んだだけ）。 */
const SIDE_OVERLAP = 0.01;

/** 体の芯のマス（2026-10-11。キャラクターの大きさで広がる。倍率 1 なら居るマス 1 つ）。 */
export const coreCells = (center: number, half: number): [number, number] => {
  const inner = Math.max(0, half - 0.5);
  if (inner === 0) return [Math.floor(center), Math.floor(center)];
  return [Math.floor(center - inner + 1e-6), Math.floor(center + inner - 1e-6)];
};
export const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

/** 触れたかを見る 1 人ぶん。位置はマス、`half` は体の幅の半分（マス）、`aim` は向いている向き（ワールド）。 */
export interface Toucher {
  at: { x: number; z: number };
  half: number;
  aim: { x: number; z: number };
}

type Core = { x: [number, number]; z: [number, number] };
const core = (who: Toucher): Core => ({ x: coreCells(who.at.x, who.half), z: coreCells(who.at.z, who.half) });

/**
 * `from` の体（半幅 `half` の四角）が、向いている先で `to` のマスに接しているか。
 * 横は体どうしが重なっていればよい（角でも触れる）。
 */
const touches = (from: Toucher, to: Toucher, toCore: Core): boolean => {
  const alongX = Math.abs(from.aim.x) >= Math.abs(from.aim.z);
  const sign = Math.sign(alongX ? from.aim.x : from.aim.z);
  if (sign === 0) return false;
  const cross = alongX ? from.at.z : from.at.x;
  const toCross = alongX ? to.at.z : to.at.x;
  if (Math.abs(cross - toCross) >= from.half + to.half - SIDE_OVERLAP) return false;
  const pos = alongX ? from.at.x : from.at.z;
  const [lo, hi] = alongX ? toCore.x : toCore.z;
  const gap = sign > 0 ? lo - (pos + from.half) : pos - from.half - (hi + 1);
  return gap <= SYMBOL_TOUCH && gap > -(hi - lo + 1);
};

/** プレイヤーと敵シンボルが触れているか。高さの差は呼ぶ側で見る。 */
export function symbolTouching(me: Toucher, it: Toucher): boolean {
  const mine = core(me);
  const its = core(it);
  if (overlaps(mine.x, its.x) && overlaps(mine.z, its.z)) return true;
  return touches(me, it, its) || touches(it, me, mine);
}
