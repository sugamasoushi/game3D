// 当たりの決まり（GS-237 / マップエディタ DEC-466）。**ゲームとエディタで同じ物を写して使う。**
//
// - **チップの形状で当たりが決まる。** 床・坂は立てる面、壁は板、ブロック・斜面は塊。ビルボード・天井は当たり無し
// - **レイヤーの「当たり」（`Hit`）** で、そのレイヤーの当たりを 4 つから選ぶ。書いていなければ `all`
// - 描いた所がそのまま進入禁止（水・川など）は、レイヤーを `block` にする（チップのあるマスを丸ごと塞ぐ）
// - 見た目と関係ない所（見えない柵など）は、オブジェクトの図形で置く（`Collision` を付けたオブジェクト）
//
// 古い `Collision` / `Walkable` / `NoEntry`（レイヤー）は読まない。マップは変換済み（エディタは開くときに変換する）。

import { isBillboardShape, isCeilShape, isFloorShape, isWallShape, type LayerDef, type Shape } from './types';

/** レイヤーのプロパティ名。値は `LayerHit`（文字列）。 */
export const HIT_PROPERTY = 'Hit';

/**
 * レイヤーの当たり。
 * - `all`: 床に立ち、壁・ブロックで止まる（既定。書かなくてよい）
 * - `nowall`: 壁チップは見た目だけ。床とブロックは当たる
 * - `none`: 見た目だけ。何も当たらない
 * - `block`: チップのあるマスを形に関係なく丸ごと塞ぐ（進入禁止。水・川など）
 */
export type LayerHit = 'all' | 'nowall' | 'none' | 'block';

export const LAYER_HITS: LayerHit[] = ['all', 'nowall', 'none', 'block'];

export const LAYER_HIT_LABELS: Record<LayerHit, string> = {
  all: 'すべて当たる',
  nowall: '壁は見た目だけ',
  none: '見た目だけ',
  block: 'マスごと塞ぐ',
};

/** チップの当たりの役割。`ground` は立てる面、`wall` は板、`solid` は塊。 */
export type HitRole = 'ground' | 'wall' | 'solid';

/** マスを埋める形。 */
export const SOLID_HIT_SHAPES = new Set<string>(['box', 'slope', 'slope_corner', 'slope_corner_in', 'mesh']);

export function isLayerHit(value: unknown): value is LayerHit {
  return value === 'all' || value === 'nowall' || value === 'none' || value === 'block';
}

/** そのレイヤーの当たり。`Hit` が無い・読めなければ `all`。 */
export function layerHitOf(layer: Pick<LayerDef, 'properties'>): LayerHit {
  const raw = layer.properties?.find((entry) => entry.name === HIT_PROPERTY)?.value;
  return isLayerHit(raw) ? raw : 'all';
}

/**
 * その形状のチップが、その当たりのレイヤーで何になるか。null は当たり無し。
 * `block` は形に関係なく塊（マスを丸ごと塞ぐ。ビルボード・天井も塞ぐ）。
 */
export function chipRoleOf(shape: Shape | string, hit: LayerHit): HitRole | null {
  if (hit === 'none') return null;
  if (hit === 'block') return 'solid';
  if (isBillboardShape(shape) || isCeilShape(shape)) return null;
  if (SOLID_HIT_SHAPES.has(shape)) return 'solid';
  if (isFloorShape(shape)) return 'ground';
  if (isWallShape(shape)) return hit === 'all' ? 'wall' : null;
  return null;
}
