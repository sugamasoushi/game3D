// 光のプリセット（時間帯）を基準に重ねる（DEC-435 / GS-222）。**マップエディタとゲームで同じ物を使う。**
//
// 基準はマップの `lighting`・`pointLights`・`camera`・`view` そのもの。プリセット（朝・昼・夕・夜と足した物）は
// 時間帯で変わる値を全部自分で持ち、表示するときは基準の写しをその値で差し替える（光源の強さと背景の明暗だけは倍率）。
// 保存した基準は変えない。
//
// 時間帯で出し分ける物（`ShowIn`）と時間帯ごとのエフェクト（`Effect.<id>`）も、ここの決まりで読む。
// **基準（時間帯なし）では時間帯の条件をかけない**——すべて出す（DEC-448 / DEC-449）。

import { Color } from 'three';
import { resolveCameraFx } from './camera';
import { resolveLighting } from './lighting';
import type { CameraFxDef, GameViewDef, LayerDef, LightingDef, LightingPresetDef, MapDef, PointLightDef } from './types';

/**
 * 朝・昼・夕・夜（DEC-448）。いつもこの 4 つがこの順に在る。`enabled`（このマップで使うか）で切り替える。
 * 自分で足すプリセットは `preset_1`、`preset_2`…で、この後ろに並ぶ。
 */
export const PRESET_DEFAULTS: readonly { id: string; name: string }[] = [
  { id: 'morning', name: '朝' },
  { id: 'day', name: '昼' },
  { id: 'evening', name: '夕' },
  { id: 'night', name: '夜' },
];

/** 朝・昼・夕・夜の枠か。 */
export function isTimePreset(id: string): boolean {
  return PRESET_DEFAULTS.some((entry) => entry.id === id);
}

/** 出し分けのプロパティ名（DEC-439 / DEC-446）。 */
export const SHOW_IN_PROPERTY = 'ShowIn';

/** `ShowIn` を読む。付いていなければ null（いつも出す）。値はプリセットの id のカンマ区切り。 */
export function readShowIn(properties: readonly { name: string; value: unknown }[] | undefined): string[] | null {
  const hit = (properties ?? []).find((entry) => entry.name === SHOW_IN_PROPERTY);
  if (!hit) return null;
  return String(hit.value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** その時間帯で出すか。**時間帯なし（基準）ではすべて出す。** */
export function shownAtTime(properties: readonly { name: string; value: unknown }[] | undefined, time: string): boolean {
  if (!time) return true;
  const showIn = readShowIn(properties);
  return !showIn || showIn.includes(time);
}

/** レイヤーをその時間帯で出すか。親のグループの `ShowIn` もたどる。 */
export function layerShownAtTime(layers: readonly LayerDef[], layerId: string, time: string): boolean {
  if (!time) return true;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  let current = byId.get(layerId);
  let guard = 0;
  while (current && guard <= layers.length) {
    if (!shownAtTime(current.properties, time)) return false;
    current = current.parent ? byId.get(current.parent) : undefined;
    guard += 1;
  }
  return true;
}

/**
 * そのマップでその時間帯に使うプリセット。無い・使わない（`enabled: false`）なら null（基準の光）。
 * 足したプリセット（`preset_N`）は `enabled` を持たないので、在れば使う。
 */
export function activePreset(map: Pick<MapDef, 'lightingPresets'>, time: string): LightingPresetDef | null {
  if (!time) return null;
  const hit = (map.lightingPresets ?? []).find((entry) => entry.id === time);
  if (!hit) return null;
  if (isTimePreset(hit.id) && hit.enabled === false) return null;
  return hit;
}

/** 方向光・光の色・影・雲の影をプリセットの値に差し替える。 */
export function presetLighting(lighting: LightingDef, preset: LightingPresetDef | null): LightingDef {
  if (!preset) return lighting;
  return {
    ...lighting,
    azimuth: preset.azimuth,
    elevation: preset.elevation,
    ambient: preset.ambient,
    intensity: preset.intensity,
    wrap: preset.wrap,
    billboard: preset.billboard,
    ambientColor: preset.ambientColor,
    sunColor: preset.sunColor,
    blockShadow: preset.blockShadow,
    blockShadowStrength: preset.blockShadowStrength,
    cloudShadow: preset.cloudShadow,
    cloudShadowAmount: preset.cloudShadowAmount,
    cloudShadowScale: preset.cloudShadowScale,
    cloudShadowSpeed: preset.cloudShadowSpeed,
  };
}

/** 配置光源の強さに倍率をかける。入れ物（group）は触らない。 */
export function presetPointLights(lights: PointLightDef[], preset: LightingPresetDef | null): PointLightDef[] {
  if (!preset || preset.lights === 1) return lights;
  const scale = Math.max(0, preset.lights);
  return lights.map((entry) =>
    entry.kind === 'group' ? entry : { ...entry, intensity: (entry.intensity ?? 0.7) * scale },
  );
}

/** フォグとパノラマの絵をプリセットの値に差し替え、パノラマの明るさに倍率をかける。チルトシフトは基準のまま。 */
export function presetCameraFx(cameraFx: CameraFxDef, preset: LightingPresetDef | null): CameraFxDef {
  if (!preset) return cameraFx;
  return {
    ...cameraFx,
    fog: preset.fog,
    fogColor: preset.fogColor,
    fogNear: preset.fogNear,
    fogFar: preset.fogFar,
    fogMax: preset.fogMax,
    ...(preset.sky ? { sky: preset.sky } : {}),
    skyGain: (cameraFx.skyGain ?? 1) * preset.skyGain,
  };
}

/** 書き割りの絵をプリセットの値に差し替え、明るさに倍率をかける。形・位置は基準のまま。 */
export function presetView(view: GameViewDef, preset: LightingPresetDef | null): GameViewDef {
  if (!preset || !view.backdrop) return view;
  return {
    ...view,
    backdrop: {
      ...view.backdrop,
      ...(preset.backdrop ? { src: preset.backdrop } : {}),
      gain: (view.backdrop.gain ?? 1) * preset.skyGain,
    },
  };
}

// ── ゲーム: 時間帯の見た目と、切り替えのあいだの混ぜ方（GS-222）────────────────

/** ある時間帯でのマップの見た目。 */
export interface TimeLook {
  /** 出し分け（`ShowIn` / `Effect.<id>`）に使う時間帯。使うプリセットが無ければ ''（基準＝すべて出す）。 */
  time: string;
  lighting: Required<LightingDef>;
  /** 配置光源。`ShowIn` で消える光源レイヤーの光は**強さ 0**（並びはマップのまま。混ぜるため）。 */
  lights: PointLightDef[];
  cameraFx: Required<CameraFxDef>;
  view: GameViewDef;
}

/**
 * その時間帯で使うプリセット。使わない時間帯は `fallback`（マップの台帳。GS-223）の代わりの時間帯を使い、
 * それも無い・使わないなら null（基準）。代わりはたどるのは 1 回だけ（代わりの代わりは見ない）。
 */
export function resolvePreset(
  map: Pick<MapDef, 'lightingPresets'>,
  time: string,
  fallback?: Readonly<Record<string, string>>,
): LightingPresetDef | null {
  const own = activePreset(map, time);
  if (own || !time) return own;
  const instead = fallback?.[time];
  return instead ? activePreset(map, instead) : null;
}

/**
 * その時間帯のマップの見た目を組む。使うプリセットが無い時間帯は `fallback` の代わり、
 * それも無ければ**基準そのもの**（このとき `time` は '' で、出し分けもかけない）。
 * 代わりを使うときの `time` は代わりの id（出し分けも代わりの時間帯で）。
 */
export function timeLookOf(map: MapDef, time: string, fallback?: Readonly<Record<string, string>>): TimeLook {
  const preset = resolvePreset(map, time, fallback);
  const shown = preset ? preset.id : '';
  const lights = presetPointLights(map.pointLights ?? [], preset).map((entry) => {
    if (entry.kind === 'group' || !entry.parent) return entry;
    return layerShownAtTime(map.layers, entry.parent, shown) ? entry : { ...entry, intensity: 0 };
  });
  return {
    time: shown,
    lighting: resolveLighting(presetLighting(map.lighting ?? {}, preset)),
    lights,
    cameraFx: resolveCameraFx(presetCameraFx(map.camera ?? {}, preset)),
    view: presetView(map.view ?? {}, preset),
  };
}

/**
 * 時間帯の見た目で組むためのマップ（GS-224）。**いつも新しい入れ物を返し、`map` は書き換えない。**
 * `map` の光・空・書き割りは基準で、次の時間帯もそこから組む。上書きすると、絵を持たない時間帯
 * （0102 の昼など）が組んだときの時間帯の絵（夜空）を基準と思って使い続ける。
 */
export function withTimeLook(map: MapDef, look: TimeLook): MapDef {
  return { ...map, lighting: look.lighting, camera: look.cameraFx, view: look.view, pointLights: look.lights };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 角度（度）を近いほうへ回して混ぜる。返す値は 0..360。 */
function lerpAngle(a: number, b: number, t: number): number {
  const turn = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + turn * t) % 360) + 360) % 360;
}

/** `#rrggbb`（`#` 無しも可）を混ぜる。返す形は `from` に合わせる。 */
function mixHex(from: string, to: string, t: number): string {
  const sharp = from.startsWith('#');
  const a = new Color(`#${from.replace(/^#/, '')}`);
  const b = new Color(`#${to.replace(/^#/, '')}`);
  const hex = a.lerp(b, t).getHexString();
  return sharp ? `#${hex}` : hex;
}

/**
 * 2 つの見た目の間（`t` は 0..1）。**数と色・光の方位と高さは混ぜ、それ以外（入切・絵・出し分け）は半分で切り替える。**
 * 方位は近いほうへ回す（350° → 10° は 0° をまたぐ）。影は切り替えの間だけ毎フレーム焼き直す（GS-225）。
 * 影や雲・フォグを片方だけ出す時間帯へ移るときは、出していない側の濃さを 0 とみなして混ぜる（ぱっと出ない）。
 * 書き割りの絵は呼ぶ側が重ねて入れ替える（`backdropFade`）。
 */
export function blendTimeLook(from: TimeLook, to: TimeLook, t: number): TimeLook {
  const k = Math.min(1, Math.max(0, t));
  const near = k < 0.5 ? from : to;
  const a = from.lighting;
  const b = to.lighting;
  const shadowA = a.blockShadow ? a.blockShadowStrength : 0;
  const shadowB = b.blockShadow ? b.blockShadowStrength : 0;
  const cloudA = a.cloudShadow ? a.cloudShadowAmount : 0;
  const cloudB = b.cloudShadow ? b.cloudShadowAmount : 0;
  const lighting: Required<LightingDef> = {
    ...near.lighting,
    // 方位と高さも混ぜる（GS-225）。影が切り替えの時間をかけて回る。
    azimuth: lerpAngle(a.azimuth, b.azimuth, k),
    elevation: lerp(a.elevation, b.elevation, k),
    ambient: lerp(a.ambient, b.ambient, k),
    intensity: lerp(a.intensity, b.intensity, k),
    wrap: lerp(a.wrap, b.wrap, k),
    billboard: lerp(a.billboard, b.billboard, k),
    ambientColor: mixHex(a.ambientColor, b.ambientColor, k),
    sunColor: mixHex(a.sunColor, b.sunColor, k),
    blockShadow: a.blockShadow || b.blockShadow,
    blockShadowStrength: lerp(shadowA, shadowB, k),
    cloudShadow: a.cloudShadow || b.cloudShadow,
    cloudShadowAmount: lerp(cloudA, cloudB, k),
    cloudShadowScale: lerp(a.cloudShadowScale, b.cloudShadowScale, k),
    cloudShadowSpeed: lerp(a.cloudShadowSpeed, b.cloudShadowSpeed, k),
  };
  const lights = from.lights.map((entry, index) => {
    const other = to.lights[index];
    if (!other || entry.kind === 'group') return near.lights[index] ?? entry;
    return { ...near.lights[index]!, intensity: lerp(entry.intensity ?? 0.7, other.intensity ?? 0.7, k) };
  });
  const fa = from.cameraFx;
  const fb = to.cameraFx;
  const cameraFx: Required<CameraFxDef> = {
    ...near.cameraFx,
    fog: fa.fog || fb.fog,
    fogColor: mixHex(fa.fogColor, fb.fogColor, k),
    fogNear: lerp(fa.fogNear, fb.fogNear, k),
    fogFar: lerp(fa.fogFar, fb.fogFar, k),
    fogMax: lerp(fa.fog ? fa.fogMax : 0, fb.fog ? fb.fogMax : 0, k),
    skyGain: lerp(fa.skyGain, fb.skyGain, k),
  };
  const ba = from.view.backdrop;
  const bb = to.view.backdrop;
  const view: GameViewDef =
    ba && bb
      ? { ...near.view, backdrop: { ...ba, gain: lerp(ba.gain ?? 1, bb.gain ?? 1, k) } }
      : near.view;
  return { time: near.time, lighting, lights, cameraFx, view };
}

/**
 * 書き割りの絵を重ねて入れ替えるか（GS-222）。前と次で絵が違えば、次の絵（形・位置は同じ）と濃さを返す。
 * 呼ぶ側は前の絵の上に次の絵を `amount` の濃さで重ねる。終わったら前の絵を次の絵へ差し替えて重ねを外す。
 */
export function backdropFade(
  from: TimeLook,
  to: TimeLook,
  t: number,
): { next: NonNullable<GameViewDef['backdrop']>; amount: number } | null {
  const a = from.view.backdrop;
  const b = to.view.backdrop;
  if (!a?.src || !b?.src || a.src === b.src) return null;
  const k = Math.min(1, Math.max(0, t));
  return { next: { ...b, gain: lerp(a.gain ?? 1, b.gain ?? 1, k) }, amount: k };
}
