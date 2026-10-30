import {
  AlwaysStencilFunc,
  Color,
  CustomBlending,
  DoubleSide,
  EqualStencilFunc,
  GreaterDepth,
  Group,
  KeepStencilOp,
  Mesh,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PerspectiveCamera,
  ReplaceStencilOp,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Object3D,
  type PlaneGeometry,
  type Scene,
  type WebGLRenderer,
} from 'three';

/** 下位7ビットは従来の床影、最上位ビットは直前の深度を書いた遮蔽物の種類。 */
const SEE_THROUGH_MASK = 0x80;
const prepared = new WeakSet<Material>();

export function prepareSilhouetteOccluder(material: Material): void {
  if (prepared.has(material)) return;
  prepared.add(material);
  if (material.stencilWrite) {
    // 床影の書き込み・比較がSeeThroughの印を壊さないよう分離する。
    material.stencilWriteMask &= ~SEE_THROUGH_MASK;
    material.stencilFuncMask &= ~SEE_THROUGH_MASK;
    return;
  }
  if (!material.depthWrite) return;
  material.stencilWrite = true;
  material.stencilWriteMask = SEE_THROUGH_MASK;
  material.stencilFuncMask = SEE_THROUGH_MASK;
  material.stencilRef = (material as ShaderMaterial).defines?.MEP_SEE_THROUGH !== undefined ? SEE_THROUGH_MASK : 0;
  material.stencilFunc = AlwaysStencilFunc;
  material.stencilFail = KeepStencilOp;
  material.stencilZFail = KeepStencilOp;
  material.stencilZPass = ReplaceStencilOp;
}

export function prepareSilhouetteOccluders(scene: Object3D): void {
  scene.traverseVisible((object) => {
    const material = (object as Mesh).material;
    if (Array.isArray(material)) material.forEach(prepareSilhouetteOccluder);
    else if (material) prepareSilhouetteOccluder(material);
  });
}

/**
 * 足元からこの高さ（マス）までは白くしない（2026-10-30）。
 *
 * 地面に敷いた装飾（「下に重ねる」レイヤー）は、地面とちらつかないよう**深度だけ手前へ寄せて**描く
 * （`material.ts` の `polygonOffset`。DEC-123）。そのぶん、すぐ後ろに立つキャラの足元が
 * 「装飾の後ろ」と判定され、足元が白く抜けていた。床に平らに敷いた物が隠せるのは**その高さより下**だけなので、
 * 足元のこの帯を外せば、白くなるのは壁など立っている物に隠れたときだけになる。
 * 壁に隠れたときは体の高さまで隠れるので、足元の帯が白くならなくても見分けられる。
 */
const FLOOR_CLEAR_CELLS = 0.03;

/** 隠れた割合がこれ以上になったら白シルエットを出す（2026-10-30。利用者の指定で 1/2）。 */
export const SILHOUETTE_SHOW_RATIO = 0.5;
/** 出したあと、これを切ったら消す。出す値と同じにすると、境目で歩くと点いたり消えたりする。 */
export const SILHOUETTE_HIDE_RATIO = 0.4;
/** 出し入れにかける秒数。 */
export const SILHOUETTE_FADE_S = 0.15;

/** 隊列の 1 人ぶんの白シルエット。表示と、隠れた割合を数えるための口。 */
export interface PartySilhouette {
  /** 入れ物（本体の子）。入れていないあいだは `visible = false`。 */
  group: Group;
  /** 本体の板。画面のどこに居るかを測るのに使う。 */
  body: Mesh;
  /** 白の濃さ（0..1）。ふわっと出し入れする。 */
  setFade(amount: number): void;
  fade(): number;
  /** 数えるときの層。白の板と「全体」の板をこの層にも載せる（ふだんの描画は層 0 の白だけ）。 */
  setCountLayer(layer: number): void;
  /** 数えるあいだだけ白を濃さ 1 にする（出し入れの途中でも数えが変わらないように）。 */
  beginCount(): void;
  endCount(): void;
  /** 跳んだときに足元の帯を合わせる。 */
  setLift(lift: number): void;
  dispose(): void;
}

/**
 * 地形の深度の後、隊列の通常描画（50〜）の前に描く。仲間同士では白くならない。
 * `unit` は 1 マスの長さ。足元からの高さは本体の `position.y`（板の中心の高さ）から測る。
 *
 * **出すのは隠れた割合が 1/2 以上のときだけ**（2026-10-30）。割合は `createOcclusionMeter` が
 * 小さな画像に描いて数える。白の濃さは `silhouetteFade` で、数えた結果に合わせて出し入れする。
 */
export function createPartySilhouette(body: Mesh, source: ShaderMaterial, unit: number): PartySilhouette {
  const fadeUniform = { value: 0 };
  const material = new ShaderMaterial({
    // 元の uniform は**同じ物を指す**（コマ・濃さの更新がそのまま効く）。足元の帯と白の濃さだけ足す。
    uniforms: {
      ...source.uniforms,
      silhouetteLift: { value: body.position.y },
      silhouetteClear: { value: FLOOR_CLEAR_CELLS * unit },
      silhouetteFade: fadeUniform,
    },
    vertexShader: `
      uniform vec4 frame;
      uniform float silhouetteLift;
      varying vec2 vChipUv;
      varying float vAboveFoot;
      void main() {
        vChipUv = frame.xy + uv * frame.zw;
        // 足元からの高さ。板は縦に立つので、板の中の y に中心の高さを足せばよい。
        vAboveFoot = position.y + silhouetteLift;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec4 frameClamp;
      uniform float alphaCutoff;
      uniform float actorOpacity;
      uniform float silhouetteClear;
      uniform float silhouetteFade;
      varying vec2 vChipUv;
      varying float vAboveFoot;
      void main() {
        float alpha = actorOpacity * silhouetteFade;
        if (alpha <= 0.0) discard;
        // 足元の帯は白くしない（地面の装飾に隠れた所。上の FLOOR_CLEAR_CELLS）。
        if (vAboveFoot < silhouetteClear) discard;
        if (texture2D(map, clamp(vChipUv, frameClamp.xy, frameClamp.zw)).a < alphaCutoff) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `,
    side: DoubleSide,
    depthFunc: GreaterDepth,
    depthTest: true,
    depthWrite: false,
    stencilWrite: true,
    stencilWriteMask: 0,
    stencilFuncMask: SEE_THROUGH_MASK,
    stencilRef: 0,
    stencilFunc: EqualStencilFunc,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: KeepStencilOp,
    // 不透明描画の列に置き、半透明のイベント演出でも元の濃さを守る。
    transparent: false,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  // 補助表示自身は、遮蔽物や床影の設定に変えない。
  prepared.add(material);

  /**
   * 数えるときだけ描く「全体」の板（緑）。深度もステンシルも見ずに、絵の見える画素をそのまま塗る。
   * 白の板（隠れた所だけ）を上から重ねると、赤が立つ画素 ÷ 緑が立つ画素 が隠れた割合になる。
   */
  const totalMaterial = new ShaderMaterial({
    uniforms: material.uniforms,
    vertexShader: `
      uniform vec4 frame;
      varying vec2 vChipUv;
      void main() {
        vChipUv = frame.xy + uv * frame.zw;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec4 frameClamp;
      uniform float alphaCutoff;
      uniform float actorOpacity;
      varying vec2 vChipUv;
      void main() {
        if (actorOpacity <= 0.0) discard;
        if (texture2D(map, clamp(vChipUv, frameClamp.xy, frameClamp.zw)).a < alphaCutoff) discard;
        gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
      }
    `,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
  prepared.add(totalMaterial);

  const group = new Group();
  group.name = 'party-occluded-silhouette';
  group.renderOrder = 49;
  group.visible = false;
  // 入れ物の描く順（renderOrder）は**入れ物の層がカメラに合うときだけ**効く。数える層でも効くよう全部の層に置く。
  group.layers.enableAll();
  const white = new Mesh(body.geometry, material);
  group.add(white);
  // 「全体」は白より先に描く（白が上から赤を足す）。ふだんの描画（層 0）には載せない。
  const totalGroup = new Group();
  totalGroup.renderOrder = 48;
  totalGroup.layers.enableAll();
  const total = new Mesh(body.geometry, totalMaterial);
  total.layers.disableAll();
  totalGroup.add(total);
  group.add(totalGroup);
  // 本体の子なので、向き・足元補正・ジャンプ・非表示をそのまま受け継ぐ。
  body.add(group);

  let saved = 0;
  return {
    group,
    body,
    setFade(amount) {
      fadeUniform.value = Math.min(1, Math.max(0, amount));
    },
    fade: () => fadeUniform.value,
    setCountLayer(layer) {
      white.layers.set(0);
      white.layers.enable(layer);
      total.layers.set(layer);
    },
    beginCount() {
      saved = fadeUniform.value;
      fadeUniform.value = 1;
    },
    endCount() {
      fadeUniform.value = saved;
    },
    setLift(lift) {
      material.uniforms.silhouetteLift.value = lift;
    },
    dispose() {
      material.dispose();
      totalMaterial.dispose();
      group.removeFromParent();
    },
  };
}

/** 数える画像の大きさ（画素）。隊列ぜんぶが入る四角をこの大きさへ縮めて描く。 */
const METER_SIZE = 64;
/** 何フレームに 1 回数えるか。読み戻しは GPU を待たせるので、毎フレームはしない。 */
const METER_EVERY = 4;
/** 数えるときの層（1 人ずつ。0 はふだんの描画、1 は戦闘の舞台が使う）。 */
const METER_LAYER = 20;

/** 隠れた割合を数える。1 人ずつ 0..1 を返す（画面の外や透明なら 0）。 */
export interface OcclusionMeter {
  /**
   * 数えるフレームなら数えて割合を返す。数えないフレームは null（前の結果を使い続ける）。
   * **ふだんの描画のすぐ後**に呼ぶ（遮蔽物の印とキャラの位置がそのフレームのまま）。
   */
  measure(scene: Scene, camera: Camera, list: PartySilhouette[], hide: Object3D[]): number[] | null;
  dispose(): void;
}

export function createOcclusionMeter(renderer: WebGLRenderer): OcclusionMeter {
  const target = new WebGLRenderTarget(METER_SIZE, METER_SIZE, { depthBuffer: true, stencilBuffer: true });
  const pixels = new Uint8Array(METER_SIZE * METER_SIZE * 4);
  const corner = new Vector3();
  const drawSize = new Vector2();
  const clearColor = new Color();
  let frame = 0;
  let perspective: PerspectiveCamera | null = null;
  let orthographic: OrthographicCamera | null = null;

  /** 画面の画素で、板の 4 隅を囲む四角。 */
  const rectOf = (body: Mesh, width: number, height: number, view: Camera, box: { x0: number; y0: number; x1: number; y1: number }) => {
    const geometry = body.geometry as PlaneGeometry;
    const w = geometry.parameters.width / 2;
    const h = geometry.parameters.height / 2;
    for (const [x, y] of [[-w, -h], [w, -h], [-w, h], [w, h]]) {
      corner.set(x, y, 0).applyMatrix4(body.matrixWorld).project(view);
      const px = ((corner.x + 1) / 2) * width;
      const py = ((1 - corner.y) / 2) * height;
      box.x0 = Math.min(box.x0, px);
      box.y0 = Math.min(box.y0, py);
      box.x1 = Math.max(box.x1, px);
      box.y1 = Math.max(box.y1, py);
    }
  };

  return {
    measure(scene, camera, list, hide) {
      frame += 1;
      if (frame % METER_EVERY !== 0) return null;
      const shown = list.filter((one) => one.group.visible && one.body.visible);
      if (!shown.length) return list.map(() => 0);
      renderer.getDrawingBufferSize(drawSize);
      const width = drawSize.x;
      const height = drawSize.y;
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      // 隊列ぜんぶを囲む四角（画面の外は切る）。
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const one of shown) rectOf(one.body, width, height, camera, box);
      const x0 = Math.max(0, Math.floor(box.x0));
      const y0 = Math.max(0, Math.floor(box.y0));
      const x1 = Math.min(width, Math.ceil(box.x1));
      const y1 = Math.min(height, Math.ceil(box.y1));
      if (x1 - x0 < 1 || y1 - y0 < 1) return list.map(() => 0);

      // ふだんのカメラの写しで、その四角だけを描く（`setViewOffset`）。
      let view: PerspectiveCamera | OrthographicCamera;
      if ((camera as PerspectiveCamera).isPerspectiveCamera) view = (perspective ??= new PerspectiveCamera()).copy(camera as PerspectiveCamera);
      else view = (orthographic ??= new OrthographicCamera()).copy(camera as OrthographicCamera);
      view.setViewOffset(width, height, x0, y0, x1 - x0, y1 - y0);
      view.layers.set(0);

      const before = {
        target: renderer.getRenderTarget(),
        autoClear: renderer.autoClear,
        clearAlpha: renderer.getClearAlpha(),
        shadowAuto: renderer.shadowMap.autoUpdate,
      };
      renderer.getClearColor(clearColor);
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target);

      // 1. 地形など（隊列は隠す）。深度と「遮蔽物の印」（ステンシル）がふだんと同じに入る。
      const visible = hide.map((object) => object.visible);
      for (const object of hide) object.visible = false;
      renderer.autoClear = true;
      renderer.render(scene, view);
      hide.forEach((object, index) => (object.visible = visible[index]));

      // 2. 1 人ずつ、色だけ消して「全体（緑）」と「隠れた所（白）」を描き、数える。
      const background = scene.background;
      scene.background = null;
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      const out = list.map((one, index) => {
        if (!shown.includes(one)) return 0;
        const layer = METER_LAYER + Math.min(index, 7);
        one.setCountLayer(layer);
        one.beginCount();
        renderer.clear(true, false, false);
        view.layers.set(layer);
        renderer.render(scene, view);
        one.endCount();
        renderer.readRenderTargetPixels(target, 0, 0, METER_SIZE, METER_SIZE, pixels);
        let all = 0;
        let hidden = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 1] === 0 && pixels[i] === 0) continue;
          all += 1;
          // 白（隠れた所）は緑の上に重なるので赤が立つ。
          if (pixels[i] > 0) hidden += 1;
        }
        return all > 0 ? hidden / all : 0;
      });
      scene.background = background;

      renderer.setRenderTarget(before.target);
      renderer.autoClear = before.autoClear;
      renderer.setClearColor(clearColor, before.clearAlpha);
      renderer.shadowMap.autoUpdate = before.shadowAuto;
      return out;
    },
    dispose() {
      target.dispose();
    },
  };
}
