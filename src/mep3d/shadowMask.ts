import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType, Vector2, Vector3 } from 'three';
import type { Shape } from './types';

/**
 * ブロックが光を遮る高さ。点ごとの天井。描画はせず陰影項として読む。
 */

/** マスあたりのテクセル。32px チップの 1/4。高さの細かさだけ。 */
export const TEXELS_PER_CELL = 8;

/** マスクの一辺の上限。 */
const MAX_TEXELS = 4096;

/** 輪郭計算の余白（テクセル）。フィルタが辺の両側を読むため。高さは書かない。 */
const EDGE_MARGIN = 2;

/** 輪郭が影の外で読む値（セル）。 */
const OUTSIDE = -1;

/** 影の遠端が溶ける幅（セル）。輪郭ではなく高さ側。 */
export const FADE_CELLS = 0.5;

export interface MaskColumn {
  cell: { x: number; y: number; z: number };
  /** 上面の高さ。セル Y=0 からのセル数。 */
  height: number;
  /** 中身の下端。無いと空中の箱が真下まで影を落とす。 */
  bottom?: number;
  /** 箱以外（斜面など）は頂点が違う。無ければ箱。 */
  shape?: Shape;
  /** 90 度単位。斜面の向き。 */
  rotation?: number;
  /** XZ の実寸。省略時はマスいっぱい。 */
  foot?: { x0: number; z0: number; x1: number; z1: number };
  /**
   * 面 1 枚の板の 4 隅の高さ（DEC-127）。屋根や庇が影を落とすのに使う。
   * `cell.y` からの高さ。並びは北西・北東・南東・南西。
   */
  plate?: number[];
  /**
   * 影を投げるだけで受けない（DEC-76）。壁チップ用。
   * 板 1 枚なので面に影を落とすと厚み 2px の帯にしかならず、絵として意味が無い。
   */
  castOnly?: boolean;
  /**
   * まとめる相手（DEC-130）。同じ印の柱は投影点を集めて 1 枚の凸包にする。
   * グループの id を入れる。家などを「1 個の物」として影を出すため。
   */
  silhouette?: string;
  /**
   * 影を敷く地面の高さ（DEC-136）。入れておくと足元を探さずここへ敷く。
   * プレハブは 1 個の物なので、屋根も壁も同じ地面へ落とす。
   * 入れないと屋根のマスは屋根のすぐ下を地面と見なし、影が屋根の上に出る。
   */
  groundY?: number;
}

/** 遮蔽が無いテクセルが読む床下。どの実床より低ければよい。 */
const NO_FLOOR = -16;

export interface ShadowMaskData {
  /** 先頭テクセルの位置（セル）。 */
  origin: Vector2;
  texelsPerCell: number;
  width: number;
  height: number;
  /** 天井の基準高さ（セル）。 */
  baseY: number;
  /** テクセルごとの天井。行は `width`。`baseY` から。 */
  data: Float32Array<ArrayBuffer>;
  /** 輪郭の内側までの距離（セル）。外は負。距離なので辺がテクセル間に出る。 */
  edge: Float32Array<ArrayBuffer>;
  /** 影の下端（`baseY` からのセル）。箱の下は光が届く。 */
  under: Float32Array<ArrayBuffer>;
}

/** 上面 `top`、影に沿って `distance` 先の天井。光線は length セル進むと 1 セル登る。 */
function ceilingFor(top: number, distance: number, length: number): number {
  if (length <= 0) return top;
  return top - distance / length;
}

function spanInto(
  point: Vector2,
  cell: Vector2,
  away: Vector2,
  sizeX = 1,
  sizeZ = 1,
): [number, number] {
  let low = 0;
  let high = Infinity;
  const axes: [number, number, number][] = [
    [away.x, point.x - cell.x, sizeX],
    [away.y, point.y - cell.y, sizeZ],
  ];
  for (const [direction, offset, size] of axes) {
    if (Math.abs(direction) < 1e-6) {
      if (offset < 0 || offset > size) return [-1, -1];
      continue;
    }
    const first = (offset - size) / direction;
    const second = offset / direction;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
  }
  if (high < low || high < 0) return [-1, -1];
  return [Math.max(low, 0), high];
}

/** 遮蔽の影の下端。箱の下を通る光線は止まらない。 */
function floorFor(bottom: number, exitDistance: number, length: number): number {
  if (length <= 0 || !Number.isFinite(exitDistance)) return -Infinity;
  return bottom - exitDistance / length;
}

/** マスの影の内側までの距離（セル）。外は負。六角形の半平面の最近。 */
function edgeDistance(
  point: Vector2,
  cell: Vector2,
  sweep: Vector2,
  across: Vector2,
  sizeX = 1,
  sizeZ = 1,
): number {
  const nearSide = (at: number, low: number, high: number, sweep: number): number => {
    if (sweep > 1e-6) return at - low;
    if (sweep < -1e-6) return high - at;
    return Math.min(at - low, high - at);
  };
  const x1 = cell.x + sizeX;
  const y1 = cell.y + sizeZ;
  const nearest = Math.min(
    nearSide(point.x, cell.x, x1, sweep.x),
    nearSide(point.y, cell.y, y1, sweep.y),
  );

  const corners = [
    cell.x * across.x + cell.y * across.y,
    x1 * across.x + cell.y * across.y,
    cell.x * across.x + y1 * across.y,
    x1 * across.x + y1 * across.y,
  ];
  const near = Math.min(...corners);
  const far = Math.max(...corners);
  const along = point.x * across.x + point.y * across.y;
  return Math.min(nearest, along - near, far - along);
}

/** マスクを組む。投げるものが無ければ null。 */
export function buildShadowMask(
  columns: MaskColumn[],
  away: Vector3,
  length: number,
  lowCell: { x: number; y: number; z: number },
  highCell: { x: number; y: number; z: number },
  lengthOf?: (column: MaskColumn) => number,
): ShadowMaskData | null {
  if (columns.length === 0 || length <= 0) return null;

  const flat = new Vector2(away.x, away.z);
  let tallest = 0;
  for (const column of columns) tallest = Math.max(tallest, column.height);
  const reach = tallest * length;

  const origin = new Vector2(
    lowCell.x + Math.min(flat.x * reach, 0) - 1,
    lowCell.z + Math.min(flat.y * reach, 0) - 1,
  );
  const farX = highCell.x + 1 + Math.max(flat.x * reach, 0) + 1;
  const farZ = highCell.z + 1 + Math.max(flat.y * reach, 0) + 1;

  const width = Math.ceil((farX - origin.x) * TEXELS_PER_CELL);
  const height = Math.ceil((farZ - origin.y) * TEXELS_PER_CELL);
  if (width <= 0 || height <= 0 || width > MAX_TEXELS || height > MAX_TEXELS) return null;

  const baseY = lowCell.y;
  const data = new Float32Array(width * height);
  const edge = new Float32Array(width * height).fill(OUTSIDE);
  const under = new Float32Array(width * height).fill(Infinity);
  const point = new Vector2();
  const square = new Vector2();

  const across = new Vector2(-flat.y, flat.x);
  const sweep = new Vector2();

  for (const column of columns) {
    const reach = lengthOf ? lengthOf(column) : length;
    if (reach < 0.04) continue;
    const top = column.height - baseY;
    const bottom = (column.bottom ?? lowCell.y) - baseY;
    const sweepX = flat.x * top * reach;
    const sweepZ = flat.y * top * reach;
    sweep.set(sweepX, sweepZ);

    const foot = column.foot;
    const x0 = foot?.x0 ?? column.cell.x;
    const z0 = foot?.z0 ?? column.cell.z;
    const x1 = foot?.x1 ?? column.cell.x + 1;
    const z1 = foot?.z1 ?? column.cell.z + 1;
    const sizeX = Math.max(x1 - x0, 1e-6);
    const sizeZ = Math.max(z1 - z0, 1e-6);

    const boxLowX = Math.min(x0, x0 + sweepX, x1, x1 + sweepX);
    const boxHighX = Math.max(x0, x0 + sweepX, x1, x1 + sweepX);
    const boxLowZ = Math.min(z0, z0 + sweepZ, z1, z1 + sweepZ);
    const boxHighZ = Math.max(z0, z0 + sweepZ, z1, z1 + sweepZ);
    const firstX = Math.max(0, Math.floor((boxLowX - origin.x) * TEXELS_PER_CELL) - EDGE_MARGIN);
    const lastX = Math.min(
      width - 1,
      Math.ceil((boxHighX - origin.x) * TEXELS_PER_CELL) + EDGE_MARGIN,
    );
    const firstZ = Math.max(0, Math.floor((boxLowZ - origin.y) * TEXELS_PER_CELL) - EDGE_MARGIN);
    const lastZ = Math.min(
      height - 1,
      Math.ceil((boxHighZ - origin.y) * TEXELS_PER_CELL) + EDGE_MARGIN,
    );

    square.set(x0, z0);
    for (let tz = firstZ; tz <= lastZ; tz += 1) {
      const row = tz * width;
      const worldZ = origin.y + (tz + 0.5) / TEXELS_PER_CELL;
      for (let tx = firstX; tx <= lastX; tx += 1) {
        point.set(origin.x + (tx + 0.5) / TEXELS_PER_CELL, worldZ);

        const inside = edgeDistance(point, square, sweep, across, sizeX, sizeZ);
        if (inside > edge[row + tx]) edge[row + tx] = inside;
        if (inside < 0) continue;

        const [enter, exit] = spanInto(point, square, flat, sizeX, sizeZ);
        if (enter <= 0) continue;
        const ceiling = ceilingFor(top, enter, reach);
        if (ceiling <= 0) continue;
        if (ceiling > data[row + tx]) data[row + tx] = ceiling;
        const below = Math.max(floorFor(bottom, exit, reach), NO_FLOOR);
        if (below < under[row + tx]) under[row + tx] = below;
      }
    }
  }

  for (let i = 0; i < under.length; i += 1) {
    if (under[i] === Infinity) under[i] = NO_FLOOR;
  }

  return { origin, texelsPerCell: TEXELS_PER_CELL, width, height, baseY, data, edge, under };
}

/**
 * シェーダ用テクスチャ。8bit。float 補間は環境で効かず斜めが階段になる。
 * パック: R = ceiling/8、G = (edge+1)/9、B = (under+16)/32。
 */
export function maskTexture(mask: ShadowMaskData): DataTexture {
  const pixels = new Uint8Array(mask.data.length * 4);
  for (let i = 0; i < mask.data.length; i += 1) {
    pixels[i * 4] = Math.round(Math.min(Math.max(mask.data[i] / 8, 0), 1) * 255);
    pixels[i * 4 + 1] = Math.round(Math.min(Math.max((mask.edge[i] + 1) / 9, 0), 1) * 255);
    pixels[i * 4 + 2] = Math.round(Math.min(Math.max((mask.under[i] + 16) / 32, 0), 1) * 255);
    pixels[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(pixels, mask.width, mask.height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
