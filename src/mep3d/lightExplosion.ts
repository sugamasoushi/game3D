import { BufferGeometry, Float32BufferAttribute, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';

/** 光球・球状衝撃波・交差する輪・全方向の光条を1メッシュにまとめる。画像素材は不要。 */
export function createLightExplosionGeometry(): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], parts: number[] = [], seeds: number[] = [], directions: number[] = [];
  const add = (source: BufferGeometry, part: number, seed = 0, direction = new Vector3()) => {
    const g = source.index ? source.toNonIndexed() : source;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      parts.push(part); seeds.push(seed); directions.push(direction.x, direction.y, direction.z);
    }
    if (g !== source) g.dispose();
    source.dispose();
  };
  add(new SphereGeometry(1, 32, 20), 0);
  add(new SphereGeometry(1, 32, 20), 1);
  for (let i = 0; i < 3; i++) {
    const ring = new TorusGeometry(1, 0.018, 6, 80);
    ring.rotateX(Math.PI / 2 + i * 0.65);
    ring.rotateZ(i * 1.05);
    add(ring, 2, i);
  }
  for (let i = 0; i < 40; i++) {
    const y = 1 - 2 * (i + 0.5) / 40;
    const angle = i * 2.399963;
    const direction = new Vector3(Math.cos(angle) * Math.sqrt(1 - y * y), y, Math.sin(angle) * Math.sqrt(1 - y * y));
    const ray = new SphereGeometry(1, 6, 4);
    ray.scale(0.009, 0.009, 0.12 + (i % 5) * 0.015);
    ray.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), direction));
    add(ray, 3, i, direction);
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  result.setAttribute('blastPart', new Float32BufferAttribute(parts, 1));
  result.setAttribute('blastSeed', new Float32BufferAttribute(seeds, 1));
  result.setAttribute('blastDirection', new Float32BufferAttribute(directions, 3));
  // 頂点シェーダが外へ広げる範囲を含めて、画面端で消えない境界にする。
  result.computeBoundingSphere();
  result.boundingSphere!.radius = 1.5;
  return result;
}

export const lightExplosionVertexShader = `
uniform float time;
uniform float speed;
uniform float scale;
attribute float blastPart;
attribute float blastSeed;
attribute vec3 blastDirection;
varying vec3 blastNormal;
varying vec3 blastView;
varying vec3 blastLocal;
varying float blastAlpha;
varying float blastKind;
void main() {
  float t = mod(time * speed, 3.0);
  float expand = 1.0 - exp(-t * 5.0);
  vec3 p = position;
  blastKind = blastPart;
  blastLocal = position;
  if (blastPart < 0.5) {
    p *= 0.06 + 0.40 * (1.0 - exp(-t * 13.0));
    blastAlpha = exp(-t * 6.0);
  } else if (blastPart < 1.5) {
    p *= 0.08 + 0.83 * expand;
    blastAlpha = (1.0 - smoothstep(0.12, 1.15, t)) * 0.7;
  } else if (blastPart < 2.5) {
    float delay = blastSeed * 0.07;
    float age = max(0.0, t - delay);
    p *= 0.04 + (1.0 + blastSeed * 0.12) * (1.0 - exp(-age * 4.0));
    blastAlpha = step(delay, t) * (1.0 - smoothstep(0.3, 1.45, age));
  } else {
    float travel = (0.72 + fract(blastSeed * 0.618) * 0.42) * (1.0 - exp(-t * 3.4));
    p = p * (0.2 + expand) + blastDirection * travel;
    blastAlpha = (1.0 - smoothstep(0.25, 1.7, t)) * step(blastSeed, min(40.0, 16.0 + scale * 12.0));
  }
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  blastNormal = normalize(normalMatrix * normal);
  blastView = -viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const lightExplosionFragmentShader = `
precision highp float;
uniform vec3 tint;
uniform float amount;
uniform float time;
uniform float speed;
varying vec3 blastNormal;
varying vec3 blastView;
varying vec3 blastLocal;
varying float blastAlpha;
varying float blastKind;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(blastNormal), normalize(blastView))), 2.0);
  float alpha = blastAlpha * amount;
  vec3 colour = tint * 1.35;
  if (blastKind < 0.5) {
    alpha *= 0.75 + rim;
    colour = mix(tint, vec3(1.0, 0.88, 1.0), 0.8);
  } else if (blastKind < 1.5) {
    float veins = pow(0.5 + 0.5 * sin(blastLocal.y * 32.0 + sin(blastLocal.x * 23.0) * 2.0 + time * speed * 9.0), 6.0);
    alpha *= 0.08 + rim * 0.9 + veins * 0.2;
  } else if (blastKind > 2.5) {
    colour = mix(tint, vec3(1.0, 0.8, 1.0), 0.35);
  }
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(colour, min(1.0, alpha));
}
`;
