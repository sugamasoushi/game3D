// 画面エフェクト（DEC-389）。**画面全体にかかる画作りで、世界の場所を持たない。**
//
// フィールドエフェクト（`fieldEffects.ts`）との違いは置き場所——あちらは世界に板を置くので
// カメラが動けば流れていく。こちらは**画面に貼る 1 枚**なので、どこを見ていても同じようにかかる。
// 遠景の靄や、木立の下にいるときの木漏れ日のような「その場の空気」を出すのに使う。
//
// **一覧はマップが持つ**（`MapDef.screenEffects`）。フィールドエフェクトと同じ形にして、
// エディタで作った物がそのままゲームでも出るようにする——見え方の食い違いは、
// 直す場所が 2 つある形からしか生まれない。
//
// 描くのは**シーンを描いたあと**（深度は見ない）。チルトや色被せ（`tiltshift.ts`）より後ろ、
// つまり一番上に重なる。

import {
  AdditiveBlending,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { ScreenEffectDef } from '../mep3d/types';

/** 重ねる 2 枚。速さを変えるので同じ絵にはしない。 */
const NOISE_A = '/assets/noise/Super Perlin/Super Perlin 14 - 512x512.png';
const NOISE_B = '/assets/noise/Super Perlin/Super Perlin 12 - 512x512.png';

export const SCREEN_EFFECT_KINDS = ['fog', 'dapple'] as const;
export type ScreenEffectKind = (typeof SCREEN_EFFECT_KINDS)[number];

export const SCREEN_EFFECT_LABELS: Record<ScreenEffectKind, string> = {
  fog: '霧',
  dapple: '木漏れ日',
};

/**
 * 種類ごとの既定。**書かなくても「それらしく」出る**ようにしておく。
 * `scale` の意味は種類で変わる（霧は模様の大きさ、木漏れ日は筋の細かさ）ので、
 * 幅も画面のラベルも種類ごとに分けてある。
 */
export const SCREEN_EFFECT_DEFAULTS: Record<
  ScreenEffectKind,
  { amount: number; speed: number; scale: number; color: string; height: number; bottom: number; thickness: number }
> = {
  // 霧の `height` は**どこまで上へ届くか**、`bottom` は**下から何割を薄くするか**
  // （画面の高さの比）。既定は下は薄くしない（0）。
  fog: { amount: 0.45, speed: 0.02, scale: 1.6, color: 'cfd8e3', height: 0.9, bottom: 0, thickness: 0.5 },
  // 木漏れ日は旧作の `SunrayPostPipeline` に合わせた（密度 18・速さ 0.4・太さ 0.5・濃さ 0.2）。
  dapple: { amount: 0.2, speed: 0.4, scale: 18, color: 'fff5d2', height: 0.9, bottom: 0, thickness: 0.5 },
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 霧。2 枚を掛け合わせて、下側ほど濃くする。上（空）まで白くすると板だとばれる。 */
const fogShader = /* glsl */ `
precision highp float;
uniform sampler2D mapA;
uniform sampler2D mapB;
uniform vec2 offsetA;
uniform vec2 offsetB;
uniform vec2 tile;
uniform vec3 tint;
uniform float amount;
uniform float height;
uniform float bottom;
varying vec2 vUv;

void main() {
  float a = texture2D(mapA, vUv * tile + offsetA).r;
  float b = texture2D(mapB, vUv * tile * 0.63 + offsetB).r;
  // 掛け算だと暗くなりすぎるので、薄い方に寄せてから持ち上げる。
  float n = smoothstep(0.25, 0.85, a * 0.6 + b * 0.6);
  // 画面の下ほど濃く。地面に溜まって見える。
  // height はどこまで上へ届くか。下から 3 割は満量で、そこから height にかけて薄れる。
  float low = 1.0 - smoothstep(height * 0.3, max(height, 0.05), vUv.y);
  // bottom は下から何割を薄くするか。0 なら下端まで濃い（既定）。
  low *= smoothstep(0.0, max(bottom, 0.001), vUv.y);
  gl_FragColor = vec4(tint, n * low * amount);
}
`;

/**
 * 木漏れ日（DEC-390）。**旧作の `SunrayPostPipeline` の移植**——
 * ノイズの斑ではなく、**左上から右下へ降る光の筋**。
 *
 * 筋は「進む向きへ射影した値の sin」で作る（3 本を周期をずらして重ねる）。
 * ノイズで斑を作る手もあるが、それは曇り空に見えて**光が差している**感じが出ない。
 *
 * **太さは下へ行くほど細く**（`pow` の指数を下ほど大きくする）、
 * **濃さは右下へ行くほど薄く**——空から差す光は、遠ざかるほど細く弱く見える。
 * 光なので**加算**で足す（上から色を塗ると、明るいはずの筋が画面を白く曇らせる）。
 */
const dappleShader = /* glsl */ `
precision highp float;
uniform vec2 tile;
uniform vec3 tint;
uniform float amount;
uniform float thickness;
uniform float clock;
uniform float speed;
uniform vec2 screen;
varying vec2 vUv;

void main() {
  // 横長の画面でも筋の角度が変わらないよう、縦横比で伸ばす。
  float aspect = screen.x / max(screen.y, 1.0);
  vec2 st = vUv * vec2(aspect, 1.0);
  // 左上から右下へ。**この向きの直交線が筋になる。**
  float projection = (st.x + st.y) * 0.70710678;

  float density = max(1.0, tile.x);
  float t = -clock * speed;
  float rays = sin(projection * density + t);
  rays += sin(projection * density * 1.43 - t * 1.3) * 0.5;
  rays += sin(projection * density * 2.51 + t * 1.8) * 0.3;
  rays = max(0.0, rays);

  // 下（vUv.y が小さい）ほど指数を上げて細くする。旧作と同じ 4.5 の幅。
  float sharp = thickness + (1.0 - vUv.y) * 4.5;
  rays = pow(rays, sharp);

  // 左上ほど強く、右下ほど薄く。
  float fade = smoothstep(0.0, 1.0, vUv.y * 0.8 + (1.0 - vUv.x) * 0.2);
  gl_FragColor = vec4(tint * rays * fade * amount, 1.0);
}
`;

export interface ScreenEffects {
  /** 一覧を差し替える。**毎フレーム渡してよい**（同じなら作り直さない）。 */
  set(list: ScreenEffectDef[]): void;
  /** シーンを描いたあとに呼ぶ。出す物が無ければ何もしない。 */
  render(renderer: WebGLRenderer, deltaSeconds: number): void;
  dispose(): void;
}

/** 流れの向き。種類ごとに変える——同じ向きだと 2 枚が一緒に流れて 1 枚に見える。 */
interface Drift {
  a: Vector2;
  b: Vector2;
}

export function createScreenEffects(): ScreenEffects {
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

  const makeMaterial = (fragmentShader: string, additive: boolean) =>
    new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        mapA: { value: mapA },
        mapB: { value: mapB },
        offsetA: { value: new Vector2() },
        offsetB: { value: new Vector2() },
        tile: { value: new Vector2(1, 1) },
        tint: { value: new Vector3(1, 1, 1) },
        amount: { value: 0 },
        // 霧だけが使う（どこまで上へ届くか／下から何割を薄くするか）。
        height: { value: 0.9 },
        bottom: { value: 0 },
        // 木漏れ日だけが使う（筋の太さ・時計・速さ・画面の大きさ）。
        thickness: { value: 0.5 },
        clock: { value: 0 },
        speed: { value: 0 },
        screen: { value: new Vector2(1280, 720) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      ...(additive ? { blending: AdditiveBlending } : {}),
    });

  const materials: Record<ScreenEffectKind, ShaderMaterial> = {
    fog: makeMaterial(fogShader, false),
    dapple: makeMaterial(dappleShader, true),
  };

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), materials.fog);
  quad.frustumCulled = false;
  scene.add(quad);

  let list: ScreenEffectDef[] = [];
  /** 経った時間（秒）。**筋は「流す」のではなく波を動かす**ので、時計そのものを渡す。 */
  let clock = 0;
  /** 流れた量は**id ごと**に覚える。1 つの入れ物で持つと、2 枚が同じ模様で流れる。 */
  const drifts = new Map<string, Drift>();

  const driftOf = (id: string): Drift => {
    let found = drifts.get(id);
    if (!found) {
      // 始まりをずらす。同じ種類を 2 つ置いたときに、ぴったり重ならないように。
      const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      found = { a: new Vector2((seed % 97) / 97, (seed % 61) / 61), b: new Vector2((seed % 43) / 43, 0) };
      drifts.set(id, found);
    }
    return found;
  };

  const colorOf = (hex: string | undefined, fallback: string): Vector3 => {
    const text = String(hex ?? fallback).replace(/^#/, '');
    const value = Number.parseInt(/^[0-9a-fA-F]{6}$/.test(text) ? text : fallback, 16);
    return new Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
  };

  return {
    set(next) {
      list = next.map((entry) => ({ ...entry }));
      // 消えた物の流れは捨てる。残すと、作り直したときに前の位置から始まる。
      const alive = new Set(list.map((entry) => entry.id));
      for (const id of [...drifts.keys()]) if (!alive.has(id)) drifts.delete(id);
    },

    render(renderer, deltaSeconds) {
      const shown = list.filter(
        (entry) =>
          entry.on !== false &&
          (SCREEN_EFFECT_KINDS as readonly string[]).includes(entry.kind) &&
          (entry.amount ?? SCREEN_EFFECT_DEFAULTS[entry.kind as ScreenEffectKind].amount) > 0,
      );
      if (shown.length === 0) return;
      clock += Math.max(0, deltaSeconds);

      const size = renderer.getSize(new Vector2());
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      for (const entry of shown) {
        const kind = entry.kind as ScreenEffectKind;
        const fallback = SCREEN_EFFECT_DEFAULTS[kind];
        const material = materials[kind];
        const drift = driftOf(entry.id);
        const speed = entry.speed ?? fallback.speed;
        const scale = entry.scale ?? fallback.scale;

        // 速さも向きも 2 枚で変える。同じだと一緒に流れて 1 枚に見える。
        drift.a.x = (drift.a.x + speed * deltaSeconds) % 1;
        drift.a.y = (drift.a.y + speed * 0.18 * deltaSeconds) % 1;
        drift.b.x = (drift.b.x - speed * 0.42 * deltaSeconds) % 1;
        drift.b.y = (drift.b.y + speed * 0.07 * deltaSeconds) % 1;

        (material.uniforms.offsetA.value as Vector2).copy(drift.a);
        (material.uniforms.offsetB.value as Vector2).copy(drift.b);
        // 霧は縦を横の 0.56 倍に（画面が横長なので、そのままだと模様が横へ伸びる）。
        // 木漏れ日は `tile.x` を**筋の細かさ**として読むので、縦は触らない。
        (material.uniforms.tile.value as Vector2).set(scale, kind === 'fog' ? scale * 0.56 : scale);
        (material.uniforms.tint.value as Vector3).copy(colorOf(entry.color, fallback.color));
        material.uniforms.amount.value = Math.max(0, entry.amount ?? fallback.amount);
        material.uniforms.height.value = Math.max(0.05, entry.height ?? fallback.height);
        material.uniforms.bottom.value = Math.max(0, entry.bottom ?? fallback.bottom);
        material.uniforms.thickness.value = Math.max(0, entry.thickness ?? fallback.thickness);
        material.uniforms.clock.value = clock;
        material.uniforms.speed.value = speed;
        (material.uniforms.screen.value as Vector2).copy(size);

        quad.material = material;
        renderer.render(scene, camera);
      }
      renderer.autoClear = auto;
    },

    dispose() {
      quad.geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      mapA.dispose();
      mapB.dispose();
    },
  };
}
