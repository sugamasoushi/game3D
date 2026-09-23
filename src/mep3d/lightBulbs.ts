// 光の玉（DEC-314）。点光源の位置に置く「電球」の見た目。光そのものは点光源が出す。

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { emittingPointLights, lightColorLinear, pulseTriple } from './lighting';
import { LIGHT_PULSE_GLSL } from './material';
import type { PointLightDef } from './types';

/**
 * 光の玉（DEC-314）。
 *
 * 点光源は明るさを配るだけで**姿が無い**。ランタンや焚き火を置いても、
 * 照らされた壁は見えるのに光源そのものは見えない。玉はその姿。
 *
 * **カメラを向く板 1 枚**を光源ごとに 1 枚。中心が白く、外へ向かって色が薄れる。
 * 加算で重ねるので、下地が明るいほど白飛びして「光っている」ように見える。
 * 点滅・ゆらめきは**タイルと同じ式**（`lightPulseAt`）を共有するので拍がずれない。
 *
 * 奥行きは**読むが書かない**。壁の裏へ回れば隠れるが、玉どうしは重ねて足せる。
 */
export interface LightBulbs {
  mesh: Mesh;
  /** 光源の一覧を差し替える。板を組み直す。 */
  setLights(lights: PointLightDef[] | undefined, unit: number): void;
  /** 点滅・ゆらめきの時計（秒）。タイルの `lightTime` と同じ値を渡す。 */
  setTime(seconds: number): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
attribute vec2 corner;
attribute float bulbSize;
attribute vec3 bulbColor;
attribute vec3 bulbPulse;
attribute float bulbPhase;
uniform float lightTime;
${LIGHT_PULSE_GLSL}
varying vec2 vCorner;
varying vec3 vColor;

void main() {
  vCorner = corner;
  vColor = bulbColor * lightPulseAt(bulbPulse, bulbPhase);
  // カメラを向く板。視野の右と上は view 行列の列から取る。
  vec3 right = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
  vec3 up = vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
  vec3 world = position + (right * corner.x + up * corner.y) * bulbSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;

void main() {
  float d = length(vCorner);
  if (d >= 1.0) discard;
  // 外側のにじみ。端でちょうど 0 になるので縁が出ない。
  float halo = pow(1.0 - d, 2.6);
  // 中心の芯。色より白へ寄せて、明るさが振り切れた感じを出す。
  float core = smoothstep(0.42, 0.0, d);
  vec3 rgb = vColor * halo + mix(vColor, vec3(1.0), 0.6) * core * 1.5;
  gl_FragColor = vec4(rgb, 1.0);
}
`;

/** 板 1 枚ぶんの角。2 枚の三角で 6 頂点。 */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
] as const;

export function createLightBulbs(): LightBulbs {
  const material = new ShaderMaterial({
    uniforms: { lightTime: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    // 光なので足す。奥行きは読むが書かない——玉どうしは重ねたい。
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const geometry = new BufferGeometry();
  const mesh = new Mesh(geometry, material);
  mesh.name = 'lightBulbs';
  mesh.visible = false;
  // 地形より後。水面（4 / 8）より前なので、水にも映り込む。
  mesh.renderOrder = 3;
  /*
   * **視錐台の判定を切る**。頂点の座標は光源の**中心**で、板はシェーダで広げるので、
   * three が組む境界球は玉の大きさを知らない。画面の端の玉が丸ごと消える。
   */
  mesh.frustumCulled = false;

  const setLights = (lights: PointLightDef[] | undefined, unit: number) => {
    const scale = unit > 0 ? unit : 1;
    // 位相はタイルの uniform 並びと同じ添字で決まる（DEC-294）。同じ一覧から取る。
    const list = emittingPointLights(lights);
    const shown: Array<{ entry: PointLightDef; index: number }> = [];
    list.forEach((entry, index) => {
      if ((entry.bulb ?? 0) > 0) shown.push({ entry, index });
    });
    const count = shown.length;
    mesh.visible = count > 0;
    if (count === 0) {
      geometry.setDrawRange(0, 0);
      return;
    }
    const verts = count * CORNERS.length;
    const position = new Float32Array(verts * 3);
    const corner = new Float32Array(verts * 2);
    const size = new Float32Array(verts);
    const colour = new Float32Array(verts * 3);
    const pulse = new Float32Array(verts * 3);
    const phase = new Float32Array(verts);
    let v = 0;
    for (const { entry, index } of shown) {
      const rgb: Vector3 = lightColorLinear(entry.color);
      const gain = Math.max(0, entry.bulbGain ?? 1);
      const [pulseKind, speed, amount] = pulseTriple(entry);
      // 大きさは直径（マス）。板は ±1 で作るので半分にして渡す。
      const radius = ((entry.bulb ?? 0) * scale) / 2;
      for (const [cx, cy] of CORNERS) {
        position[v * 3] = entry.x * scale;
        position[v * 3 + 1] = entry.y * scale;
        position[v * 3 + 2] = entry.z * scale;
        corner[v * 2] = cx;
        corner[v * 2 + 1] = cy;
        size[v] = radius;
        colour[v * 3] = rgb.x * gain;
        colour[v * 3 + 1] = rgb.y * gain;
        colour[v * 3 + 2] = rgb.z * gain;
        pulse[v * 3] = pulseKind;
        pulse[v * 3 + 1] = speed;
        pulse[v * 3 + 2] = amount;
        phase[v] = index * 1.73;
        v += 1;
      }
    }
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('corner', new BufferAttribute(corner, 2));
    geometry.setAttribute('bulbSize', new BufferAttribute(size, 1));
    geometry.setAttribute('bulbColor', new BufferAttribute(colour, 3));
    geometry.setAttribute('bulbPulse', new BufferAttribute(pulse, 3));
    geometry.setAttribute('bulbPhase', new BufferAttribute(phase, 1));
    geometry.setDrawRange(0, verts);
  };

  return {
    mesh,
    setLights,
    setTime(seconds) {
      material.uniforms.lightTime.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
