import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Sphere, SphereGeometry, TorusGeometry, Vector3 } from 'three';

/** 地面を原点にした立体の光柱。円筒・足元の輪・上昇する光粒を1メッシュへまとめる。 */
export function createLightPillarGeometry(): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], parts: number[] = [], seeds: number[] = [];
  const add = (source: BufferGeometry, part: number, seed = 0) => {
    const g = source.toNonIndexed();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      parts.push(part); seeds.push(seed);
    }
    g.dispose(); source.dispose();
  };
  for (let i = 0; i < 3; i++) {
    const radius = [0.10, 0.25, 0.42][i];
    const tube = new CylinderGeometry(radius * 0.65, radius, 1, 48, 12, true);
    tube.translate(0, 0.5, 0);
    add(tube, 0, i);
  }
  for (let i = 0; i < 2; i++) {
    const ring = new TorusGeometry(0.65 + i * 0.25, 0.014, 6, 96);
    ring.rotateX(-Math.PI / 2); ring.translate(0, 0.02, 0);
    add(ring, 1, i);
  }
  for (let i = 0; i < 36; i++) {
    const spark = new SphereGeometry(1, 6, 4);
    spark.scale(0.013, 0.035, 0.013);
    add(spark, 2, i);
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  result.setAttribute('pillarPart', new Float32BufferAttribute(parts, 1));
  result.setAttribute('pillarSeed', new Float32BufferAttribute(seeds, 1));
  // 上昇する粒を含む。GPUで動かすため静止頂点からは求めない。
  result.boundingSphere = new Sphere(new Vector3(0, 0.5, 0), 1.1);
  return result;
}

export const lightPillarVertexShader = `
uniform float time;
uniform float speed;
uniform float scale;
attribute float pillarPart;
attribute float pillarSeed;
varying vec3 pillarNormal;
varying vec3 pillarView;
varying vec3 pillarLocal;
varying float pillarAlpha;
varying float pillarKind;
varying float pillarLayer;
void main() {
  float t = mod(time * speed, 4.0);
  float rise = smoothstep(0.2, 1.25, t);
  float fade = 1.0 - smoothstep(2.7, 3.5, t);
  vec3 p = position;
  pillarKind = pillarPart;
  pillarLayer = pillarSeed;
  pillarLocal = position;
  if (pillarPart < 0.5) {
    p.y *= rise;
    p.xz *= 0.8 + 0.2 * rise;
    pillarAlpha = rise * fade;
  } else if (pillarPart < 1.5) {
    p.xz *= 0.55 + 0.45 * smoothstep(0.0, 0.8, t);
    pillarAlpha = smoothstep(0.0, 0.18, t) * fade;
  } else {
    float age = fract(t * (0.4 + fract(pillarSeed * 0.37) * 0.3) + pillarSeed * 0.618);
    float a = pillarSeed * 2.399963 + t * 0.7;
    float radius = 0.24 + fract(pillarSeed * 0.73) * 0.40;
    p += vec3(cos(a) * radius, 0.04 + age * 0.90, sin(a) * radius);
    pillarAlpha = rise * fade * sin(age * 3.141593) * step(pillarSeed, min(35.0, 11.0 + scale * 12.0));
  }
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  pillarNormal = normalize(normalMatrix * normal);
  pillarView = -viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const lightPillarFragmentShader = `
precision highp float;
uniform vec3 tint;
uniform float amount;
uniform float time;
uniform float speed;
uniform float scale;
varying vec3 pillarNormal;
varying vec3 pillarView;
varying vec3 pillarLocal;
varying float pillarAlpha;
varying float pillarKind;
varying float pillarLayer;
void main() {
  float alpha = pillarAlpha * amount;
  vec3 colour = tint;
  if (pillarKind < 0.5) {
    float facing = abs(dot(normalize(pillarNormal), normalize(pillarView)));
    float angle = atan(pillarLocal.z, pillarLocal.x);
    float streak = pow(0.5 + 0.5 * sin(angle * floor(8.0 + scale * 8.0) + pillarLocal.y * 6.0 - time * speed * 4.0), 5.0);
    float top = 1.0 - smoothstep(0.65, 1.0, pillarLocal.y);
    alpha *= top * (0.18 + 0.35 * facing + 0.35 * streak) / (1.0 + pillarLayer * 0.55);
    colour = mix(tint, vec3(0.96, 0.8, 1.0), (1.0 - step(0.5, pillarLayer)) * 0.55);
  } else if (pillarKind < 1.5) {
    float angle = atan(pillarLocal.z, pillarLocal.x);
    alpha *= 0.5 + 0.5 * pow(0.5 + 0.5 * sin(angle * 12.0 - time * speed * 3.0), 3.0);
  } else {
    colour = mix(tint, vec3(1.0, 0.82, 1.0), 0.35);
  }
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(colour, min(alpha, 1.0));
}
`;
