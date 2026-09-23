import { Color, ClampToEdgeWrapping, DataTexture, DoubleSide, FrontSide, LinearFilter, NoColorSpace, RGBAFormat, ShaderMaterial, Texture, UnsignedByteType, Vector2, Vector3, Vector4 } from 'three';
import { blockShadowStrength, fillPointLightUniforms, lightDirection, MAX_POINT_LIGHTS, type PointLightUniformBuf } from './lighting';
import { CAMERA_FX_DEFAULTS, fogColor } from './camera';
import { createLightWallArrays, LIGHT_WALL_GLSL, LIGHT_WALL_UNIFORMS_GLSL } from './lightWalls';
import { createOccluderArrays, emptyOccluderMap, MAX_OCCLUDERS, OCCLUDER_GLSL, OCCLUDER_UNIFORMS_GLSL } from './occluders';
import { FADE_CELLS, TEXELS_PER_CELL } from './shadowMask';
import { createSunShadowUniforms, SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORMS_GLSL } from './sunShadow';
import type { CameraFxDef, LightingDef, MaterialDef, PointLightDef } from './types';

/**
 * 透過レイヤー（DEC-251）。**レイヤー**のプロパティ。
 * オンにすると、そのレイヤーのチップが網掛けで透ける。手前の壁を別レイヤーにして使う。
 */
export const SEE_THROUGH_PROPERTY_NAME = 'SeeThrough';

/**
 * タイルセット×ビルボードごとに 1 マテリアル。6 面のチップ番号をインスタンス属性で持つ。
 */

/** マップが言わないときのチップ px。縁の太さを面の割合にするだけ。 */
const DEFAULT_TILE_PX = 32;

/** ブロック縁の太さ（面の割合）。省略時は絵の 1px。チップが大きくても線が太くならない。 */
export function edgeWidthFor(tilePx: number | undefined, explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit)) {
    return Math.min(Math.max(explicit, 0), 0.5);
  }
  const px = tilePx && tilePx > 0 ? tilePx : DEFAULT_TILE_PX;
  return 1 / px;
}

/**
 * 縁の内側へのぼかし（面に対する割合）。省略時は 0。
 */
export function edgeFadeFor(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit)) {
    return Math.min(Math.max(explicit, 0), 0.5);
  }
  return 0;
}

/**
 * 点光源とフォグの GLSL。タイルとキャラで同じ式を使うため、ここが唯一の定義。
 * 片方だけ直すと見た目が食い違うので、必ずこちらを直す。
 */
/**
 * キャラを遮光体として扱う（GC-39）。板を光源の方へ向けた縦板とみなし、
 * 断片から光源への線分がその板を横切り、かつ絵が抜けていなければ光を止める。
 * 影を塗るのではなく光を遮るので、床でも壁でも段差でも同じ式で正しく暗くなる。
 */
export const ACTOR_OCCLUDER_UNIFORMS_GLSL = /* glsl */ `
uniform float mepActorOn;
uniform sampler2D mepActorMap;
uniform vec4 mepActorFrame;   // xy = 左下 UV、zw = 大きさ
uniform vec3 mepActorFoot;    // 足元のワールド座標
uniform vec2 mepActorSize;    // 幅・高さ（ワールド）
uniform float mepActorCutoff;
`;

export const ACTOR_OCCLUDER_GLSL = /* glsl */ `
bool mepActorBlocks(vec3 fromPos, vec3 toPos) {
  if (mepActorOn < 0.5) return false;
  vec3 centre = mepActorFoot + vec3(0.0, mepActorSize.y * 0.5, 0.0);
  // 板は光源の方を向く。どの光源から見てもシルエットが正面に出る。
  vec3 n = toPos - centre;
  n.y = 0.0;
  float nl = length(n);
  if (nl < 0.0001) return false;
  n /= nl;
  vec3 seg = toPos - fromPos;
  float denom = dot(seg, n);
  if (abs(denom) < 0.0001) return false;
  float t = dot(centre - fromPos, n) / denom;
  // 端点は板の上なので外す。自分自身を影にしない。
  if (t <= 0.004 || t >= 0.996) return false;
  vec3 hit = fromPos + seg * t;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  float u = dot(hit - centre, right) / mepActorSize.x + 0.5;
  float v = (hit.y - mepActorFoot.y) / mepActorSize.y;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return false;
  return texture2D(mepActorMap, mepActorFrame.xy + vec2(u, v) * mepActorFrame.zw).a >= mepActorCutoff;
}
`;

/**
 * 太陽の影を落とすキャラ（DEC-393）。**受ける側で光を遮る**——チップの太陽の影（DEC-145）と同じく、
 * 透けて捨てた画素には影が乗らない。塗りの影（地形に沿って折った板）は透けた所にも乗っていた。
 * 板は**描いている向き（カメラの方）**の縦板とみなす。チップの深度もタイルと同じ頂点シェーダで
 * 焼くので、影の形の決まり方が揃う。当たりを見る点は絵の 1 画素の格子へ丸め、段の刻みも揃える。
 * サンプラは人数ぶん要るので上限を持つ（タイルのシェーダはすでに 8 枚使う。WebGL2 の保証は 16）。
 */
export const MAX_SUN_ACTORS = 6;

const SUN_ACTOR_INDICES = Array.from({ length: MAX_SUN_ACTORS }, (_, i) => i);

export const SUN_ACTOR_UNIFORMS_GLSL = /* glsl */ `
uniform int mepSunActorCount;
uniform vec3 mepSunActorDir;      // 面から太陽へ向かう単位ベクトル（チップの影と同じ向き）
uniform vec3 mepSunActorNormal;   // 板の向き（カメラ側を向く水平の単位ベクトル）
uniform float mepSunActorPixel;   // 絵の 1 画素（ワールド）
uniform vec4 mepSunActorFrame[${MAX_SUN_ACTORS}];  // xy = 左下 UV、zw = 大きさ
uniform vec4 mepSunActorFoot[${MAX_SUN_ACTORS}];   // xyz = 足元、w = 抜き色のしきい値
uniform vec2 mepSunActorSize[${MAX_SUN_ACTORS}];   // 幅・高さ（ワールド）
${SUN_ACTOR_INDICES.map((i) => `uniform sampler2D mepSunActorMap${i};`).join('\n')}
`;

/**
 * 断片から太陽への線が、いずれかのキャラの板を**不透明な所で**通るか（DEC-393）。
 * サンプラの配列を添字で引くのは WebGL2 で許されないので、人数ぶん**展開して**書く。
 * 端の除外は**絶対の長さ**（絵の 1 画素）——太陽は遠いので、点光源用の `mepActorBlocks` のように
 * 線の長さに対する割合で外すと、足元の影が欠ける。
 */
export const SUN_ACTOR_GLSL = /* glsl */ `
bool mepSunActorsBlock(vec3 worldPos) {
  if (mepSunActorCount <= 0) return false;
  float denom = dot(mepSunActorDir, mepSunActorNormal);
  if (abs(denom) < 0.0001) return false;
  vec3 p = floor(worldPos / mepSunActorPixel + 0.5) * mepSunActorPixel;
  vec3 right = vec3(mepSunActorNormal.z, 0.0, -mepSunActorNormal.x);
${SUN_ACTOR_INDICES.map(
  (i) => `  if (mepSunActorCount > ${i}) {
    vec3 foot${i} = mepSunActorFoot[${i}].xyz;
    vec3 centre${i} = foot${i} + vec3(0.0, mepSunActorSize[${i}].y * 0.5, 0.0);
    float t${i} = dot(centre${i} - p, mepSunActorNormal) / denom;
    if (t${i} > mepSunActorPixel) {
      vec3 hit${i} = p + mepSunActorDir * t${i};
      float u${i} = dot(hit${i} - centre${i}, right) / mepSunActorSize[${i}].x + 0.5;
      float v${i} = (hit${i}.y - foot${i}.y) / mepSunActorSize[${i}].y;
      if (u${i} >= 0.0 && u${i} <= 1.0 && v${i} >= 0.0 && v${i} <= 1.0 &&
          texture2D(mepSunActorMap${i}, mepSunActorFrame[${i}].xy + vec2(u${i}, v${i}) * mepSunActorFrame[${i}].zw).a >= mepSunActorFoot[${i}].w) {
        return true;
      }
    }
  }`,
).join('\n')}
  return false;
}
`;

export const POINT_LIGHT_UNIFORMS_GLSL = /* glsl */ `
uniform int pointLightCount;
uniform vec3 pointLightPos[${MAX_POINT_LIGHTS}];
uniform vec3 pointLightColor[${MAX_POINT_LIGHTS}];
uniform vec2 pointLightIR[${MAX_POINT_LIGHTS}];
uniform vec3 pointLightDir[${MAX_POINT_LIGHTS}];
uniform vec3 pointLightExtra[${MAX_POINT_LIGHTS}];
uniform vec3 pointLightPulse[${MAX_POINT_LIGHTS}];
uniform float lightTime;
${LIGHT_WALL_UNIFORMS_GLSL}
${ACTOR_OCCLUDER_UNIFORMS_GLSL}
${OCCLUDER_UNIFORMS_GLSL}
`;

/**
 * 点滅・ゆらめきの式（DEC-294 / DEC-314）。**光の玉と共有する。**
 * `p` は（種別, 速さ, 幅）、`phase` は光源ごとにずらす位相。
 * `lightTime` を使うので、読み込む側でその uniform を持っていること。
 * ここを一本にしておかないと、玉だけ別の拍で点滅する。
 */
export const LIGHT_PULSE_GLSL = /* glsl */ `
float lightPulseAt(vec3 p, float phase) {
  if (p.x < 0.5) return 1.0;
  float s = lightTime * max(p.y, 0.01) + phase;
  float amount = clamp(p.z, 0.0, 1.0);
  if (p.x < 1.5) {
    float on = step(0.45, fract(s));
    return mix(1.0 - amount, 1.0, on);
  }
  float n = sin(s * 6.13) * 0.45 + sin(s * 13.71 + 1.3) * 0.28 + sin(s * 31.2 + 2.1) * 0.18;
  n = clamp(n * 0.5 + 0.55, 0.0, 1.0);
  return mix(1.0, n, amount);
}
`;

export const POINT_LIGHT_GLSL = /* glsl */ `
${ACTOR_OCCLUDER_GLSL}
${OCCLUDER_GLSL}
${LIGHT_PULSE_GLSL}
float lightPulse(int i) {
  return lightPulseAt(pointLightPulse[i], float(i) * 1.73);
}

${LIGHT_WALL_GLSL}

vec3 pointLightRgb(vec3 N, vec3 worldPos) {
  vec3 add = vec3(0.0);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= pointLightCount) break;
    float kind = pointLightExtra[i].x;
    vec3 origin = pointLightPos[i];
    vec3 nDir = normalize(pointLightDir[i]);
    if (kind > 1.5) {
      vec3 up = abs(nDir.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
      vec3 t = normalize(cross(up, nDir));
      vec3 b = cross(nDir, t);
      vec3 rel = worldPos - origin;
      float u = clamp(dot(rel, t), -pointLightExtra[i].y, pointLightExtra[i].y);
      float v = clamp(dot(rel, b), -pointLightExtra[i].z, pointLightExtra[i].z);
      origin = origin + t * u + b * v;
      if (dot(worldPos - pointLightPos[i], nDir) < -0.04) continue;
    }
    // 届かない光源はここで捨てる。遮光の判定は届く光源だけが払う（GC-40）。
    vec3 toL = origin - worldPos;
    float dist = length(toL);
    float range = max(pointLightIR[i].y, 0.001);
    if (dist >= range) continue;
    float att = 1.0 - dist / range;
    att *= att;
    if (mepWallBlocks(worldPos, origin)) continue;
    if (mepActorBlocks(worldPos, origin)) continue;
    // 面から少し浮かせて判定する。自分の面で影が付くのを防ぐ。
    if (mepOccBlocks(i, worldPos + N * 0.08, origin)) continue;
    vec3 L = toL / max(dist, 0.0001);
    if (kind > 0.5 && kind < 1.5) {
      att *= smoothstep(pointLightExtra[i].y, pointLightExtra[i].z, dot(-L, nDir));
    }
    float d = dot(N, L);
    float lambert = clamp(mix(max(d, 0.0), d * 0.5 + 0.5, 0.35), 0.0, 1.0);
    add += pointLightColor[i] * pointLightIR[i].x * lightPulse(i) * att * lambert;
  }
  return add;
}
`;

/** ビルボードがブロック影に入ったとき本体を暗くする（L-3.12）。キャラとも共有する。 */
export const SPRITE_SHADOW_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D mepShadowMap;
uniform vec2 mepShadowOrigin;
uniform vec2 mepShadowSize;
uniform float mepShadowBaseY;
uniform float mepShadowTpc;
uniform float mepShadowUnit;
uniform float mepShadowOn;
uniform float mepShadowStrength;
uniform float mepShadowFade;
`;

/** `lightAmbient` と `lightIntensity` も要る。 */
export const SPRITE_SHADOW_GLSL = /* glsl */ `
vec3 mepBlockShadow(vec3 colour, vec3 shadowPos) {
  if (mepShadowOn <= 0.5 || mepShadowUnit <= 0.0001) return colour;
  float x = shadowPos.x / mepShadowUnit;
  float y = shadowPos.y / mepShadowUnit - mepShadowBaseY;
  float z = shadowPos.z / mepShadowUnit;
  vec2 uv = vec2(
    (x - mepShadowOrigin.x) * mepShadowTpc / mepShadowSize.x,
    (z - mepShadowOrigin.y) * mepShadowTpc / mepShadowSize.y
  );
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return colour;
  vec4 packed = texture2D(mepShadowMap, uv);
  float ceiling = packed.r * 8.0;
  float edge = packed.g * 9.0 - 1.0;
  float under = packed.b * 32.0 - 16.0;
  float cover = clamp(edge * mepShadowTpc + 0.5, 0.0, 1.0);
  float fade = max(mepShadowFade, 0.0001);
  float amount = clamp((ceiling - y) / fade, 0.0, 1.0) * clamp((y - under) / fade, 0.0, 1.0) * cover;
  float shade = lightAmbient + lightIntensity;
  float shadowed = lightAmbient + lightIntensity * (1.0 - mepShadowStrength * amount);
  return colour * (shadowed / max(shade, 0.0001));
}
`;

/** three の scene fog が fogColor などを注入するので mep 接頭辞。 */
export const FOG_UNIFORMS_GLSL = /* glsl */ `
uniform bool mepFogOn;
uniform vec3 mepFogColor;
uniform float mepFogNear;
uniform float mepFogFar;
uniform float mepFogMax;
`;

export const FOG_GLSL = /* glsl */ `
float mepFogFactor(float dist) {
  float span = max(mepFogFar - mepFogNear, 0.001);
  return clamp((dist - mepFogNear) / span, 0.0, 1.0) * mepFogMax;
}
`;

/** 点光源の uniform 配列。タイルとキャラで同じ形。 */
export function createPointLightArrays(): PointLightUniformBuf {
  return {
    pos: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector3()),
    color: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector3()),
    ir: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector2()),
    dir: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector3(0, -1, 0)),
    extra: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector3()),
    pulse: Array.from({ length: MAX_POINT_LIGHTS }, () => new Vector3()),
  };
}

export interface AtlasLayout {
  cols: number;
  /** チップ 0 の左上（UV。inset 込み）。 */
  origin: Vector2;
  /** チップ間の距離（UV）。 */
  step: Vector2;
  /** 1 チップの大きさ（UV。inset 込み）。 */
  span: Vector2;
}

const vertexShader = /* glsl */ `
attribute vec4 chip;        // top, front, bottom, 回転フラグ
attribute vec4 chipSides;   // back, left, right, w = 隠す面（GC-36）
attribute float chipEdge;   // 縁の色。0 はなし
attribute float chipEmit;   // 6bit 発光。順は top..right
attribute float boxThickY;  // 符号付き Y 厚み（セル）。0 はフル／箱以外
attribute float boxThickZ;  // 符号付き Z 厚み（セル）。0 はフル／箱以外
attribute float boxThickX;  // 符号付き X 厚み（セル）。0 はフル／箱以外
attribute float faceAnchor; // 6 面 × 2bit（bl=0 br=1 tl=2 tr=3）。順は top..right
attribute float faceFit;    // 6 面 × 1bit。stretch が 1。同じ順
varying vec2 vChipUv;
/** チップのアトラス矩形（xy=左上 zw=大きさ）。4 頂点とも同じ値なので補間で変わらない。 */
varying vec4 vChipRect;
varying float vShade;
varying float vSolid;
varying vec3 vSolidColor;
varying float vEdge;
varying vec3 vEdgeColor;
varying vec2 vFaceUv;
#ifndef MEP_BILLBOARD
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#endif
// 補間する。床タイルがカメラから伸びるとセル端でフォグが段になる。
varying vec3 vFogView;
varying vec3 vClipPos;
varying vec4 vClipBound;
varying vec2 vClipBoundX;
varying float vClipOn;
varying float vEmit;
#ifdef MEP_BILLBOARD
varying vec3 vShadowPos;
#endif

uniform float cullHidden;   // 1 で隠面除去を効かせる（GF-5.1）
uniform float atlasCols;
uniform vec2 atlasOrigin;
uniform vec2 atlasStep;
uniform vec2 atlasSpan;

uniform vec3 lightDir;
uniform float lightAmbient;
uniform float lightIntensity;
uniform float lightWrap;
uniform float lightBillboard;

float faceShade(vec3 worldNormal) {
  float d = dot(worldNormal, lightDir);
  float lambert = clamp(mix(max(d, 0.0), d * 0.5 + 0.5, lightWrap), 0.0, 1.0);
  return lightAmbient + lightIntensity * lambert;
}

// 本物の sRGB。pow(2.2) だと暗いチャンネルでチップ色と単色がずれる。
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// 負値は単色: value = -1 - (r<<16|g<<8|b)。符号でチップ番号と分ける。
vec3 unpackFaceColor(float value) {
  float packed = -1.0 - value;
  return vec3(
    floor(packed / 65536.0),
    floor(mod(packed, 65536.0) / 256.0),
    mod(packed, 256.0)) / 255.0;
}

vec4 chipRect(float index, float flags) {
  float slot = floor(index + 0.5);
  float col = mod(slot, atlasCols);
  float row = floor((slot + 0.5) / atlasCols);
  vec2 origin = atlasOrigin + vec2(col, row) * atlasStep;
  vec2 span = atlasSpan;

  float bits = floor(flags + 0.5);
  if (mod(floor(bits / 4.0), 2.0) >= 1.0) { origin.x += span.x; span.x = -span.x; }
  if (mod(floor(bits / 8.0), 2.0) >= 1.0) { origin.y += span.y; span.y = -span.y; }
  return vec4(origin, span);
}

void main() {
  // 0.5 なら 45 度斜面も上面。ビルボードは常に表チップ。
  float index = chip.y;
  #if !defined(MEP_BILLBOARD) && !defined(MEP_BILLBOARD_CARD)
    if (normal.y > 0.5) index = chip.x;
    else if (normal.y < -0.5) index = chip.z;
    else if (normal.z > 0.5) index = chip.y;
    else if (normal.z < -0.5) index = chipSides.x;
    else index = normal.x < 0.0 ? chipSides.y : chipSides.z;
  #endif

  float emitBit = 2.0;
  #if !defined(MEP_BILLBOARD) && !defined(MEP_BILLBOARD_CARD)
    if (normal.y > 0.5) emitBit = 0.0;
    else if (normal.y < -0.5) emitBit = 1.0;
    else if (normal.z > 0.5) emitBit = 2.0;
    else if (normal.z < -0.5) emitBit = 3.0;
    else emitBit = normal.x < 0.0 ? 4.0 : 5.0;
  #endif
  vEmit = step(0.5, mod(floor(chipEmit / exp2(emitBit) + 0.001), 2.0));
  #if defined(MEP_BILLBOARD) || defined(MEP_BILLBOARD_CARD)
    vEmit = chipEmit > 0.5 ? 1.0 : 0.0;
  #endif

  // 隣接ブロックの接地面は描かない（GF-5.1 / N-10）。
  // 面の 4 頂点は法線が同じなので、クリップ外へ飛ばすと四角ごと消える。
  #ifndef MEP_BILLBOARD
    if (cullHidden > 0.5 && mod(floor(chipSides.w / exp2(emitBit) + 0.001), 2.0) > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
  #endif

  vSolid = index < 0.0 ? 1.0 : 0.0;
  vClipOn = 0.0;
  vClipPos = position;
  vClipBound = vec4(-0.5, 0.5, -0.5, 0.5);
  vClipBoundX = vec2(-0.5, 0.5);
  // 面の切り取り（DEC-96 / DEC-97）。板は厚みを持てないので、**外側を捨てて**切る。
  // 頂点は動かさない。動かすと三角形や坂が縮んでしまい、隅がマスの角から外れる。
  // 目印は chipSides.w の 128 の位。隠す面は bit 0..5 なのでぶつからない。
  // 属性は 16 個で上限なので新しく増やせない（GC-36）。捨てる判定は箱の clip と同じ仕組みを使う。
  float planeCrop = mod(floor(chipSides.w / 128.0 + 0.001), 2.0);
  if (planeCrop > 0.5) {
    float cx = abs(boxThickX);
    float cy = abs(boxThickY);
    float cz = abs(boxThickZ);
    if (cx > 0.001 || cy > 0.001 || cz > 0.001) {
      if (cx < 0.001) cx = 1.0;
      if (cy < 0.001) cy = 1.0;
      if (cz < 0.001) cz = 1.0;
      float px0 = boxThickX >= 0.0 ? 0.5 - cx : -0.5;
      float px1 = boxThickX >= 0.0 ? 0.5 : -0.5 + cx;
      float py0 = boxThickY < 0.0 ? -0.5 : 0.5 - cy;
      float py1 = boxThickY < 0.0 ? -0.5 + cy : 0.5;
      float pz0 = boxThickZ >= 0.0 ? -0.5 : 0.5 - cz;
      float pz1 = boxThickZ >= 0.0 ? -0.5 + cz : 0.5;
      // 面に垂直な軸は切らない。坂は局所 Y が 0〜1 まで伸びるので、広く開けておく。
      bool flatFace = abs(normal.y) > 0.5;
      vClipPos = position;
      vClipBoundX = vec2(px0, px1);
      vClipBound = flatFace ? vec4(-99.0, 99.0, pz0, pz1) : vec4(py0, py1, -99.0, 99.0);
      vClipOn = 1.0;
    }
  }
  vFaceUv = clamp(uv, 0.0, 1.0);
  if (vSolid > 0.5) {
    vSolidColor = srgbToLinear(unpackFaceColor(index));
    vChipUv = vec2(0.0);
    vChipRect = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    vSolidColor = vec3(1.0);
    vec4 rect = chipRect(index, chip.w);
    vChipRect = rect;
    vChipUv = rect.xy + vFaceUv * rect.zw;
  }

  // 単色は隣と溶け合うので縁を付ける。面 UV は常に 0..1。
  vEdge = chipEdge < 0.0 ? 1.0 : 0.0;
  vEdgeColor = vEdge > 0.5 ? srgbToLinear(unpackFaceColor(chipEdge)) : vec3(0.0);

  #ifdef MEP_BILLBOARD
    // 固定明るさ。法線がカメラと回ると木や NPC が点滅する。
    vShade = lightBillboard;

    vec4 localOrigin = vec4(0.0, 0.0, 0.0, 1.0);
    float instanceScale = 1.0;
    #ifdef USE_INSTANCING
      localOrigin = instanceMatrix * localOrigin;
      instanceScale = length(instanceMatrix[0].xyz);
    #endif

    vec3 viewUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    vec3 towardsCamera = vec3(0.0, 0.0, 1.0);
    vec3 viewRight = cross(viewUp, towardsCamera);
    // 真上からだと外積が潰れる。画面右に退避。
    viewRight = length(viewRight) < 0.0001 ? vec3(1.0, 0.0, 0.0) : normalize(viewRight);

    // 幅広スプライトは chip.x に中央からのずれ。各自転だと絵が割れる。
    float spread = chip.x;
    vec3 worldXView = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
    vec3 originView = (modelViewMatrix * localOrigin).xyz
      - worldXView * spread
      + viewRight * spread;

    vec3 viewPosition = originView
      + viewRight * position.x * instanceScale
      + viewUp * position.y * instanceScale;
    vShadowPos = vec3(localOrigin.x, localOrigin.y + position.y * instanceScale, localOrigin.z);
    vFogView = viewPosition;
    gl_Position = projectionMatrix * vec4(viewPosition, 1.0);
  #elif defined(MEP_BILLBOARD_FLAT)
    vShade = lightBillboard;

    vec4 localOrigin = vec4(0.0, 0.0, 0.0, 1.0);
    float instanceScale = 1.0;
    #ifdef USE_INSTANCING
      localOrigin = instanceMatrix * localOrigin;
      instanceScale = length(instanceMatrix[0].xyz);
    #endif

    vec3 origin = localOrigin.xyz;
    vec3 toCam = cameraPosition - origin;
    toCam.y = 0.0;
    vec3 forward = length(toCam) < 0.0001 ? vec3(0.0, 0.0, 1.0) : normalize(toCam);
    vec3 right = cross(vec3(0.0, 1.0, 0.0), forward);
    right = length(right) < 0.0001 ? vec3(1.0, 0.0, 0.0) : normalize(right);

    vec3 worldPos = origin
      + right * position.x * instanceScale
      + vec3(0.0, 1.0, 0.0) * position.y * instanceScale
      + forward * position.z * instanceScale;
    vWorldNormal = vec3(0.0, 1.0, 0.0);
    vWorldPos = worldPos;
    vFogView = (viewMatrix * vec4(worldPos, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  #else
    // 薄い箱: clip は 1 マスを四隅基準で貼ってはみ出しを捨てる。stretch は面に合わせる。基準は面ごと。
    // 板（planeCrop）は捨てる判定だけなので、ここの箱の処理は通さない。
    vec3 pos = position;
    float hx = planeCrop > 0.5 ? 0.0 : abs(boxThickX);
    float hy = planeCrop > 0.5 ? 0.0 : abs(boxThickY);
    float hz = planeCrop > 0.5 ? 0.0 : abs(boxThickZ);
    float x0 = -0.5;
    float x1 = 0.5;
    float y0 = -0.5;
    float y1 = 0.5;
    float z0 = -0.5;
    float z1 = 0.5;
    float slot = 0.0;
    if (normal.y < -0.5) slot = 1.0;
    else if (normal.z > 0.5) slot = 2.0;
    else if (normal.z < -0.5) slot = 3.0;
    else if (abs(normal.y) < 0.5 && normal.x < 0.0) slot = 4.0;
    else if (abs(normal.y) < 0.5) slot = 5.0;
    float a = mod(faceAnchor, 4.0);
    float f = mod(faceFit, 2.0);
    if (slot > 0.5 && slot < 1.5) {
      a = mod(floor(faceAnchor / 4.0 + 0.001), 4.0);
      f = mod(floor(faceFit / 2.0 + 0.001), 2.0);
    } else if (slot < 2.5 && slot > 1.5) {
      a = mod(floor(faceAnchor / 16.0 + 0.001), 4.0);
      f = mod(floor(faceFit / 4.0 + 0.001), 2.0);
    } else if (slot < 3.5 && slot > 2.5) {
      a = mod(floor(faceAnchor / 64.0 + 0.001), 4.0);
      f = mod(floor(faceFit / 8.0 + 0.001), 2.0);
    } else if (slot < 4.5 && slot > 3.5) {
      a = mod(floor(faceAnchor / 256.0 + 0.001), 4.0);
      f = mod(floor(faceFit / 16.0 + 0.001), 2.0);
    } else if (slot > 4.5) {
      a = mod(floor(faceAnchor / 1024.0 + 0.001), 4.0);
      f = mod(floor(faceFit / 32.0 + 0.001), 2.0);
    }
    float stretch = f > 0.5 ? 1.0 : 0.0;
    float isRight = (abs(a - 1.0) < 0.5 || abs(a - 3.0) < 0.5) ? 1.0 : 0.0;
    float isTop = a > 1.5 ? 1.0 : 0.0;
    if (hx > 0.001 || hy > 0.001 || hz > 0.001) {
      if (hx < 0.001) hx = 1.0;
      if (hy < 0.001) hy = 1.0;
      if (hz < 0.001) hz = 1.0;
      float oversized = (hx > 1.001 || hy > 1.001 || hz > 1.001) ? 1.0 : 0.0;
      x0 = boxThickX >= 0.0 ? 0.5 - hx : -0.5;
      x1 = boxThickX >= 0.0 ? 0.5 : -0.5 + hx;
      y0 = boxThickY < 0.0 ? -0.5 : 0.5 - hy;
      y1 = boxThickY < 0.0 ? -0.5 + hy : 0.5;
      z0 = boxThickZ >= 0.0 ? -0.5 : 0.5 - hz;
      z1 = boxThickZ >= 0.0 ? -0.5 + hz : 0.5;
      if (index < 0.0 || stretch > 0.5 || oversized > 0.5) {
        pos.x = mix(x0, x1, position.x + 0.5);
        pos.y = mix(y0, y1, position.y + 0.5);
        pos.z = mix(z0, z1, position.z + 0.5);
      } else if (abs(normal.y) > 0.5) {
        pos.y = normal.y > 0.0 ? y1 : y0;
        pos.z = isTop > 0.5 ? position.z + z0 + 0.5 : position.z + z1 - 0.5;
        pos.x = isRight > 0.5 ? position.x + x0 + 0.5 : position.x + x1 - 0.5;
      } else if (abs(normal.z) > 0.5) {
        pos.z = normal.z > 0.0 ? z1 : z0;
        pos.y = isTop > 0.5 ? position.y + y1 - 0.5 : position.y + y0 + 0.5;
        pos.x = isRight > 0.5 ? position.x + x0 + 0.5 : position.x + x1 - 0.5;
      } else if (normal.x < 0.0) {
        pos.x = x0;
        pos.z = isRight > 0.5 ? position.z + z1 - 0.5 : position.z + z0 + 0.5;
        pos.y = isTop > 0.5 ? position.y + y1 - 0.5 : position.y + y0 + 0.5;
      } else {
        pos.x = x1;
        pos.z = isRight > 0.5 ? position.z + z0 + 0.5 : position.z + z1 - 0.5;
        pos.y = isTop > 0.5 ? position.y + y1 - 0.5 : position.y + y0 + 0.5;
      }
    }
    if (planeCrop < 0.5) {
      vClipPos = pos;
      vClipBound = vec4(y0, y1, z0, z1);
      vClipBoundX = vec2(x0, x1);
    }
    if (planeCrop < 0.5) vClipOn = (index >= 0.0 && stretch < 0.5 && (abs(boxThickX) > 0.001 || abs(boxThickY) > 0.001 || abs(boxThickZ) > 0.001) && abs(boxThickX) < 1.001 && abs(boxThickY) < 1.001 && abs(boxThickZ) < 1.001) ? 1.0 : 0.0;
    vec4 local = vec4(pos, 1.0);
    vec4 worldNormal = vec4(normal, 0.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      worldNormal = instanceMatrix * worldNormal;
    #endif
    vec3 faceNormal = normalize((modelMatrix * worldNormal).xyz);
    #ifdef MEP_WALL
      // 壁の R は「回転」ではなく「ブロックのどの面か」（DEC-89）。
      // 北（2）と西（3）は板を裏返さず奥・左へ平行移動しているので、
      // 法線だけ向かい合わせにする。板ごと回すと絵が左右反転してしまう。
      if (mod(floor(chip.w + 0.5), 4.0) >= 1.5) faceNormal = -faceNormal;
    #endif
    // 上向きの明るさ（DEC-125）。遠景の縦板を床と同じ明るさで描く。
    // 発光と違って光は受ける。受ける向きだけ真上に固定する。
    if (mod(floor(chipSides.w / 64.0 + 0.001), 2.0) > 0.5) faceNormal = vec3(0.0, 1.0, 0.0);
    vShade = faceShade(faceNormal);
    #ifdef MEP_BILLBOARD_CARD
      vShade = lightBillboard;
    #endif
    vWorldNormal = faceNormal;
    vWorldPos = (modelMatrix * local).xyz;
    vFogView = (modelViewMatrix * local).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * local;
  #endif
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float alphaCutoff;
uniform vec3 tint;
varying vec2 vChipUv;
varying vec4 vChipRect;
varying float vShade;
varying float vSolid;
varying vec3 vSolidColor;
varying float vEdge;
varying vec3 vEdgeColor;
varying vec2 vFaceUv;
varying vec3 vFogView;
varying vec3 vClipPos;
varying vec4 vClipBound;
varying vec2 vClipBoundX;
varying float vClipOn;
varying float vEmit;
#ifndef MEP_BILLBOARD
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform sampler2D normalMap;
uniform float normalMapOn;
uniform vec3 lightDir;
uniform float lightWrap;
#endif
uniform float lightAmbient;
uniform float lightIntensity;
${POINT_LIGHT_UNIFORMS_GLSL}

#ifndef MEP_BILLBOARD
float faceShade(vec3 worldNormal) {
  float d = dot(worldNormal, lightDir);
  float lambert = clamp(mix(max(d, 0.0), d * 0.5 + 0.5, lightWrap), 0.0, 1.0);
  return lightAmbient + lightIntensity * lambert;
}

vec3 tbnNormal(vec3 geomN, vec3 mapN) {
  vec3 N = normalize(geomN);
  vec3 up = abs(N.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  vec3 n = mapN * 2.0 - 1.0;
  return normalize(T * n.x + B * n.y + N * n.z);
}
#endif

${SUN_SHADOW_UNIFORMS_GLSL}
${SUN_SHADOW_GLSL}
${SUN_ACTOR_UNIFORMS_GLSL}
${SUN_ACTOR_GLSL}

/**
 * 太陽の影は直射だけ落とす（DEC-145）。環境光は残すので点光源（夜・室内）と干渉しない。
 * 雲の影（DEC-218）も同じ直射から引く。**重ねずに濃いほうを採る**——
 * 建物の影の中に雲の影が来ても、そこだけ二重に暗くはならない。
 */
float mepSunShaded(float shade, vec3 worldPos, vec3 normal) {
  float lost = max(mepSunShadow(worldPos, normal) * mepSunStrength, mepCloudShadow(worldPos));
  // キャラの影（DEC-393）。チップの影と同じ濃さで、**重ねずに濃いほうを採る**。
  if (mepSunActorsBlock(worldPos)) lost = max(lost, mepSunStrength);
  if (lost <= 0.0) return shade;
  // 環境光のぶんは明るさ以下に抑える（DEC-400）。ビルボードの明るさは環境光と別の値なので、
  // 環境光のほうが大きいと 1 を超えた影で引きすぎ、影の中だけ真っ黒になった。
  float base = min(shade, lightAmbient);
  float direct = shade - base;
  // 1 までは直射だけ。1 を超えたぶんは環境光も食い、2 で真っ黒（DEC-220）。
  return max(shade - direct * min(lost, 1.0) - base * max(lost - 1.0, 0.0), 0.0);
}

${POINT_LIGHT_GLSL}
#ifdef MEP_BILLBOARD
varying vec3 vShadowPos;
#endif
#if defined(MEP_BILLBOARD) || defined(MEP_BILLBOARD_CARD)
${SPRITE_SHADOW_UNIFORMS_GLSL}
${SPRITE_SHADOW_GLSL}
#endif
uniform float edgeWidth;
uniform float edgeFade;

${FOG_UNIFORMS_GLSL}
#ifdef MEP_WALL
uniform float mepNearFadeOn;
uniform float mepNearFadeDist;
#endif
#ifdef MEP_SEE_THROUGH
uniform float mepSeeOn;   // 0..1 の抜け具合（DEC-281）。ゲームが隠れ具合に合わせて動かす
#endif

${FOG_GLSL}

void main() {
  if (vClipOn > 0.5) {
    float pad = 0.002;
    if (vClipPos.x < vClipBoundX.x - pad || vClipPos.x > vClipBoundX.y + pad) discard;
    if (vClipPos.y < vClipBound.x - pad || vClipPos.y > vClipBound.y + pad) discard;
    if (vClipPos.z < vClipBound.z - pad || vClipPos.z > vClipBound.w + pad) discard;
  }
  // アトラスの引き先はここで組み直す（DEC-141）。
  // MSAA だと、辺にかかった画素は「画素の中心」で補間値を出すため、
  // 中心が三角形の外にあると UV が chip の外へはみ出し、隣のチップの端を引いてしまう。
  // 面 UV を 0..1 に留めてから矩形へ写せば、はみ出しても隣へ入らない。
  vec2 chipUv = vChipRect.xy + clamp(vFaceUv, 0.0, 1.0) * vChipRect.zw;
  vec3 albedo;
  // 透け具合（DEC-378）。**混ぜない材質では 1.0 のまま**なので、今までと同じ絵になる。
  float alpha = 1.0;
  if (vSolid > 0.5) {
    albedo = vSolidColor;
  } else {
    vec4 texel = texture2D(map, chipUv);
    if (texel.a < alphaCutoff) discard;
    albedo = texel.rgb;
    #ifdef MEP_BLEND
      alpha = texel.a;
    #endif
  }

  #ifdef MEP_WALL
  if (mepNearFadeOn > 0.5 && vEmit < 0.5) {
    float dist = length(vFogView);
    float start = max(mepNearFadeDist, 0.001);
    if (mepNearFadeOn > 1.5) {
      if (dist < start) discard;
    } else {
      float t = 1.0 - clamp(dist / start, 0.0, 1.0);
      vec2 p = floor(mod(gl_FragCoord.xy, 4.0));
      vec2 a = mod(p, 2.0);
      float r = a.x + a.y * 2.0;
      vec2 b = mod(floor(p / 2.0), 2.0);
      r = r * 4.0 + b.x + b.y * 2.0;
      if (t * t > (r + 0.5) / 16.0) discard;
    }
  }
  #endif

  // **透過レイヤー**（DEC-251）。半透明にせず、4×4 のディザで市松に捨てる。
  // 不透明のままなので描き順を管理せずに済む（近さで抜く mepNearFade と同じ作り）。
  // レイヤーのプロパティで決まるので、シェーダを分ける（uniform を毎フレーム配らない）。
  #ifdef MEP_SEE_THROUGH
  // 抜け具合は 0..1（DEC-281）。**急に切り替えず、呼ぶ側が時間で動かす。**
  // 4×4 のディザは 16 段なので、抜ける画素が段ごとに増えて溶けるように見える。
  if (mepSeeOn > 0.0) {
    vec2 sp = floor(mod(gl_FragCoord.xy, 4.0));
    vec2 sa = mod(sp, 2.0);
    float sBayer = sa.x + sa.y * 2.0;
    vec2 sb = mod(floor(sp / 2.0), 2.0);
    sBayer = sBayer * 4.0 + sb.x + sb.y * 2.0;
    if (mepSeeOn * MEP_SEE_THROUGH_AMOUNT > (sBayer + 0.5) / 16.0) discard;
  }
  #endif

  if (vEdge > 0.5) {
    vec2 toEdge = min(vFaceUv, vec2(1.0) - vFaceUv);
    float d = min(toEdge.x, toEdge.y);
    float inner = edgeWidth;
    float outer = min(edgeWidth + edgeFade, 0.5);
    if (d < inner) {
      albedo = vEdgeColor;
    } else if (edgeFade > 0.0 && d < outer) {
      albedo = mix(vEdgeColor, albedo, smoothstep(inner, outer, d));
    }
  }

  vec3 colour;
  if (vEmit > 0.5) {
    colour = albedo * tint;
  } else {
  #ifndef MEP_BILLBOARD
    vec3 geomN = normalize(vWorldNormal);
    vec3 N = geomN;
    if (normalMapOn > 0.5 && vSolid < 0.5) {
      N = tbnNormal(N, texture2D(normalMap, chipUv).xyz);
    }
    #ifdef MEP_BILLBOARD_CARD
      float shade = vShade;
    #else
      float shade = faceShade(N);
    #endif
    // ずらすのは形の法線。法線マップで曲げた向きだと面から浮く。
    shade = mepSunShaded(shade, vWorldPos, geomN);
    colour = albedo * tint * (vec3(shade) + pointLightRgb(N, vWorldPos));
  #else
    colour = albedo * tint * (vec3(vShade) + pointLightRgb(vec3(0.0, 1.0, 0.0), vShadowPos));
  #endif
  }

  #ifdef MEP_BILLBOARD
    colour = mepBlockShadow(colour, vShadowPos);
  #elif defined(MEP_BILLBOARD_CARD)
    colour = mepBlockShadow(colour, vWorldPos);
  #endif

  if (mepFogOn) {
    colour = mix(colour, mepFogColor, mepFogFactor(length(vFogView)));
  }

  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

interface TileMaterialOptions {
  billboard: boolean;
  /** 固定／横置きビルボード。カメラを向かず、表チップだけ出す。 */
  card?: boolean;
  /** 横置きのヨー追従。床に寝かせたままカメラ方位へ回る。 */
  flatFollow?: boolean;
  /** 壁バッチ専用。床・箱には付けない。 */
  wall?: boolean;
  /**
   * 透過レイヤー（DEC-251）。レイヤーのプロパティ `SeeThrough` がオンのとき。
   * 半透明にせず、4×4 のディザで市松に捨てる（描き順を管理しなくて済む）。
   */
  seeThrough?: boolean;
  atlas: AtlasLayout;
  lighting: Required<LightingDef>;
  /** チップサイズ（ピクセル）。縁を絵の 1px にするため。 */
  tilePx?: number;
  /** ブロック縁の太さ（面に対する割合）。省略時は絵の 1px。 */
  edgeWidth?: number;
  /** 縁から中央へ向かうぼかし（面に対する割合）。省略時は 0。 */
  edgeFade?: number;
  /** 距離フォグ。省略時は既定（オフ）。 */
  cameraFx?: Required<CameraFxDef>;
  /** ワールド 1 マスの大きさ。ビルボードの影マスク用。 */
  unit?: number;
  /** アルベドと同じ UV の法線マップ。無ければ平面。 */
  normalMap?: Texture;
  pointLights?: PointLightDef[];
  /**
   * レイヤーの重なり順（DEC-123）。共面のチップを深度だけずらす。
   * 頂点を動かすと絵が 1px ずれるので、`polygonOffset` で深度側だけ寄せる。
   * 値は「ずらす段数」。呼ぶ側で並び順の周回とレイヤー設定を足してから渡す（DEC-143）。
   */
  layerDepth?: number;
}

let emptyMask: DataTexture | null = null;
let emptyNormal: DataTexture | null = null;

/** キャラ遮光を使わないときの 1x1 透明テクスチャ。 */
let emptyActor: DataTexture | null = null;
export function emptyActorMap(): DataTexture {
  if (emptyActor) return emptyActor;
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  emptyActor = texture;
  return emptyActor;
}

/** 太陽の影を落とすキャラ 1 人ぶん（DEC-393）。 */
export interface SunActor {
  texture: Texture;
  frame: { x: number; y: number; width: number; height: number };
  foot: Vector3;
  size: { width: number; height: number };
  alphaCutoff?: number;
}

/** 太陽の影を落とすキャラの uniform（DEC-393）。既定は 0 人。 */
export function createSunActorUniforms(): Record<string, { value: unknown }> {
  const uniforms: Record<string, { value: unknown }> = {
    mepSunActorCount: { value: 0 },
    mepSunActorDir: { value: new Vector3(0, 1, 0) },
    mepSunActorNormal: { value: new Vector3(0, 0, 1) },
    mepSunActorPixel: { value: 1 / 32 },
    mepSunActorFrame: { value: Array.from({ length: MAX_SUN_ACTORS }, () => new Vector4(0, 0, 1, 1)) },
    mepSunActorFoot: { value: Array.from({ length: MAX_SUN_ACTORS }, () => new Vector4(0, 0, 0, 0.5)) },
    mepSunActorSize: { value: Array.from({ length: MAX_SUN_ACTORS }, () => new Vector2(1, 1)) },
  };
  for (let i = 0; i < MAX_SUN_ACTORS; i += 1) uniforms[`mepSunActorMap${i}`] = { value: emptyActorMap() };
  return uniforms;
}

/**
 * マテリアルへ太陽の影を落とすキャラを書く（DEC-393）。uniform を持たない材質は素通り。
 * `direction` は面から太陽への単位ベクトル、`facing` は板の向き（カメラ側の水平の単位ベクトル）。
 * 上限を超えた人は捨てる——呼ぶ側で近い順に並べておくこと。
 */
export function applySunActors(
  material: ShaderMaterial,
  actors: readonly SunActor[],
  direction: Vector3,
  facing: Vector3,
  pixel: number,
): void {
  const uniforms = material.uniforms;
  if (!uniforms.mepSunActorCount) return;
  const count = Math.min(actors.length, MAX_SUN_ACTORS);
  uniforms.mepSunActorCount.value = count;
  (uniforms.mepSunActorDir.value as Vector3).copy(direction);
  (uniforms.mepSunActorNormal.value as Vector3).copy(facing);
  uniforms.mepSunActorPixel.value = pixel;
  const frames = uniforms.mepSunActorFrame.value as Vector4[];
  const feet = uniforms.mepSunActorFoot.value as Vector4[];
  const sizes = uniforms.mepSunActorSize.value as Vector2[];
  for (let i = 0; i < count; i += 1) {
    const actor = actors[i]!;
    frames[i]!.set(actor.frame.x, actor.frame.y, actor.frame.width, actor.frame.height);
    feet[i]!.set(actor.foot.x, actor.foot.y, actor.foot.z, actor.alphaCutoff ?? 0.5);
    sizes[i]!.set(actor.size.width, actor.size.height);
    uniforms[`mepSunActorMap${i}`]!.value = actor.texture;
  }
}

export function emptyShadowMap(): DataTexture {
  if (emptyMask) return emptyMask;
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  emptyMask = texture;
  return texture;
}

function emptyNormalMap(): DataTexture {
  if (emptyNormal) return emptyNormal;
  const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  emptyNormal = texture;
  return texture;
}

/** タイル用シェーダ。ビルボードは両面。不透明＋discard で深度を書く。 */
export function createTileMaterial(
  texture: Texture,
  def: MaterialDef,
  options: TileMaterialOptions,
): ShaderMaterial {
  const light = options.lighting;
  const fx = options.cameraFx ?? CAMERA_FX_DEFAULTS;
  const lights = createPointLightArrays();
  const occluders = createOccluderArrays();
  const walls = createLightWallArrays();
  const pointCount = fillPointLightUniforms(options.pointLights, options.unit ?? 1, lights);
  /**
   * 本当に混ぜるか（DEC-378）。材質の `transparent` が立っているときだけ。
   *
   * 既定は今までどおり**切るだけ**（`alphaTest` より薄い画素を捨てる）。水面のように
   * 縁がふわっと薄いチップは、それだと縁が硬くなり下の地面とも混ざらない。
   * 立てたときは**チップのアルファをそのまま出す**——薄い所は下が透ける。
   */
  const blend = def.transparent === true;
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      map: { value: texture },
      normalMap: { value: options.normalMap ?? emptyNormalMap() },
      normalMapOn: { value: options.normalMap ? 1 : 0 },
      // 混ぜるなら**完全に透明な画素だけ**捨てる。0.5 で切ると薄い所が消えてしまう。
      alphaCutoff: { value: blend ? 0.004 : (def.alphaTest ?? 0.5) },
      tint: { value: new Color(1, 1, 1) },
      atlasCols: { value: options.atlas.cols },
      atlasOrigin: { value: options.atlas.origin },
      atlasStep: { value: options.atlas.step },
      atlasSpan: { value: options.atlas.span },
      cullHidden: { value: 0 },
      edgeWidth: { value: edgeWidthFor(options.tilePx, options.edgeWidth) },
      edgeFade: { value: edgeFadeFor(options.edgeFade) },
      lightDir: { value: lightDirection(light) },
      lightAmbient: { value: light.ambient },
      lightIntensity: { value: light.intensity },
      lightWrap: { value: light.wrap },
      lightBillboard: { value: light.billboard },
      lightTime: { value: 0 },
      pointLightCount: { value: pointCount },
      pointLightPos: { value: lights.pos },
      pointLightColor: { value: lights.color },
      pointLightIR: { value: lights.ir },
      pointLightDir: { value: lights.dir },
      pointLightExtra: { value: lights.extra },
      pointLightPulse: { value: lights.pulse },
      // 太陽の影を落とすキャラ（DEC-393）。既定は 0 人（何もしない）。
      ...createSunActorUniforms(),
      // キャラの遮光（GC-39）。既定はオフなので、渡さなければ従来どおり。
      mepActorOn: { value: 0 },
      mepActorMap: { value: emptyActorMap() },
      mepActorFrame: { value: new Vector4(0, 0, 1, 1) },
      mepActorFoot: { value: new Vector3() },
      mepActorSize: { value: new Vector2(1, 1) },
      mepActorCutoff: { value: 0.5 },
      // マップの遮光体（GC-41）。span が全部 0 なら何もしない。
      mepOccMap: { value: emptyOccluderMap() },
      mepOccData: { value: occluders.texture },
      mepOccRows: { value: MAX_OCCLUDERS },
      mepOccSpan: { value: occluders.span },
      mepOccCutoff: { value: 0.5 },
      mepWallCount: { value: 0 },
      mepWallAxis: { value: walls.axis },
      mepWallBounds: { value: walls.bounds },
      mepFogOn: { value: fx.fog },
      mepFogColor: { value: fogColor(fx) },
      mepFogNear: { value: fx.fogNear },
      mepFogFar: { value: fx.fogFar },
      mepFogMax: { value: fx.fogMax },
      // 透過レイヤーの入切（DEC-252）。既定は透ける。ゲームが毎フレーム決める。
      // 既定は抜かない（DEC-281）。ゲームが隠れ具合に合わせて 0..1 で動かす。
      ...(options.seeThrough ? { mepSeeOn: { value: 0 } } : {}),
      ...(options.wall
        ? {
            mepNearFadeOn: { value: 0 },
            mepNearFadeDist: { value: 4 },
          }
        : {}),
      mepShadowMap: { value: emptyShadowMap() },
      mepShadowOrigin: { value: new Vector2() },
      mepShadowSize: { value: new Vector2(1, 1) },
      mepShadowBaseY: { value: 0 },
      mepShadowTpc: { value: TEXELS_PER_CELL },
      mepShadowUnit: { value: options.unit ?? 1 },
      mepShadowOn: { value: 0 },
      mepShadowStrength: { value: Math.min(1, blockShadowStrength(light)) },
      mepShadowFade: { value: FADE_CELLS },
      // 太陽の影（DEC-145）。既定はオフ。焼いてから applySunShadow で入れる。
      ...createSunShadowUniforms(),
    },
    defines: {
      ...(options.billboard ? { MEP_BILLBOARD: '' } : {}),
      ...(options.card ? { MEP_BILLBOARD_CARD: '' } : {}),
      ...(options.flatFollow ? { MEP_BILLBOARD_FLAT: '' } : {}),
      ...(options.wall ? { MEP_WALL: '' } : {}),
      // 透過レイヤー（DEC-251）。抜く割合は定数で持つ。0.5 なら半分の画素を捨てる。
      ...(options.seeThrough ? { MEP_SEE_THROUGH: '', MEP_SEE_THROUGH_AMOUNT: '0.5' } : {}),
      // チップのアルファを出す（DEC-378）。
      ...(blend ? { MEP_BLEND: '' } : {}),
    },
    side: options.billboard || options.card || options.flatFollow || def.side !== 'front' ? DoubleSide : FrontSide,
    transparent: blend,
    // 混ぜる面は**深度を書かない**。書くと後ろの物が消えて、透けたところが背景色になる。
    // 描く順は three が面倒を見る（不透明を全部描いてから、奥から手前へ）。
    depthWrite: blend ? false : (def.depthWrite ?? true),
    depthTest: true,
    // 共面のレイヤーは深度だけ手前へ寄せる（DEC-123）。見た目の位置は動かさない。
    polygonOffset: true,
    // 定数ぶんだけだと、斜めから見た面（面の中で深度が急に変わる）で足りず、
    // 角度やズームで前後が入れ替わってチラつく。傾きに比例する factor も併せて使う（DEC-143）。
    polygonOffsetFactor: -(options.layerDepth ?? 0),
    // 深すぎるとズームアウト時に手前へ出てしまう。段数は呼ぶ側で抑える（DEC-128）。
    polygonOffsetUnits: -(options.layerDepth ?? 0),
  });
  // 太陽の影を焼くかの目印（DEC-378）。混ぜる面は**影を落とさない**——
  // 薄い水面が地面へ真っ黒な影を落とすと、透けている意味がなくなる。
  material.userData.mepBlend = blend;
  tileAttributeDefaults(material);
  return material;
}

/** 属性を省いたバッチのための既定値。タイルと深度で同じ。 */
function tileAttributeDefaults(material: ShaderMaterial): void {
  material.defaultAttributeValues.boxThickY = [0];
  material.defaultAttributeValues.boxThickZ = [0];
  material.defaultAttributeValues.boxThickX = [0];
  material.defaultAttributeValues.faceAnchor = [0];
  material.defaultAttributeValues.faceFit = [0];
  material.defaultAttributeValues.chipEmit = [0];
}

/** 太陽の深度パス用。色は書かず、切り取りと抜き色だけタイルと同じに判定する。 */
const depthFragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float alphaCutoff;
varying vec4 vChipRect;
varying vec2 vFaceUv;
varying float vSolid;
varying vec3 vClipPos;
varying vec4 vClipBound;
varying vec2 vClipBoundX;
varying float vClipOn;

void main() {
  if (vClipOn > 0.5) {
    float pad = 0.002;
    if (vClipPos.x < vClipBoundX.x - pad || vClipPos.x > vClipBoundX.y + pad) discard;
    if (vClipPos.y < vClipBound.x - pad || vClipPos.y > vClipBound.y + pad) discard;
    if (vClipPos.z < vClipBound.z - pad || vClipPos.z > vClipBound.w + pad) discard;
  }
  if (vSolid < 0.5) {
    vec2 chipUv = vChipRect.xy + clamp(vFaceUv, 0.0, 1.0) * vChipRect.zw;
    if (texture2D(map, chipUv).a < alphaCutoff) discard;
  }
  gl_FragColor = vec4(1.0);
}
`;

/**
 * 太陽の深度を焼くマテリアル（DEC-145）。**頂点シェーダはタイルと同じ物**を使う。
 * 厚み・位置の調整（DEC-118）やビルボードの向きが本体とずれると、影だけ別の形になる。
 * uniform はタイル側と**同じオブジェクトを共有**するので、片方を直せば両方に効く。
 */
export function createTileDepthMaterial(source: ShaderMaterial): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader: depthFragmentShader,
    uniforms: source.uniforms,
    defines: { ...(source.defines ?? {}) },
    // 面 1 枚は裏からでも光を遮る。
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  tileAttributeDefaults(material);
  return material;
}
