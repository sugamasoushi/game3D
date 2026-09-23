import {
  Color,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  TextureLoader,
  type Scene,
  type Texture,
} from 'three';
import type { CameraFxDef } from './types';

/**
 * カメラ距離の効果（フォグ・チルト）。光源とは別。タイルシェーダ内で処理する。
 */

/** 旧ファイルはオフのまま。当時の見た目を変えない。 */
export const CAMERA_FX_DEFAULTS: Required<CameraFxDef> = {
  background: '1b1f25',
  sky: '',
  skyBlur: 0,
  skyGain: 1,
  skyYaw: 0,
  fog: false,
  fogColor: '1a2740',
  fogNear: 12,
  fogFar: 40,
  fogMax: 0.85,
  tilt: false,
  tiltFocus: 0.55,
  tiltFocusX: 0.5,
  tiltBand: 0.18,
  tiltBandX: 0.34,
  tiltFalloff: 0.9,
  tiltStrength: 0.004,
};

/** ぼけ半径の上限。超えるとゴーストに見える。 */
export const MAX_TILT_STRENGTH = 0.02;

/** 欠落を既定で埋める。 */
export function resolveCameraFx(raw: CameraFxDef | undefined): Required<CameraFxDef> {
  return { ...CAMERA_FX_DEFAULTS, ...(raw ?? {}) };
}

function colorOf(value: string | undefined, fallback: string): Color {
  const text = String(value ?? '').trim().replace(/^#/, '');
  return new Color(`#${/^[0-9a-fA-F]{6}$/.test(text) ? text : fallback}`);
}

export function fogColor(settings: Required<CameraFxDef>): Color {
  return colorOf(settings.fogColor, CAMERA_FX_DEFAULTS.fogColor);
}

/** キャンバスのクリア色。ゲーム側がエディタと同じ背景にするため。 */
export function backgroundColor(settings: Required<CameraFxDef>): Color {
  return colorOf(settings.background, CAMERA_FX_DEFAULTS.background);
}

const SKY_PREFIX = 'assets/backscreen/';

/** `assets/backscreen/` からの相対パス。空ならパノラマなし。 */
export function skyFile(sky: string | undefined): string {
  const name = String(sky ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!name) return '';
  return name.startsWith(SKY_PREFIX) ? name.slice(SKY_PREFIX.length) : name;
}

export function skyUrl(sky: string | undefined): string {
  const rel = skyFile(sky);
  return rel ? `/${SKY_PREFIX}${rel}` : '';
}

type SkyBinder = {
  apply(raw: CameraFxDef | undefined, workColor?: string): void;
  dispose(): void;
};

/** 単色またはパノラマを `scene.background` に載せる。同じ画像ならテクスチャを使い回す。 */
export function createSkyBinder(scene: Scene): SkyBinder {
  const loader = new TextureLoader();
  let gen = 0;
  let url = '';
  let texture: Texture | null = null;

  const paintColor = (fx: Required<CameraFxDef>, raw: CameraFxDef | undefined, workColor?: string) => {
    if (texture) {
      texture.dispose();
      texture = null;
    }
    url = '';
    if (raw?.background) scene.background = backgroundColor(fx);
    else if (workColor) scene.background = new Color(workColor);
    else scene.background = backgroundColor(fx);
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
    scene.backgroundRotation.set(0, 0, 0);
  };

  const paintSky = (fx: Required<CameraFxDef>, tex: Texture) => {
    scene.background = tex;
    scene.backgroundBlurriness = Math.min(Math.max(fx.skyBlur, 0), 1);
    scene.backgroundIntensity = Math.max(fx.skyGain, 0);
    scene.backgroundRotation.set(0, (fx.skyYaw * Math.PI) / 180, 0);
  };

  return {
    apply(raw, workColor) {
      const fx = resolveCameraFx(raw);
      const next = skyUrl(fx.sky);
      if (!next) {
        gen += 1;
        paintColor(fx, raw, workColor);
        return;
      }
      if (next === url && texture) {
        paintSky(fx, texture);
        return;
      }
      const id = ++gen;
      if (!texture) paintColor(fx, raw, workColor);
      loader.load(
        next,
        (tex) => {
          if (id !== gen) {
            tex.dispose();
            return;
          }
          if (texture) texture.dispose();
          texture = tex;
          url = next;
          tex.mapping = EquirectangularReflectionMapping;
          tex.colorSpace = SRGBColorSpace;
          tex.needsUpdate = true;
          paintSky(fx, tex);
        },
        undefined,
        () => {
          if (id !== gen) return;
          paintColor(fx, raw, workColor);
        },
      );
    },
    dispose() {
      gen += 1;
      if (texture) texture.dispose();
      texture = null;
      url = '';
    },
  };
}
