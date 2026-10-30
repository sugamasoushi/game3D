import { BufferGeometry, Float32BufferAttribute, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';

/** 光球・球状衝撃波・交差する輪・全方向の光条を1メッシュにまとめる。画像素材は不要。 */
export function createLightExplosionGeometry(): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], parts: number[] = [], seeds: number[] = [], directions: number[] = [], soft: number[] = [];
  const add = (source: BufferGeometry, part: number, seed = 0, direction = new Vector3(), ringNormal?: Vector3) => {
    const g = source.index ? source.toNonIndexed() : source;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      parts.push(part); seeds.push(seed); directions.push(direction.x, direction.y, direction.z);
      const across = ringNormal ? Math.cos(g.getAttribute('uv').getY(i) * Math.PI * 2) : 0;
      const radial = new Vector3(p.getX(i), p.getY(i), p.getZ(i));
      if (ringNormal) radial.addScaledVector(ringNormal, -radial.dot(ringNormal)).normalize().multiplyScalar(across);
      else radial.set(0,0,0);
      soft.push(radial.x,radial.y,radial.z,across);
    }
    if (g !== source) g.dispose();
    source.dispose();
  };
  add(new SphereGeometry(1, 32, 20), 0);
  add(new SphereGeometry(1, 32, 20), 1);
  for (let i = 0; i < 3; i++) {
    const ring = new TorusGeometry(1, 0.018, 16, 80);
    ring.rotateX(Math.PI / 2 + i * 0.65);
    ring.rotateZ(i * 1.05);
    const ringNormal = new Vector3(0,0,1).applyAxisAngle(new Vector3(1,0,0),Math.PI/2+i*0.65).applyAxisAngle(new Vector3(0,0,1),i*1.05);
    add(ring, 2, i, new Vector3(), ringNormal);
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
  result.setAttribute('ringSoft', new Float32BufferAttribute(soft, 4));
  // 頂点シェーダが外へ広げる範囲を含めて、画面端で消えない境界にする。
  result.computeBoundingSphere();
  result.boundingSphere!.radius = 1.5;
  return result;
}

export const lightExplosionVertexShader = `
uniform float time;
uniform float speed;
uniform float scale;
uniform float ringBlur;
attribute float blastPart;
attribute float blastSeed;
attribute vec3 blastDirection;
attribute vec4 ringSoft;
varying float ringAcross;
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
  ringAcross = ringSoft.w;
  if (blastPart < 0.5) {
    p *= 0.06 + 0.40 * (1.0 - exp(-t * 13.0));
    blastAlpha = exp(-t * 6.0);
  } else if (blastPart < 1.5) {
    p *= 0.08 + 0.83 * expand;
    blastAlpha = (1.0 - smoothstep(0.12, 1.15, t)) * 0.7;
  } else if (blastPart < 2.5) {
    // 光輪を太らせ、広がった分をフラグメント側で滑らかに落とす。
    p += ringSoft.xyz * ringBlur * 0.10;
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
uniform float ringBlur;
varying vec3 blastNormal;
varying vec3 blastView;
varying vec3 blastLocal;
varying float blastAlpha;
varying float blastKind;
varying float ringAcross;
void main() {
  float facing = abs(dot(normalize(blastNormal), normalize(blastView)));
  float rim = pow(1.0 - facing, 2.0);
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
  // 球の縁も光輪の断面も、輪郭へ近づくほど透明にして硬い切れ目をなくす。
  if (blastKind < 1.5) alpha *= mix(1.0, pow(facing, 1.7), ringBlur);
  else if (blastKind < 2.5) alpha *= mix(1.0, exp(-ringAcross*ringAcross*5.0)*(1.0-smoothstep(0.8,1.0,abs(ringAcross))), ringBlur);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(colour, min(1.0, alpha));
}
`;
