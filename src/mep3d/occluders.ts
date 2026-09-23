// 配置光源の遮光体（GC-41）。影を塗るのではなく、光が届くかどうかで暗くする。
//
// 遮光板（`lightWalls.ts`）と同じ考え方を、マップの中身（ブロック・ビルボード）へ広げる。
// 板はシルエットのアルファを引くので、影の形は絵のまま。ブロックはマスの AABB。
//
// 光源ごとに「範囲に入る遮光体」の一覧を先に作る。断片が払うのは
// **届いている光源の、その範囲にある遮光体だけ**（GC-40 と組み合わせて効く）。

import { CanvasTexture, DataTexture, FloatType, LinearFilter, NearestFilter, RGBAFormat, UnsignedByteType, Vector2, Vector3, Vector4, type IUniform, type Texture } from 'three';
import { MAX_POINT_LIGHTS } from './lighting';
import type { PointLightDef } from './types';

/**
 * データテクスチャに置ける遮光体の総数。光源ごとの一覧を並べるので、
 * マップの遮光体数ではなく「光源 × その範囲の個数」の合計を見込む。
 */
export const MAX_OCCLUDERS = 256;

/**
 * 1 光源が見る上限。シェーダのループ回数はこちらで決まるので、
 * 総数を増やしても 1 画素あたりのコストは変わらない。
 */
export const MAX_OCC_PER_LIGHT = 48;

/** 遮光体の種類。シェーダの `kind` と同じ並び。 */
export const OCC_CARD = 0;
export const OCC_BOX = 1;
export const OCC_SLOPE = 2;

export interface Occluder {
  kind: number;
  /** 中心のワールド座標。板は面の中心、ブロックはマスの中心。 */
  centre: Vector3;
  /** 板は (幅, 高さ, 0)。ブロックは XYZ の半分の大きさ。横板も立った板として扱う（GC-44）。 */
  size: Vector3;
  /**
   * 板は遮光アトラスの UV（幅, 高さ, 左下 x, 左下 y）。
   * 斜面は 4 隅の高さ（0〜1。箱の下端からの割合）。順は (x0,z0) (x1,z0) (x1,z1) (x0,z1)。
   */
  frame: Vector4;
}

export interface OccluderUniformBuf {
  /** 1 体 3 テクセル × MAX_OCCLUDERS 行。 */
  data: Float32Array;
  texture: DataTexture;
  span: Vector2[];
}

export function createOccluderArrays(): OccluderUniformBuf {
  const data = new Float32Array(MAX_OCCLUDERS * 3 * 4);
  const texture = new DataTexture(data, 3, MAX_OCCLUDERS, RGBAFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    data,
    texture,
    span: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector2()),
  };
}

/**
 * 遮光体の中身はデータテクスチャで渡す。
 * **GLSL ES 1.00 は uniform 配列を可変添字で引けない**ので、配列にすると
 * `mepOccHead[start + k]` がリンクエラーになり、そのシェーダを使う面が全部消える（実際に踏んだ）。
 * 1 体につき 3 テクセル。行が遮光体、列が (中心+種類 / 大きさ / UV)。
 */
export const OCCLUDER_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D mepOccMap;                  // シルエットのアトラス
uniform sampler2D mepOccData;                 // 遮光体の中身
uniform float mepOccRows;                     // データテクスチャの行数
uniform vec2 mepOccSpan[${MAX_POINT_LIGHTS}]; // 光源ごとの (開始, 個数)
uniform float mepOccCutoff;
`;

export const OCCLUDER_GLSL = /* glsl */ `
/** 線分が軸平行の箱を横切るか。遮光板と同じ判定。 */
// 「箱の中をどれだけ通るか」で判定する。面の上に乗っている断片は、光源へ向かう線分が
// すぐ外へ出るので通過長がほぼ 0 になり、自分自身では暗くならない。
// 逆にブロックの真下にある床や、光源に背を向けた面は中を長く通るので遮られる。
// 「箱に含まれていたら飛ばす」だと、ブロックの下の床まで免除されて継ぎ目から光が漏れる（実際に踏んだ）。
const float MEP_OCC_MIN_DEPTH = 0.03;

bool mepOccHitsBox(vec3 fromPos, vec3 toPos, vec3 centre, vec3 halfSize) {
  vec3 d = toPos - fromPos;
  vec3 mn = centre - halfSize;
  vec3 mx = centre + halfSize;
  vec3 inv = 1.0 / vec3(
    abs(d.x) < 0.0001 ? 0.0001 : d.x,
    abs(d.y) < 0.0001 ? 0.0001 : d.y,
    abs(d.z) < 0.0001 ? 0.0001 : d.z
  );
  vec3 ta = (mn - fromPos) * inv;
  vec3 tb = (mx - fromPos) * inv;
  vec3 lo = min(ta, tb);
  vec3 hi = max(ta, tb);
  float t0 = max(max(lo.x, lo.y), max(lo.z, 0.0));
  float t1 = min(min(hi.x, hi.y), min(hi.z, 1.0));
  if (t1 <= t0) return false;
  return (t1 - t0) * length(d) > MEP_OCC_MIN_DEPTH;
}

/** 光源の方を向く縦板。当たった位置の絵が抜けていなければ遮る。 */
bool mepOccHitsCard(vec3 fromPos, vec3 toPos, vec3 centre, vec2 size, vec4 uv) {
  vec3 n = toPos - centre;
  n.y = 0.0;
  float nl = length(n);
  if (nl < 0.0001) return false;
  n /= nl;
  vec3 seg = toPos - fromPos;
  float denom = dot(seg, n);
  if (abs(denom) < 0.0001) return false;
  float t = dot(centre - fromPos, n) / denom;
  if (t <= 0.004 || t >= 0.996) return false;
  vec3 hit = fromPos + seg * t;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  float u = dot(hit - centre, right) / size.x + 0.5;
  float v = (hit.y - centre.y) / size.y + 0.5;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return false;
  return texture2D(mepOccMap, uv.zw + vec2(u, v) * uv.xy).a >= mepOccCutoff;
}

vec4 mepOccFetch(float row, float col) {
  return texture2D(mepOccData, vec2((col + 0.5) / 3.0, (row + 0.5) / mepOccRows));
}

/**
 * 斜面。天面が 4 隅の高さで決まる双一次面なので、XZ と下端で線分を切ってから
 * 区間を刻み、天面より下にいる点があれば遮る。三角として扱うので薄い側で影が出すぎない。
 */
bool mepOccHitsSlope(vec3 fromPos, vec3 toPos, vec3 centre, vec3 halfSize, vec4 corners) {
  vec3 mn = centre - halfSize;
  vec3 mx = centre + halfSize;
  vec3 d = toPos - fromPos;
  vec2 dxz = vec2(abs(d.x) < 0.0001 ? 0.0001 : d.x, abs(d.z) < 0.0001 ? 0.0001 : d.z);
  vec2 ta = (mn.xz - fromPos.xz) / dxz;
  vec2 tb = (mx.xz - fromPos.xz) / dxz;
  vec2 lo = min(ta, tb);
  vec2 hi = max(ta, tb);
  float t0 = max(max(lo.x, lo.y), 0.0);
  float t1 = min(min(hi.x, hi.y), 1.0);
  if (t1 <= t0) return false;
  float spanY = halfSize.y * 2.0;
  float depth = (t1 - t0) * length(d);
  if (depth <= MEP_OCC_MIN_DEPTH) return false;
  for (int i = 0; i <= 8; i++) {
    float t = mix(t0, t1, float(i) / 8.0);
    vec3 at = fromPos + d * t;
    if (at.y < mn.y) return true;
    vec2 uv = (at.xz - mn.xz) / max(halfSize.xz * 2.0, vec2(0.0001));
    // 隅の並びは (x0,z0) (x1,z0) (x1,z1) (x0,z1)。
    float front = mix(corners.x, corners.y, uv.x);
    float back = mix(corners.w, corners.z, uv.x);
    float top = mn.y + mix(front, back, uv.y) * spanY;
    if (at.y <= top) return true;
  }
  return false;
}

/** その光源に割り当てられた遮光体だけを見る。 */
bool mepOccBlocks(int light, vec3 fromPos, vec3 toPos) {
  vec2 span = mepOccSpan[light];
  if (span.y < 0.5) return false;
  for (int k = 0; k < ${MAX_OCC_PER_LIGHT}; k++) {
    if (float(k) >= span.y) break;
    float row = span.x + float(k);
    vec4 head = mepOccFetch(row, 0.0);
    vec4 body = mepOccFetch(row, 1.0);
    vec4 frame = mepOccFetch(row, 2.0);
    if (head.w < 0.5) {
      if (mepOccHitsCard(fromPos, toPos, head.xyz, body.xy, frame)) return true;
    } else if (head.w < 1.5) {
      if (mepOccHitsBox(fromPos, toPos, head.xyz, body.xyz)) return true;
    } else if (mepOccHitsSlope(fromPos, toPos, head.xyz, body.xyz, frame)) {
      return true;
    }
  }
  return false;
}
`;


/** 絵を構成するチップ 1 枚。 */
export interface AtlasPiece {
  /** 元のタイルセット画像。 */
  image: CanvasImageSource;
  /** 画像の実寸（px）。 */
  imageWidth: number;
  imageHeight: number;
  /** 絵の中の位置。左上が (0, 0)。 */
  col: number;
  row: number;
  /** タイルセット内のチップ UV。反転フラグ込み（負の幅・高さ）。 */
  uv: { x: number; y: number; width: number; height: number };
}

/**
 * アトラスへ焼く絵 1 枚。**スタンプ 1 個ぶん**で、2×3 のテーブルのような
 * 複数チップの集合体も 1 枚として扱う（GC-45）。
 */
export interface AtlasChip {
  /** 絵の大きさ（チップ数）。 */
  cols: number;
  rows: number;
  pieces: AtlasPiece[];
}

export interface OccluderAtlas {
  texture: CanvasTexture;
  /** `chips` と同じ並び。(幅, 高さ, 左下 x, 左下 y)。 */
  rects: Vector4[];
}

/** アトラスの横幅の上限（px）。超えたら次の棚へ折り返す。 */
const ATLAS_MAX_WIDTH = 1024;

/**
 * 遮光用のシルエットを 1 枚へ焼く（GC-43）。
 * フラグメントシェーダはサンプラーを添字で切り替えられないので、
 * タイルセットを跨ぐビルボードを 1 枚にまとめる必要がある。
 * ビルボードは動かないので、読み込み時に 1 回焼けば済む。
 *
 * 絵ごとに大きさが違う（1×1 の椅子、2×3 のテーブル）ので、棚詰めで並べる。
 */
export function bakeOccluderAtlas(chips: readonly AtlasChip[], slotPx = 32): OccluderAtlas | null {
  if (chips.length === 0) return null;

  // 背の高い絵から置くと棚の隙間が減る。
  const order = chips.map((_, index) => index).sort((a, b) => chips[b].rows - chips[a].rows);
  const places: Array<{ x: number; y: number }> = new Array(chips.length);
  let penX = 0;
  let penY = 0;
  let shelf = 0;
  let width = 0;
  for (const index of order) {
    const w = Math.max(chips[index].cols, 1) * slotPx;
    const h = Math.max(chips[index].rows, 1) * slotPx;
    if (penX > 0 && penX + w > ATLAS_MAX_WIDTH) {
      penX = 0;
      penY += shelf;
      shelf = 0;
    }
    places[index] = { x: penX, y: penY };
    penX += w;
    shelf = Math.max(shelf, h);
    width = Math.max(width, penX);
  }
  const height = penY + shelf;
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  const rects: Vector4[] = [];
  chips.forEach((chip, index) => {
    const place = places[index];
    for (const piece of chip.pieces) {
      const u0 = Math.min(piece.uv.x, piece.uv.x + piece.uv.width);
      const v0 = Math.min(piece.uv.y, piece.uv.y + piece.uv.height);
      const w = Math.abs(piece.uv.width);
      const h = Math.abs(piece.uv.height);
      // タイルセットは `flipY = false` で読む（`loader.ts`）。UV の原点は画像の左上で、
      // v はそのまま上からの画素行。ここを反転させると別のタイルを焼いてしまう。
      const sx = u0 * piece.imageWidth;
      const sy = v0 * piece.imageHeight;
      // 反転フラグはチップの鍵に入っているので、焼くときに絵へ畳み込む。
      const flipU = piece.uv.width < 0;
      const flipV = piece.uv.height < 0;
      const dx = place.x + piece.col * slotPx;
      const dy = place.y + piece.row * slotPx;
      ctx.save();
      ctx.translate(dx + (flipU ? slotPx : 0), dy + (flipV ? slotPx : 0));
      ctx.scale(flipU ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(
        piece.image,
        sx,
        sy,
        Math.max(w * piece.imageWidth, 1),
        Math.max(h * piece.imageHeight, 1),
        0,
        0,
        slotPx,
        slotPx,
      );
      ctx.restore();
    }
    // 焼いた先も flipY で読むので、行を下から数え直す。
    const w = Math.max(chip.cols, 1) * slotPx;
    const h = Math.max(chip.rows, 1) * slotPx;
    rects.push(new Vector4(w / width, h / height, place.x / width, 1 - (place.y + h) / height));
  });

  const texture = new CanvasTexture(canvas);
  // タイルセット側と違い、このアトラスは flipY のまま読む（`rects` が下から数えている）。
  texture.flipY = true;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, rects };
}

/** 遮光体が要らないときの 1x1 透明テクスチャ。 */
let emptyOcc: DataTexture | null = null;
export function emptyOccluderMap(): DataTexture {
  if (emptyOcc) return emptyOcc;
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  emptyOcc = texture;
  return emptyOcc;
}

/** 遮光体が光源の範囲に入るか。端がかすめる場合も拾えるよう大きさぶん余裕を見る。 */
function reaches(light: PointLightDef, occluder: Occluder, unit: number, at: Vector3): boolean {
  const range = (light.range ?? 6) * unit;
  const pad = Math.max(occluder.size.x, occluder.size.y, occluder.size.z);
  return occluder.centre.distanceTo(at) <= range + pad;
}

/**
 * 光源を包んでいる遮光体は外す。ランプは壁に埋めて置かれるので、
 * そのまま入れると自分の取り付け先に全方向を塞がれて部屋が真っ暗になる。
 */
function holdsLight(occluder: Occluder, at: Vector3): boolean {
  const skin = 0.05;
  return (
    Math.abs(occluder.centre.x - at.x) <= occluder.size.x + skin &&
    Math.abs(occluder.centre.y - at.y) <= occluder.size.y + skin &&
    Math.abs(occluder.centre.z - at.z) <= occluder.size.z + skin
  );
}

/**
 * 光源ごとに範囲へ入る遮光体を並べ、uniform を埋める。返すのは使った遮光体の総数。
 * 上限を超えたら光源に近い順に残す。
 */
export function fillOccluderUniforms(
  occluders: readonly Occluder[],
  lights: readonly PointLightDef[],
  unit: number,
  buf: OccluderUniformBuf,
): number {
  for (let i = 0; i < MAX_POINT_LIGHTS; i += 1) buf.span[i].set(0, 0);
  buf.data.fill(0);
  if (occluders.length === 0) {
    buf.texture.needsUpdate = true;
    return 0;
  }

  const at = new Vector3();
  let cursor = 0;
  for (let i = 0; i < lights.length && i < MAX_POINT_LIGHTS; i += 1) {
    if (cursor >= MAX_OCCLUDERS) break;
    const light = lights[i];
    at.set(light.x * unit, light.y * unit, light.z * unit);
    const mine = occluders.filter((entry) => reaches(light, entry, unit, at) && !holdsLight(entry, at));
    if (mine.length === 0) continue;
    mine.sort((a, b) => a.centre.distanceToSquared(at) - b.centre.distanceToSquared(at));
    const take = Math.min(mine.length, MAX_OCC_PER_LIGHT, MAX_OCCLUDERS - cursor);
    buf.span[i].set(cursor, take);
    for (let k = 0; k < take; k += 1) {
      const entry = mine[k];
      const at3 = cursor * 12;
      buf.data[at3] = entry.centre.x;
      buf.data[at3 + 1] = entry.centre.y;
      buf.data[at3 + 2] = entry.centre.z;
      buf.data[at3 + 3] = entry.kind;
      buf.data[at3 + 4] = entry.size.x;
      buf.data[at3 + 5] = entry.size.y;
      buf.data[at3 + 6] = entry.size.z;
      buf.data[at3 + 7] = 0;
      buf.data[at3 + 8] = entry.frame.x;
      buf.data[at3 + 9] = entry.frame.y;
      buf.data[at3 + 10] = entry.frame.z;
      buf.data[at3 + 11] = entry.frame.w;
      cursor += 1;
    }
  }
  buf.texture.needsUpdate = true;
  return cursor;
}

/** uniform をマテリアルへ流す。遮光体の枠を持たないマテリアルは何もしない。 */
export function applyOccluderUniforms(
  material: { uniforms: Record<string, IUniform> },
  buf: OccluderUniformBuf,
  map: Texture | null,
  cutoff: number,
): void {
  const span = material.uniforms.mepOccSpan;
  if (!span) return;
  material.uniforms.mepOccMap.value = map ?? emptyOccluderMap();
  material.uniforms.mepOccCutoff.value = cutoff;
  material.uniforms.mepOccData.value = buf.texture;
  material.uniforms.mepOccRows.value = MAX_OCCLUDERS;
  const spans = span.value as Vector2[];
  for (let i = 0; i < MAX_POINT_LIGHTS; i += 1) spans[i].copy(buf.span[i]);
}
