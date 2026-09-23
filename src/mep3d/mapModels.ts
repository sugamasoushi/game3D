// マップに置いた 3D（.glb / .gltf）を出す（DEC-288）。
//
// **見た目だけ**の飾り。セル（ブロック）にはならないので、
// 当たり判定にも影にも出ず、キャラはすり抜ける。塞ぎたいときは
// オブジェクトを重ねて `Collision` を入れる。
//
// 置いた実体はレイヤーの `models` に入る（`objects` と同じ並び）。
// レイヤーを隠せば消え、レイヤーごと消せば一緒に消える。
//
// ファイルは `public/assets/models/` に置く。エディタの取り込みで
// 生成フォルダからここへ写す——マップが外のフォルダに依存しないため。

import {
  AmbientLight,
  Box3,
  Color,
  PMREMGenerator,
  DirectionalLight,
  Group,
  HemisphereLight,
  PointLight,
  SpotLight,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { emittingPointLights, lightDirection, resolveLighting } from './lighting';
import { fogColor, resolveCameraFx } from './camera';
import type { CameraFxDef, LayerDef, LightingDef, MapDef, MapModelDef, ModelLook, PointLightDef } from './types';

/** 取り込んだ 3D の置き場。マップと一緒に配られる。 */
export const MODEL_DIR = '/assets/models/';

export function modelUrl(file: string): string {
  return `${MODEL_DIR}${encodeURIComponent(file)}`;
}

/**
 * 見た目の調整（DEC-288）。生成した 3D は色が近いところで滲むので、
 * 濃さを上げて分け、明るい色だけ薄く光らせて締める。
 * 値はプレビューで決めて、置いた実体へ写す。
 */
export const MODEL_LOOK_DEFAULTS: Required<ModelLook> = {
  brightness: 1,
  saturation: 1.3,
  glow: 0.35,
  glowFloor: 0.22,
  ambient: 0.38,
  sky: 1.42,
  sun: 1.05,
  lights: 1,
  rim: 0,
  exposure: 1,
  tone: 0,
  topFrom: 0.85,
  topGlow: 0,
  topMetal: 0,
  topTo: 1,
  pickColor: '',
  pickRange: 0.25,
  pickGlow: 0,
};

export function resolveModelLook(look: ModelLook | undefined): Required<ModelLook> {
  return { ...MODEL_LOOK_DEFAULTS, ...(look ?? {}) };
}

/** 既定と同じ値は書かない。マップの json を膨らませないため。 */
export function modelLookForSave(look: ModelLook | undefined): ModelLook | undefined {
  if (!look) return undefined;
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(resolveModelLook(look))) {
    if (value !== MODEL_LOOK_DEFAULTS[key as keyof ModelLook]) out[key] = value;
  }
  return Object.keys(out).length ? (out as ModelLook) : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 保存から読む。壊れていれば null。 */
export function parseMapModel(raw: unknown, id: string): MapModelDef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const file = typeof src.file === 'string' ? src.file : '';
  if (!/\.(glb|gltf)$/i.test(file)) return null;
  const look = src.look && typeof src.look === 'object' ? (src.look as ModelLook) : undefined;
  const saved = modelLookForSave(look);
  return {
    id: typeof src.id === 'string' && src.id ? src.id : id,
    name: typeof src.name === 'string' && src.name ? src.name : file.replace(/\.[^.]+$/, ''),
    file,
    x: num(src.x, 0),
    y: num(src.y, 0),
    z: num(src.z, 0),
    ...(Array.isArray(src.origin) && src.origin.some((value) => num(value, 0) !== 0)
      ? { origin: [num(src.origin[0], 0), num(src.origin[1], 0), num(src.origin[2], 0)] as [number, number, number] }
      : {}),
    scale: Math.max(0.05, num(src.scale, 1)),
    yaw: num(src.yaw, 0),
    ...(saved ? { look: saved } : {}),
  };
}

export function sanitiseMapModels(raw: unknown): MapModelDef[] {
  if (!Array.isArray(raw)) return [];
  const out: MapModelDef[] = [];
  const used = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const model = parseMapModel(entry, `model_${index + 1}`);
    if (!model || used.has(model.id)) continue;
    used.add(model.id);
    out.push(model);
  }
  return out;
}

/** 「3D を置く」で選んだ内容（DEC-290）。押したマスで置き場所が決まる。 */
export type PendingModel = Omit<MapModelDef, 'id' | 'x' | 'y' | 'z'>;

export function cloneMapModel(model: MapModelDef): MapModelDef {
  return {
    ...model,
    ...(model.look ? { look: { ...model.look } } : {}),
    ...(model.origin ? { origin: [...model.origin] as [number, number, number] } : {}),
  };
}

function visibleWithParents(layers: readonly LayerDef[], layer: LayerDef): boolean {
  const byId = new Map(layers.map((entry) => [entry.id, entry]));
  let current: LayerDef | undefined = layer;
  let guard = 0;
  while (current && guard <= layers.length) {
    if (current.visible === false) return false;
    current = current.parent ? byId.get(current.parent) : undefined;
    guard += 1;
  }
  return true;
}

/** 出すぶんだけ集める。隠したレイヤーのぶんは落とす。 */
export function collectMapModels(map: MapDef): MapModelDef[] {
  const out: MapModelDef[] = [];
  for (const layer of map.layers) {
    if (!layer.models?.length) continue;
    if (!visibleWithParents(map.layers, layer)) continue;
    for (const model of layer.models) out.push(model);
  }
  return out;
}

interface LookUniforms {
  modelBrightness: { value: number };
  modelExposure: { value: number };
  modelTone: { value: number };
  /** 「上のほう」の絞り込み（DEC-296 / DEC-298）。高さの**帯**で分ける。 */
  modelTopFrom: { value: number };
  modelTopTo: { value: number };
  modelTopGlow: { value: number };
  modelTopMetal: { value: number };
  /** 色で選んで光らせる（DEC-298）。 */
  modelPickColor: { value: Color };
  modelPickRange: { value: number };
  modelPickGlow: { value: number };
  /** 読み込んだ物の底面の高さと、てっぺんまでの幅（モデルの座標）。 */
  modelLowY: { value: number };
  modelSpanY: { value: number };
  modelSaturation: { value: number };
  modelGlow: { value: number };
  modelGlowFloor: { value: number };
  /** フォグ（DEC-288）。マップのチップと同じ式・同じ値を差し込む。 */
  mepFogOn: { value: boolean };
  mepFogColor: { value: Color };
  mepFogNear: { value: number };
  mepFogFar: { value: number };
  mepFogMax: { value: number };
}

// 色を分けて、明るい色だけ薄く光らせる。ブルームは画面全体に掛かるので**使わない**。
const LOOK_CHUNK = /* glsl */ `#include <emissivemap_fragment>
  vec3 mepColor = diffuseColor.rgb;
  float mepLuma = dot(mepColor, vec3(0.299, 0.587, 0.114));
  vec3 mepClear = mix(vec3(mepLuma), mepColor, modelSaturation) * modelBrightness;
  diffuseColor.rgb = mepClear;
  float mepLift = smoothstep(modelGlowFloor, modelGlowFloor + 0.35, mepLuma);
  totalEmissiveRadiance += max(mepClear, vec3(0.0)) * (modelGlow * mepLift);
  // 上のほう（屋根の飾り）だけ足す（DEC-296）。高さの帯で挟む（DEC-298）。
  float mepTop = mepTopAt(mepHighAt);
  totalEmissiveRadiance += max(mepClear, vec3(0.0)) * (modelTopGlow * mepTop);
  // 色で選んで光らせる（DEC-298）。比べるのは**濃さを掛ける前の元の色**。
  if (modelPickGlow > 0.0) {
    float mepNear = 1.0 - smoothstep(modelPickRange * 0.5, max(modelPickRange, 1e-4), distance(mepHue(mepColor), mepHue(modelPickColor)));
    totalEmissiveRadiance += max(mepClear, vec3(0.0)) * (modelPickGlow * mepNear);
  }`;

/**
 * トーンマッピング（DEC-295）。three の ACES と同じ式を持ち込む。
 * レンダラの設定は画面全体に掛かるので使えない——**この材質だけ**に掛ける。
 */
const TONE_CHUNK = /* glsl */ `  gl_FragColor.rgb *= modelExposure;
  if (modelTone > 0.5) {
    vec3 mepTone = gl_FragColor.rgb * (1.0 / 0.6);
    mepTone = MEP_ACES_IN * mepTone;
    vec3 mepA = mepTone * (mepTone + 0.0245786) - 0.000090537;
    vec3 mepB = mepTone * (0.983729 * mepTone + 0.4329510) + 0.238081;
    mepTone = MEP_ACES_OUT * (mepA / mepB);
    gl_FragColor.rgb = clamp(mepTone, 0.0, 1.0);
  }
#include <tonemapping_fragment>`;

const LOOK_HEAD = /* glsl */ `uniform float modelBrightness;
uniform float modelExposure;
uniform float modelTone;
uniform float modelTopFrom;
uniform float modelTopTo;
uniform float modelTopGlow;
uniform float modelTopMetal;
uniform vec3 modelPickColor;
uniform float modelPickRange;
uniform float modelPickGlow;
varying float mepHighAt;
/**
 * 色味だけ取り出す（DEC-298）。明るさを外し、見た目に近い目盛りへ移す。
 * 生の値で比べると、同じ色でも陰の側が外れて選べない。
 */
vec3 mepHue(vec3 c) {
  vec3 g = sqrt(max(c, vec3(0.0)));
  return g / max(max(g.r, max(g.g, g.b)), 1e-4);
}
// 高さの帯（DEC-298）。終わりが 1 なら てっぺんまで。
float mepTopAt(float h) {
  return smoothstep(modelTopFrom, min(modelTopFrom + 0.08, 1.0), h)
    * (1.0 - smoothstep(modelTopTo, min(modelTopTo + 0.08, 1.0), h));
}
const mat3 MEP_ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 MEP_ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
uniform float modelSaturation;
uniform float modelGlow;
uniform float modelGlowFloor;
uniform bool mepFogOn;
uniform vec3 mepFogColor;
uniform float mepFogNear;
uniform float mepFogFar;
uniform float mepFogMax;
varying vec3 mepFogView;
void main() {`;

/**
 * フォグ（DEC-288）。マップのチップと**同じ式・同じ値**。
 * 色空間を変える前に混ぜる——後ろで混ぜるとチップと濃さが揃わない。
 */
const FOG_CHUNK = /* glsl */ `  if (mepFogOn) {
    float mepFogSpan = max(mepFogFar - mepFogNear, 0.001);
    float mepFogAmount = clamp((length(mepFogView) - mepFogNear) / mepFogSpan, 0.0, 1.0) * mepFogMax;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mepFogColor, mepFogAmount);
  }
#include <colorspace_fragment>`;

// 視点からの距離は自前で持つ。three の varying は材質の設定で消えることがある。
const FOG_VARYING = /* glsl */ `varying vec3 mepFogView;
varying float mepHighAt;
uniform float modelLowY;
uniform float modelSpanY;
void main() {`;

const FOG_VERTEX = /* glsl */ `#include <fog_vertex>
  mepFogView = (modelViewMatrix * vec4(transformed, 1.0)).xyz;
  // 底面からの高さ（0..1）。屋根の飾りを絞るのに使う（DEC-296）。
  mepHighAt = clamp((transformed.y - modelLowY) / max(modelSpanY, 1e-5), 0.0, 1.0);`;

/** 上のほうだけ金属にする（DEC-296）。粗さと金属度は面ごとに書き換える。 */
const ROUGH_CHUNK = /* glsl */ `#include <roughnessmap_fragment>
  float mepTopRough = mepTopAt(mepHighAt) * modelTopMetal;
  roughnessFactor = mix(roughnessFactor, 0.14, mepTopRough);`;

const METAL_CHUNK = /* glsl */ `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, 0.95, mepTopAt(mepHighAt) * modelTopMetal);`;

/**
 * 読み込んだ物ごとの高さ（DEC-296）。「上のほう」を測る物差し。
 * `dressModel` で渡す。既定はモデルの実寸を測る前の当てにならない値。
 */
export interface ModelSpan {
  low: number;
  span: number;
}

/** 材質へ色の調整を差し込む。読み込んだ物の材質は複製してから渡すこと。 */
export function patchModelMaterial(material: Material, look: Required<ModelLook>, span: ModelSpan): LookUniforms {
  const uniforms: LookUniforms = {
    modelBrightness: { value: look.brightness },
    modelExposure: { value: look.exposure },
    modelTone: { value: look.tone },
    modelTopFrom: { value: look.topFrom },
    modelTopTo: { value: look.topTo },
    modelTopGlow: { value: look.topGlow },
    modelTopMetal: { value: look.topMetal },
    modelPickColor: { value: colourOf(look.pickColor, 0x000000) },
    modelPickRange: { value: look.pickRange },
    modelPickGlow: { value: look.pickColor ? look.pickGlow : 0 },
    modelLowY: { value: span.low },
    modelSpanY: { value: span.span },
    modelSaturation: { value: look.saturation },
    modelGlow: { value: look.glow },
    modelGlowFloor: { value: look.glowFloor },
    mepFogOn: { value: false },
    mepFogColor: { value: new Color(0x1a2740) },
    mepFogNear: { value: 12 },
    mepFogFar: { value: 40 },
    mepFogMax: { value: 0.85 },
  };
  material.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', FOG_VARYING)
      .replace('#include <fog_vertex>', FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', LOOK_HEAD)
      .replace('#include <emissivemap_fragment>', LOOK_CHUNK)
      .replace('#include <roughnessmap_fragment>', ROUGH_CHUNK)
      .replace('#include <metalnessmap_fragment>', METAL_CHUNK)
      .replace('#include <tonemapping_fragment>', TONE_CHUNK)
      .replace('#include <colorspace_fragment>', FOG_CHUNK);
  };
  // 太陽の深度パスへ入れる印（DEC-288）。マップの材質ではないので、これで見分ける。
  material.userData.mepModelCaster = true;
  // 素の標準材質と同じ器を共有させない。差し込んだぶんが混ざる。
  material.customProgramCacheKey = () => 'mep3d-model-look-v1';
  material.needsUpdate = true;
  return uniforms;
}

export function setLookUniforms(list: readonly LookUniforms[], look: Required<ModelLook>): void {
  for (const uniforms of list) {
    uniforms.modelBrightness.value = look.brightness;
    uniforms.modelExposure.value = look.exposure;
    uniforms.modelTone.value = look.tone;
    uniforms.modelTopFrom.value = look.topFrom;
    uniforms.modelTopTo.value = look.topTo;
    uniforms.modelTopGlow.value = look.topGlow;
    uniforms.modelTopMetal.value = look.topMetal;
    uniforms.modelPickColor.value.copy(colourOf(look.pickColor, 0x000000));
    uniforms.modelPickRange.value = look.pickRange;
    // 色を選んでいなければ光らせない。黒に近い所が全部光ってしまう。
    uniforms.modelPickGlow.value = look.pickColor ? look.pickGlow : 0;
    uniforms.modelSaturation.value = look.saturation;
    uniforms.modelGlow.value = look.glow;
    uniforms.modelGlowFloor.value = look.glowFloor;
  }
}

/** マップのフォグを置いた物にも掛ける（DEC-288）。値はチップと同じ物を渡す。 */
export function setFogUniforms(list: readonly LookUniforms[], raw: CameraFxDef | undefined): void {
  const fx = resolveCameraFx(raw);
  const colour = fogColor(fx);
  for (const uniforms of list) {
    uniforms.mepFogOn.value = fx.fog;
    uniforms.mepFogColor.value.copy(colour);
    uniforms.mepFogNear.value = fx.fogNear;
    uniforms.mepFogFar.value = fx.fogFar;
    uniforms.mepFogMax.value = fx.fogMax;
  }
}

/**
 * 読み込んだ物を材質ごと複製して、色の調整を差し込む。
 * 複製は材質を**共有する**ので、置いた物ごとに調整を変えるには分けるしかない。
 */
export function dressModel(
  source: Object3D,
  look: Required<ModelLook>,
  envMap?: Texture,
): { body: Object3D; uniforms: LookUniforms[]; bounds: Box3 } {
  const body = source.clone(true);
  // 高さの物差しは**複製の前**に測る。上のほうの絞り込みに使う（DEC-296）。
  const bounds = new Box3().setFromObject(body);
  const span: ModelSpan = { low: bounds.min.y, span: Math.max(bounds.max.y - bounds.min.y, 1e-5) };
  const uniforms: LookUniforms[] = [];
  body.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as Material | Material[];
    const list = (Array.isArray(material) ? material : [material]).map((entry) => entry.clone());
    mesh.material = Array.isArray(material) ? list : list[0];
    for (const entry of list) {
      // 映り込む相手（DEC-296）。金属にしないと効かないので、無くても困らない。
      const pbr = entry as MeshStandardMaterial;
      if (envMap && 'envMap' in pbr) {
        pbr.envMap = envMap;
        pbr.envMapIntensity = 1;
      }
      uniforms.push(patchModelMaterial(entry, look, span));
    }
  });
  return { body, uniforms, bounds };
}

/**
 * 映り込みの下地（DEC-296）。three の RoomEnvironment を 1 回だけ焼く。
 * **レンダラごとに別**——焼いた物はその WebGL の文脈でしか使えない。
 */
const envMaps = new WeakMap<WebGLRenderer, Texture>();

export function modelEnvironment(renderer: WebGLRenderer): Texture {
  const known = envMaps.get(renderer);
  if (known) return known;
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const map = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  envMaps.set(renderer, map);
  return map;
}

/** 読み込んだ物の使い回し。20MB 級の glb を組み直しのたびに取り直さない。 */
const cache = new Map<string, Promise<Object3D>>();

/**
 * 読み込む。`fresh` を立てると使い回しを捨てて読み直す（DEC-293）——
 * 同じ名前で作り直した glb を見るため。控えは新しいほうに差し替わる。
 */
export function loadModel(file: string, fresh = false): Promise<Object3D> {
  const url = modelUrl(file);
  if (fresh) cache.delete(url);
  const known = cache.get(url);
  if (known) return known;
  const task = new GLTFLoader()
    .loadAsync(fresh ? `${url}?t=${Date.now()}` : url)
    .then((gltf) => gltf.scene);
  cache.set(url, task);
  return task;
}

/**
 * 中身を捨てる。**形は捨てない**——複製（clone）は形を使い回しの元と共有するので、
 * ここで捨てると次に置いたときに何も出なくなる。材質はこちらで複製したぶんだけ捨てる。
 */
function dropDeep(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as Material | Material[];
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
  root.clear();
}

interface Instance {
  /** 置き場所・大きさ・向きを持つ入れ物。 */
  holder: Group;
  file: string;
  /** 高さ合わせに使う、読み込んだ物の実寸。 */
  height: number;
  uniforms: LookUniforms[];
  generation: number;
}

export interface MapModels {
  group: Group;
  /**
   * 点滅・ゆらめきを進める（DEC-294）。毎フレーム、`Mep3DScene.time` を渡す。
   * 振る光が無ければ何もしない。
   */
  tick(time: number): void;
  /**
   * 置く前の仮表示（DEC-296）。押す前にどこへどの大きさで載るか見せる。
   * `at` に null を渡すと消す。**マップには何も足さない。**
   */
  preview(model: MapModelDef | null, unit: number): void;
  /** 置いた物の世界での大きさ（DEC-296）。編集中の枠を描くのに使う。 */
  boundsOf(id: string): Box3 | null;
  /** 出す物・置き場所・光・フォグを今の状態に合わせる。 */
  apply(
    models: readonly MapModelDef[],
    unit: number,
    lighting: LightingDef | undefined,
    fx?: CameraFxDef,
    lights?: readonly PointLightDef[],
  ): void;
  dispose(): void;
}

/**
 * マップの点光源を three の実ライトへ写す（DEC-290）。
 * チップは自前のシェーダで独自に光を足しているので**同じ絵にはならない**。
 * 明るさの目盛りも別物なので、`look.lights` で合わせる。
 * 数を増やすとシェーダが組み直されるため上限を切る。
 */
const MAX_MODEL_LIGHTS = 8;

/**
 * 点滅・ゆらめき（DEC-294）。`material.ts` の `lightPulse` と**同じ式**。
 * 片方だけ直すとチップと 3D で明滅がずれるので、直すときは両方直す。
 * `index` は光源の並び順——位相をずらすのに使っており、チップ側と揃える必要がある。
 */
function lightPulse(entry: PointLightDef, index: number, time: number): number {
  const kind = entry.pulse === 'blink' ? 1 : entry.pulse === 'flicker' ? 2 : 0;
  if (kind === 0) return 1;
  const speed = Math.max(0.1, entry.pulseSpeed ?? 1);
  const amount = Math.min(1, Math.max(0, entry.pulseAmount ?? (kind === 1 ? 1 : 0.45)));
  const s = time * Math.max(speed, 0.01) + index * 1.73;
  if (kind === 1) {
    // step(0.45, fract(s)) を JS で。消えている間は `1 - amount` まで落ちる。
    const on = s - Math.floor(s) >= 0.45 ? 1 : 0;
    return on ? 1 : 1 - amount;
  }
  const noise = Math.sin(s * 6.13) * 0.45 + Math.sin(s * 13.71 + 1.3) * 0.28 + Math.sin(s * 31.2 + 2.1) * 0.18;
  const n = Math.min(1, Math.max(0, noise * 0.5 + 0.55));
  return 1 * (1 - amount) + n * amount;
}

function colourOf(value: string | undefined, fallback: number): Color {
  const text = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(text) ? new Color(`#${text}`) : new Color(fallback);
}

export interface MapModelsOptions {
  /**
   * 読み込みが 1 件終わるたびに呼ぶ。**影を焼き直す合図**（DEC-288）。
   * glb は後から届くので、これが無いと最初の 1 回の深度パスに間に合わない。
   */
  onLoad?: () => void;
  /**
   * 映り込みを焼くためのレンダラ（DEC-296）。渡すと金属が映り込むようになる。
   * 焼いた物はその WebGL の文脈でしか使えないので、画面ごとに渡す。
   */
  renderer?: WebGLRenderer;
}

/**
 * マップの 3D をまとめて出す（DEC-288）。
 *
 * 入れ物は 2 段。**明かりは動かす側に入れない**——一緒に動かすと、
 * 大きさを上げたぶん光源が飛び、向きも世界の原点を向いたままになって平たく暗くなる。
 */
export function createMapModels(options: MapModelsOptions = {}): MapModels {
  const group = new Group();
  group.name = 'map-models';

  const ambient = new AmbientLight(0xffffff, MODEL_LOOK_DEFAULTS.ambient);
  const sky = new HemisphereLight(0xffffff, 0x6a7e92, MODEL_LOOK_DEFAULTS.sky);
  const sun = new DirectionalLight(0xfff2e0, MODEL_LOOK_DEFAULTS.sun);
  // 影側を起こす 2 本目（DEC-295）。方向光の**反対**から当てて、輪郭を出す。
  const rim = new DirectionalLight(0xdfe8ff, MODEL_LOOK_DEFAULTS.rim);
  group.add(ambient, sky, sun, sun.target, rim, rim.target);

  const holders = new Group();
  holders.name = 'map-models-body';
  group.add(holders);

  // マップの点光源を写した実ライト（DEC-290）。数が変わったときだけ作り直す。
  const lamps = new Group();
  lamps.name = 'map-models-lights';
  group.add(lamps);
  let lampDefs: readonly PointLightDef[] = [];
  /**
   * 実ライトの並び。**`lamps.children` は当てにしない**——スポットは的（target）も
   * 一緒に入るので、添字が光源の順番とずれる。
   */
  const lampList: Array<PointLight | SpotLight> = [];
  /** 振る前の明るさ。点滅はここへ掛ける。 */
  const lampBase: number[] = [];
  let lampPulses = false;

  const syncLamps = (list: readonly PointLightDef[], unit: number, scale: number) => {
    const use = emittingPointLights(list as PointLightDef[]).slice(0, MAX_MODEL_LIGHTS);
    // 種類か数が変わったときだけ作り直す。毎回捨てるとシェーダが組み直される。
    const changed =
      use.length !== lampDefs.length || use.some((entry, index) => (entry.kind ?? 'light') !== (lampDefs[index]?.kind ?? 'light'));
    if (changed) {
      for (const child of [...lamps.children]) {
        (child as PointLight).dispose?.();
        child.removeFromParent();
      }
      lampList.length = 0;
      for (const entry of use) {
        if ((entry.kind ?? 'light') === 'spot') {
          const spot = new SpotLight(0xffffff, 1);
          lamps.add(spot, spot.target);
          lampList.push(spot);
        } else {
          const point = new PointLight(0xffffff, 1);
          lamps.add(point);
          lampList.push(point);
        }
      }
    }
    lampDefs = use;
    lampBase.length = use.length;
    lampPulses = use.some((entry) => entry.pulse === 'blink' || entry.pulse === 'flicker');
    use.forEach((entry, index) => {
      const lamp = lampList[index];
      if (!lamp) return;
      const range = Math.max(0.1, entry.range ?? 6) * unit;
      lamp.position.set(entry.x * unit, entry.y * unit, entry.z * unit);
      lamp.color.copy(colourOf(entry.color, 0xffd9a0));
      // 目盛りが別物なので、届く距離ぶんだけ持ち上げる。細かくは `look.lights` で。
      lampBase[index] = Math.max(0, entry.intensity ?? 0.7) * scale * range * 0.5;
      lamp.intensity = lampBase[index] * lightPulse(entry, index, lastTime);
      lamp.distance = range;
      lamp.decay = 1;
      const spot = lamp as SpotLight;
      if (!spot.isSpotLight) return;
      spot.angle = ((entry.cone ?? 40) * Math.PI) / 360;
      spot.penumbra = 0.4;
      const yaw = ((entry.yaw ?? 0) * Math.PI) / 180;
      const pitch = ((entry.pitch ?? -90) * Math.PI) / 180;
      const flat = Math.cos(pitch);
      spot.target.position.set(
        lamp.position.x + flat * Math.sin(yaw) * range,
        lamp.position.y + Math.sin(pitch) * range,
        lamp.position.z - flat * Math.cos(yaw) * range,
      );
      spot.target.updateMatrixWorld();
    });
  };

  const shown = new Map<string, Instance>();
  let generation = 0;
  /** 置く前の仮表示（DEC-296）。透かして出すだけで、置いた物とは別。 */
  const ghost = new Group();
  ghost.name = 'map-models-ghost';
  ghost.visible = false;
  group.add(ghost);
  let ghostFile = '';
  let ghostGen = 0;
  /** 最後に渡されたフォグ。読み込みは後から届くので控えておく。 */
  let lastFx: CameraFxDef | undefined;
  /** 点滅の時計。`tick` で進む。 */
  let lastTime = 0;

  const place = (instance: Instance, model: MapModelDef, unit: number) => {
    // 原点の微調整はマス単位で足す（DEC-290）。回転や大きさでは動かさない——
    // 「半マス右へ」が形ごとに違う量になると合わせられない。
    const [ox, oy, oz] = model.origin ?? [0, 0, 0];
    instance.holder.position.set((model.x + ox) * unit, (model.y + oy) * unit, (model.z + oz) * unit);
    instance.holder.rotation.y = (model.yaw * Math.PI) / 180;
    // `scale` は**マス数での高さ**。読み込んだ物の実寸で割って合わせる。
    instance.holder.scale.setScalar((model.scale * unit) / Math.max(instance.height, 1e-6));
  };

  const build = (model: MapModelDef, unit: number): Instance => {
    const holder = new Group();
    holder.name = `model-${model.id}`;
    holders.add(holder);
    const instance: Instance = {
      holder,
      file: model.file,
      height: 1,
      uniforms: [],
      generation: ++generation,
    };
    const mine = instance.generation;
    void loadModel(model.file)
      .then((source) => {
        if (instance.generation !== mine) return;
        const { body, uniforms, bounds } = dressModel(
          source,
          resolveModelLook(model.look),
          options.renderer ? modelEnvironment(options.renderer) : undefined,
        );
        instance.uniforms = uniforms;
        // 原点を**底面の中心**に合わせる。置いた位置がそのまま足元になる。
        const size = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        instance.height = Math.max(size.y, 1e-6);
        body.position.set(-center.x, -bounds.min.y, -center.z);
        holder.add(body);
        place(instance, model, unit);
        setFogUniforms(instance.uniforms, lastFx);
        options.onLoad?.();
      })
      .catch(() => {
        if (instance.generation !== mine) return;
        instance.file = '';
      });
    return instance;
  };

  const drop = (instance: Instance) => {
    instance.generation = ++generation;
    dropDeep(instance.holder);
    instance.holder.removeFromParent();
  };

  return {
    group,
    apply(models, unit, lighting, fx, lights) {
      lastFx = fx;
      const settings = resolveLighting(lighting);
      const towards = lightDirection(settings);
      // 明かりは 1 組で共有する。**先頭の置き物の値**を使う。
      const first = resolveModelLook(models[0]?.look);
      ambient.intensity = first.ambient;
      sky.intensity = first.sky;
      sun.intensity = first.sun;
      // 光の向きはマップの方向光と揃える。影は落とさないので距離は何でもよい。
      sun.position.copy(towards).multiplyScalar(100);
      sun.target.position.set(0, 0, 0);
      sun.target.updateMatrixWorld();
      rim.intensity = first.rim;
      rim.position.set(-towards.x * 100, Math.abs(towards.y) * 60 + 40, -towards.z * 100);
      rim.target.position.set(0, 0, 0);
      rim.target.updateMatrixWorld();
      syncLamps(lights ?? [], unit, first.lights);

      const keep = new Set<string>();
      for (const model of models) {
        keep.add(model.id);
        let instance = shown.get(model.id);
        if (instance && instance.file !== model.file) {
          drop(instance);
          shown.delete(model.id);
          instance = undefined;
        }
        if (!instance) {
          instance = build(model, unit);
          shown.set(model.id, instance);
        }
        place(instance, model, unit);
        setLookUniforms(instance.uniforms, resolveModelLook(model.look));
        setFogUniforms(instance.uniforms, fx);
      }
      for (const [id, instance] of [...shown]) {
        if (keep.has(id)) continue;
        drop(instance);
        shown.delete(id);
      }
    },
    preview(model, unit) {
      if (!model) {
        ghost.visible = false;
        return;
      }
      ghost.visible = true;
      const [ox, oy, oz] = model.origin ?? [0, 0, 0];
      ghost.position.set((model.x + ox) * unit, (model.y + oy) * unit, (model.z + oz) * unit);
      ghost.rotation.y = (model.yaw * Math.PI) / 180;
      if (ghostFile === model.file) {
        const height = ghost.userData.height as number | undefined;
        ghost.scale.setScalar((model.scale * unit) / Math.max(height ?? 1, 1e-6));
        return;
      }
      ghostFile = model.file;
      const mine = ++ghostGen;
      dropDeep(ghost);
      void loadModel(model.file)
        .then((source) => {
          if (mine !== ghostGen) return;
          const { body, bounds } = dressModel(source, resolveModelLook(model.look));
          const size = bounds.getSize(new Vector3());
          const center = bounds.getCenter(new Vector3());
          body.position.set(-center.x, -bounds.min.y, -center.z);
          // 透かす。奥行きは書かないので、後ろの物を隠さない。
          body.traverse((node) => {
            const mesh = node as Mesh;
            if (!mesh.isMesh) return;
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const entry of list) {
              entry.transparent = true;
              entry.opacity = 0.45;
              entry.depthWrite = false;
            }
          });
          ghost.userData.height = Math.max(size.y, 1e-6);
          ghost.scale.setScalar((model.scale * unit) / Math.max(size.y, 1e-6));
          ghost.add(body);
        })
        .catch(() => {
          if (mine !== ghostGen) return;
          ghostFile = '';
        });
    },
    boundsOf(id) {
      const instance = shown.get(id);
      if (!instance || !instance.holder.children.length) return null;
      return new Box3().setFromObject(instance.holder);
    },
    tick(time) {
      lastTime = time;
      if (!lampPulses) return;
      lampDefs.forEach((entry, index) => {
        const lamp = lampList[index];
        if (lamp) lamp.intensity = (lampBase[index] ?? 0) * lightPulse(entry, index, time);
      });
    },
    dispose() {
      for (const instance of shown.values()) drop(instance);
      shown.clear();
      group.removeFromParent();
    },
  };
}
