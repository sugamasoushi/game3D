import { Color, Vector2, Vector3 } from 'three';
import { lightRayBlocked, lightRayHitT, type LightWall } from './lightWalls';
import type { LightingDef, PointLightDef } from './types';

/**
 * マップ全体の方向光。実ライトではなく、面の法線と 1 方向の内積で明るさを出す。
 */

/** 既定の方向光。南西・高め。 */
export const LIGHTING_DEFAULTS: Required<LightingDef> = {
  azimuth: 225,
  elevation: 50,
  ambient: 0.55,
  intensity: 0.45,
  wrap: 0,
  billboard: 0.95,
  blockShadow: true,
  blockShadowStrength: 1,
  cloudShadow: false,
  cloudShadowAmount: 0.45,
  cloudShadowScale: 0.018,
  cloudShadowSpeed: 0.004,
};

/** ブロック影マスクを組むか。暗さは環境光で、直射を失うことが影。 */
export function blockShadowsOn(lighting: LightingDef | undefined): boolean {
  const on = lighting?.blockShadow ?? LIGHTING_DEFAULTS.blockShadow;
  return on && blockShadowStrength(lighting) > 0;
}

/**
 * 影の濃さ（DEC-220）。**0..2**。
 * 1 までは直射を削るだけで、環境光は残る（点光源や夜と干渉しないため）。
 * 1 を超えたぶんは環境光も食い、2 で真っ黒になる。
 */
export const MAX_SHADOW_STRENGTH = 2;

export function blockShadowStrength(lighting: LightingDef | undefined): number {
  const value = lighting?.blockShadowStrength ?? LIGHTING_DEFAULTS.blockShadowStrength;
  return Math.min(Math.max(value, 0), MAX_SHADOW_STRENGTH);
}

/** シルエットの最大伸長（セル）。地平に近いと tan が 0 になり無限になるため。 */
const MAX_SHADOW_LENGTH = 6;

/** ブロック影の届く距離（高さ 1 セルあたり）。 */
export function blockShadowLength(settings: Required<LightingDef>): number {
  const elevation = (Math.abs(settings.elevation) * Math.PI) / 180;
  const tangent = Math.tan(elevation);
  const length = tangent < 0.0001 ? MAX_SHADOW_LENGTH : 1 / tangent;
  return Math.min(Math.max(length, 0.15), MAX_SHADOW_LENGTH);
}

/** 影を落とす水平方向。光と逆、地面に寝かせる。 */
export function shadowDirection(settings: Required<LightingDef>): Vector3 {
  const towards = lightDirection(settings);
  const flat = new Vector3(-towards.x, 0, -towards.z);
  if (flat.lengthSq() < 1e-6) return new Vector3(0, 0, 1);
  return flat.normalize();
}

/** 欠落を既定で埋める。光源のない旧ファイルも真っ黒にしない。 */
export function resolveLighting(raw: LightingDef | undefined): Required<LightingDef> {
  return { ...LIGHTING_DEFAULTS, ...(raw ?? {}) };
}

/** 面から光へ向かう単位ベクトル。方位 0 が北（−Z）、仰角は地平から。 */
export function lightDirection(settings: Required<LightingDef>): Vector3 {
  const azimuth = (settings.azimuth * Math.PI) / 180;
  const elevation = (settings.elevation * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  const direction = new Vector3(
    horizontal * Math.sin(azimuth),
    Math.sin(elevation),
    -horizontal * Math.cos(azimuth),
  ).normalize();
  return direction;
}

/** タイルシェーダが同時に足す点光源の上限。それ以上はリスト順の先頭だけ。 */
export const MAX_POINT_LIGHTS = 16;

/** 可視の発光光源。グループと非表示の親は除く。個数は切らない。 */
export function emittingPointLights(lights: PointLightDef[] | undefined): PointLightDef[] {
  const list = lights ?? [];
  const byId = new Map(list.map((entry) => [entry.id, entry]));
  return list.filter((entry) => {
    if (entry.kind === 'group' || entry.visible === false) return false;
    if (Math.min(20, Math.max(0, entry.intensity ?? 0.7)) <= 0) return false;
    /*
     * 親をたどって隠れていないか見る。**引けない親は無視する**（DEC-317）——
     * 光源レイヤーは書き出すときに同じ id のグループとして並べてあるが、
     * レイヤーを消した直後など、親が居ない瞬間がある。そこで全部消えると驚く。
     */
    let current = entry.parent ?? '';
    let guard = 0;
    while (current && guard < list.length) {
      const parent = byId.get(current);
      if (!parent) break;
      if (parent.visible === false) return false;
      current = parent.parent ?? '';
      guard += 1;
    }
    return true;
  });
}

/** ビルボードへ落とす点光源影。届かない・床より下からは null。 */

const SUN_PROBE = 48;

/** 方向光の影の伸び。壁の向こうへは出さない。光が壁の向こうなら 0。 */
export function clipDirectionalShadowLength(
  at: { x: number; y: number; z: number },
  footY: number,
  height: number,
  fullLength: number,
  lighting: Required<LightingDef>,
  walls: LightWall[] | undefined,
): number {
  if (!walls || walls.length === 0 || fullLength <= 0) return fullLength;
  const sun = lightDirection(lighting);
  if (
    lightRayBlocked(
      at,
      { x: at.x + sun.x * SUN_PROBE, y: at.y + sun.y * SUN_PROBE, z: at.z + sun.z * SUN_PROBE },
      walls,
    )
  ) {
    return 0;
  }
  const away = shadowDirection(lighting);
  const h = Math.max(0.2, height);
  const t = lightRayHitT(
    at,
    { x: at.x + away.x * h * fullLength, y: footY, z: at.z + away.z * h * fullLength },
    walls,
  );
  if (t == null) return fullLength;
  return Math.max(0, fullLength * t);
}


const scratchColor = new Color();

/**
 * 点滅・ゆらめきを（種別, 速さ, 幅）へ。種別は 0 一定 / 1 点滅 / 2 炎。
 * **光の玉も同じ値を使う**（DEC-314）ので一本にしてある。
 */
export function pulseTriple(entry: PointLightDef): [number, number, number] {
  const kind = entry.pulse === 'blink' ? 1 : entry.pulse === 'flicker' ? 2 : 0;
  const amount = entry.pulseAmount ?? (kind === 1 ? 1 : 0.45);
  return [kind, Math.max(0.1, entry.pulseSpeed ?? 1), Math.min(1, Math.max(0, amount))];
}

/** 光源の色をリニアへ。**光の玉も同じ色を使う**（DEC-314）ので外へ出してある。 */
export function lightColorLinear(hex: string | undefined): Vector3 {
  scratchColor.set(hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffd9a0');
  scratchColor.convertSRGBToLinear();
  return new Vector3(scratchColor.r, scratchColor.g, scratchColor.b);
}

function emitKind(entry: PointLightDef): 0 | 1 | 2 {
  if (entry.kind === 'spot') return 1;
  if (entry.kind === 'area') return 2;
  return 0;
}

function aimOf(entry: PointLightDef): Vector3 {
  const yaw = ((entry.yaw ?? 0) * Math.PI) / 180;
  const pitch = ((entry.pitch ?? (entry.kind === 'spot' ? -90 : 0)) * Math.PI) / 180;
  const horizontal = Math.cos(pitch);
  return new Vector3(horizontal * Math.sin(yaw), Math.sin(pitch), -horizontal * Math.cos(yaw)).normalize();
}

export type PointLightUniformBuf = {
  pos: Vector3[];
  color: Vector3[];
  ir: Vector2[];
  dir: Vector3[];
  extra: Vector3[];
  pulse: Vector3[];
};

/** 可視の点光源を uniform 配列へ書く。戻り値は個数。 */
export function fillPointLightUniforms(
  lights: PointLightDef[] | undefined,
  unit: number,
  buf: PointLightUniformBuf,
): number {
  const visible = emittingPointLights(lights).slice(0, MAX_POINT_LIGHTS);
  const scale = unit > 0 ? unit : 1;
  for (let i = 0; i < MAX_POINT_LIGHTS; i += 1) {
    const entry = visible[i];
    if (!entry) {
      buf.pos[i]?.set(0, 0, 0);
      buf.color[i]?.set(0, 0, 0);
      buf.ir[i]?.set(0, 1);
      buf.dir[i]?.set(0, -1, 0);
      buf.extra[i]?.set(0, 0, 0);
      buf.pulse[i]?.set(0, 1, 0);
      continue;
    }
    buf.pos[i]?.set(entry.x * scale, entry.y * scale, entry.z * scale);
    buf.color[i]?.copy(lightColorLinear(entry.color));
    buf.ir[i]?.set(Math.min(20, Math.max(0, entry.intensity ?? 0.7)), Math.max(0.001, entry.range ?? 6) * scale);
    buf.dir[i]?.copy(aimOf(entry));
    const kind = emitKind(entry);
    if (kind === 1) {
      const outer = ((entry.cone ?? 40) * Math.PI) / 180;
      const inner = outer * 0.7;
      buf.extra[i]?.set(1, Math.cos(outer), Math.cos(inner));
    } else if (kind === 2) {
      buf.extra[i]?.set(2, Math.max(0.001, (entry.width ?? 2) * 0.5 * scale), Math.max(0.001, (entry.height ?? 1.5) * 0.5 * scale));
    } else {
      buf.extra[i]?.set(0, 0, 0);
    }
    const p = pulseTriple(entry);
    buf.pulse[i]?.set(p[0], p[1], p[2]);
  }
  return visible.length;
}
