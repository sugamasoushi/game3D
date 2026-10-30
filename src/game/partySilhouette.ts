import { AlwaysStencilFunc, CustomBlending, DoubleSide, EqualStencilFunc, GreaterDepth, Group, KeepStencilOp, Mesh, OneMinusSrcAlphaFactor, ReplaceStencilOp, ShaderMaterial, SrcAlphaFactor, type Material, type Object3D } from 'three';

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
const FLOOR_CLEAR_CELLS = 0.3;

/**
 * 地形の深度の後、隊列の通常描画（50〜）の前に描く。仲間同士では白くならない。
 * `unit` は 1 マスの長さ。足元からの高さは本体の `position.y`（板の中心の高さ）から測る。
 */
export function createPartySilhouette(body: Mesh, source: ShaderMaterial, unit: number): Group {
  const material = new ShaderMaterial({
    // 元の uniform は**同じ物を指す**（コマ・濃さの更新がそのまま効く）。足元の帯の 2 つだけ足す。
    uniforms: {
      ...source.uniforms,
      silhouetteLift: { value: body.position.y },
      silhouetteClear: { value: FLOOR_CLEAR_CELLS * unit },
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
      varying vec2 vChipUv;
      varying float vAboveFoot;
      void main() {
        if (actorOpacity <= 0.0) discard;
        // 足元の帯は白くしない（地面の装飾に隠れた所。上の FLOOR_CLEAR_CELLS）。
        if (vAboveFoot < silhouetteClear) discard;
        if (texture2D(map, clamp(vChipUv, frameClamp.xy, frameClamp.zw)).a < alphaCutoff) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, actorOpacity);
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
  const group = new Group();
  group.name = 'party-occluded-silhouette';
  group.renderOrder = 49;
  group.visible = false;
  group.add(new Mesh(body.geometry, material));
  // 本体の子なので、向き・足元補正・ジャンプ・非表示をそのまま受け継ぐ。
  body.add(group);
  return group;
}
