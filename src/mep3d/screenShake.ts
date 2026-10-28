import type { ScreenEffectDef } from './types';

export const SCREEN_SHAKE_DEFAULT_AMOUNT = 0.3;
export const SCREEN_SHAKE_DEFAULT_SPEED = 1;
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

/** UVの移動量。複数の揺れを合算し、画面外を読まない余白も返す。 */
export function screenShakeOffset(list: readonly ScreenEffectDef[], seconds: number, weights?: ReadonlyMap<string, number>) {
  let x = 0, y = 0, margin = 0;
  const t = Math.max(0, finite(seconds, 0));
  for (const entry of list) {
    if (entry.kind !== 'shake') continue;
    const weight = Math.max(0, finite(weights?.get(entry.id) ?? (entry.on === false ? 0 : 1), 0));
    const amount = Math.min(1, Math.max(0, finite(entry.amount ?? SCREEN_SHAKE_DEFAULT_AMOUNT, 0))) * weight;
    const speed = Math.max(0, finite(entry.speed ?? SCREEN_SHAKE_DEFAULT_SPEED, 0));
    if (amount <= 0 || speed === 0) continue;
    const phase = [...entry.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) * 0.13;
    const a = Math.min(1, amount) * 0.025;
    x += (Math.sin(t * speed * 53 + phase) * 0.65 + Math.sin(t * speed * 89 + phase) * 0.35) * a;
    y += (Math.sin(t * speed * 71 + phase) * 0.65 + Math.sin(t * speed * 41 + phase) * 0.35) * a * 0.6;
    margin += a;
  }
  margin = Math.min(0.025, margin);
  return { x: Math.max(-margin, Math.min(margin, x)), y: Math.max(-margin, Math.min(margin, y)), margin };
}

export const screenShakeFragmentShader = `
precision highp float;
uniform sampler2D sceneMap;
uniform vec2 shakeOffset;
uniform float shakeMargin;
varying vec2 vUv;
void main() {
  // 少し内側を読むことで、揺れた端に黒帯が出るのを防ぐ。
  vec2 uv = (vUv - 0.5) * (1.0 - 2.0 * shakeMargin) + 0.5 + shakeOffset;
  gl_FragColor = texture2D(sceneMap, uv);
}
`;
