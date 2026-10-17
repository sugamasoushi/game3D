// 当たりの決まり（GS-237 / マップエディタ DEC-466）。**ゲームとエディタで同じ物を写して使う。**
//
// - **チップの形状で当たりが決まる。** 床・坂は立てる面、壁は板、ブロック・斜面は塊。ビルボード・天井は当たり無し
// - **レイヤーの「当たり」（`Hit`）** で、そのレイヤーの当たりを 4 つから選ぶ。書いていなければ `all`
// - 描いた所がそのまま進入禁止（水・川など）は、レイヤーを `block` にする（チップのあるマスを丸ごと塞ぐ）
// - 見た目と関係ない所（見えない柵など）は、オブジェクトの図形で置く（`Collision` を付けたオブジェクト）
//
// 古い `Collision` / `Walkable` / `NoEntry`（レイヤー）は読まない。マップは変換済み（エディタは開くときに変換する）。

import { isBillboardShape, isCeilShape, isFloorShape, isSolidPieceShape, isStackedBoardShape, isWallShape, type LayerDef, type Shape } from './types';

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

/** 値ごとの説明。エディタは値をキーワードのまま出し、意味はこれで添える。 */
export const LAYER_HIT_HINTS: Record<LayerHit, string> = {
  all: '床に立ち、壁・ブロックで止まる。既定（書かなくてよい）',
  nowall: '壁チップは見た目だけ（通り抜ける）。床とブロックは当たる。屋根・木・飾りの壁に',
  none: '見た目だけ。何も当たらない（床にも立てない）',
  block: 'チップのあるマスを形に関係なく丸ごと塞ぐ。水・川などの進入禁止',
};

/** チップの当たりの役割。`ground` は立てる面、`wall` は板、`solid` は塊。 */
export type HitRole = 'ground' | 'wall' | 'solid';

/** マスを埋める形。立体の部品（円柱・井戸。DEC-479）も塊（`chipRoleOf` が形の名前で見る）。 */
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
  // 奥に重ねた板（草むらなど）は縦向きの面として描くが、当たりはビルボードだった頃のまま持たない（DEC-481）。
  if (isBillboardShape(shape) || isStackedBoardShape(shape) || isCeilShape(shape)) return null;
  if (SOLID_HIT_SHAPES.has(shape) || isSolidPieceShape(shape)) return 'solid';
  if (isFloorShape(shape)) return 'ground';
  if (isWallShape(shape)) return hit === 'all' ? 'wall' : null;
  return null;
}
