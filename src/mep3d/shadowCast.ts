import { Vector2, Vector3 } from 'three';

/**
 * スプライト影が地面のどこに着くか。マップはセルの高さ場なので 1 次元ウォークで足りる。
 */

/**
 * 影の下の地面をマスあたり何点取るか。壁の面はここの刻みでしか折れないので、
 * 粗いと壁の手前に浮いた急斜面に影が乗る。16 で 1/16 マス（32px チップの 2px）。
 */
const SAMPLES_PER_CELL = 16;

/** スプライト高さ 1 マスを何区間に切るか。8 なら階段が曲線に見える。 */
export const SEGMENTS_PER_CELL = 8;

/** 着地点を探す歩行の上限（セル）。 */
export const MAX_WALK = 24;

/** 影の幅を切る帯の数。角では片側だけ登る。 */
export const STRIPS_ACROSS = 8;

/** 隣帯の段差がこれ以上なら角。隙間を伸ばさない。 */
export const BREAK_HEIGHT = 0.5;

/**
 * 隣帯の着地距離がこれ以上離れたら切る（セル）。
 * 壁の角では片方が壁で止まり、隣は角を回り込んで床の先まで伸びる。
 * そのまま繋ぐと、壁の面から床の遠くへ向かう板が**何も無い空中に立つ**。
 */
export const BREAK_ALONG = 0.5;

/**
 * 影の道に沿った地面の高さ。1/SAMPLES_PER_CELL マスごと。
 * **投げ元の柱は「物は無いが地面はある」扱い**（DEC-219）。固体を見ないのは自分の板で
 * 自分の影を止めないため。地面まで無視して `baseY` で平らにすると、坂の上では
 * 足元の 1 マスだけ水平になり、隣のマスとの境目で影が段になって欠ける。
 */
/**
 * 固体の判定（DEC-240）。マス内の位置と光線の向きも受け取る。
 *
 * **対角線の壁はマスの半分しか塞がない**ので、整数のマスだけでは線の位置が出せない。
 * `fx` / `fz` はマス内の位置（0〜1）、`dirX` / `dirZ` は光線の水平の向き。
 * 省くとマスの中心・向きなしとして扱われ、今までと同じ答えになる。
 */
export type SolidTest = (
  x: number,
  y: number,
  z: number,
  fx?: number,
  fz?: number,
  dirX?: number,
  dirZ?: number,
) => boolean;

/**
 * 遮る物と同じマスの中で塞ぐか（DEC-241）。位置と光の向きは必ず渡す。
 * `SolidTest` と違って省略を許さない——自分のマスは位置で答えが変わる形だけを見るため。
 */
export type SelfSolidTest = (
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
  dirX: number,
  dirZ: number,
) => boolean;

export function profile(
  isSolid: SolidTest,
  start: Vector2,
  baseY: number,
  away: Vector3,
  distance: number,
  ceiling: number,
  caster: { x: number; z: number },
  isBoard?: (x: number, y: number, z: number) => boolean,
  /** 使い回しの受け皿。長さが合えば新しく作らない（DEC-208）。 */
  reuse?: Float32Array,
  /**
   * **自分のマスの中で**塞ぐか（DEC-241）。対角壁だけを見る判定。
   * 渡さないと自分のマスは足元の床として扱う（DEC-219 のまま）。
   */
  selfSolid?: SelfSolidTest,
  /**
   * 面の高さ（DEC-215）。マス内の位置まで見るので、坂の上では影が斜めに乗る。
   * 渡さないと `isBoard` の頃と同じで、マスの底で平らに扱う。
   */
  boardTop?: (x: number, y: number, z: number, fx: number, fz: number) => number | null,
): Float32Array {
  const steps = Math.ceil(distance * SAMPLES_PER_CELL);
  const out = reuse && reuse.length === steps + 1 ? reuse : new Float32Array(steps + 1);
  /** そのマスの天面。自分のマスだけ床として扱う（DEC-219 / DEC-241）。 */
  const at = (x: number, z: number, fx: number, fz: number): number =>
    x === caster.x && z === caster.z
      ? casterColumn(selfSolid, x, z, baseY, ceiling, fx, fz, boardTop, away.x, away.z)
      : columnTop(isSolid, x, z, baseY, ceiling, isBoard, fx, fz, boardTop, away.x, away.z);
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let lastPx = 0;
  let lastPz = 0;
  for (let i = 0; i <= steps; i += 1) {
    const s = i / SAMPLES_PER_CELL;
    const px = start.x + away.x * s;
    const pz = start.y + away.z * s;
    const x = Math.floor(px);
    const z = Math.floor(pz);
    let top = at(x, z, px - x, pz - z);
    // **斜めに 1 歩進んだら、間の 2 マスも見る**（DEC-242）。
    //
    // 光線を点で刻んで進めるので、マスの角をまたぐ 1 歩で**両隣のマスを踏まずに**
    // 向こう側へ出てしまう。対角壁を階段状に並べた崖は角 1 点でしか接していないため、
    // ここを抜けた帯だけ壁に当たらず、影に帯 1 本ぶんの切れ目ができる（実測 96 か所中 32 か所）。
    // 見るのは**共有する格子点**で、対角線はそこを通るのでちょうど線の上に当たる。
    if (i > 0 && (x !== lastX || z !== lastZ)) {
      // **マスを出た所でも、出る前のマスを見る**（DEC-242）。
      // マスの中で線を跨いでから次のサンプルまでに出てしまうと、点だけでは取りこぼす。
      const dx = px - lastPx;
      const dz = pz - lastPz;
      let t = 1;
      if (x !== lastX && dx !== 0) t = Math.min(t, ((dx > 0 ? lastX + 1 : lastX) - lastPx) / dx);
      if (z !== lastZ && dz !== 0) t = Math.min(t, ((dz > 0 ? lastZ + 1 : lastZ) - lastPz) / dz);
      const ex = lastPx + dx * t * 0.999;
      const ez = lastPz + dz * t * 0.999;
      const exit = at(lastX, lastZ, ex - lastX, ez - lastZ);
      if (exit > top) top = exit;
    }
    if (i > 0 && x !== lastX && z !== lastZ) {
      const cornerX = x > lastX ? x : lastX;
      const cornerZ = z > lastZ ? z : lastZ;
      const a = at(lastX, z, cornerX - lastX, cornerZ - z);
      const b = at(x, lastZ, cornerX - x, cornerZ - lastZ);
      if (a > top) top = a;
      if (b > top) top = b;
    }
    out[i] = top;
    lastX = x;
    lastZ = z;
    lastPx = px;
    lastPz = pz;
  }
  return out;
}

/**
 * 投げ元の柱の地面（DEC-219）。固体・壁は見ない。足元の床チップの高さだけを取る。
 * 面が無ければ `baseY`（今までどおり）。**足元のセルは境目にかかるので 2 段見る**——
 * 坂の高い端に立つと `floor(baseY)` が 1 つ上のセルを指す。
 */
/**
 * 遮る物と同じマスの高さ（DEC-241）。
 *
 * **自分のマスでも、マスの中で塞いでいる所は壁として受ける。**
 * 対角壁はマスの真ん中を斜めに横切るので、キャラが**その壁と同じマスに立てる**。
 * ここを床の高さだけで答えると、目の前の壁が影から消えて折れ線が平らになる
 * （セル -8,7,6 で出た。影がまるごと出なくなる）。
 * 塞いでいなければ今までどおり足元の床の高さ（DEC-219）。坂の上で影が斜めに乗るのはこの働き。
 */
function casterColumn(
  selfSolid: SelfSolidTest | undefined,
  x: number,
  z: number,
  baseY: number,
  ceiling: number,
  fx: number,
  fz: number,
  boardTop: ((x: number, y: number, z: number, fx: number, fz: number) => number | null) | undefined,
  dirX: number,
  dirZ: number,
): number {
  if (selfSolid) {
    for (let y = Math.floor(ceiling); y >= Math.floor(baseY); y -= 1) {
      if (selfSolid(x, y, z, fx, fz, dirX, dirZ)) return y + 1;
    }
  }
  return casterTop(x, z, baseY, fx, fz, boardTop);
}

function casterTop(
  x: number,
  z: number,
  baseY: number,
  fx: number,
  fz: number,
  boardTop?: (x: number, y: number, z: number, fx: number, fz: number) => number | null,
): number {
  if (!boardTop) return baseY;
  const from = Math.floor(baseY + 0.001);
  for (let y = from; y >= from - 1; y -= 1) {
    const top = boardTop(x, y, z, fx, fz);
    if (top !== null && top !== undefined) return top;
  }
  return baseY;
}

function columnTop(
  isSolid: SolidTest,
  x: number,
  z: number,
  baseY: number,
  ceiling: number,
  isBoard?: (x: number, y: number, z: number) => boolean,
  fx = 0.5,
  fz = 0.5,
  boardTop?: (x: number, y: number, z: number, fx: number, fz: number) => number | null,
  dirX = 0,
  dirZ = 0,
): number {
  // セルは整数キーで引く。`ceiling` / `baseY` は小数で来ることがある
  // （キャラの背丈が 1.5 マスなど）。そのまま回すと何にも当たらない（DEC-160）。
  for (let y = Math.floor(ceiling); y >= Math.floor(baseY); y -= 1) {
    if (isSolid(x, y, z, fx, fz, dirX, dirZ)) return y + 1;
    if (!isBoard?.(x, y, z)) continue;
    // 面の高さはマスの中で変わる（DEC-215）。坂ならここが斜めになる。
    const top = boardTop?.(x, y, z, fx, fz);
    /** 高さを取れない面は今までどおりセルの底。少し浮かせて板の上に乗る。 */
    return top === null || top === undefined ? y + 0.012 : top;
  }
  return baseY;
}

/** 光線が地面に着く点。（地面に沿った距離, 高さ）。length は高さ 1 マスあたりの届く距離。 */
export function drape(
  heights: Float32Array,
  baseY: number,
  length: number,
  low: number,
  high: number,
  segments: number,
  /** 使い回しの受け皿。中の Vector2 ごと再利用する（DEC-208）。 */
  reuse?: Vector2[],
): Vector2[] {
  if (segments < 1 || heights.length === 0) return reuse ? ((reuse.length = 0), reuse) : [];
  const out = reuse ?? [];
  for (let i = 0; i <= segments; i += 1) {
    const y = low + (high - low) * (i / segments);
    const slot = out[i];
    if (slot) land(heights, baseY, length, y, slot);
    else out[i] = land(heights, baseY, length, y);
  }
  out.length = segments + 1;
  return out;
}

/**
 * 高さ場は「柱の天面」しか持たないが、面は 2 種類ある。
 *
 *   天面（水平）… 光線が降りてきて乗る。`高さ = 天面` なので距離は閉じた式で出る
 *   壁面（垂直）… 天面が光線より上へ立ち上がった境目。`距離 = 境目` のまま高さだけが変わる
 *
 * 両者を混ぜて 1 本の折れ線で補間すると、壁が「1 サンプル幅の急斜面」になり、
 * 影が壁の手前に浮いて寝そべって見える。ここで面の種類を分けて解く（DEC-66）。
 * 光線は行ごとに独立して歩くので、壁を何枚跨いでも同じ扱いで済む。
 */
function land(heights: Float32Array, baseY: number, length: number, y: number, out?: Vector2): Vector2 {
  // 使い回しの受け皿があれば新しく作らない（DEC-208）。毎フレーム走るので効く。
  const put = (x: number, v: number): Vector2 => (out ? out.set(x, v) : new Vector2(x, v));
  if (length <= 0.0001) return put(0, heights[0] - baseY);

  let above = heights[0] - baseY;
  for (let i = 0; i < heights.length; i += 1) {
    const surface = heights[i] - baseY;
    const ray = y - i / SAMPLES_PER_CELL / length;
    if (ray > surface) {
      above = surface;
      continue;
    }
    if (i === 0) return put(0, surface);

    // 柱が変わる境目。サンプル間なので位置の誤差は 1/(2×SAMPLES_PER_CELL) マス。
    const edge = (i - 0.5) / SAMPLES_PER_CELL;
    if (surface > above + 1e-6) {
      const atEdge = y - edge / length;
      // 角を越えずに壁面へ当たったなら、そのまま面へ貼る。
      if (atEdge <= surface) return put(edge, Math.max(atEdge, above));
      // 越えた場合は下の天面へ落ちる。
    }
    // 天面に乗る。`y - 距離/length = surface` を解くだけなので誤差ゼロ。
    // 着地はこの区間の中にしかないので、境目と現在のサンプルで挟む。
    // 挟まないと歩いた範囲の外へ飛び、影が異常に伸びる。
    const here = i / SAMPLES_PER_CELL;
    return put(Math.min(Math.max((y - surface) * length, edge), here), surface);
  }

  const last = (heights.length - 1) / SAMPLES_PER_CELL;
  return put(last, y - last / length);
}
