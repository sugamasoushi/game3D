// コマンド戦闘の床のマスを描く（2026-11-09 / GS-342）。線の並びと決まりは `game/battle/floorGrid.ts`。
//
// - 黒い線: 床に寝かせた細い帯（1 画素の線はチルトシフトのぼかしで消えるので帯にする。エディタのマスの線と同じ理由）。
// - 白い光: 奥行きの線を、明るい頭と手前へ伸びる尾で手前から奥へ走る。**いつ・どの線を走るかはくじ**（GS-343）:
//   線ごとに周期を区切り、区切りごとに走るか・いつ走り出すか・速さを、線の番号と区切りの番号から決める（毎フレーム同じ答え）。
//   横の線は、光が交わる所を通るときだけその辺りが光る。にじみ（幅の広い帯・足し算の色）を下に重ねる。
// - 敵の立つマス（GS-343）: 赤い縁と脈打つ塗り。倒れたら消える。
// - 両端は薄くして床へなじませる。出し入れは `fade`（0〜1）。

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
} from 'three';
import {
  FLOOR_GRID_GLOW_WIDTH,
  FLOOR_GRID_LINE_WIDTH,
  FLOOR_GRID_PERIOD_S,
  FLOOR_GRID_RUN_CHANCE,
  FLOOR_GRID_RUN_SHARE,
  type FloorGridLine,
} from '../game/battle/floorGrid';

type Point = [number, number, number];

export interface BattleFloorGrid {
  group: Group;
  /** 時間（秒）と濃さ（0〜1）を渡す。濃さ 0 なら描かない。 */
  update(time: number, fade: number): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute float aCol;
attribute float aRow;
attribute float aU;
attribute float aSide;
attribute float aWeight;
attribute float aKind;
attribute vec3 aCenter;
uniform vec2 uViewport;
uniform float uMinPx;
varying float vCol;
varying float vRow;
varying float vU;
varying float vSide;
varying float vWeight;
varying float vKind;
varying float vCover;
// 遠くで帯が 1 画素より細くなると、画素に当たったり外れたりしてチラつく（GS-344）。
// 画面で半幅が uMinPx 画素に満たなければ広げ、その分だけ薄くする（見た目の濃さは保つ）。
void main() {
  vCol = aCol; vRow = aRow; vU = aU; vSide = aSide; vWeight = aWeight; vKind = aKind;
  vec4 c = projectionMatrix * modelViewMatrix * vec4(aCenter, 1.0);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float px = length((p.xy / p.w - c.xy / c.w) * 0.5 * uViewport);
  float k = px > 0.0001 ? max(1.0, uMinPx / px) : 1.0;
  vCover = 1.0 / k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(aCenter + (position - aCenter) * k, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uGlow;
uniform float uFront;
uniform float uBack;
uniform vec3 uLine;
uniform vec3 uLight;
varying float vCol;
varying float vRow;
varying float vU;
varying float vSide;
varying float vWeight;
varying float vKind;
varying float vCover;
float hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
// 奥行きの線（横の番号 col）の光の明るさ。t は手前 0・奥 1。
float streak(float col, float t) {
  float cycle = uTime / ${FLOOR_GRID_PERIOD_S.toFixed(3)} + hash(col * 3.7) * 9.0;
  float n = floor(cycle);
  float f = fract(cycle);
  float seed = col * 13.1 + n * 7.3;
  if (hash(seed) > ${FLOOR_GRID_RUN_CHANCE.toFixed(3)}) return 0.0;
  float share = ${FLOOR_GRID_RUN_SHARE.toFixed(3)} * (0.75 + 0.5 * hash(seed + 2.9));
  float start = hash(seed + 1.3) * (1.0 - share);
  // 頭は奥の端の先（1.6）まで進め、尾が奥へ抜けきってから次の区切りへ移る（途中でぷつっと消えない。GS-344）。
  float head = (f - start) / share * 1.85 - 0.25;
  float d = head - t;
  float fade = 1.0 - smoothstep(1.2, 1.6, head);
  return fade * (d >= 0.0 ? exp(-d * 6.0) : exp(d * 30.0));
}
void main() {
  float ends = smoothstep(0.0, 0.08, vU) * smoothstep(1.0, 0.92, vU);
  // 縁は画素の幅でなめらかに（ギザギザが動いてチラつかないよう）。
  float aa = max(fwidth(vSide), 0.0001);
  float edge = clamp((1.0 - abs(vSide)) / (aa * 1.5), 0.0, 1.0);
  float t = (uFront - vRow) / (uFront - uBack);
  float light;
  // 線の番号は半端（x.5）。画素ごとに補間で僅かにずれる（2.4999…）と、くじの答えが画素ごとに変わって粒のように見える（GS-345）。
  // くじに渡す前に、必ず同じ x.5 へ丸める。
  if (vKind < 0.5) {
    light = streak(floor(vCol) + 0.5, t);
  } else {
    // 横の線: 両隣の奥行きの線の光が交わる所を通るとき、その辺りだけ光る。左右を足すので、マスの真ん中で切れない。
    float left = floor(vCol - 0.5) + 0.5;
    float dl = vCol - left;
    float dr = left + 1.0 - vCol;
    light = 0.8 * (streak(left, t) * exp(-dl * dl * 6.0) + streak(left + 1.0, t) * exp(-dr * dr * 6.0));
  }
  light *= vWeight;
  if (uGlow > 0.5) {
    float soft = pow(max(0.0, 1.0 - abs(vSide)), 2.0);
    gl_FragColor = vec4(uLight * light * soft * ends * uFade * 1.4 * vCover, 1.0);
  } else {
    vec3 color = mix(uLine, uLight, clamp(light, 0.0, 1.0));
    // 黒い線は外側でも薄くしない（GS-346。奥の端の線が消えていた）。両端のぼかしも短く、遠くで細い分の薄め方も弱める。
    // 外側ほど薄くするのは白い光だけ。
    float tips = smoothstep(0.0, 0.015, vU) * smoothstep(1.0, 0.985, vU);
    float black = 0.6 * tips * sqrt(vCover);
    float alpha = max(black, light * ends * vCover) * edge * uFade;
    gl_FragColor = vec4(color, alpha);
  }
}
`;

/** 周期の区切りの番号が大きくなりすぎない（GPU の sin の精度が落ちない）よう、時間を折り返す長さ（秒）。 */
const TIME_WRAP_S = FLOOR_GRID_PERIOD_S * 512;

/**
 * 床のマスを作る。`point(col, row)` はマスの番号を床の点（ワールド）へ直す口、`width` は戦闘のマス 1 つのワールドの長さ。
 * `rows` は奥行きの線の手前の端と奥の端の番号（光の 0 と 1）。`order` は描く順（敵・味方の板より前にする）。
 */
export function createBattleFloorGrid(
  lines: FloorGridLine[],
  point: (col: number, row: number) => Point,
  width: number,
  rows: { front: number; back: number },
  order: number,
): BattleFloorGrid {
  const build = (half: number) => {
    const position: number[] = [];
    const center: number[] = [];
    const attr = { aCol: [] as number[], aRow: [] as number[], aU: [] as number[], aSide: [] as number[], aWeight: [] as number[], aKind: [] as number[] };
    for (const line of lines) {
      const a = point(line.from.col, line.from.row);
      const b = point(line.to.col, line.to.row);
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dz) || 1;
      const ox = (-dz / length) * half;
      const oz = (dx / length) * half;
      const corner = (end: 0 | 1, side: -1 | 1) => {
        const p = end ? b : a;
        const at = end ? line.to : line.from;
        position.push(p[0] + ox * side, p[1], p[2] + oz * side);
        center.push(p[0], p[1], p[2]);
        attr.aCol.push(at.col);
        attr.aRow.push(at.row);
        attr.aU.push(end);
        attr.aSide.push(side);
        attr.aWeight.push(line.weight);
        attr.aKind.push(line.kind === 'depth' ? 0 : 1);
      };
      // 三角形 2 枚。
      corner(0, 1); corner(1, 1); corner(1, -1);
      corner(0, 1); corner(1, -1); corner(0, -1);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
    geometry.setAttribute('aCenter', new Float32BufferAttribute(center, 3));
    for (const [name, values] of Object.entries(attr)) geometry.setAttribute(name, new Float32BufferAttribute(values, 1));
    return geometry;
  };
  const material = (glow: boolean) => new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uGlow: { value: glow ? 1 : 0 },
      uFront: { value: rows.front },
      uBack: { value: rows.back === rows.front ? rows.front - 1 : rows.back },
      uViewport: { value: new Vector2(1, 1) },
      // 半幅の最小（画素）。芯は 0.75（幅 1.5 画素）、にじみは 2。
      uMinPx: { value: glow ? 2 : 0.75 },
      uLine: { value: new Color(0x050608) },
      uLight: { value: new Color(0xf2f8ff) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    blending: glow ? AdditiveBlending : NormalBlending,
  });
  // にじみを先に（下に）、黒い線と光の芯を上に。
  const glow = new Mesh(build((FLOOR_GRID_GLOW_WIDTH * width) / 2), material(true));
  const core = new Mesh(build((FLOOR_GRID_LINE_WIDTH * width) / 2), material(false));
  glow.renderOrder = order - 1;
  core.renderOrder = order;
  // 描く直前に画面の画素数を渡す（帯の最小の太さを画素で決めるため）。
  const size = new Vector2();
  for (const mesh of [glow, core]) {
    mesh.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(size);
      (mesh.material as ShaderMaterial).uniforms.uViewport.value.copy(size);
    };
  }
  const group = new Group();
  group.add(glow, core);
  group.visible = false;
  const meshes = [glow, core];
  return {
    group,
    update(time, fade) {
      group.visible = fade > 0.001;
      for (const mesh of meshes) {
        const uniforms = (mesh.material as ShaderMaterial).uniforms;
        uniforms.uTime.value = time % TIME_WRAP_S;
        uniforms.uFade.value = fade;
      }
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as ShaderMaterial).dispose();
      }
    },
  };
}

const MARK_VERTEX = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 赤い縁（内へにじむ）と、ゆっくり脈打つ塗り。真ん中から外へ広がる輪を時々重ねる。
const MARK_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0;
  float box = max(q.x, q.y);
  float border = smoothstep(0.74, 0.92, box) * (1.0 - smoothstep(0.97, 1.0, box));
  float pulse = 0.5 + 0.5 * sin(uTime * 3.2 + uSeed * 6.283);
  float fill = (0.3 + 0.18 * pulse) * (1.0 - smoothstep(0.85, 1.0, box));
  float ring = fract(uTime * 0.6 + uSeed);
  float wave = exp(-pow((box - ring) * 9.0, 2.0)) * (1.0 - ring) * 0.55;
  float alpha = (border * (0.85 + 0.15 * pulse) + fill + wave) * uFade;
  gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.75, 0.75), border * pulse * 0.5), min(1.0, alpha));
}
`;

export interface EnemyCellMark {
  mesh: Mesh;
  /** 時間（秒）と濃さ（0〜1）。 */
  update(time: number, fade: number): void;
  dispose(): void;
}

/**
 * 敵の立つマス 1 つの赤い光（GS-343）。四隅は `corners`（手前左・手前右・奥右・奥左の順、ワールド）。
 * 普通の重ね方（足し算にすると明るい砂地で赤が埋もれる）。
 */
export function createEnemyCellMark(corners: [Point, Point, Point, Point], seed: number, order: number): EnemyCellMark {
  const [a, b, c, d] = corners;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  geometry.setAttribute('aUv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  const material = new ShaderMaterial({
    vertexShader: MARK_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new Color(0xff2a3a) },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = order;
  mesh.visible = false;
  return {
    mesh,
    update(time, fade) {
      mesh.visible = fade > 0.001;
      material.uniforms.uTime.value = time % TIME_WRAP_S;
      material.uniforms.uFade.value = fade;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
