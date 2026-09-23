// フィールドエフェクト（DEC-175 / DEC-177）。世界に置く。画面エフェクト（`screenEffects.ts`）と違い、
// カメラが動けば一緒に流れていく。
//
// 置き方はオブジェクトレイヤーの四角に載せる。四角の AABB が広がり、`y` が下端、
// `height` が厚み（未設定は 3 マス）。プロパティ `Effect` の値が種類。
//
// 描き方は種類ごとに板の向きが違う。
//   fog / dapple      — 水平の板。地面に沿って見せる
//   rain / snow / mote — 縦の板。カメラは南から北の固定なので、板は南向きで足りる（DEC-147）
// 中身はすべて自前のシェーダー。雨・雪・光の粒はハッシュで散らすのでテクスチャを読まない。

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FramebufferTexture,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { FieldEffectPresetDef, MapObjectDef } from './../mep3d/types';

/** 霧と木漏れ日で使う。速さを変えて重ねる。 */
const NOISE_A = '/assets/noise/Super Perlin/Super Perlin 14 - 512x512.png';
const NOISE_B = '/assets/noise/Super Perlin/Super Perlin 12 - 512x512.png';

/** オブジェクトのプロパティ名。値がこの種類の名前ならフィールドエフェクトになる。 */
export const EFFECT_PROPERTY_NAME = 'Effect';

export const FIELD_EFFECT_KINDS = ['fog', 'smoke', 'rain', 'snow', 'dapple', 'mote', 'water', 'swell', 'mirror'] as const;
export type FieldEffectKind = (typeof FIELD_EFFECT_KINDS)[number];

export const FIELD_EFFECT_LABELS: Record<FieldEffectKind, string> = {
  fog: '霧',
  smoke: '煙',
  rain: '雨',
  snow: '雪',
  dapple: '木漏れ日',
  mote: '光の粒',
  water: '水面',
  swell: '水面2',
  mirror: '鏡面',
};

/** 1 つのプリセット。`id` で参照される。 */
export interface FieldEffectPreset extends FieldEffectSettings {
  id: string;
  name: string;
  kind: FieldEffectKind;
}

function asKind(raw: unknown): FieldEffectKind | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (FIELD_EFFECT_KINDS as readonly string[]).includes(value) ? (value as FieldEffectKind) : null;
}

function num(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** 保存された 1 件を、欠けを既定で埋めて読む。種類が壊れていれば null。 */
export function readFieldPreset(raw: FieldEffectPresetDef): FieldEffectPreset | null {
  const kind = asKind(raw.kind);
  if (!kind || !raw.id) return null;
  const base = FIELD_EFFECT_DEFAULTS[kind];
  return {
    id: String(raw.id),
    name: String(raw.name || FIELD_EFFECT_LABELS[kind]),
    kind,
    on: raw.on !== false,
    amount: num(raw.amount, base.amount),
    speed: num(raw.speed, base.speed),
    scale: num(raw.scale, base.scale),
    color: typeof raw.color === 'string' && raw.color ? raw.color : base.color,
    lift: num(raw.lift, base.lift),
    thick: num(raw.thick, base.thick),
    warp: num(raw.warp, base.warp),
    mirror: num(raw.mirror, base.mirror),
    face: num(raw.face, base.face),
    dye: num(raw.dye, base.dye),
    cast: raw.cast !== false,
  };
}

/**
 * `readFieldVolumes` が要るものだけ（DEC-202）。`MapDef` でも、文書のレイヤー一覧でも渡せる。
 * **マップ全体を書き出さずに済む**——オブジェクトを 1 つ動かすたびに直列化すると重い。
 */
export interface FieldEffectSource {
  layers: ReadonlyArray<{
    id?: string;
    kind: string;
    /** 親グループの id。入れ子の目を辿るのに要る（DEC-221）。 */
    parent?: string;
    /** レイヤーの目。省略時は出す。 */
    visible?: boolean;
    objects?: readonly MapObjectDef[];
  }>;
  fieldEffects?: readonly FieldEffectPresetDef[];
}

/**
 * そのレイヤーが実際に見えているか（DEC-221）。親グループを辿る。
 * `id` / `parent` を持たない呼び出し（古い形）では自分の目だけ見る。
 */
function layerShown(map: FieldEffectSource, layer: FieldEffectSource['layers'][number]): boolean {
  let current = layer;
  for (let guard = 0; guard < map.layers.length + 1; guard += 1) {
    if (current.visible === false) return false;
    const parent = current.parent;
    if (!parent) return true;
    const next = map.layers.find((entry) => entry.id === parent);
    if (!next) return true;
    current = next;
  }
  return true;
}

export function readFieldPresets(map: FieldEffectSource): FieldEffectPreset[] {
  const out: FieldEffectPreset[] = [];
  for (const raw of map.fieldEffects ?? []) {
    const preset = readFieldPreset(raw);
    if (preset) out.push(preset);
  }
  return out;
}

/**
 * マップから置き場所を拾う（DEC-175 / DEC-198 / DEC-200）。エディタとゲームで同じものを使う。
 * オブジェクトレイヤーの四角のうち、プロパティ `Effect` の値が種類の名前のもの。
 * **描いた格子の向き**（xz / xy / yz）がそのまま面の向きになる。
 * **目を切ったレイヤー・オブジェクトは拾わない**（DEC-221）。
 */
export function readFieldVolumes(map: FieldEffectSource): FieldEffectVolume[] {
  const presets = new Map(readFieldPresets(map).map((entry) => [entry.id, entry]));
  const out: FieldEffectVolume[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    // 目を切ったレイヤー・オブジェクトは出さない（DEC-221）。置いたものと絵を一致させる。
    if (!layerShown(map, layer)) continue;
    for (const object of layer.objects ?? []) {
      if (object.visible === false) continue;
      let look: FieldEffectPreset | null = null;
      for (const entry of object.properties ?? []) {
        if (entry.name !== EFFECT_PROPERTY_NAME) continue;
        const raw = String(entry.value).trim();
        // まずプリセットの id。無ければ種類名そのもの（既定の見た目。旧いマップ用）。
        const hit = presets.get(raw) ?? presets.get(raw.toLowerCase());
        if (hit) {
          look = hit;
          break;
        }
        const kind = asKind(raw);
        look = kind
          ? { id: kind, name: FIELD_EFFECT_LABELS[kind], kind, ...FIELD_EFFECT_DEFAULTS[kind] }
          : null;
      }
      if (!look) continue;
      const points = object.points ?? [];
      if (points.length < 2) continue;
      // 点は (u, v)。面によって軸の意味が変わる（`editor/mapObject.setMapObjectPosition` と同じ）。
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const [u, v] of points) {
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
      if (!Number.isFinite(minU)) continue;
      const plane: FieldEffectPlane =
        object.plane === 'xy' || object.plane === 'yz' ? object.plane : 'xz';
      const lift = look.lift;
      if (plane === 'xy') {
        const z = object.z ?? 0;
        out.push({ look, plane, baseY: minV, minX: minU, maxX: maxU, minY: minV + lift, maxY: maxV + lift, minZ: z, maxZ: z });
      } else if (plane === 'yz') {
        const x = object.x ?? 0;
        out.push({ look, plane, baseY: minV, minX: x, maxX: x, minY: minV + lift, maxY: maxV + lift, minZ: minU, maxZ: maxU });
      } else {
        // 床は厚みを設定から取る。オブジェクトの高さは使わない（DEC-200）。
        const base = object.y ?? 0;
        const y = base + lift;
        out.push({ look, plane, baseY: base, minX: minU, maxX: maxU, minY: y, maxY: y + Math.max(0.2, look.thick), minZ: minV, maxZ: maxV });
      }
    }
  }
  return out;
}

/** その種類で何枚の板を使うか。増やすと厚く見えるが重くなる。 */
const LAYERS: Record<FieldEffectKind, number> = {
  fog: 7,
  smoke: 5,
  rain: 5,
  snow: 5,
  dapple: 1,
  mote: 4,
  water: 1,
  swell: 1,
  mirror: 1,
};

/**
 * 置いた面の向き（DEC-198）。オブジェクトを描いた格子がそのまま入る。
 * `xz` は床（今までどおり）、`xy` は南北を向いた縦面、`yz` は東西を向いた縦面。
 */
export type FieldEffectPlane = 'xz' | 'xy' | 'yz';

export interface FieldEffectVolume {
  /** この置き場所で使う見た目。プリセットそのもの（DEC-200）。 */
  look: FieldEffectPreset;
  plane: FieldEffectPlane;
  /**
   * オブジェクトを描いた高さ（セル。DEC-217）。`lift` を足す前の Y。
   * 雲の影はここへ敷く。縦面では使わない。
   */
  baseY: number;
  /** セル座標の箱。縦面のときは薄い箱（片方の幅が 0）。 */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface FieldEffectSettings {
  /**
   * 出すか。**エディタからは切り替えない**（DEC-225）。出す／出さないは演出の側で決めるので、
   * ゲームが実行時に触る前提で残してある。保存に無ければ入。切れているものは一覧に（切）と出る。
   */
  on: boolean;
  /** 濃さ・数。 */
  amount: number;
  /** 流れる速さ。 */
  speed: number;
  /** 粒や模様の細かさ。大きいほど細かい。 */
  scale: number;
  color: string;
  /** 高さのずらし（マス。DEC-200）。置いた面から上下へ動かす。 */
  lift: number;
  /** 厚み（マス）。床に置いたときだけ効く。 */
  thick: number;
  /**
   * 水面の歪み（DEC-302）。**水面だけ**が使う。
   * 下地（その時点の画面）を波でずらす量。0 で歪めない。
   */
  warp: number;
  /**
   * 水面の映り込み（DEC-303）。**水面だけ**が使う。0 で映さない。
   * **シーンをもう 1 回描く**ので、上げるとそのぶん重くなる。
   */
  mirror: number;
  /**
   * 真正面から見たときの映りの強さ（DEC-321）。0〜1。
   * 映り込みの重みは `映り込み × (face + (1 - face) × フレネル)`。
   * 0 なら真上から覗いたとき映らず、1 なら角度によらず一定に映る。
   */
  face: number;
  /**
   * 映り込んだ絵を水の色で染める量（DEC-322）。0〜1。
   * 0 は素の色のまま、1 は水の色味を掛ける。明るさは落とさない。
   */
  dye: number;
  /**
   * 水面へ映すか（DEC-345）。省略時は映す。
   * 映す側（水面・うねり・鏡面）は焼くあいだ必ず隠れるので、この札は見ない。
   */
  cast: boolean;
}

export const FIELD_EFFECT_DEFAULTS: Record<FieldEffectKind, FieldEffectSettings> = {
  fog: { on: true, amount: 0.5, speed: 0.03, scale: 0.09, color: '#dbe6f0', lift: 0, thick: 3, warp: 0, mirror: 0, face: 0.22, dye: 0, cast: true },
  // 煙は立ち上がる柱（DEC-343）。厚みが柱の高さになる。
  smoke: { on: true, amount: 0.75, speed: 0.35, scale: 0.5, color: '#9aa3ad', lift: 0, thick: 6, warp: 0.8, mirror: 0, face: 0.22, dye: 0, cast: true },
  rain: { on: true, amount: 0.55, speed: 1.6, scale: 1, color: '#b9cfe4', lift: 0, thick: 8, warp: 0, mirror: 0, face: 0.22, dye: 0, cast: true },
  snow: { on: true, amount: 0.7, speed: 0.35, scale: 1, color: '#ffffff', lift: 0, thick: 8, warp: 0, mirror: 0, face: 0.22, dye: 0, cast: true },
  dapple: { on: true, amount: 0.45, speed: 0.02, scale: 0.14, color: '#fff3cf', lift: 0, thick: 1, warp: 0, mirror: 0, face: 0.22, dye: 0, cast: true },
  mote: { on: true, amount: 0.6, speed: 0.18, scale: 1, color: '#ffe9a8', lift: 0, thick: 4, warp: 0, mirror: 0, face: 0.22, dye: 0, cast: true },
  // 水面は面 1 枚（DEC-300）。厚みは使わないので薄くしてある。
  water: { on: true, amount: 0.35, speed: 0.05, scale: 0.12, color: '#2f7ea8', lift: 0, thick: 0.5, warp: 0.5, mirror: 0.35, face: 0.22, dye: 0, cast: true },
  // うねりは空の絵を映す（DEC-316）。映り込み 0 なら書き割りだけを読むので**軽い**。
  swell: { on: true, amount: 0.32, speed: 0.5, scale: 0.35, color: '#12405c', lift: 0, thick: 0.5, warp: 1, mirror: 0, face: 0.22, dye: 0, cast: true },
  // 鏡面は映すだけ（DEC-308）。波もきらめきも持たない。色はほんの少しだけ乗せる。
  mirror: { on: true, amount: 0.06, speed: 0, scale: 0.12, color: '#31434f', lift: 0, thick: 0.5, warp: 0, mirror: 0.9, face: 0.22, dye: 0, cast: true },
};

export interface FieldEffects {
  group: Group;
  /** 置き場所を差し替える。板を組み直す。 */
  setVolumes(list: FieldEffectVolume[], unit: number): void;
  /**
   * 見た目だけ差し替える（DEC-200）。板は組み直さない。
   * 表のキーはプリセットの `id`。`lift` と `thick` は形が変わるので `setVolumes` を呼び直す。
   */
  setLooks(looks: Record<string, FieldEffectSettings>): void;
  /** まとめて出す／出さない（DEC-201）。置き場所の有無とは別に持つ。 */
  setVisible(on: boolean): void;
  /**
   * 水面へ映すもの（DEC-303）。**シーンをもう 1 回描く**ので、
   * 何を渡すかは呼び元が決める。渡さなければ映り込みは出ない。
   * 補助線や格子を映したくないので、`scene` ごとは渡さないこと。
   *
   * `hooks` は焼く前後に呼ぶ（DEC-311）。**エディタだけの見せ方を外す**ために使う——
   * 「手前を薄く抜く」は鏡像のカメラから見ても効いてしまい、映り込みが虫食いになる。
   */
  setReflectSources(objects: readonly Object3D[], hooks?: ReflectHooks): void;
  /**
   * 空の絵（DEC-316）。**うねり**が環境として引く。書き割りの絵をそのまま渡す。
   * 渡さなければ「うねり」は水の色だけになる。画面をもう一度描かないので**軽い**。
   */
  setSkyTexture(texture: Texture | null): void;
  /** 毎フレーム。時間を進める。 */
  update(deltaSeconds: number): void;
  dispose(): void;
}

/** どの種類でも同じ。世界の位置と、板の中の UV を渡す。 */
const vertexShader = `
varying vec3 vWorld3;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  // 世界の座標で引く。板を動かさずに模様だけ流すので、置いた場所に留まる。
  vWorld3 = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * 水面だけ使う頂点シェーダ（DEC-302）。画面のどこに出るかを渡す。
 * 下地（写した画面）を読む位置に要る。解像度は要らない——`w` で割れば 0..1 になる。
 */
const waterVertexShader = `
uniform mat4 mirrorMatrix;
varying vec3 vWorld3;
varying vec2 vUv;
varying vec4 vClip;
varying vec4 vMirror;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld3 = world.xyz;
  vClip = projectionMatrix * viewMatrix * world;
  // 鏡像を読む位置（DEC-310）。行列に板の変換まで入っているので**局所座標**を掛ける。
  vMirror = mirrorMatrix * vec4(position, 1.0);
  gl_Position = vClip;
}
`;

/**
 * 焼いた鏡像を読むときの後始末（DEC-322 / DEC-325）。
 *
 * - **アルファで割る。** 的は「黒・アルファ 0」で下塗りしてあるので、
 *   輪郭の補間された画素は色が黒へ引かれている。割ると素の色に戻る。
 * - **リニア → sRGB。** three は**別の的へ描くとき、出力の色空間をリニアに固定する**
 *   （`WebGLPrograms`: 的が XR でなければ `LinearSRGBColorSpace`）。チップも書き割りも
 *   `<colorspace_fragment>` を通すので、**画面へは sRGB・的にはリニア**で書かれる。
 *   そのまま読むと**濃く沈んで**見える——背景と映りで色が違って見えるのはこれ。
 *   読むときに焼き直して画面と揃える。**画面の写し（`sceneMap`）は画面からの複製なので
 *   すでに sRGB。あちらへ掛けてはいけない。**
 * - **染まり。** 水の色で映りを染める量。0 で素のまま、1 で水の色味を掛ける。
 *   明るさを保つため、色は一番強い成分で割ってから掛ける（暗くしない）。
 */
const REFL_COLOUR = `
vec3 mepReflColour(vec4 refl, vec3 tone, float dye) {
  vec3 rgb = refl.rgb / max(refl.a, 0.004);
  // three の sRGBTransferOETF と同じ式。
  rgb = mix(pow(rgb, vec3(0.41666)) * 1.055 - vec3(0.055), rgb * 12.92, vec3(lessThanEqual(rgb, vec3(0.0031308))));
  rgb = clamp(rgb, 0.0, 1.0);
  if (dye <= 0.0) return rgb;
  vec3 hue = tone / max(max(tone.r, max(tone.g, tone.b)), 0.004);
  return mix(rgb, rgb * hue, clamp(dye, 0.0, 1.0));
}
`;

/** 四角の縁で切れると板だとばれるので、外周を落とす。 */
const EDGE_FADE = `
float mepEdgeFade(vec2 uv, float width) {
  vec2 edge = min(uv, 1.0 - uv);
  return smoothstep(0.0, width, min(edge.x, edge.y));
}
`;

const HASH = `
float mepHash(float n) { return fract(sin(n * 127.1) * 43758.5453123); }
float mepHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

const COMMON_UNIFORMS = `
uniform vec3 tint;
uniform float amount;
uniform float speed;
uniform float scale;
uniform float time;
/** その板の位置。0 が下端（手前）、1 が上端（奥）。 */
uniform float level;
varying vec3 vWorld3;
varying vec2 vUv;
/** 水平面での引き方。縦面のシェーダは使わない。 */
#define vWorld vWorld3.xz
`;

/** 霧。ノイズ 2 枚を別の速さで流して重ねる。1 枚だと動きが読めて模様に見える。 */
const fogShader = `
precision highp float;
uniform sampler2D mapA;
uniform sampler2D mapB;
${COMMON_UNIFORMS}
${EDGE_FADE}
void main() {
  vec2 shift = vec2(level * 3.7, level * 1.9);
  vec2 flowA = vec2(time * speed, time * speed * 0.23);
  vec2 flowB = vec2(time * speed * 0.45, -time * speed * 0.11);
  float a = texture2D(mapA, vWorld * scale + flowA + shift).r;
  float b = texture2D(mapB, vWorld * scale * 0.61 - flowB + shift).r;
  float n = smoothstep(0.3, 0.9, a * 0.6 + b * 0.6);
  // 上ほど薄い。下に溜まって見える。
  float lift = 1.0 - level * 0.85;
  float alpha = n * lift * mepEdgeFade(vUv, 0.18) * amount;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(tint, alpha);
}
`;

/**
 * 縦に置いた霧（DEC-198）。背景の手前に垂らす帯。
 * 横方向は面に沿った世界軸（`axisZ` が 1 なら Z、0 なら X）、縦は世界の Y で引く。
 */
const fogWallShader = `
precision highp float;
uniform sampler2D mapA;
uniform sampler2D mapB;
uniform float axisZ;
${COMMON_UNIFORMS}
${EDGE_FADE}
void main() {
  vec2 here = vec2(mix(vWorld3.x, vWorld3.z, axisZ), vWorld3.y);
  vec2 flowA = vec2(time * speed, time * speed * 0.17);
  vec2 flowB = vec2(time * speed * 0.45, -time * speed * 0.09);
  float a = texture2D(mapA, here * scale + flowA).r;
  float b = texture2D(mapB, here * scale * 0.61 - flowB).r;
  float n = smoothstep(0.3, 0.9, a * 0.6 + b * 0.6);
  // 下ほど濃い。地面に溜まって見える。
  float lift = 1.0 - vUv.y * 0.85;
  float alpha = n * lift * mepEdgeFade(vUv, 0.18) * amount;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(tint, alpha);
}
`;

/** 木漏れ日。ノイズを高いところで切って明るい斑にする。加算で重ねる。 */
const dappleShader = `
precision highp float;
uniform sampler2D mapA;
uniform sampler2D mapB;
${COMMON_UNIFORMS}
${EDGE_FADE}
void main() {
  vec2 flow = vec2(time * speed, time * speed * 0.4);
  float a = texture2D(mapA, vWorld * scale + flow).r;
  float b = texture2D(mapB, vWorld * scale * 1.7 - flow * 0.6).r;
  // 掛けてから高いところで切る。葉の隙間だけが抜けるので斑になる。
  float n = smoothstep(0.52, 0.86, a * b * 1.9);
  float alpha = n * mepEdgeFade(vUv, 0.2) * amount;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(tint * alpha, alpha);
}
`;

/** 雨。列に切って、列ごとに速さと横位置を変えた筋を落とす。 */
const rainShader = `
precision highp float;
${COMMON_UNIFORMS}
${EDGE_FADE}
${HASH}
void main() {
  float cols = max(4.0, 46.0 * scale);
  float x = vUv.x * cols;
  float col = floor(x);
  float fx = fract(x);
  float r = mepHash(col + level * 31.0);
  float fast = 0.65 + 0.7 * mepHash(col + level * 13.0 + 5.0);
  // fract(uv.y + t) は t が増えるほど模様が下へ流れる。
  float rows = 1.5 + 2.5 * r;
  float y = fract(vUv.y * rows + time * speed * fast + r);
  // 筋。頭が濃く、尾を引く。
  float streak = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.05, 0.34, y));
  // 列の中では細い線。列ごとに横へずらす。
  float w = 1.0 - smoothstep(0.05, 0.20, abs(fx - 0.5 - (r - 0.5) * 0.5));
  // 列の一部だけ降らせる。全部だと簾に見える。
  float pick = step(0.30, mepHash(col * 3.3 + level));
  float alpha = streak * w * pick * mepEdgeFade(vUv, 0.1) * amount;
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(tint, alpha);
}
`;

/** 雪。格子に 1 粒ずつ置き、格子ごと下へ流しながら横に揺らす。 */
const snowShader = `
precision highp float;
${COMMON_UNIFORMS}
${EDGE_FADE}
${HASH}
void main() {
  float cells = max(3.0, 22.0 * scale);
  vec2 p = vUv * vec2(cells, cells * 0.62);
  p.y += time * speed * (0.6 + level * 0.5);
  // 高さで揺らす。まっすぐ落ちると雨に見える。
  p.x += sin(time * 0.7 + p.y * 1.6 + level * 4.0) * 0.3;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  float r = mepHash2(id + level * 17.0);
  float radius = 0.10 + 0.16 * r;
  float d = length(f);
  float grain = 1.0 - smoothstep(radius * 0.4, radius, d);
  // 半分ほどの格子だけ使う。全部だと粒が整列して見える。
  float pick = step(0.45, r);
  float alpha = grain * pick * mepEdgeFade(vUv, 0.12) * amount;
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(tint, alpha);
}
`;

/** 光の粒。雪よりゆっくり漂い、明るさが呼吸する。加算で重ねる。 */
const moteShader = `
precision highp float;
${COMMON_UNIFORMS}
${EDGE_FADE}
${HASH}
void main() {
  float cells = max(2.0, 13.0 * scale);
  vec2 p = vUv * vec2(cells, cells * 0.55);
  // 上へゆっくり。蛍のように漂わせる。
  p.y -= time * speed * (0.5 + level * 0.4);
  p.x += sin(time * 0.5 + p.y * 2.3 + level * 2.0) * 0.35;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  float r = mepHash2(id + level * 23.0);
  float d = length(f);
  float core = 1.0 - smoothstep(0.03, 0.16 + 0.12 * r, d);
  // 明滅。粒ごとに位相をずらす。
  float pulse = 0.6 + 0.4 * sin(time * (0.8 + r * 1.6) + r * 30.0);
  float pick = step(0.5, r);
  float alpha = core * pick * pulse * mepEdgeFade(vUv, 0.14) * amount;
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(tint * alpha, alpha);
}
`;

/**
 * 水面（DEC-300）。速さと大きさを変えた値ノイズを 3 枚重ねて波の高さにし、
 * 隣との差から法線を作って光らせる。参考にしたのは 2D 側の水面シェーダ。
 *
 * **後ろを歪ませることはしない。** 屈折には画面をもう 1 枚焼いて読む必要があり、
 * それは板 1 枚では済まない。ここは半透明の面として、下地は素通りさせる。
 */
const waterShader = `
precision highp float;
uniform sampler2D sceneMap;
uniform float sceneOn;
uniform float warp;
uniform float face;
uniform float dye;
uniform sampler2D mirrorMap;
uniform float mirrorOn;
uniform float mirror;
varying vec4 vClip;
varying vec4 vMirror;
${COMMON_UNIFORMS}
${EDGE_FADE}
${REFL_COLOUR}
${HASH}

// 値ノイズ。格子の四隅を滑らかに混ぜる。
float mepValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mepHash2(i), mepHash2(i + vec2(1.0, 0.0)), u.x),
    mix(mepHash2(i + vec2(0.0, 1.0)), mepHash2(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

// 波の高さ。3 枚を別の速さ・大きさで流す。1 枚だと動きが読めて模様に見える。
float mepWave(vec2 p) {
  float t = time * speed;
  return mepValue(p * 2.0 + vec2(t * 1.6, t * 2.4)) * 0.5
       + mepValue(p * 4.0 - vec2(t * 3.0, t * 1.0)) * 0.3
       + mepValue(p * 8.0 + vec2(t * 4.0, -t * 2.0)) * 0.2;
}

void main() {
  // 世界の XZ で引く。板を動かさず模様だけ流すので、置いた場所に留まる。
  vec2 p = vWorld * scale * 8.0;
  float e = 0.05;
  float h = mepWave(p);
  float hL = mepWave(p - vec2(e, 0.0));
  float hR = mepWave(p + vec2(e, 0.0));
  float hD = mepWave(p - vec2(0.0, e));
  float hU = mepWave(p + vec2(0.0, e));
  // 水平の板なので上は Y。z を小さくすると波が鋭くなる。
  vec3 n = normalize(vec3((hL - hR) * 6.0, 1.0, (hD - hU) * 6.0));

  // 太陽は高いところから斜めに、と決め打つ。板は水平なので向きは変わらない。
  vec3 lightDir = normalize(vec3(-0.45, 0.85, -0.4));
  vec3 halfDir = normalize(lightDir + vec3(0.0, 1.0, 0.0));
  float spec = pow(max(dot(n, halfDir), 0.0), 90.0);
  // 峰だけ光らせる。谷まで光ると一面が白む。
  float crest = smoothstep(0.52, 0.86, h);

  vec3 water = tint * (0.72 + 0.55 * h);
  float edge = mepEdgeFade(vUv, 0.12);
  vec3 colour;
  float alpha;
  if (sceneOn > 0.5 && warp > 0.0) {
    // 下地は**その時点の画面**（DEC-302）。板が描かれる直前に写してある。
    vec2 screen = (vClip.xy / vClip.w) * 0.5 + 0.5;
    vec2 off = vec2(hL - hR, hD - hU) * warp * 0.06;
    vec3 under = texture2D(sceneMap, clamp(screen + off, vec2(0.002), vec2(0.998))).rgb;
    // 自分で下地を描くので不透明でよい。濃さは水の色をどれだけ混ぜるか。
    colour = mix(under, water, clamp(amount, 0.0, 1.0));
    alpha = 1.0;
  } else {
    colour = water;
    alpha = clamp(amount, 0.0, 1.0);
  }
  /*
   * 映り込み（DEC-303 / DEC-307）。**画面の座標でそのまま読む。**
   * 仮のカメラは本物の鏡像で、射影も同じものを使っているので、
   * 水面の上の点は**どちらのカメラでも画面の同じ場所**へ来る。
   * 行列を組んで引くより素直で、寄り引きでずれることもない。
   */
  if (mirrorOn > 0.5 && mirror > 0.0) {
    vec4 mq = vMirror;
    mq.xy += vec2(hL - hR, hD - hU) * warp * 0.18 * mq.w;
    // 透明な所は「映す物が無い」（DEC-309）。混ぜる量に掛けて、そこは素通しにする。
    vec4 refl = texture2DProj(mirrorMap, mq);
    vec3 eye = normalize(cameraPosition - vWorld3);
    float fres = pow(1.0 - clamp(dot(eye, n), 0.0, 1.0), 3.0);
    float mix2 = clamp(mirror * (face + (1.0 - face) * fres), 0.0, 1.0) * refl.a;
    colour = mix(colour, mepReflColour(refl, tint, dye), mix2);
    alpha = max(alpha, mix2 * edge);
  }
  colour += vec3(1.0) * spec * crest * 2.2;
  alpha = clamp(alpha + spec * crest * 0.9, 0.0, 1.0) * edge;
  if (alpha <= 0.003) discard;
  gl_FragColor = vec4(colour, alpha);
}
`;

/**
 * 鏡面（DEC-308）。**映すだけ**の面。波もきらめきも持たない。
 * 水面をこの上へ重ねると、水の波・きらめきと鏡の映り込みを別々に調整できる。
 * 「歪み」を上げれば、この面だけでもゆるく揺れる。
 */
const mirrorShader = `
precision highp float;
uniform sampler2D sceneMap;
uniform float sceneOn;
uniform float warp;
uniform float face;
uniform float dye;
uniform sampler2D mirrorMap;
uniform float mirrorOn;
uniform float mirror;
varying vec4 vClip;
varying vec4 vMirror;
${COMMON_UNIFORMS}
${EDGE_FADE}
${REFL_COLOUR}
${HASH}

float mepValueM(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mepHash2(i), mepHash2(i + vec2(1.0, 0.0)), u.x),
    mix(mepHash2(i + vec2(0.0, 1.0)), mepHash2(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

void main() {
  vec2 screen = (vClip.xy / vClip.w) * 0.5 + 0.5;
  vec2 off = vec2(0.0);
  if (warp > 0.0) {
    vec2 p = vWorld * scale * 8.0;
    float t = time * speed;
    float e = 0.05;
    float hL = mepValueM(p - vec2(e, 0.0) + vec2(t, t * 0.6));
    float hR = mepValueM(p + vec2(e, 0.0) + vec2(t, t * 0.6));
    float hD = mepValueM(p - vec2(0.0, e) + vec2(t, t * 0.6));
    float hU = mepValueM(p + vec2(0.0, e) + vec2(t, t * 0.6));
    off = vec2(hL - hR, hD - hU) * warp * 0.06;
  }
  vec2 uv = clamp(screen + off, vec2(0.002), vec2(0.998));
  vec3 under = sceneOn > 0.5 ? texture2D(sceneMap, uv).rgb : tint;
  // 鏡像は行列で読む（DEC-310）。歪みは w を掛けて射影の前でずらす。
  vec4 mq = vMirror;
  mq.xy += off * 3.0 * mq.w;
  // 透明な所は「映す物が無い」（DEC-309）。混ぜる量に掛けて、そこは下地のままにする。
  vec4 refl = mirrorOn > 0.5 ? texture2DProj(mirrorMap, mq) : vec4(0.0);
  // 平らな面なので法線は真上。浅い角度ほど強く映す。
  vec3 eye = normalize(cameraPosition - vWorld3);
  float fres = pow(1.0 - clamp(eye.y, 0.0, 1.0), 3.0);
  vec3 base = mix(under, tint, clamp(amount, 0.0, 1.0));
  vec3 colour = mix(base, mepReflColour(refl, tint, dye), clamp(mirror * (face + (1.0 - face) * fres), 0.0, 1.0) * refl.a);
  float edge = mepEdgeFade(vUv, 0.12);
  // 下地は自分で描くので不透明でよい。写す前だけ薄く出す。
  float alpha = (sceneOn > 0.5 ? 1.0 : clamp(amount + mirror, 0.0, 1.0)) * edge;
  if (alpha <= 0.003) discard;
  gl_FragColor = vec4(colour, alpha);
}
`;

/**
 * うねり（DEC-316）。**空の絵を映す水面。**
 *
 * 水面（DEC-300）が「下地を歪める」のに対し、こちらは**書き割りの絵を環境として映す**。
 * 画面をもう一度描かないので**軽い**。参考にした Phaser の例と同じ組み立てで、
 *
 * - **単体ノイズ**（simplex）を**縦へ引き伸ばした格子**で引く。奥へ伸びる筋になる
 * - 引く位置そのものを別のノイズでずらす（**ドメインワープ**）。うねって見える
 * - そこから法線を出し、**視線を反射させて空の絵を引く**
 *
 * `映り込み` を 0 より上げると、焼いた鏡像（重い）を空の上へ混ぜる。
 * 0 のままなら書き割りだけなので、広い湖でも値段が変わらない。
 */
const swellShader = `
precision highp float;
uniform sampler2D sceneMap;
uniform float sceneOn;
uniform float warp;
uniform float face;
uniform float dye;
uniform sampler2D skyMap;
uniform float skyOn;
uniform sampler2D mirrorMap;
uniform float mirrorOn;
uniform float mirror;
varying vec4 vClip;
varying vec4 vMirror;
${COMMON_UNIFORMS}
${EDGE_FADE}
${REFL_COLOUR}

// 2D simplex ノイズ（Ashima / Gustavson の作りをそのまま）。値ノイズより筋が出にくい。
vec3 mepPermute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float mepSimplex(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = mepPermute(mepPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/**
 * うねりの高さ。**縦へ 6 倍引き伸ばした格子**で引き、引く位置自体をノイズでずらす。
 * 引き伸ばすと波が奥行き方向の筋になり、湖を斜めから見たときの見えに近づく。
 */
float mepSwell(vec2 p) {
  float t = time * speed;
  vec2 q = vec2(p.x, p.y * 6.0);
  // ドメインワープ。うねりの強さで効き方を変える。
  vec2 w = vec2(mepSimplex(q * 0.5 + vec2(t * 0.3, 0.0)), mepSimplex(q * 0.5 + vec2(5.2, t * 0.4)));
  q += w * warp * 0.8;
  return mepSimplex(q + vec2(0.0, t * 1.2)) * 0.6 + mepSimplex(q * 2.3 - vec2(t * 0.7, 0.0)) * 0.4;
}

void main() {
  vec2 p = vWorld * scale * 4.0;
  float e = 0.08;
  float h = mepSwell(p);
  float hL = mepSwell(p - vec2(e, 0.0));
  float hR = mepSwell(p + vec2(e, 0.0));
  float hD = mepSwell(p - vec2(0.0, e));
  float hU = mepSwell(p + vec2(0.0, e));
  // 水平の板なので上は Y。うねりが強いほど法線を寝かせる。
  float bend = 0.35 + warp * 0.65;
  vec3 n = normalize(vec3((hL - hR) * bend * 4.0, 1.0, (hD - hU) * bend * 4.0));

  vec3 eye = normalize(vWorld3 - cameraPosition);
  // 面で跳ね返った先。これが「映って見える向き」。
  vec3 m = reflect(eye, n);

  vec3 water = tint * (0.78 + 0.5 * h);
  vec3 sky = water;
  float skyHit = 0.0;
  if (skyOn > 0.5) {
    // 書き割りは筒／球なので、方位をそのまま横の位置に、上向きぶんを縦の位置に写す。
    vec2 suv = vec2(atan(m.z, m.x) * 0.15915494 + 0.5, clamp(m.y * 1.8, 0.0, 1.0));
    // 空も「映っている絵」なので、染まりは同じように効かせる（DEC-323）。
    sky = mepReflColour(vec4(texture2D(skyMap, suv).rgb, 1.0), tint, dye);
    skyHit = 1.0;
  }

  // 浅い角度ほど強く映る。真上から覗くと水の色が勝つ。
  float fres = pow(1.0 - clamp(dot(-eye, n), 0.0, 1.0), 3.0);
  float blend = clamp(face + (1.0 - face) * fres, 0.0, 1.0) * skyHit;
  vec3 colour = mix(water, sky, blend);

  // 焼いた鏡像があれば空の上へ混ぜる（重い側）。映り込み 0 なら焼かない。
  if (mirrorOn > 0.5 && mirror > 0.0) {
    vec4 mq = vMirror;
    mq.xy += vec2(hL - hR, hD - hU) * warp * 0.22 * mq.w;
    vec4 refl = texture2DProj(mirrorMap, mq);
    colour = mix(colour, mepReflColour(refl, tint, dye), clamp(mirror * (face + (1.0 - face) * fres), 0.0, 1.0) * refl.a);
  }

  /*
   * 水の色を乗せる（濃さ。DEC-324）。**最後に掛ける。**
   * 前は水の色を空と混ぜる側にだけ置いていたので、「正面の映り」を 1 にすると
   * 混ぜる重みが 1 になり、**濃さが 1 ミリも効かなかった**。アルファも空があると 1 に
   * 固定されるため、つまみが完全に死んでいた。水面（DEC-300）と同じ意味——
   * 「出来上がった絵へ水の色をどれだけ混ぜるか」——に揃える。
   */
  colour = mix(colour, water, clamp(amount, 0.0, 1.0));

  // 峰の白。谷まで光ると一面が白む。
  vec3 lightDir = normalize(vec3(-0.45, 0.85, -0.4));
  float spec = pow(max(dot(n, normalize(lightDir - eye)), 0.0), 60.0);
  float crest = smoothstep(0.25, 0.75, h);
  colour += vec3(1.0) * spec * crest * 1.6;

  float edge = mepEdgeFade(vUv, 0.12);
  // 下地は見せない。書き割りが無いときだけ水の色で塗る。
  float alpha = clamp(mix(clamp(amount, 0.0, 1.0), 1.0, skyHit), 0.0, 1.0) * edge;
  if (alpha <= 0.003) discard;
  gl_FragColor = vec4(colour, alpha);
}
`;

/**
 * 煙（DEC-343）。**立ち上がって広がりながら薄れる**もの。
 *
 * 霧（DEC-172）は空気に溶けた層で、板を水平に敷いて一面を白ませる。煙は違って、
 * **下から湧いて上へ抜ける柱**なので、縦板を前後に並べて雲を昇らせる。
 * 雨や光の粒と同じ立て方だが、粒ではなく**塊**なので、値ノイズを 3 枚重ねて縁をぼかす。
 *
 * - **下は細く、上へ行くほど広がる逆三角**（DEC-346）。広がり方は「広がり」つまみ
 * - 上へ行くほど模様も引き伸ばし、**薄れる**（`fade`）
 * - 板ごとに位相と速さをずらす。同じ絵が重なると板の枚数が見えてしまう
 * - 加算では出さない。煙は光らない——下地を**覆う**
 */
const smokeShader = `
precision highp float;
uniform float warp;
${COMMON_UNIFORMS}
${EDGE_FADE}
${HASH}

// 値ノイズ。格子の四隅を滑らかに混ぜる。
float mepValueS(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mepHash2(i), mepHash2(i + vec2(1.0, 0.0)), u.x),
    mix(mepHash2(i + vec2(0.0, 1.0)), mepHash2(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

// 3 枚重ねの雲。細かいほど速く流す。
float mepPuff(vec2 p, float t) {
  return mepValueS(p + vec2(t * 0.10, -t)) * 0.55
       + mepValueS(p * 2.1 + vec2(-t * 0.20, -t * 1.7)) * 0.30
       + mepValueS(p * 4.3 + vec2(t * 0.35, -t * 2.6)) * 0.15;
}

void main() {
  // 0 が下端（煙突の口）、1 が上端。
  float up = vUv.y;
  /*
   * 逆三角の輪郭（DEC-346）。下端の半幅を「広がり」で決め、上端で板いっぱいへ開く。
   * 広がり 0 なら下も板いっぱい＝四角のまま。1 に近いほど煙突らしくすぼまる。
   */
  float root = mix(0.5, 0.10, clamp(warp, 0.0, 1.0));
  // **half は GLSL の予約語**。使うと「Illegal use of reserved word」で通らない。
  float halfW = mix(root, 0.5, up);
  float off = abs(vUv.x - 0.5);
  // 縁はやわらかく。硬く切ると三角形の板に見える。
  float side = 1.0 - smoothstep(halfW * 0.35, halfW, off);
  /*
   * 模様は**幅で割った座標**で引く。裾が広がっても同じ細かさの雲が乗るので、
   * 上へ行くほど雲そのものが引き伸ばされて散っていくように見える。
   */
  float cells = max(1.0, 9.0 * scale);
  vec2 p = vec2((vUv.x - 0.5) / max(halfW, 0.02) * 0.5, up) * cells;
  // 板ごとに位相をずらす。同じ絵が重なると枚数が見えてしまう。
  p += vec2(level * 7.3, level * 3.1);
  float t = time * max(0.0, speed) * (0.85 + level * 0.3);
  // 立ち上がりながら横へ揺れる。上ほど大きく振る。
  p.x += sin(t * 0.6 + up * 2.4 + level * 2.0) * (0.3 + up * 0.7);
  float puff = mepPuff(p, t);
  /*
   * 口元は濃く、上へ行くほど薄れて散る。しきい値も下ほど低くして、
   * 煙突の口が途切れないようにする。
   */
  float mouth = smoothstep(0.0, 0.05, up);
  float fade = 1.0 - smoothstep(0.30, 1.0, up);
  float gate = mix(0.34, 0.60, up);
  float body = smoothstep(gate, gate + 0.30, puff) * mouth * fade * side;
  float alpha = clamp(body * amount, 0.0, 1.0) * mepEdgeFade(vUv, 0.10);
  if (alpha <= 0.004) discard;
  // 濃い所ほど白く、薄い所は色のまま。焚き火の煙が芯だけ明るいのに合わせる。
  vec3 colour = mix(tint, tint * 1.35, smoothstep(0.55, 0.95, puff));
  gl_FragColor = vec4(colour, alpha);
}
`;

const SHADERS: Record<FieldEffectKind, string> = {
  fog: fogShader,
  smoke: smokeShader,
  rain: rainShader,
  snow: snowShader,
  dapple: dappleShader,
  mote: moteShader,
  water: waterShader,
  swell: swellShader,
  mirror: mirrorShader,
};

/** 加算で重ねる種類。光るものだけ。 */
const ADDITIVE: Record<FieldEffectKind, boolean> = {
  fog: false,
  // 煙は光らない。下地を覆う。
  smoke: false,
  rain: false,
  snow: false,
  dapple: true,
  mote: true,
  // 水面は下地を隠す面なので重ねない。光る所はアルファで出す。
  water: false,
  swell: false,
  mirror: false,
};

/** 縦に置いたときだけ使うシェーダ。無い種類は水平と同じものを使う。 */
const WALL_SHADERS: Partial<Record<FieldEffectKind, string>> = {
  fog: fogWallShader,
};

/** 縦の格子に置いたときの枚数と、板どうしの間隔（マス）。1 枚だと平べったい（DEC-198）。 */
const WALL_LAYERS = 3;
const WALL_GAP = 0.35;

/** 画面を写して読む種類（DEC-302 / DEC-308）。水面と鏡面。 */
const REFLECTS: Partial<Record<FieldEffectKind, boolean>> = { water: true, swell: true, mirror: true };

/** 水平の板を使う種類。それ以外は縦の板。 */
const FLAT: Record<FieldEffectKind, boolean> = {
  fog: true,
  // 煙は立ち上がるので縦板（DEC-343）。
  smoke: false,
  rain: false,
  snow: false,
  dapple: true,
  mote: false,
  water: true,
  swell: true,
  mirror: true,
};

function tintOf(color: string, fallback: string): Vector3 {
  const hex = color.replace('#', '');
  const n = Number.parseInt(hex.length === 6 ? hex : fallback, 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * 鏡像の焼き付け（DEC-303）。three の `Reflector` と同じ組み立て。
 * 面の裏へ回した仮のカメラでもう 1 回描き、水面はその絵を読む。
 * **面より下は映さない**——射影行列の近平面を面に寝かせて切る（斜め近平面）。
 */
/** 鏡像を焼く前後に呼ぶ（DEC-311）。エディタ限定の見せ方を外すため。 */
export interface ReflectHooks {
  before?: () => void;
  after?: () => void;
}

interface MirrorRig {
  target: WebGLRenderTarget;
  camera: PerspectiveCamera;
  /** 読む位置（0..1 へ寄せた射影 × 仮カメラ × 板）。`texture2DProj` で引く。 */
  matrix: Matrix4;
}

const mirrorNormal = new Vector3();
const mirrorHere = new Vector3();
const mirrorEye = new Vector3();
const mirrorLook = new Vector3();
const mirrorTo = new Vector3();
const mirrorView = new Vector3();
const mirrorRot = new Matrix4();

/**
 * 焼くあいだだけ材質をいじる（DEC-312 / DEC-315）。`false` で元へ戻す。
 * 元の値は材質へ覚えさせる——毎回配列を組むと、焼くたびにごみが増える。
 *
 * **背景（renderOrder が負のもの＝空の筒や球）に深度を書かせない。**
 * 書き割りは世界の原点へ据え置きなので、面の下から見上げる鏡像のカメラからは
 * その壁が地形と手前で交差する。**先に描いて深度を書く**ため、あとから来る地形が
 * 深度で弾かれ、空だけが残ってしまう。深度を書かなければただの下地になる。
 *
 * **両面にはしない**（DEC-315）。一度は入れたが、片面しか持たない地面の**裏**まで
 * 映るようになり、仰角を下げると**地面の底が大きな黒い板**になって鏡を覆った。
 * 水は地面へ薄く敷くものなので、裏が見えるときは**映さないほうが正しい**。
 */
function dressForBake(sources: readonly Object3D[], on: boolean): void {
  for (const root of sources) {
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const background = mesh.renderOrder < 0;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const entry of list) {
        const kept = entry.userData.mepBakeKeep as { depthWrite: boolean } | undefined;
        if (!on) {
          if (kept) {
            entry.depthWrite = kept.depthWrite;
            delete entry.userData.mepBakeKeep;
          }
        } else if (!kept && background) {
          entry.userData.mepBakeKeep = { depthWrite: entry.depthWrite };
          entry.depthWrite = false;
        }
      }
    });
  }
}
const mirrorKeep = new Color();
/** 映る物が無い所を塗る色（DEC-304）。水の色をそのまま使う。 */
const mirrorClearColour = new Color();


function bakeMirror(
  rig: MirrorRig,
  mesh: Mesh,
  renderer: WebGLRenderer,
  camera: Camera,
  sources: readonly Object3D[],
  clear: Color,
  hooks: ReflectHooks | undefined,
): boolean {
  if (sources.length === 0) return false;
  mirrorHere.setFromMatrixPosition(mesh.matrixWorld);
  mirrorEye.setFromMatrixPosition(camera.matrixWorld);
  mirrorRot.extractRotation(mesh.matrixWorld);
  // 板の面法線は局所 +Z。水面は寝かせてあるので世界では上を向く。
  mirrorNormal.set(0, 0, 1).applyMatrix4(mirrorRot);
  mirrorView.subVectors(mirrorHere, mirrorEye);
  // 面から見てカメラがどちら側にいるか。負なら表（上）。
  const away = mirrorView.dot(mirrorNormal);
  // 裏から見ているときは映さない。
  if (away > 0) return false;
  mirrorView.reflect(mirrorNormal).negate().add(mirrorHere);

  mirrorRot.extractRotation(camera.matrixWorld);
  mirrorLook.set(0, 0, -1).applyMatrix4(mirrorRot).add(mirrorEye);
  mirrorTo.subVectors(mirrorHere, mirrorLook);
  mirrorTo.reflect(mirrorNormal).negate().add(mirrorHere);

  const virtual = rig.camera;
  virtual.position.copy(mirrorView);
  virtual.up.set(0, 1, 0).applyMatrix4(mirrorRot).reflect(mirrorNormal);
  virtual.lookAt(mirrorTo);
  virtual.far = (camera as PerspectiveCamera).far ?? 2000;
  virtual.updateMatrixWorld();
  virtual.projectionMatrix.copy((camera as PerspectiveCamera).projectionMatrix);

  /*
   * 読む位置（DEC-310）。`Reflector` と同じ組み立て。
   * **斜め近平面を入れる前**に作る——あれは z の行しか触らないが、順番は合わせておく。
   */
  rig.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  rig.matrix.multiply(virtual.projectionMatrix);
  rig.matrix.multiply(virtual.matrixWorldInverse);
  rig.matrix.multiply(mesh.matrixWorld);

  /*
   * **近平面は寝かせない**（DEC-311）。
   * 面より下を切るために射影の近平面を水面へ寝かせる手（`Reflector` の clipBias）は、
   * **面の際にある物を巻き込んで削る**。奥行きの精度が近平面のすぐ上で潰れるためで、
   * 寄り引きのたびに削れる量が変わる——「拡大縮小で絵が欠ける」のはこれだった。
   * HD-2D の水は地面へ薄く敷くので、面の下にはほとんど何も無い。切らずに全部映す。
   */

  const wasTarget = renderer.getRenderTarget();
  const wasAuto = renderer.autoClear;
  renderer.setRenderTarget(rig.target);
  /*
   * 映る物が無い所は**透明**にする（DEC-304 / DEC-309）。
   * 色で塗ると、その色がそのまま水に出る——鏡面の既定色は明るいので**白っぽくなっていた**。
   * 透明にしておけば、読み側が「ここは映す物が無い」と分かり、混ぜずに済む。
   */
  renderer.getClearColor(mirrorKeep);
  const keepAlpha = renderer.getClearAlpha();
  renderer.setClearColor(clear, 0);
  /*
   * **消す前に深度を書ける状態へ戻す**（DEC-312）。
   * ここは板の `onBeforeRender`——つまり透明の描き込みの最中で、
   * 板自身が `depthWrite: false` なので **深度の書き込みが閉じている**。
   * `glClear(DEPTH_BUFFER_BIT)` はこの書き込み許可に従うため、閉じたままだと
   * **深度が消えない**。前の絵の深度が残り続け、カメラを動かすほど手前の値が積もって
   * 地形が弾かれる——「掴んで動かすと少しずつ欠けて、やがて映らなくなる」のはこれ。
   * 動かさなければ前の深度と一致するので、ゲームやカメラ編集では表に出なかった。
   */
  renderer.state.buffers.depth.setMask(true);
  renderer.clear(true, true, true);
  renderer.setClearColor(mirrorKeep, keepAlpha);
  renderer.autoClear = false;
  hooks?.before?.();
  /*
   * 焼くあいだは**裏面も描く**（DEC-312）。
   * 鏡像のカメラは面の下から見上げるので、片面しか持たない物——マップのチップも、
   * 生成した glb（中身が空の殻）も——は**裏側から見ると消える**。
   * 見る角度が変わるたびに欠けていくのはこれ。両面にすれば裏から見ても映る。
   */
  dressForBake(sources, true);
  for (const root of sources) renderer.render(root, virtual);
  dressForBake(sources, false);
  hooks?.after?.();
  renderer.autoClear = wasAuto;
  renderer.setRenderTarget(wasTarget);
  return true;
}

export function createFieldEffects(): FieldEffects {
  /** 水面へ映すもの（DEC-303）。呼び元が渡す。 */
  let reflectSources: readonly Object3D[] = [];
  /** 焼く前後の下ごしらえ（DEC-311）。 */
  let reflectHooks: ReflectHooks | undefined;

  /**
   * 水面の下地（DEC-302）。板が描かれる直前に、そのときの画面を写す。
   * 半透明は最後に描かれるので、この時点で地面もキャラも描き終わっている。
   * **シーンをもう 1 回描かない。**写しは 1 フレームに 1 回だけ。
   */
  /**
   * 鏡像の的（DEC-303）。材質に付けて持ち回す——材質は取り置き（DEC-277）で
   * 使い回すので、的も一緒に付いてくる。捨てるのは `dispose` のときだけ。
   */
  let skyTexture: Texture | null = null;
  const rigs = new Set<MirrorRig>();
  const mirrorRig = (renderer: WebGLRenderer, material: ShaderMaterial): MirrorRig => {
    const known = material.userData.mirrorRig as MirrorRig | undefined;
    renderer.getDrawingBufferSize(bufferSize);
    /*
     * **画面と同じ大きさで焼く**（DEC-310）。小さくすると縦横比が変わることがあり、
     * 読む位置がずれる。「重くてもきれいに」という方針なのでそのままの大きさにする。
     */
    const w = Math.max(64, Math.floor(bufferSize.x));
    const h = Math.max(64, Math.floor(bufferSize.y));
    if (known && known.target.width === w && known.target.height === h) return known;
    known?.target.dispose();
    if (known) rigs.delete(known);
    const target = new WebGLRenderTarget(w, h, { minFilter: LinearFilter, magFilter: LinearFilter });
    const rig: MirrorRig = { target, camera: new PerspectiveCamera(), matrix: new Matrix4() };
    material.userData.mirrorRig = rig;
    rigs.add(rig);
    return rig;
  };

  let screenGrab: FramebufferTexture | null = null;
  const bufferSize = new Vector2();
  const grabScreen = (renderer: WebGLRenderer): FramebufferTexture | null => {
    renderer.getDrawingBufferSize(bufferSize);
    const w = Math.max(1, Math.floor(bufferSize.x));
    const h = Math.max(1, Math.floor(bufferSize.y));
    if (screenGrab && (screenGrab.image.width !== w || screenGrab.image.height !== h)) {
      screenGrab.dispose();
      screenGrab = null;
    }
    if (!screenGrab) {
      screenGrab = new FramebufferTexture(w, h);
      screenGrab.minFilter = LinearFilter;
      screenGrab.magFilter = LinearFilter;
    }
    renderer.copyFramebufferToTexture(screenGrab);
    return screenGrab;
  };

  const loader = new TextureLoader();
  const load = (url: string): Texture => {
    const texture = loader.load(url);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  };
  const mapA = load(NOISE_A);
  const mapB = load(NOISE_B);

  const group = new Group();
  group.name = 'field-effects';
  const geometry = new PlaneGeometry(1, 1);
  /**
   * 置いた板。`reflects` は自分が映す側か（DEC-344）、`cast` は水面へ映すか（DEC-345）。
   * どちらも焼くあいだ隠すかの判断に使う。
   */
  const slices: Array<{
    id: string;
    mesh: Mesh<PlaneGeometry, ShaderMaterial>;
    poolKey: string;
    reflects: boolean;
    cast: boolean;
  }> = [];
  let clock = 0;
  /** 画面の切り替え（DEC-201）。置いてあっても切っていれば出さない。 */
  let shown = true;

  /** 板 1 枚へ見た目を流し込む。組み直さずに値だけ差し替えられる。 */
  /**
   * つまみを板へ流す（DEC-200）。**板は組み直さない。**
   * `setLooks` から毎回ここを通るので、**シェーダが読む値は全部ここで入れ直す**こと
   * （DEC-323）——歪み・映り込み・正面の映り・映りの染まりが抜けていて、
   * フィールドエフェクト編集で動かしても画に出なかった。
   */
  const applyLook = (look: FieldEffectSettings, material: ShaderMaterial) => {
    material.uniforms.amount.value = Math.max(0, look.amount);
    material.uniforms.speed.value = Math.max(0, look.speed);
    material.uniforms.scale.value = Math.max(0.001, look.scale);
    material.uniforms.tint.value = tintOf(look.color, 'ffffff');
    if (material.uniforms.warp) material.uniforms.warp.value = Math.max(0, look.warp);
    if (material.uniforms.mirror) material.uniforms.mirror.value = Math.max(0, look.mirror);
    if (material.uniforms.face) material.uniforms.face.value = Math.min(1, Math.max(0, look.face));
    if (material.uniforms.dye) material.uniforms.dye.value = Math.min(1, Math.max(0, look.dye));
    material.visible = look.on;
  };

  /**
   * 使い終わったマテリアルの置き場（DEC-277）。**捨てずに取っておく。**
   * 捨てるとシェーダのプログラムも消えるので、次に組み直すときリンクし直しになる。
   * エディタはチップを 1 個置くたびに `setVolumes` を呼ぶので、そのたびに 1 本増えていた。
   * 種類と縦横で形が決まるので、その組ごとに積んでおけば使い回せる。
   */
  const pool = new Map<string, ShaderMaterial[]>();
  const poolKey = (kind: FieldEffectKind, wall: boolean): string => `${kind}|${wall ? 'w' : 'f'}`;

  const clear = () => {
    for (const slice of slices) {
      group.remove(slice.mesh);
      const key = slice.poolKey;
      const list = pool.get(key);
      if (list) list.push(slice.mesh.material);
      else pool.set(key, [slice.mesh.material]);
    }
    slices.length = 0;
  };

  return {
    group,

    setVolumes(list, unit) {
      clear();
      for (const volume of list) {
        const look = volume.look;
        const kind = look.kind;
        const wide = Math.max(0.2, volume.maxX - volume.minX) * unit;
        const deep = Math.max(0.2, volume.maxZ - volume.minZ) * unit;
        const tall = Math.max(0.2, volume.maxY - volume.minY) * unit;
        const cx = ((volume.minX + volume.maxX) / 2) * unit;
        const cy = ((volume.minY + volume.maxY) / 2) * unit;
        const cz = ((volume.minZ + volume.maxZ) / 2) * unit;
        // 縦の格子に置いたものは、その面 1 枚として立てる（DEC-198）。
        const wall = volume.plane !== 'xz';
        const count = wall ? WALL_LAYERS : LAYERS[kind];
        for (let i = 0; i < count; i += 1) {
          const level = i / Math.max(1, count - 1);
          const key = poolKey(kind, wall);
          const spare = pool.get(key)?.pop();
          const material = spare ?? new ShaderMaterial({
            vertexShader: REFLECTS[kind] ? waterVertexShader : vertexShader,
            fragmentShader: (wall && WALL_SHADERS[kind]) || SHADERS[kind],
            uniforms: {
              mapA: { value: mapA },
              mapB: { value: mapB },
              tint: { value: tintOf(look.color, 'ffffff') },
              amount: { value: look.amount },
              speed: { value: look.speed },
              scale: { value: look.scale },
              time: { value: 0 },
              level: { value: level },
              // 水面の下地（DEC-302）。ほかの種類では使わない。
              sceneMap: { value: null },
              sceneOn: { value: 0 },
              // 空の絵（DEC-316）。うねりが環境として引く。書き割りの絵をそのまま使う。
              skyMap: { value: skyTexture },
              skyOn: { value: skyTexture ? 1 : 0 },
              warp: { value: look.warp },
              // 真正面の映り（DEC-321）。角度によらず出る下限。
              face: { value: look.face },
              // 映りを水の色で染める量（DEC-322）。0 で素の色。
              dye: { value: look.dye },
              // 映り込み（DEC-303）。水面だけが使う。
              mirrorMap: { value: null },
              mirrorOn: { value: 0 },
              mirror: { value: look.mirror },
              mirrorMatrix: { value: new Matrix4() },
              // 縦面の横方向がどちらの軸か。YZ 面なら Z。
              axisZ: { value: volume.plane === 'yz' ? 1 : 0 },
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: ADDITIVE[kind] ? AdditiveBlending : undefined,
          });
          // 取り置きを使うときは値を入れ直す。形（シェーダ）は同じ。
          if (spare) {
            const u = material.uniforms;
            u.tint.value = tintOf(look.color, 'ffffff');
            u.amount.value = look.amount;
            u.speed.value = look.speed;
            u.scale.value = look.scale;
            u.level.value = level;
            u.axisZ.value = volume.plane === 'yz' ? 1 : 0;
            u.warp.value = look.warp;
            u.face.value = look.face;
            u.dye.value = look.dye;
            u.mirror.value = look.mirror;
          }
          applyLook(look, material);
          const mesh = new Mesh(geometry, material);
          if (REFLECTS[kind]) {
            mesh.onBeforeRender = (renderer, _scene, drawCamera) => {
              // 映り込みが先（DEC-303）。別の的へ描くので、画面の写しより前に済ませる。
              const wants = material.uniforms.mirror.value > 0 && reflectSources.length > 0;
              if (wants) {
                const rig = mirrorRig(renderer, material);
                /*
                 * 映る物が無い所は**黒のアルファ 0**（DEC-322）。
                 * 前は水の色で塗っていたが、的の補間は色とアルファを別々に混ぜるので、
                 * **映った物の輪郭に水の色がにじむ**——青い縁取りが出ていた。
                 * 黒なら滲んだぶんは「アルファで割る」だけで元の色に戻せる。
                 */
                mirrorClearColour.setRGB(0, 0, 0);
                /*
                 * **映すあいだは映す側の板を隠す**（DEC-344）。
                 * エフェクトの入れ物ごと映すようにしたので、水面・うねり・鏡面が
                 * その中に居る。隠さないと、焼いている最中にその板の `onBeforeRender`
                 * がまた走って**焼きが入れ子**になる。映らなくて困るのは霧や煙のほうで、
                 * 水が水に映る必要は無い。
                 */
                const hidden: Mesh[] = [];
                for (const slice of slices) {
                  // 映す側は必ず隠す。ほかは「水面に映す」を切ったものだけ隠す（DEC-345）。
                  if (!slice.reflects && slice.cast) continue;
                  if (!slice.mesh.visible) continue;
                  slice.mesh.visible = false;
                  hidden.push(slice.mesh);
                }
                const ok = bakeMirror(
                  rig,
                  mesh,
                  renderer,
                  drawCamera,
                  reflectSources,
                  mirrorClearColour,
                  reflectHooks,
                );
                for (const item of hidden) item.visible = true;
                material.uniforms.mirrorMap.value = ok ? rig.target.texture : null;
                material.uniforms.mirrorOn.value = ok ? 1 : 0;
                (material.uniforms.mirrorMatrix.value as Matrix4).copy(rig.matrix);
              } else {
                material.uniforms.mirrorOn.value = 0;
              }
              /*
               * 描かれる直前に画面を写す（DEC-302 / DEC-308）。**面ごとに写す。**
               * まとめて 1 回にすると、鏡面の上に水面を重ねたとき、
               * 上の水が「鏡面を描く前の画」を読んでしまい、下の鏡が隠れる。
               */
              grabScreen(renderer);
              material.uniforms.sceneMap.value = screenGrab;
              material.uniforms.sceneOn.value = screenGrab ? 1 : 0;
            };
          }
          if (wall) {
            // 板が重なるとチラつくので、奥行きへ少しずつずらす。
            const gap = (i - (count - 1) / 2) * WALL_GAP * unit;
            if (volume.plane === 'yz') {
              mesh.rotation.y = Math.PI / 2;
              mesh.scale.set(deep, tall, 1);
              mesh.position.set(cx + gap, cy, cz);
            } else {
              mesh.scale.set(wide, tall, 1);
              mesh.position.set(cx, cy, cz + gap);
            }
          } else if (FLAT[kind]) {
            mesh.rotation.x = -Math.PI / 2;
            mesh.scale.set(wide, deep, 1);
            mesh.position.set(cx, volume.minY * unit + level * tall + 0.02, cz);
          } else {
            // 縦の板は奥行き方向に並べる。手前から奥へ順に。
            const at = count === 1 ? 0.5 : level;
            mesh.scale.set(wide, tall, 1);
            mesh.position.set(cx, volume.minY * unit + tall / 2, cz + deep / 2 - deep * at);
          }
          /*
           * 半透明は奥から。奥の板を先に描く。
           * 鏡面は**必ず水面より先**（DEC-308）。後から描くと、上の水が
           * 「鏡面を描く前の画」を写してしまい、下の鏡が見えなくなる。
           */
          mesh.renderOrder = (kind === 'mirror' ? 4 : 8) + i;
          slices.push({ id: look.id, mesh, poolKey: key, reflects: REFLECTS[kind] === true, cast: look.cast });
          group.add(mesh);
        }
      }
      group.visible = shown && slices.length > 0;
    },

    setVisible(on) {
      shown = on;
      group.visible = on && slices.length > 0;
    },

    setReflectSources(objects, hooks) {
      reflectSources = objects;
      reflectHooks = hooks;
    },

    setSkyTexture(texture) {
      // 書き割りは読み込みが非同期なので、毎フレーム呼ばれる。同じなら何もしない。
      if (skyTexture === texture) return;
      skyTexture = texture;
      for (const slice of slices) {
        const uniforms = (slice.mesh.material as ShaderMaterial).uniforms;
        if (!uniforms.skyMap) continue;
        uniforms.skyMap.value = texture;
        uniforms.skyOn.value = texture ? 1 : 0;
      }
    },

    setLooks(looks) {
      for (const slice of slices) {
        const look = looks[slice.id];
        if (!look) continue;
        applyLook(look, slice.mesh.material);
        // 映すかは uniform ではないので、板の側に憶える（DEC-345）。
        slice.cast = look.cast;
      }
    },

    update(deltaSeconds) {
      if (!group.visible) return;
      clock += deltaSeconds;
      for (const slice of slices) slice.mesh.material.uniforms.time.value = clock;
    },

    dispose() {
      clear();
      geometry.dispose();
      mapA.dispose();
      mapB.dispose();
      screenGrab?.dispose();
      screenGrab = null;
      for (const rig of rigs) rig.target.dispose();
      rigs.clear();
    },
  };
}
