// キャラのビルボード用マテリアル（GF-3.7）。マップのビルボードと同じ光の当て方にする。
//
// タイル側（material.ts）のビルボードは
//   colour = albedo * (vec3(lightBillboard) + pointLightRgb(上向き, ワールド位置))
// で、そのあとフォグを混ぜる。ここも同じ式を使う。点光源とフォグの GLSL は
// material.ts のチャンクを共有しているので、片方だけずれることはない。

import { DoubleSide, ShaderMaterial, Vector2, Vector3, Vector4, type Texture } from 'three';
import {
  FOG_GLSL,
  FOG_UNIFORMS_GLSL,
  POINT_LIGHT_GLSL,
  POINT_LIGHT_UNIFORMS_GLSL,
  SPRITE_SHADOW_GLSL,
  SPRITE_SHADOW_UNIFORMS_GLSL,
  SUN_ACTOR_GLSL,
  SUN_ACTOR_UNIFORMS_GLSL,
  createPointLightArrays,
  createSunActorUniforms,
  emptyActorMap,
  emptyShadowMap,
} from './material';
import { CAMERA_FX_DEFAULTS, fogColor } from './camera';
import { createSunShadowUniforms, SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORMS_GLSL } from './sunShadow';
import { createLightWallArrays } from './lightWalls';
import { blockShadowStrength, fillPointLightUniforms, resolveLighting } from './lighting';
import { createOccluderArrays, emptyOccluderMap, MAX_OCCLUDERS } from './occluders';
import { FADE_CELLS } from './shadowMask';
import type { CameraFxDef, LightingDef, PointLightDef } from './types';

const vertexShader = /* glsl */ `
uniform vec4 frame;       // スプライトシートの コマ: xy = 左下 UV, zw = 大きさ
uniform vec3 shadowBase;  // 足元のワールド座標。影マスクを引く柱
uniform float sunLift;    // 太陽の影を引く高さ（頭の少し上。DEC-156）
varying vec3 vSunPos;
varying vec2 vChipUv;
varying vec3 vWorldPos;
varying vec3 vShadowPos;
varying vec3 vFogView;

void main() {
  vChipUv = frame.xy + uv * frame.zw;
  vec4 local = vec4(position, 1.0);
  vWorldPos = (modelMatrix * local).xyz;
  // 影マスクはビルボードと同じく「足元の柱」で引く。板の幅方向には動かさない。
  vShadowPos = vec3(shadowBase.x, vWorldPos.y, shadowBase.z);
  // 太陽の影は**頭の上の 1 点**で引く（DEC-156）。
  // 自分もいま深度に入っているので、体の高さで引くと自分の板を踏んで下半身が黒くなる。
  vSunPos = vec3(shadowBase.x, shadowBase.y + sunLift, shadowBase.z);
  vec4 view = modelViewMatrix * local;
  vFogView = view.xyz;
  gl_Position = projectionMatrix * view;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float alphaCutoff;
uniform float lightBillboard;
uniform float lightAmbient;
uniform float lightIntensity;
${POINT_LIGHT_UNIFORMS_GLSL}
${SPRITE_SHADOW_UNIFORMS_GLSL}
${SUN_SHADOW_UNIFORMS_GLSL}
${SUN_ACTOR_UNIFORMS_GLSL}
${FOG_UNIFORMS_GLSL}
uniform vec4 frameClamp;  // コマの内側（半画素ぶん締めた UV の枠）
varying vec2 vChipUv;
varying vec3 vWorldPos;
varying vec3 vShadowPos;
varying vec3 vSunPos;
varying vec3 vFogView;

${POINT_LIGHT_GLSL}
${SPRITE_SHADOW_GLSL}
${SUN_SHADOW_GLSL}
${SUN_ACTOR_GLSL}
${FOG_GLSL}

void main() {
  vec4 texel = texture2D(map, clamp(vChipUv, frameClamp.xy, frameClamp.zw));
  if (texel.a < alphaCutoff) discard;
  // 法線はカメラで回ると点滅するので、タイルのビルボードと同じく上向き固定。
  // 太陽の影は**足元の柱**で引く（GC-49）。カードの実座標だと、上のほうが
  // カメラの向き次第で前後にずれて、頭だけ日向／足だけ日陰になる。
  float shade = lightBillboard;
  // 雲の影（DEC-218）もマップと同じ直射から引く。濃いほうを採る。
  float lost = max(mepSunShadow(vSunPos, vec3(0.0, 1.0, 0.0)) * mepSunStrength, mepCloudShadow(vWorldPos));
  // ほかのキャラの影（DEC-393）。マップの影と同じく**足元の柱で引く**（GC-49 と同じ理由）。
  // 自分の板は足元の柱の上にあるので、線がすぐ自分の板に当たって外れる（自分では暗くならない）。
  if (mepSunActorsBlock(vSunPos)) lost = max(lost, mepSunStrength);
  // 1 までは直射だけ。1 を超えたぶんは環境光も食う（DEC-220）。マップと同じ式。
  // 環境光のぶんは明るさ以下に抑える（DEC-400）。マップと同じ式。
  if (lost > 0.0) {
    float base = min(shade, lightAmbient);
    shade = max(shade - (shade - base) * min(lost, 1.0) - base * max(lost - 1.0, 0.0), 0.0);
  }
  vec3 colour = texel.rgb * (vec3(shade) + pointLightRgb(vec3(0.0, 1.0, 0.0), vWorldPos));
  // 旧方式のブロック影（L-3.12）。新方式が入のときは mepShadowOn が 0 なので何もしない。
  colour = mepBlockShadow(colour, vShadowPos);
  if (mepFogOn) {
    colour = mix(colour, mepFogColor, mepFogFactor(length(vFogView)));
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * 太陽の深度パス用（DEC-154）。**板を太陽のほうへ向け直して**焼く。
 * 本体の向きのまま焼くと、太陽が真横から来たとき板が薄い刃になって影が消える。
 * 向け方はマップのビルボード（`material.ts` の MEP_BILLBOARD）と同じ式。
 */
const depthVertexShader = /* glsl */ `
uniform vec4 frame;
varying vec2 vChipUv;

void main() {
  vChipUv = frame.xy + uv * frame.zw;
  vec4 origin = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(modelMatrix[0].xyz);
  vec3 viewUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 towardsCamera = vec3(0.0, 0.0, 1.0);
  vec3 viewRight = cross(viewUp, towardsCamera);
  viewRight = length(viewRight) < 0.0001 ? vec3(1.0, 0.0, 0.0) : normalize(viewRight);
  vec3 at = origin.xyz + viewRight * position.x * scale + viewUp * position.y * scale;
  gl_Position = projectionMatrix * vec4(at, 1.0);
}
`;

const depthFragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float alphaCutoff;
uniform vec4 frameClamp;
varying vec2 vChipUv;

void main() {
  if (texture2D(map, clamp(vChipUv, frameClamp.xy, frameClamp.zw)).a < alphaCutoff) discard;
  gl_FragColor = vec4(1.0);
}
`;

/** キャラを太陽の深度へ焼くマテリアル。uniform は本体と共有する。 */
export function createActorDepthMaterial(source: ShaderMaterial): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: depthVertexShader,
    fragmentShader: depthFragmentShader,
    uniforms: source.uniforms,
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
}

/**
 * キャラの影を地面へ寝かせる板（DEC-157）。深度パスを使わない。
 * 絵の抜き色をそのままシルエットにするので、キャラの形のまま落ちる。
 * uniform は本体と共有するので、コマ送りも自動で付いてくる。
 */
const shadowVertexShader = /* glsl */ `
uniform vec4 frame;
varying vec2 vChipUv;

void main() {
  vChipUv = frame.xy + uv * frame.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const shadowFragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float alphaCutoff;
uniform float actorShadowAlpha;
uniform vec4 frameClamp;
varying vec2 vChipUv;

void main() {
  if (texture2D(map, clamp(vChipUv, frameClamp.xy, frameClamp.zw)).a < alphaCutoff) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, actorShadowAlpha);
}
`;

/** 地面へ寝かせるキャラの影。uniform は本体と共有する。 */
export function createActorShadowMaterial(source: ShaderMaterial): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: shadowVertexShader,
    fragmentShader: shadowFragmentShader,
    uniforms: source.uniforms,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // 面へ貼るので深度も手前へ寄せる（DEC-164）。ワールドで浮かせるだけ（DEC-161）だと、
    // 寄り引きで深度の刻みが変わったときに面と競って一部が消える。
    // 傾いた面ほど深度の変化が大きいので、傾きに比例する factor も併せて使う（DEC-143 と同じ理由）。
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  });
}

export interface ActorMaterialOptions {
  lighting?: LightingDef;
  cameraFx?: Required<CameraFxDef>;
  pointLights?: PointLightDef[];
  /** ワールド 1 マスの大きさ。点光源の距離計算に使う。 */
  unit?: number;
  alphaTest?: number;
}

export interface ActorMaterial {
  material: ShaderMaterial;
  /** シートのコマを選ぶ。左下原点の UV。 */
  setFrame(x: number, y: number, width: number, height: number): void;
  /** マップの光を差し替える。読み込み直後に呼ぶ。 */
  setLighting(lighting: LightingDef, pointLights: PointLightDef[], unit: number): void;
  /** 影マスクを引く柱の位置（足元のワールド座標）。 */
  setShadowBase(x: number, y: number, z: number): void;
  /** カメラ効果（フォグ）を差し替える。 */
  setCameraFx(fx: Required<CameraFxDef>): void;
  /** 点滅・炎のゆらぎを進める。経過秒。 */
  setTime(seconds: number): void;
  dispose(): void;
}

export function createActorMaterial(
  texture: Texture,
  options: ActorMaterialOptions = {},
): ActorMaterial {
  const light = resolveLighting(options.lighting);
  const fx = options.cameraFx ?? CAMERA_FX_DEFAULTS;
  const lights = createPointLightArrays();
  const occluders = createOccluderArrays();
  const walls = createLightWallArrays();
  const count = fillPointLightUniforms(options.pointLights ?? [], options.unit ?? 1, lights);

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      map: { value: texture },
      alphaCutoff: { value: options.alphaTest ?? 0.5 },
      frame: { value: new Vector4(0, 0, 1, 1) },
      frameClamp: { value: new Vector4(0, 0, 1, 1) },
      lightBillboard: { value: light.billboard },
      lightAmbient: { value: light.ambient },
      lightIntensity: { value: light.intensity },
      lightTime: { value: 0 },
      shadowBase: { value: new Vector3() },
      sunLift: { value: 1 },
      // 地面へ寝かせる影の濃さ（DEC-157）。
      actorShadowAlpha: { value: 0.45 },
      mepShadowMap: { value: emptyShadowMap() },
      mepShadowOrigin: { value: new Vector2() },
      mepShadowSize: { value: new Vector2(1, 1) },
      mepShadowBaseY: { value: 0 },
      mepShadowTpc: { value: 1 },
      mepShadowUnit: { value: 1 },
      mepShadowOn: { value: 0 },
      mepShadowStrength: { value: blockShadowStrength(light) },
      mepShadowFade: { value: FADE_CELLS },
      // 太陽の影（DEC-145）。ローダの attachShadowMask で毎回入れ直される。
      ...createSunShadowUniforms(),
      pointLightCount: { value: count },
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
    },
    // 抜き色は discard で処理する。半透明にすると深度が書けない。
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });

  return {
    material,
    setFrame(x, y, width, height) {
      (material.uniforms.frame.value as Vector4).set(x, y, width, height);
      // **拾う場所をコマの中へ締める（DEC-271）。**
      // MSAA の縁では varying が「三角形の外にある画素の中心」で評価されるので、
      // uv がコマの外へはみ出し、隣のコマの 1 行を拾う。左を向いたとき頭の上に
      // 出ていた灰色の線がこれ——上のコマ（前向き）の靴だった。
      // 半画素ぶん内側で丸めれば、はみ出しても端の画素で止まる。
      const image = texture.image as { width?: number; height?: number } | undefined;
      const halfU = image?.width ? 0.5 / image.width : 0;
      const halfV = image?.height ? 0.5 / image.height : 0;
      (material.uniforms.frameClamp.value as Vector4).set(
        x + halfU,
        y + halfV,
        x + width - halfU,
        y + height - halfV,
      );
    },
    setLighting(lighting, pointLights, unit) {
      const next = resolveLighting(lighting);
      material.uniforms.lightBillboard.value = next.billboard;
      material.uniforms.lightAmbient.value = next.ambient;
      material.uniforms.lightIntensity.value = next.intensity;
      material.uniforms.mepShadowStrength.value = blockShadowStrength(next);
      material.uniforms.pointLightCount.value = fillPointLightUniforms(pointLights, unit, lights);
    },
    setShadowBase(x, y, z) {
      (material.uniforms.shadowBase.value as Vector3).set(x, y, z);
    },
    setCameraFx(next) {
      material.uniforms.mepFogOn.value = next.fog;
      material.uniforms.mepFogColor.value = fogColor(next);
      material.uniforms.mepFogNear.value = next.fogNear;
      material.uniforms.mepFogFar.value = next.fogFar;
      material.uniforms.mepFogMax.value = next.fogMax;
    },
    setTime(seconds) {
      material.uniforms.lightTime.value = seconds;
    },
    dispose() {
      material.dispose();
    },
  };
}
