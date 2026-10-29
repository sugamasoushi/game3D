/** 雷と単独フラッシュの共通時計。速さ0は最初の発光を静止表示する。 */
export function fieldFlashState(seconds: number, speed: number): { cycle: number; pulse: number } {
  const clock = Math.max(0, seconds) * Math.max(0, speed);
  const cycle = Math.floor(clock / 3.2);
  const t = clock - cycle * 3.2;
  const pulse = Math.exp(-t * 22)
    + (t >= 0.16 ? Math.exp(-(t - 0.16) * 28) * 0.65 : 0)
    + (t >= 0.31 ? Math.exp(-(t - 0.31) * 18) * 0.35 : 0);
  return { cycle, pulse };
}

/** 範囲の外周をぼかした発光。雷もこの関数を使う。 */
export const FIELD_FLASH_GLOW = `
float fieldFlashGlow(vec2 uv, float spread) {
  vec2 edge = min(uv, 1.0 - uv);
  float fade = smoothstep(0.0, 0.16, edge.x) * smoothstep(0.0, 0.16, edge.y);
  float radius = length((uv - 0.5) * vec2(1.0, 0.8));
  return exp(-radius * radius * 5.0 / max(spread, 0.2)) * fade;
}
`;

export const fieldFlashFragmentShader = `
precision highp float;
uniform vec3 tint;
uniform float amount;
uniform float scale;
uniform float flashPulse;
varying vec2 vUv;
${FIELD_FLASH_GLOW}
void main() {
  float alpha = fieldFlashGlow(vUv, scale) * flashPulse * amount;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(tint, min(alpha, 1.0));
}
`;
