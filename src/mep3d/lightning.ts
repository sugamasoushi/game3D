import { FIELD_FLASH_GLOW } from './fieldFlash';

/** 配置した縦面の中で落雷と共通フラッシュを描く。 */
export const lightningFragmentShader = `
precision highp float;
uniform vec3 tint;
uniform float amount;
uniform float speed;
uniform float scale;
uniform float time;
uniform float flashPulse;
uniform float flashCycle;
varying vec2 vUv;
${FIELD_FLASH_GLOW}

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  return length(p - a - d * clamp(dot(p - a, d) / max(dot(d, d), 0.00001), 0.0, 1.0));
}
vec2 boltPoint(float i, float seed) {
  float y = 0.04 + i * 0.076;
  float spread = sin(i / 12.0 * 3.141593);
  return vec2(0.5 + (hash(seed + i * 7.3) - 0.5) * 0.38 * spread, y);
}
void main() {
  // 一撃→短い再放電→余韻→休止。速度0でも最初の一撃を表示する。
  float cycle = flashCycle;
  float flash = flashPulse;
  if (flash * amount < 0.003) discard;
  float seed = cycle * 37.7 + 11.0;
  float mainDistance = 1.0;
  float branchDistance = 1.0;
  for (int i = 0; i < 12; i++) {
    vec2 a = boltPoint(float(i), seed);
    vec2 b = boltPoint(float(i + 1), seed);
    mainDistance = min(mainDistance, segment(vUv, a, b));
  }
  // 枝も根元を幹へつなぐ。細かさで枝の数を変える。
  for (int j = 0; j < 6; j++) {
    if (float(j) >= clamp(scale * 2.0, 1.0, 6.0)) continue;
    float k = float(j);
    vec2 a = boltPoint(4.0 + k, seed);
    float side = mod(k, 2.0) < 0.5 ? -1.0 : 1.0;
    vec2 b = a + vec2(side * (0.08 + hash(seed + k) * 0.06), -0.07);
    vec2 c = b + vec2(side * 0.10, -0.16 - hash(seed + k + 9.0) * 0.08);
    branchDistance = min(branchDistance, min(segment(vUv, a, b), segment(vUv, b, c)));
  }
  float aa = max(length(fwidth(vUv)), 0.0005);
  float core = 1.0 - smoothstep(0.002, 0.004 + aa, mainDistance);
  float branches = 1.0 - smoothstep(0.001, 0.002 + aa, branchDistance);
  float glow = exp(-mainDistance * 95.0) * 0.45 + exp(-branchDistance * 160.0) * 0.18;
  float impact = exp(-length((vUv - vec2(0.5, 0.04)) * vec2(1.0, 2.5)) * 30.0);
  float edge = smoothstep(0.0, 0.025, vUv.y) * (1.0 - smoothstep(0.96, 1.0, vUv.y));
  float bolt = (core + branches * 0.65 + glow + impact * 0.7) * edge;
  float localFlash = fieldFlashGlow(vUv, 1.5) * 0.4;
  float alpha = clamp((bolt + localFlash) * flash * amount, 0.0, 1.0);
  if (alpha < 0.003) discard;
  vec3 colour = mix(tint, vec3(1.0), clamp(core * 0.85 + branches * 0.45, 0.0, 0.9));
  gl_FragColor = vec4(colour, alpha);
}
`;
