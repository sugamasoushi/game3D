import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { Color } from 'three';
import { CAMERA_FX_DEFAULTS } from './camera';
import type { CameraFxDef } from './types';

/**
 * チルトシフト。シャープ楕円の外をぼかす。フォグと違いポストプロセス。
 *
 * **カメラ演出の色被せ（veil。DEC-388）もここで塗る。** 絵の上に 1 枚かぶせるだけなので
 * 場所は最後の 1 回描くところが素直で、**3 プロジェクトとも同じ道**になる
 * （画面の HTML に重ねると、エディタとゲームで作りが分かれる）。
 */

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 texelSize;
uniform vec2 tiltFocus;
uniform vec2 tiltBand;
uniform float tiltFalloff;
uniform float tiltStrength;
varying vec2 vUv;

// 中心＋内外 6 点。1 リングだと半径が大きいとき隙間が筋になる。
const vec2 TAPS[13] = vec2[13](
  vec2(0.0, 0.0),
  vec2(0.500, 0.000), vec2(0.250, 0.433), vec2(-0.250, 0.433),
  vec2(-0.500, 0.000), vec2(-0.250, -0.433), vec2(0.250, -0.433),
  vec2(1.000, 0.000), vec2(0.500, 0.866), vec2(-0.500, 0.866),
  vec2(-1.000, 0.000), vec2(-0.500, -0.866), vec2(0.500, -0.866)
);

// 楕円半径を 1 とした距離。ぼけ帯の厚みが全周で揃う。
float blurAt(vec2 screen) {
  float d = length((screen - tiltFocus) / max(tiltBand, vec2(0.01)));
  return smoothstep(1.0, 1.0 + max(tiltFalloff, 0.02), d);
}

void main() {
  vec4 colour = texture2D(tDiffuse, vUv);
  // UV の Y は下が 0。エディタは上が 0 なので反転する。
  float amount = blurAt(vec2(vUv.x, 1.0 - vUv.y));
  if (amount > 0.001) {
    // アスペクト補正。ぼけが横に伸びないように。
    vec2 radius = amount * tiltStrength * vec2(texelSize.x / max(texelSize.y, 1e-6), 1.0);
    vec4 total = vec4(0.0);
    for (int i = 0; i < 13; i++) {
      total += texture2D(tDiffuse, vUv + TAPS[i] * radius);
    }
    colour = total / 13.0;
  }
  // キャンバスからコピーした sRGB のまま出す。ここで変換すると影が二重に暗くなる。
  gl_FragColor = colour;
}
`;

/** 色被せ（DEC-388）。絵の一番上に 1 枚。 */
const veilVertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const veilFragmentShader = /* glsl */ `
uniform vec3 veilColor;
uniform float veilAlpha;
void main() {
  gl_FragColor = vec4(veilColor, veilAlpha);
}
`;

interface TiltShiftPass {
  /** ぼけが実際に効いているか。 */
  readonly enabled: boolean;
  /** シーンを描く。オンならぼけを通す。 */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera): void;
  /** 描画先をキャンバスに合わせる。リサイズから呼ぶ。 */
  setSize(width: number, height: number, pixelRatio?: number): void;
  /** 設定だけ差し替える。パスは組み直さない。 */
  update(settings: CameraFxDef): void;
  /**
   * 色被せ（DEC-388）。`alpha` が 0 なら塗らない。
   * **毎フレーム渡してよい**——同じ値なら何もしない。
   */
  setVeil(color: { r: number; g: number; b: number }, alpha: number): void;
  dispose(): void;
}

export function createTiltShiftPass(settings?: CameraFxDef): TiltShiftPass {
  let fx: Required<CameraFxDef> = { ...CAMERA_FX_DEFAULTS, ...(settings ?? {}) };

  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
  });

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      tDiffuse: { value: target.texture },
      texelSize: { value: new Vector2(1, 1) },
      tiltFocus: { value: new Vector2(fx.tiltFocusX, fx.tiltFocus) },
      tiltBand: { value: new Vector2(fx.tiltBandX, fx.tiltBand) },
      tiltFalloff: { value: fx.tiltFalloff },
      tiltStrength: { value: fx.tiltStrength },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quad);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const veilMaterial = new ShaderMaterial({
    vertexShader: veilVertexShader,
    fragmentShader: veilFragmentShader,
    uniforms: {
      veilColor: { value: new Color(0, 0, 0) },
      veilAlpha: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const veilQuad = new Mesh(new PlaneGeometry(2, 2), veilMaterial);
  veilQuad.frustumCulled = false;
  const veilScene = new Scene();
  veilScene.add(veilQuad);
  let veilAlpha = 0;

  let width = 1;
  let height = 1;
  let ratio = 1;

  return {
    get enabled() {
      return fx.tilt;
    },

    setSize(nextWidth: number, nextHeight: number, pixelRatio = 1) {
      width = Math.max(1, Math.floor(nextWidth));
      height = Math.max(1, Math.floor(nextHeight));
      ratio = pixelRatio;
      target.setSize(Math.floor(width * ratio), Math.floor(height * ratio));
      (material.uniforms.texelSize.value as Vector2).set(1 / width, 1 / height);
    },

    update(next: CameraFxDef) {
      fx = { ...CAMERA_FX_DEFAULTS, ...next };
      (material.uniforms.tiltFocus.value as Vector2).set(fx.tiltFocusX, fx.tiltFocus);
      (material.uniforms.tiltBand.value as Vector2).set(fx.tiltBandX, fx.tiltBand);
      material.uniforms.tiltFalloff.value = fx.tiltFalloff;
      material.uniforms.tiltStrength.value = fx.tiltStrength;
    },

    setVeil(color, alpha) {
      veilAlpha = Math.min(1, Math.max(0, alpha));
      (veilMaterial.uniforms.veilColor.value as Color).setRGB(color.r, color.g, color.b);
      veilMaterial.uniforms.veilAlpha.value = veilAlpha;
    },

    render(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
      const size = renderer.getSize(new Vector2());
      if (size.x !== width || size.y !== height || renderer.getPixelRatio() !== ratio) {
        this.setSize(size.x, size.y, renderer.getPixelRatio());
      }

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      if (fx.tilt) {
        copyCanvasToTarget(renderer, target);
        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCamera);
      }
      if (veilAlpha <= 0.002) return;
      // **消さずに重ねる**。`render` は既定で画面を消すので、その間だけ止める。
      const cleared = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(veilScene, quadCamera);
      renderer.autoClear = cleared;
    },

    dispose() {
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
      veilMaterial.dispose();
      veilQuad.geometry.dispose();
    },
  };
}

/** キャンバス（AA 込み）を RT へコピーする。copyTex は MSAA から呼べない。 */
function copyCanvasToTarget(renderer: WebGLRenderer, target: WebGLRenderTarget): void {
  const gl = renderer.getContext();
  const dw = gl.drawingBufferWidth;
  const dh = gl.drawingBufferHeight;
  if (target.width !== dw || target.height !== dh) target.setSize(dw, dh);

      renderer.setRenderTarget(target);
      const framebuffer = framebufferOf(renderer, target);
      renderer.setRenderTarget(null);
      if (!framebuffer || !('blitFramebuffer' in gl)) return;

  const gl2 = gl as WebGL2RenderingContext;
  gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, null);
  gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, framebuffer);
  gl2.blitFramebuffer(0, 0, dw, dh, 0, 0, target.width, target.height, gl2.COLOR_BUFFER_BIT, gl2.NEAREST);
  renderer.resetState();
}

function framebufferOf(renderer: WebGLRenderer, target: WebGLRenderTarget): WebGLFramebuffer | undefined {
  return (renderer.properties.get(target) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
}
