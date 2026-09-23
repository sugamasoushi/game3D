// JSON から Three.js シーンを組む。エディタとゲームが同じ入口。

import {
  ClampToEdgeWrapping,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  NearestFilter,
  NoColorSpace,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { decodeCells, decodeProtoIndices, decodeRotationFlags, decodeStampGids } from './decode';
import { createTileDepthMaterial, createTileMaterial, edgeFadeFor, edgeWidthFor, SEE_THROUGH_PROPERTY_NAME, type AtlasLayout,
  applySunActors,
  type SunActor,
} from './material';
import { frameAt, playSequence, type PlaySequence } from './animation';
import {
  blockShadowLength,
  blockShadowStrength,
  blockShadowsOn,
  clipDirectionalShadowLength,
  emittingPointLights,
  fillPointLightUniforms,
  lightDirection,
  resolveLighting,
  shadowDirection,
} from './lighting';
import { resolveCameraFx, fogColor } from './camera';
import { applyLightWallUniforms, collectLightWalls, type LightWall, type LightWallLayer } from './lightWalls';
import {
  applyOccluderUniforms,
  bakeOccluderAtlas,
  createOccluderArrays,
  fillOccluderUniforms,
  OCC_BOX,
  OCC_CARD,
  OCC_SLOPE,
  type AtlasChip,
  type Occluder,
  type OccluderAtlas,
} from './occluders';
import { createFloorShadow } from './shadowFloor';
import { createSunShadow,
  snapAzimuth,
} from './sunShadow';
import { createBackdrop } from './backdrop';
import { createLightBulbs } from './lightBulbs';
import { buildShadowMask, maskTexture, type MaskColumn, type ShadowMaskData } from './shadowMask';

/** マスを埋める形。影を止められる。 */
const SOLID_SHAPES = new Set<string>([
  'box',
  'slope',
  'slope_corner',
  'slope_corner_in',
  'mesh',
]);
/** 板の切り取りの目印。`chipSides.w` に立てる。隠す面のビット 0..5 を避ける（DEC-96）。 */
const PLANE_CROP_BIT = 128;
/** 環境光を上向き面として受ける目印（DEC-125）。隠す面（0..5）と切り取り（128）の隙間。 */
const SHADE_UP_BIT = 64;
/** 隠す面のビットだけ数えるためのマスク。 */
const HIDE_FACE_MASK = 0x3f;

/** 厚みを「切り取り」として使う形。面 1 枚のもの（DEC-96）。 */
function cropsFaceShape(shape: string): boolean {
  return isFloorShape(shape) || isCeilShape(shape) || isWallShape(shape);
}

const EDGE_SHAPES = new Set<string>([
  'box',
  'wall',
  'slope',
  'slope_corner',
  'slope_corner_in',
]);

type SolidCell = {
  shape: Shape;
  rotation: number;
  thickness: [number, number, number];
  offset: [number, number, number];
  shadowOffset: [number, number, number];
};
import { FLAT_PLATE, LAYER_DEPTH_STEP, OFFSET_STEPS, applyWallPose, boxFootprint, boxHeight, geometryFor, offsetFor, offsetInCells, offsetStepsFor, plateCornerHeights, plateHalves, plateHeight, readThickness, rotatePlate, slopeCornerHeights } from './shapes';
import {
  ROTATION_MASK,
  billboardFacesCamera,
  billboardFollowsYaw,
  billboardStandsUpright,
  isBillboardFlat,
  isBillboardShape,
  isCeilShape,
  isDiagWallShape,
  isEdgeWallShape,
  isFloorShape,
  isWallShape,
  shapeRotates,
  normaliseFaceValue,
  packFaceAnchorAttr,
  packFaceFitAttr,
  type AssetsDef,
  type BatchDef,
  type CameraFxDef,
  type FaceName,
  type GameViewDef,
  type LayerDef,
  type LightingDef,
  type MapDef,
  type MapObjectKind,
  type MapObjectPlane,
  type PointLightDef,
  type PropertyDef,
  type ProtoDef,
  type Shape,
  type TextureDef,
  type TilesetDef,
} from './types';
import { isContainerKind } from './types';

interface LoadOptions {
  /** `textures[].src` の解決基点。省略時はページ。 */
  assetBase?: string;
  /** `invisible` を薄いゴーストで出す。ゲームは出さない。エディタ用。 */
  previewInvisible?: boolean;
  /**
   * 前のシーンから受け取る持ち物（DEC-275）。**アセットが同じものでないと使えない。**
   * 渡すとテクスチャの読み直しとシェーダの作り直しが起きなくなる。
   */
  carry?: Mep3DCarry;
  /**
   * 目を閉じたレイヤーの形を作らない（DEC-270）。見えない物まで組むと、
   * チップ 1 個ごとの組み直しがそのぶん遅くなる。
   * **入れる側は、目を戻したときに組み直すこと**——`syncLayerVisibility` では戻らない。
   */
  skipHidden?: boolean;
  /**
   * 法線マップが在るかを**聞ける相手**（DEC-374）。渡すと、探すための取得をやめて台帳で決める。
   *
   * 無い絵を毎回取りに行くと、開発サーバによっては **1 本 100〜500ms** かかる
   * （Next の 404 は HTML を組み立てて返す。Vite は 4ms）。1 マップで 50 本を超えるので、
   * 実測でシーンの組み立てが 32 秒になっていた。台帳があれば 0 本になる。
   */
  hasFile?: (path: string) => boolean;
}

/** 太陽の影を落とす、マップの外の物（DEC-154）。 */
export interface SunCaster {
  /** 焼く対象の根。 */
  object: Object3D;
  /** その Mesh が使っているマテリアル。 */
  material: ShaderMaterial;
  /** 深度パスで差し替えるマテリアル。抜き色だけ本体と同じに判定する。 */
  depth: ShaderMaterial;
}

export interface ActorOccluder {
  /** スプライトシート。 */
  texture: Texture;
  /** いま出しているコマの UV（左下原点）。 */
  frame: { x: number; y: number; width: number; height: number };
  /** 足元のワールド座標。 */
  foot: Vector3;
  /** 板の幅と高さ（ワールド）。 */
  size: { width: number; height: number };
  /** 抜き色のしきい値。 */
  alphaCutoff?: number;
}

/**
 * 組み直しで**次のシーンへ渡す持ち物**（DEC-275）。
 * テクスチャとマテリアルは作り直すと GPU の作業が丸ごとやり直しになる
 * ——実測でチップ 1 個につきシェーダのリンクが 13 回、テクスチャ転送が 23 回、
 * 差し替え直後の描画が **260ms**。同じアセットで組み直すだけなら持ち回せる。
 * `carry()` を呼ぶと、そのシーンは**もう持ち主ではなくなる**（`dispose` で捨てない）。
 */
export interface Mep3DCarry {
  assets: AssetsDef;
  textures: Map<string, Texture>;
  normalTextures: Map<string, Texture>;
  materials: Map<string, ShaderMaterial>;
  /** 太陽の深度用。鍵はタイルのマテリアルそのものなので、上を引き継げばそのまま合う。 */
  sunDepthMaterials: Map<ShaderMaterial, ShaderMaterial>;
  /** バッチの見取り図（DEC-276）。中身が変わっていないバッチは形も作り直さない。 */
  meshes: Map<string, CarriedMesh>;
}

/** 引き継ぐバッチ 1 つぶん（DEC-276）。 */
export interface CarriedMesh {
  object: Object3D;
  hiddenFaces: number;
  count: number;
  animated: AnimatedBatch | null;
  /** マス 1 つの絵を差し替える口（GS-53）。引き継いでも使えるように持ち歩く。 */
  cellAt?: Map<string, number>;
  swapChip?: (index: number, faces: Partial<Record<FaceName, number>>) => void;
}

export interface Mep3DScene {
  group: Group;
  map: MapDef;
  assets: AssetsDef;
  /** 当たりレイヤーのセルキー（"x,y,z"）。 */
  collision: Set<string>;
  /** オブジェクトレイヤーのセル。レイヤー id ごと。 */
  objects: Map<string, ObjectLayer>;
  /** マップのカスタムプロパティ。名前 → 値。 */
  properties: Record<string, number | boolean | string>;
  /** マップの方向光。欠落は既定で埋めてある。 */
  lighting: Required<LightingDef>;
  /** カメラ効果。欠落は既定で埋めてある。ゲーム側が背景をフォグ色に合わせる用。 */
  cameraFx: Required<CameraFxDef>;
  /**
   * 方位・高度などを差し替えて、面の陰影とブロック影・ビルボード影を組み直す。
   * タイルのメッシュはそのまま。
   */
  setLighting(patch: LightingDef): void;
  /** 点光源を差し替える。タイルのメッシュはそのまま。ビルボードの点光源影は組み直す。 */
  setPointLights(lights: PointLightDef[]): void;
  /** 書き割りの絵（DEC-316）。フィールドエフェクトの「うねり」へ渡す。 */
  readonly skyTexture: Texture | null;
  /** 配置した点・スポット・面のビルボード影を出すか。 */
  /** 方向光とその影を出すか。マップの lighting は変えない。 */
  setEnvLight(on: boolean): void;
  /** オブジェクトの遮光平面を差し替える。タイルのメッシュはそのまま。配置光源の影は組み直す。 */
  setLightWalls(layers: LightWallLayer[]): void;
  /** 遮光平面をキャラなどへ渡す。 */
  bindLightWalls(material: ShaderMaterial): void;
  /** ブロック影マスクをキャラなどへ渡す。足元の柱で引く。 */
  attachShadowMask(material: ShaderMaterial): void;
  /**
   * 影の高さ場（DEC-159）。マップのビルボード影が歩いているのと**同じ地形**。
   * `solid` は光を遮る実体（ブロック・斜面・縦チップ）、`surface` は影が乗る上向き面。
   * **当たり判定とは別物。** 通り抜けられる塀でも影は折れる。
   */
  /**
   * マス 1 つの絵を差し替える（GS-53）。宝箱の開閉のように**見た目だけ変える**もの。
   *
   * 書けるのは**チップ番号**で、形も材質も変えない——同じバッチの中の話に閉じるので、
   * ジオメトリも当たりも影も組み直さずに済む（属性を書いて印を立てるだけ）。
   * `faces` に書いた面だけ変わる。`layer` を書けばそのレイヤーのマスだけ。
   *
   * 差し替えられなければ false（そのマスにブロックが無い、など）。
   */
  setCellChip(
    at: { x: number; y: number; z: number },
    faces: Partial<Record<FaceName, number>>,
    layer?: string,
  ): boolean;
  shadowField(): {
    solid: (x: number, y: number, z: number, fx?: number, fz?: number, dirX?: number, dirZ?: number) => boolean;
    /**
     * **遮る物と同じマスの中で**塞ぐか（DEC-241）。対角壁だけを見る。
     * 対角壁はマスを斜めに横切るのでキャラが同じマスに立てる。`solid` を自分のマスにも使うと、
     * マス全体を塞ぐ形（`wall` など）と同じマスに立ったとき影が足元でいきなり立ち上がる。
     */
    selfSolid: (x: number, y: number, z: number, fx: number, fz: number, dirX: number, dirZ: number) => boolean;
    surface: (x: number, y: number, z: number) => boolean;
    /**
     * その面の高さ（マス。`fx` / `fz` はマス内の位置で東・南へ 0..1）。無ければ null。
     * 坂の床チップはマスの中で高さが変わる（DEC-215）。これが無いと影が段々になる。
     */
    top: (x: number, y: number, z: number, fx: number, fz: number) => number | null;
  };
  /**
   * 太陽の影を新方式（正射深度 1 枚。DEC-145）へ切り替える。
   * on の間は旧方式の床影・面影・影マスクを出さない。見比べ用の切替。
   */
  /** ゲーム画面の設定を差し替える（DEC-148）。今は背景の書き割りだけ効く。 */
  setView(next: GameViewDef): void;
  /**
   * マップの外にある遮蔽体を差し替える（DEC-154）。キャラなど。
   * 動いたら `markSunDirty()` を呼ぶ。呼ばないと焼き直さない。
   */
  setSunCasters(list: SunCaster[]): void;
  /**
   * 外部モデル（DEC-288）を太陽の影に入れる。中の材質は問わず、
   * `userData.mepModelCaster` が立った材質を 1 枚の深度材質で焼く。
   * 動かない前提なので枠（正射カメラの範囲）にも入れる。
   */
  setSunModels(objects: Object3D[]): void;
  /** 次のフレームで太陽の深度を焼き直す。 */
  markSunDirty(): void;
  setSunShadow(on: boolean): void;
  /** 太陽の影の縁をぼかす半径（絵の画素。DEC-145）。0 はベタ塗り 1 段。 */
  setSunShadowBlur(radius: number): void;
  /** 影の向きだけ方位を 90 度の倍数へ丸めるか（DEC-145）。面の明暗は変えない。 */
  setSunShadowAxis(on: boolean): void;
  /**
   * 必要なら太陽の深度を焼き直す。毎フレーム呼んでよい（変化が無ければ何もしない）。
   * マップか太陽が変わった次のフレームで 1 回だけ焼く。
   */
  tickSunShadow(renderer: WebGLRenderer): void;
  /** 隣接ブロックの接地面を描かない。 */
  setCullHidden(on: boolean): void;
  /**
   * キャラを遮光体として扱う（GC-39）。影を塗るのではなく、光源への線分を
   * キャラの板で遮って暗くする。`on` を false にすると従来のシルエット影だけになる。
   */
  setActorOccluder(state: ActorOccluder | null): void;
  /**
   * 太陽の影を落とすキャラ（DEC-393）。**受ける側で光を遮る**ので、チップと同じく透けた所に影が乗らない。
   * 近い順に並べて渡す（上限 `MAX_SUN_ACTORS`。超えた人は影を出さない）。`facing` は板の向き
   * （カメラ側の水平の単位ベクトル）。`extra` はキャラの材質など、マップの外で影を受ける物。
   * 太陽の影が出ていないマップでは何人渡しても 0 人として扱う（チップの影と同じ出方）。
   */
  setSunActors(actors: readonly SunActor[], facing: Vector3, extra?: readonly ShaderMaterial[]): void;
  /**
   * フォグを差し替える。タイルのメッシュはそのまま。チルトシフトは呼び出し側のポストプロセス。
   */
  setCameraFx(raw: CameraFxDef): void;
  /**
   * 縁の太さと内側のぼかしを差し替える。タイルのメッシュはそのまま。
   */
  setEdge(width?: number, fade?: number): void;
  /**
   * 視点が近い壁を透かす／消す。壁バッチだけ。0 なし、1 透かす、2 消す。距離はワールド単位。
   */
  setNearFade(distance: number, wallMode?: number): void;
  /**
   * 透過レイヤー（`SeeThrough`）を実際に透かすか（DEC-252）。
   * ゲームが「キャラがカメラから見えなくなったか」で毎フレーム決める。既定は透ける。
   */
  /** 透過レイヤーの抜け具合（DEC-281）。0 で普通、1 で全開。途中の値で薄く抜ける。 */
  setSeeThrough(amount: number): void;
  /**
   * そのマスが透過レイヤーのものか（DEC-252）。セル座標（整数）。
   * カメラとキャラの間にこのマスがあれば「隠れている」と見なす。
   */
  seeThroughAt(x: number, y: number, z: number): boolean;
  /** 表示中のレイヤーに合わせて床影を組み直す。タイルは組み直さない。 */
  /**
   * 次のシーンへ持ち物を渡す（DEC-275）。渡したらこのシーンは捨てなくなる。
   * 同じアセットで組み直すときだけ使う。
   */
  carry(): Mep3DCarry;
  /**
   * 引き継いだメッシュを実際に取り込む（DEC-276）。**差し替える直前に呼ぶ。**
   * 組んでいる途中で動かすと、まだ映っている前のシーンから消えてちらつく。
   */
  adopt(): void;
  /**
   * 渡した持ち物を返してもらう（DEC-275）。
   * 組み直しが途中で追い越されて、新しいシーンを捨てるときに使う。
   * これを忘れると、**まだ使っているマテリアルを捨てられて絵が消える**。
   */
  reclaim(carried: Mep3DCarry): void;
    syncLayerVisibility(layers: Array<{ id: string; visible: boolean }>): void;
  /** タイルアニメを進める。前回からの秒。 */
  update(deltaSeconds: number): void;
  /**
   * 点滅・ゆらめきの時計（秒。DEC-294）。シェーダの `lightTime` と同じ値。
   * 置いた 3D の実ライトを同じ位相で振るために外へ出す。
   */
  readonly time: number;
  dispose(): void;
  stats: { tiles: number; drawCalls: number; hiddenFaces: number };
}

/** オブジェクトレイヤー。ゲーム側が読むデータ。 */
interface ObjectLayer {
  id: string;
  name: string;
  collision: boolean;
  properties: Record<string, number | boolean | string>;
    items: Array<{
      id: string;
      name: string;
      kind: MapObjectKind;
      collision: boolean;
      properties: Record<string, number | boolean | string>;
      space?: 'plane' | 'solid';
      plane?: MapObjectPlane;
      y: number;
      z?: number;
      x?: number;
      height?: number;
      points: [number, number][];
      cells?: [number, number, number][];
    }>;
  /** 旧形式のセル。新しいマップでは空。 */
  cells: Array<{ x: number; y: number; z: number; proto: string; rotation: number }>;
}

/** プロパティ配列を名前 → 値の表にする。 */
function propertiesToRecord(
  list: PropertyDef[] | undefined,
): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const entry of list ?? []) out[entry.name] = entry.value;
  return out;
}

const UP = new Vector3(0, 1, 0);

/** 既にパースした JSON からシーンを組む。 */
/**
 * 斜面の 4 隅の高さを 90 度単位で回す。並びは (x0,z0) (x1,z0) (x1,z1) (x0,z1) の反時計回りなので、
 * 1/4 回転はこの輪を 1 つずらすことと同じ。
 */
function rotateCorners(heights: readonly number[], rotation: number): number[] {
  const r = ((rotation % 4) + 4) % 4;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) out[i] = heights[(i + r) % 4];
  return out;
}

/** プロト単位の例外（エディタ DEC-71）。省略時はレイヤーの `Shade` に従う。 */
function protoCastsShade(proto: ProtoDef | undefined): boolean {
  return proto?.shade !== false;
}

/**
 * そのレイヤーを透かすか（DEC-251）。レイヤーのカスタムプロパティ `SeeThrough`。
 * 省略時は透かさない。**手前の壁を別レイヤーにして、そこだけオンにする**使い方。
 */
function layerSeeThrough(layer: LayerDef): boolean {
  for (const entry of layer.properties ?? []) {
    if (entry.name !== SEE_THROUGH_PROPERTY_NAME) continue;
    if (typeof entry.value === 'boolean') return entry.value;
    return entry.value !== 0 && entry.value !== '' && entry.value !== '0' && entry.value !== 'false';
  }
  return false;
}

/**
 * そのレイヤーが遮光体を出すか（GC-41 / エディタ DEC-71）。
 * レイヤーのカスタムプロパティ `Shade`。省略時は出す。
 */
function layerCastsShade(layer: LayerDef): boolean {
  for (const entry of layer.properties ?? []) {
    if (entry.type !== 'boolean' || entry.name !== 'Shade') continue;
    return entry.value === true;
  }
  return true;
}

export async function buildMep3DScene(
  map: MapDef,
  assets: AssetsDef,
  options: LoadOptions = {},
): Promise<Mep3DScene> {
  return build(map, assets, options);
}

async function build(map: MapDef, assets: AssetsDef, options: LoadOptions): Promise<Mep3DScene> {
  const texturesById = indexBy(assets.textures);
  const tilesetsById = indexBy(assets.tilesets);
  const materialsById = indexBy(assets.materials);
  const protosById = indexBy(assets.protos);

  const assetBase = options.assetBase ?? (typeof document !== 'undefined' ? document.baseURI : '/');
  // 同じアセットなら前のシーンの持ち物をそのまま使う（DEC-275）。
  const carried = options.carry && options.carry.assets === assets ? options.carry : null;
  const textures = carried ? carried.textures : await loadTextures(assets.textures, assetBase);
  const normalTextures = carried
    ? carried.normalTextures
    : await loadNormalTextures(assets.textures, assetBase, options.hasFile);
  let lighting = resolveLighting(map.lighting);
  let pointLights: PointLightDef[] = [...(map.pointLights ?? [])];
  let lightWalls: LightWall[] = collectLightWalls(map.layers);
  let cameraFx = resolveCameraFx(map.camera);
  let nearFadeOn = 0;
  let nearFadeDist = 4;

  const solidByLayer = new Map<string, Map<string, SolidCell>>();
  /** 壁チップ。マスを埋めないので `solidByLayer` とは別に持つ（DEC-76）。 */
  const wallSolidByLayer = new Map<string, Map<string, SolidCell>>();
  const visualSolidByLayer = new Map<string, Set<string>>();
  const visualScratch = new Vector3();
  for (const layer of map.layers) {
    if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
    const solidInfo = new Map<string, SolidCell>();
    const wallInfo = new Map<string, SolidCell>();
    const visual = new Set<string>();
    for (const batch of layer.batches) {
      if (materialsById.get(batch.mat)?.kind === 'invisible') continue;
      const coords = decodeCells(batch);
      const flags = decodeRotationFlags(batch);
      const protoIndices = decodeProtoIndices(batch);
      if (batch.shape === 'wall') {
        for (let i = 0; i < batch.count; i += 1) {
          const proto = protosById.get(batch.protos[protoIndices[i]]);
          wallInfo.set(`${coords[i * 3]},${coords[i * 3 + 1]},${coords[i * 3 + 2]}`, {
            shape: 'wall',
            rotation: (flags[i] ?? 0) & ROTATION_MASK,
            thickness: readThickness(proto?.thickness),
            offset: proto?.offset ?? [0, 0, 0],
            shadowOffset: proto?.shadowOffset ?? [0, 0, 0],
          });
        }
        continue;
      }
      if (!SOLID_SHAPES.has(batch.shape)) continue;
      for (let i = 0; i < batch.count; i += 1) {
        const x = coords[i * 3];
        const y = coords[i * 3 + 1];
        const z = coords[i * 3 + 2];
        const key = `${x},${y},${z}`;
        const rotation = shapeRotates(batch.shape) ? (flags[i] ?? 0) & ROTATION_MASK : 0;
        const proto = protosById.get(batch.protos[protoIndices[i]]);
        const cell: SolidCell = {
          shape: batch.shape,
          rotation,
          thickness: readThickness(proto?.thickness),
          offset: proto?.offset ?? [0, 0, 0],
          shadowOffset: proto?.shadowOffset ?? [0, 0, 0],
        };
        solidInfo.set(key, cell);
        markBoxVisual(visual, x, y, z, cell.thickness, cell.rotation, cell.offset, visualScratch);
      }
    }
    solidByLayer.set(layer.id, solidInfo);
    wallSolidByLayer.set(layer.id, wallInfo);
    visualSolidByLayer.set(layer.id, visual);
  }

  /**
   * 面 1 枚の板（屋根・庇・棚板）。マスを埋めないので固体には入らないが、絵としては光を遮る（DEC-127）。
   * 地面と同じ高さの板（普通の床）は自分の影で自分を暗くするだけなので入れない。
   */
  const plateByLayer = new Map<
    string,
    Array<{ x: number; y: number; z: number; plate: number[]; rotation: number; shape: Shape }>
  >();
  for (const layer of map.layers) {
    if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
    const plates: Array<{ x: number; y: number; z: number; plate: number[]; rotation: number; shape: Shape }> = [];
    for (const batch of layer.batches) {
      const corners = plateCornerHeights(batch.shape);
      if (!corners) continue;
      if (materialsById.get(batch.mat)?.kind === 'invisible') continue;
      const coords = decodeCells(batch);
      const flags = decodeRotationFlags(batch);
      for (let i = 0; i < batch.count; i += 1) {
        plates.push({
          x: coords[i * 3],
          y: coords[i * 3 + 1],
          z: coords[i * 3 + 2],
          plate: corners,
          rotation: (flags[i] ?? 0) & ROTATION_MASK,
          shape: batch.shape,
        });
      }
    }
    plateByLayer.set(layer.id, plates);
  }

  /**
   * 方向光のブロック影を投げる柱。`Shade` を切ったレイヤーは投げない（DEC-78）。
   * 受ける側は素通しにしない。影を作らないだけで、影は落ちてくる。
   */
  /**
   * 影をまとめるプレハブレイヤー（DEC-130 / DEC-131）。
   * 親をたどって、一番内側のプレハブレイヤーの id を返す。無ければ空。
   */
  const layerById = new Map(map.layers.map((entry) => [entry.id, entry]));
  const silhouetteGroupOf = (layer: LayerDef): string => {
    let parent = layer.parent ? layerById.get(layer.parent) : undefined;
    while (parent) {
      if (parent.kind === 'prefab') return parent.id;
      parent = parent.parent ? layerById.get(parent.parent) : undefined;
    }
    return '';
  };

  /**
   * 方向光の影を投げる柱。プレハブは**チップの角を全部投影して外周 1 枚にまとめる**（DEC-130）。
   * 足元（XZ）の形で伸ばす切り替え（DEC-135）は削除した（DEC-213）。
   */
  const visibleColumns = (): MaskColumn[] => {
    // プレハブの足元（XZ）。マスごとに一番高い所と一番低い所を持つ。
    const feet = new Map<string, Map<string, { top: number; bottom: number }>>();
    const addFoot = (key: string, x: number, z: number, bottom: number, top: number) => {
      let foot = feet.get(key);
      if (!foot) {
        foot = new Map();
        feet.set(key, foot);
      }
      const at = `${x},${z}`;
      const found = foot.get(at);
      if (found) {
        found.top = Math.max(found.top, top);
        found.bottom = Math.min(found.bottom, bottom);
      } else {
        foot.set(at, { top, bottom });
      }
    };
    // まとめるグループごとに分ける。印が無いものは "" にまとめて今まで通り。
    const buckets = new Map<string, { solid: Map<string, SolidCell>; wall: Map<string, SolidCell>; plates: MaskColumn[] }>();
    const bucketOf = (key: string) => {
      const found = buckets.get(key);
      if (found) return found;
      const made = { solid: new Map<string, SolidCell>(), wall: new Map<string, SolidCell>(), plates: [] as MaskColumn[] };
      buckets.set(key, made);
      return made;
    };
    for (const layer of map.layers) {
      if (isContainerKind(layer.kind)) continue;
      if (!layerEffectivelyVisible(map.layers, layer)) continue;
      if (!layerCastsShade(layer)) continue;
      const inPrefab = silhouetteGroupOf(layer);
      // プレハブの中身は 1 個の平面図として集める。
      // 足元の形（DEC-135）はこれがそのまま影になり、外周（DEC-130）でも地面の基準に使う（DEC-137）。
      if (inPrefab) {
        for (const key of solidByLayer.get(layer.id)?.keys() ?? []) {
          const [x, y, z] = key.split(',').map(Number);
          addFoot(inPrefab, x, z, y, y + 1);
        }
        for (const key of wallSolidByLayer.get(layer.id)?.keys() ?? []) {
          const [x, y, z] = key.split(',').map(Number);
          addFoot(inPrefab, x, z, y, y + 1);
        }
        for (const entry of plateByLayer.get(layer.id) ?? []) {
          addFoot(inPrefab, entry.x, entry.z, entry.y + Math.min(...entry.plate), entry.y + Math.max(...entry.plate));
        }
      }
      const { solid: solidInfo, wall: wallInfo, plates } = bucketOf(inPrefab);
      for (const [key, value] of solidByLayer.get(layer.id) ?? []) solidInfo.set(key, value);
      // 面 1 枚（縦向き面・上向き面）は、単体では影を落とさない（DEC-134）。
      // 地面や崖はこれで作るので、影を出すと地形が地形の影で汚れる。
      // プレハブレイヤーの中身は「1 個の物」なので、面もシルエットに参加する。
      if (!inPrefab) continue;
      for (const [key, value] of wallSolidByLayer.get(layer.id) ?? []) wallInfo.set(key, value);
      for (const entry of plateByLayer.get(layer.id) ?? []) {
        const low = entry.y + Math.min(...entry.plate);
        // 地面そのものは影を落とさない（自分の影で自分を暗くするだけ）。
        // その列で一番低い面から 1 マス以上高い板＝屋根・庇・棚だけ投げる（DEC-129）。
        if (low < lowestSurfaceAt(entry.x, entry.z) + 0.95) continue;
        // 棟・谷は折れ目で 2 枚に割る。平らな近似だと隣の坂と継ぎ目が空く（DEC-128）。
        const halves = plateHalves(entry.shape, entry.rotation);
        if (halves) {
          for (const half of halves) {
            plates.push({
              cell: { x: entry.x, y: entry.y, z: entry.z },
              foot: {
                x0: entry.x + half.foot.x0,
                z0: entry.z + half.foot.z0,
                x1: entry.x + half.foot.x1,
                z1: entry.z + half.foot.z1,
              },
              height: entry.y + Math.max(...half.corners),
              bottom: entry.y + Math.min(...half.corners),
              plate: half.corners,
              castOnly: true,
            });
          }
          continue;
        }
        plates.push({
          cell: { x: entry.x, y: entry.y, z: entry.z },
          height: entry.y + Math.max(...entry.plate),
          bottom: low,
          plate: entry.plate,
          rotation: entry.rotation,
          castOnly: true,
        });
      }
    }
    // プレハブの影を敷く地面。1 個の物なので 1 つに揃える（DEC-136）。
    // マスごとに足元を探すと、屋根のマスは屋根の下＝家の中を地面と見なして、影が屋根に出る。
    // 基準は一番低いマス（＝土台）。そこから下へ探した地面へ、影を 1 枚だけ敷く。
    const groundOf = new Map<string, number>();
    for (const [key, foot] of feet) {
      let base = Infinity;
      let baseAt = '';
      for (const [at, span] of foot) {
        if (span.bottom >= base) continue;
        base = span.bottom;
        baseAt = at;
      }
      const [baseX, baseZ] = baseAt ? baseAt.split(',').map(Number) : [0, 0];
      groundOf.set(key, Number.isFinite(base) ? groundUnder(baseX, baseZ, base) : 0);
    }

    const out: MaskColumn[] = [];
    for (const [key, bucket] of buckets) {
      const list = [...solidVolumes(bucket.solid), ...wallVolumes(bucket.wall), ...bucket.plates];
      if (key) {
        const ground = groundOf.get(key);
        for (const column of list) {
          column.silhouette = key;
          // 外周でまとめるときも地面は 1 つ。バラバラだと段ごとに影が浮く（DEC-137）。
          if (ground !== undefined) column.groundY = ground;
        }
      }
      out.push(...list);
    }
    return out;
  };

  /**
   * 縦の壁チップ。マスを埋める形ではないので `solidByLayer` には入らないが、
   * 絵としては光を遮る板なので、影はここで止まって面を這い上がってほしい（DEC-67）。
   * スプライト影の歩きだけに効かせる。ブロック影と影マスクには足さない。
   */
  const wallByLayer = new Map<string, Map<string, number>>();
  /**
   * 対角線の壁のマスと、その線の向き（DEC-239 / DEC-240）。true が北西〜南東。
   *
   * **辺の壁と分けて持つ。** 辺の壁はマスの境に立つのでマスごとで足りるが、
   * 対角壁はマスの真ん中を斜めに横切るので、マスごと塞ぐと影が四角い面にも出る。
   * 三角・切妻（`wall_tri*` / `wall_gable*`）はどちらにも入れない
   * ——面が欠けた形なので、マスを塞ぐ扱いにすると屋根の下で影が余計に止まる。
   */
  const diagWallByLayer = new Map<string, Map<string, boolean>>();
  for (const layer of map.layers) {
    if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
    const walls = new Map<string, number>();
    const diags = new Map<string, boolean>();
    for (const batch of layer.batches) {
      if (materialsById.get(batch.mat)?.kind === 'invisible') continue;
      if (batch.shape === 'wall') {
        // **どの辺に立っているかを覚える**（DEC-375）。マスごと塞ぐと、板の無い側でも影が折れる。
        const coords = decodeCells(batch);
        const flags = decodeRotationFlags(batch);
        for (let i = 0; i + 2 < coords.length; i += 3) {
          walls.set(`${coords[i]},${coords[i + 1]},${coords[i + 2]}`, (flags[i / 3] ?? 0) & ROTATION_MASK);
        }
        continue;
      }
      if (!isDiagWallShape(batch.shape)) continue;
      const coords = decodeCells(batch);
      const flags = decodeRotationFlags(batch);
      for (let i = 0; i + 2 < coords.length; i += 3) {
        // 90 度回すともう一方の対角へ移る。180 度は同じ線（`collision.blockShapeOf` と同じ）。
        const steps = (flags[i / 3] ?? 0) & ROTATION_MASK;
        const nwse = batch.shape === 'wall_diag_nwse';
        diags.set(`${coords[i]},${coords[i + 1]},${coords[i + 2]}`, steps % 2 === 1 ? !nwse : nwse);
      }
    }
    wallByLayer.set(layer.id, walls);
    diagWallByLayer.set(layer.id, diags);
  }

  /**
   * 対角壁のマスで光線を止めるか（DEC-240）。線の**光線が後に着く側**を塞ぐ。
   *
   * 帯だけを塞ぐと、線の向こう側で影がまた地面に落ちて壁の裏に出る。
   * 半分を塞げば影は線でぴたりと止まり、そこから面を這い上がる。
   * 向きが分からない（`dirX` も `dirZ` も 0）ときはマスごと塞ぐ——今までと同じ答え。
   */
  /**
   * 対角壁が影を止める帯の幅（DEC-280）。線からの符号付きの隔たり（`side`）で測る。
   * `side` は ±1 の範囲を取るので、0.25 は垂直距離でおよそ 0.18 マス。
   *
   * **半平面（線の向こう側ぜんぶ）にすると、壁の裏の半マスが天面の高さで塞がる。**
   * 対角壁は板 1 枚なので、そこは何も無い空間——影がその高さに浮いて板になる。
   * 帯にすれば、影は板の面に貼り付いて、通り過ぎたぶんは地面へ戻る。
   *
   * 狭くしすぎると、光線の刻み（1/16 マス）が帯をまたいで素通りする。
   * 1 歩で `side` は最大 0.125 動くので、その倍は取ってある。
   */
  const DIAG_BAND = 0.25;

  /**
   * 辺の壁が影を止める帯の幅（DEC-375）。当たり判定の `WALL_BAND` と同じ厚み。
   * 板は辺にぴったり立っているので、帯もその辺の側だけ。
   */
  const EDGE_BAND = 0.2;

  /**
   * 光線が板と平行と見なす傾き（DEC-375）。水平の長さに対する、面を横切るぶんの割合。
   * これより浅ければ**板は光線に対して真横**——遮る面が無いので影は折らない。
   */
  const EDGE_GRAZE = 0.05;

  /**
   * 辺の壁が光線を止めるか（DEC-375）。**立っている辺の帯だけ**を塞ぐ。
   *
   * マスごと塞ぐと、板の無い側に立ったキャラの影が**何も無い空間で折れ曲がる**
   * （実測: 縦向きの面に貼っただけのチップの横に立つと、影が壁も無いのに立ち上がった）。
   * 帯にすれば、影は板の面でだけ折れて、それ以外はそのまま地面を進む。
   *
   * 向きが分からない（`dirX` も `dirZ` も 0）ときはマスごと塞ぐ——地面の高さを
   * 探すだけの呼び出し（`lowestSurfaceAt` など）は今までと同じ答えのままにする。
   */
  const edgeBlocks = (side: number, fx: number, fz: number, dirX: number, dirZ: number): boolean => {
    if (dirX === 0 && dirZ === 0) return true;
    // 板の面の向き。0 南(+Z) / 1 東(+X) / 2 北(-Z) / 3 西(-X)（`applyWallPose` と同じ）。
    const nx = side === 1 ? 1 : side === 3 ? -1 : 0;
    const nz = side === 0 ? 1 : side === 2 ? -1 : 0;
    const across = Math.abs(dirX * nx + dirZ * nz);
    if (across <= EDGE_GRAZE * Math.hypot(dirX, dirZ)) return false;
    if (side === 0) return fz >= 1 - EDGE_BAND;
    if (side === 1) return fx >= 1 - EDGE_BAND;
    if (side === 2) return fz <= EDGE_BAND;
    return fx <= EDGE_BAND;
  };

  const diagBlocks = (nwse: boolean, fx: number, fz: number, dirX: number, dirZ: number): boolean => {
    // 中心を原点にして、線からの符号付きの隔たり。nwse は `x − z = 0`、nesw は `x + z = 0`。
    const cx = fx - 0.5;
    const cz = fz - 0.5;
    const side = nwse ? cx - cz : cx + cz;
    const along = nwse ? dirX - dirZ : dirX + dirZ;
    if (along === 0) return Math.abs(side) <= DIAG_BAND;
    // 進む先の側の、線から帯のぶんだけ（DEC-280）。
    return along > 0 ? side >= 0 && side <= DIAG_BAND : side <= 0 && side >= -DIAG_BAND;
  };

  /**
   * 傾いた床チップのあるマス（DEC-219）。`floorByLayer` を組むときに詰める。
   * 階段の側面を壁チップで飾ると同じマスに入るので、そこを「壁」と見ないための除外表。
   */
  const slopedFloors = new Set<string>();

  /**
   * 自分のマスの中で塞ぐか（DEC-241）。**対角壁だけ**を見る。
   * マス全体を塞ぐ形は、同じマスに立っている＝足元の床として扱う（DEC-219）。
   */
  /**
   * 影の判定が舐めるレイヤー（DEC-266）。入れ物と非表示を外したもの。
   * 影は 1 フレームに数千回この一覧を回るので、**表示が変わったときだけ**作り直す。
   * 見分けは `visible` の並びの走り書き——整数だけなので確保が起きない。
   */
  let shadowLayerStamp = Number.NaN;
  let shadowLayerList: LayerDef[] = [];
  const shadowLayers = (): LayerDef[] => {
    let stamp = 0;
    for (const layer of map.layers) stamp = (stamp * 3 + (layer.visible === false ? 1 : 2)) | 0;
    if (stamp !== shadowLayerStamp) {
      shadowLayerStamp = stamp;
      shadowLayerList = map.layers.filter(
        (layer) => !isContainerKind(layer.kind) && layerEffectivelyVisible(map.layers, layer),
      );
    }
    return shadowLayerList;
  };

  const visibleDiagAt = (
    x: number,
    y: number,
    z: number,
    fx: number,
    fz: number,
    dirX: number,
    dirZ: number,
  ): boolean => {
    const key = `${x},${y},${z}`;
    for (const layer of shadowLayers()) {
      const nwse = diagWallByLayer.get(layer.id)?.get(key);
      if (nwse === undefined || slopedFloors.has(key)) continue;
      if (diagBlocks(nwse, fx, fz, dirX, dirZ)) return true;
    }
    return false;
  };

  const visibleSolidAt = (
    x: number,
    y: number,
    z: number,
    fx = 0.5,
    fz = 0.5,
    dirX = 0,
    dirZ = 0,
  ): boolean => {
    const key = `${x},${y},${z}`;
    for (const layer of shadowLayers()) {
      if (solidByLayer.get(layer.id)?.has(key)) return true;
      if (visualSolidByLayer.get(layer.id)?.has(key)) return true;
      // 壁チップは絵の板なので影を止める（DEC-67）。ただし**同じマスに坂がある**なら
      // 階段の側面の飾り（DEC-210 と同じ 12 マス）。そこを壁にすると、坂に立った
      // キャラの影が足元の見えない壁に当たって欠ける（DEC-219）。
      // 塞ぐのは**立っている辺の帯だけ**（DEC-375）。
      const side = wallByLayer.get(layer.id)?.get(key);
      if (side !== undefined && !slopedFloors.has(key) && edgeBlocks(side, fx, fz, dirX, dirZ)) {
        return true;
      }
      // 対角壁は線の片側だけ（DEC-240）。マスごと塞ぐと四角い面にも影が出る。
      const nwse = diagWallByLayer.get(layer.id)?.get(key);
      if (nwse !== undefined && !slopedFloors.has(key) && diagBlocks(nwse, fx, fz, dirX, dirZ)) {
        return true;
      }
    }
    return false;
  };

  const boardByLayer = new Map<string, Set<string>>();
  for (const layer of map.layers) {
    if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
    const boards = new Set<string>();
    for (const batch of layer.batches) {
      if (!isBillboardFlat(batch.shape)) continue;
      if (materialsById.get(batch.mat)?.kind === 'invisible') continue;
      collectCells([batch], boards);
    }
    boardByLayer.set(layer.id, boards);
  }

  /**
   * 上向き面（床チップ）。マスを埋めないので固体には入らないが、影を受ける地面になる（DEC-126）。
   * 値は**マスの底からの 4 隅の高さ**（回転・微 Y 込み。DEC-215）。坂の上では影も斜めに乗る。
   */
  const floorByLayer = new Map<string, Map<string, Float32Array>>();
  {
    /** `proto.offset` の分母。`offsetSteps` はここより後で作られるので自前で取る。 */
    const steps = offsetStepsFor(assets.version ?? 1);
    const cache = new Map<string, Float32Array>();
    const plateFor = (shape: Shape, rotation: number, lift: number): Float32Array => {
      const base = plateCornerHeights(shape);
      if (!base) return FLAT_PLATE;
      if (lift === 0 && base.every((value) => value === 0)) return FLAT_PLATE;
      const key = `${shape}|${rotation}|${lift}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const made = rotatePlate(base, rotation);
      if (lift !== 0) for (let i = 0; i < 4; i += 1) made[i] += lift;
      cache.set(key, made);
      return made;
    };
    for (const layer of map.layers) {
      if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
      const floors = new Map<string, Float32Array>();
      for (const batch of layer.batches) {
        if (!isFloorShape(batch.shape)) continue;
        if (materialsById.get(batch.mat)?.kind === 'invisible') continue;
        const cells = decodeCells(batch);
        const flags = shapeRotates(batch.shape) ? decodeRotationFlags(batch) : null;
        const protoIndices = decodeProtoIndices(batch);
        for (let i = 0; i + 2 < cells.length; i += 3) {
          const at = i / 3;
          const proto = protosById.get(batch.protos[protoIndices[at]]);
          const lift = proto?.offset ? proto.offset[1] / steps : 0;
          const key = `${cells[i]},${cells[i + 1]},${cells[i + 2]}`;
          const plate = plateFor(batch.shape, (flags?.[at] ?? 0) & ROTATION_MASK, lift);
          floors.set(key, plate);
          if (plate !== FLAT_PLATE) slopedFloors.add(key);
        }
      }
      floorByLayer.set(layer.id, floors);
    }
  }

  /**
   * そのマスの床チップの板。無ければ null。
   *
   * **同じマスに 2 枚以上あれば 4 隅ごとに高いほうを採る**（DEC-386）。
   * 最初の 1 枚を返していたので、**地面の上に丘を重ねると影だけ下の平らな床に乗り**、
   * 坂を歩くと影が半マス潜って見えた（実測: 0103 の坂で影 0.00 / 当たり 0.50）。
   * 当たり（`collision.ts`）は逆に最後の 1 枚を採っていたので、両方を「高いほう」に揃える。
   *
   * **毎フレーム引かれる**（足元の影が地形をなぞる）ので答えを覚える。
   * 目の開閉が変わったら捨てる——`shadowLayers()` の版と同じ印で見る。
   */
  let floorPlateStamp = Number.NaN;
  const floorPlateCache = new Map<string, Float32Array | null>();
  const floorPlateAt = (x: number, y: number, z: number): Float32Array | null => {
    const layers = shadowLayers();
    if (floorPlateStamp !== shadowLayerStamp) {
      floorPlateStamp = shadowLayerStamp;
      floorPlateCache.clear();
    }
    const key = `${x},${y},${z}`;
    const known = floorPlateCache.get(key);
    if (known !== undefined) return known;
    let out: Float32Array | null = null;
    for (const layer of layers) {
      const plate = floorByLayer.get(layer.id)?.get(key);
      if (!plate) continue;
      if (!out) {
        out = plate;
        continue;
      }
      // **元の板は書き換えない。** 使い回しの板を壊すと、ほかのマスまで釣られて動く。
      let merged: Float32Array | null = null;
      for (let i = 0; i < 4; i += 1) {
        if (plate[i] <= out[i]) continue;
        if (!merged) merged = new Float32Array(out);
        merged[i] = plate[i];
      }
      if (merged) out = merged;
    }
    floorPlateCache.set(key, out);
    return out;
  };

  const visibleFloorAt = (x: number, y: number, z: number): boolean => floorPlateAt(x, y, z) !== null;

  /**
   * 影を受ける地面の高さ（DEC-126）。遮る物の足元から下へ探す。
   * 箱・斜面・壁は天面（y + 1）、上向き面はマスの底（y）、横板はその少し上。
   */
  /**
   * その列で一番低い面（DEC-129）。板が「地面そのもの」か「浮いている屋根」かの目安。
   * 地面のチップは自分の高さがここと同じなので影を落とさない。屋根は 1 マス以上高い。
   */
  const lowestSurfaceAt = (x: number, z: number): number => {
    for (let y = 0; y <= 64; y += 1) {
      if (visibleSolidAt(x, y, z)) return y + 1;
      if (visibleFloorAt(x, y, z)) return y;
      if (visibleBoardAt(x, y, z)) return y;
    }
    return 0;
  };

  const groundUnder = (x: number, z: number, fromY: number): number => {
    const start = Math.max(0, Math.floor(fromY));
    // 足元と同じマスに床チップがあれば、それが地面。
    if (visibleFloorAt(x, start, z)) return start;
    for (let y = start - 1; y >= 0; y -= 1) {
      if (visibleSolidAt(x, y, z)) return y + 1;
      if (visibleFloorAt(x, y, z)) return y;
      if (visibleBoardAt(x, y, z)) return y + 0.012;
    }
    return 0;
  };

  const visibleBoardAt = (x: number, y: number, z: number): boolean => {
    const key = `${x},${y},${z}`;
    for (const layer of shadowLayers()) {
      if (boardByLayer.get(layer.id)?.has(key)) return true;
    }
    return false;
  };

  /**
   * ビルボード影が乗る「板の面」（DEC-144）。横板と上向き面。
   * どちらもマスの底が表面なので、`columnTop` は同じ扱いでよい。
   */
  const shadowSurfaceAt = (x: number, y: number, z: number): boolean =>
    visibleBoardAt(x, y, z) || visibleFloorAt(x, y, z);

  /**
   * その面の高さ（DEC-215）。`fx` / `fz` はマス内の位置（東・南へ 0..1）。
   * 坂の床チップはマスの中で高さが変わるので、真ん中の値では影が段々になる。
   * 面が無ければ null。横板は今までどおりマスの底のすぐ上。
   */
  const shadowSurfaceTop = (x: number, y: number, z: number, fx: number, fz: number): number | null => {
    const plate = floorPlateAt(x, y, z);
    if (plate) return y + plateHeight(plate, fx, fz);
    if (visibleBoardAt(x, y, z)) return y + 0.012;
    return null;
  };

  const visibleBoardColumns = (): MaskColumn[] => {
    const out: MaskColumn[] = [];
    for (const layer of map.layers) {
      if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
      if (!layerEffectivelyVisible(map.layers, layer)) continue;
      const lift = (map.layers.indexOf(layer) * LAYER_DEPTH_STEP + 0.008) / unit;
      for (const key of boardByLayer.get(layer.id) ?? []) {
        const [x, y, z] = key.split(',').map(Number);
        out.push({
          cell: { x, y, z },
          height: y + lift,
          bottom: y,
          shape: 'billboard_flat',
          rotation: 0,
        });
      }
    }
    return out;
  };


  /** レイヤー内のビルボードセル。幅広スプライトを 1 枚の絵にするため。 */
  const billboardCells = new Map<string, Set<string>>();
  const spriteStackCells = new Map<string, Set<string>>();
  for (const layer of map.layers) {
    if (isContainerKind(layer.kind)) continue;
    const spread = new Set<string>();
    const stack = new Set<string>();
    for (const batch of layer.batches) {
      if (billboardFacesCamera(batch.shape)) collectCells([batch], spread);
      if (billboardStandsUpright(batch.shape)) collectCells([batch], stack);
    }
    billboardCells.set(layer.id, spread);
    spriteStackCells.set(layer.id, stack);
  }

  /** 幅広スプライトの中央からの横ずれ（ワールド単位）。 */
  const spreadOf = (batch: BatchDef, layer: LayerDef, cellUnit: number) => {
    const set = billboardCells.get(layer.id);
    const cells = decodeCells(batch);
    return (index: number): number => {
      if (!set) return 0;
      const x = cells[index * 3];
      const y = cells[index * 3 + 1];
      const z = cells[index * 3 + 2];
      let left = x;
      while (set.has(`${left - 1},${y},${z}`)) left -= 1;
      let right = x;
      while (set.has(`${right + 1},${y},${z}`)) right += 1;
      return (x - (left + right) / 2) * cellUnit;
    };
  };

  /** チップの UV。左右反転も影に載せる。 */
  const chipUv = (batch: BatchDef, tile: number, rf: number) => {
    const def = materialsById.get(batch.mat);
    const atlas = atlasLayout(tilesetsById.get(batch.ts), texturesById.get(def?.tex ?? ''));
    const slot = Math.round(tile);
    const col = slot % atlas.cols;
    const row = Math.floor(slot / atlas.cols);
    let x = atlas.origin.x + col * atlas.step.x;
    let y = atlas.origin.y + row * atlas.step.y;
    let width = atlas.span.x;
    let height = atlas.span.y;
    if ((rf & 0b100) !== 0) {
      x += width;
      width = -width;
    }
    if ((rf & 0b1000) !== 0) {
      y += height;
      height = -height;
    }
    return { x, y, width, height };
  };

  /** 透過レイヤーのマス（DEC-252）。カメラとキャラの間にあるかを見るのに使う。 */
  const seeThroughCells = new Set<string>();
  const materials = new Map<string, ShaderMaterial>();
  /** 太陽の深度を焼く相手（DEC-145）。旧方式の影メッシュや補助線と見分けるため。 */
  const tileMaterials = new Set<ShaderMaterial>();
  const materialFor = (
    materialId: string,
    tilesetId: string,
    billboard: boolean,
    wall = false,
    card = false,
    flatFollow = false,
    layerDepth = 0,
    seeThrough = false,
  ): ShaderMaterial => {
    // 深度のずらしはレイヤーごと（DEC-123）。同じ材質でも重なり順が違えば別マテリアル。
    // 透過（DEC-251）もシェーダが変わるので鍵に混ぜる。
    // **半透明の切り替え（DEC-378）も鍵に混ぜる。** 混ぜないと、前のシーンから
    // 使い回した古い設定のマテリアルがそのまま出て、切り替えても絵が変わらない。
    const blend = materialsById.get(materialId)?.transparent === true;
    const key = `${materialId}|${tilesetId}|${billboard ? 'bb' : flatFollow ? 'flat' : card ? 'card' : wall ? 'wall' : 'st'}|${layerDepth}|${seeThrough ? 'see' : ''}|${blend ? 'blend' : ''}`;
    const existing = materials.get(key);
    if (existing) return existing;
    // 前のシーンが持っていれば作り直さない（DEC-275）。シェーダのリンクが丸ごと省ける。
    // 取ったものは向こうの手元から外す——残しておくと両方が持ち主になる。
    const handed = carried?.materials.get(key);
    if (handed && carried) {
      carried.materials.delete(key);
      materials.set(key, handed);
      tileMaterials.add(handed);
      return handed;
    }

    const def = materialsById.get(materialId);
    if (!def) throw new Error(`mep3d: unknown material '${materialId}'`);
    const texture = textures.get(def.tex);
    if (!texture) throw new Error(`mep3d: unknown texture '${def.tex}'`);

    const material = createTileMaterial(texture, def, {
      layerDepth,
      billboard,
      card: card || flatFollow,
      flatFollow,
      wall: wall && !billboard && !card && !flatFollow,
      seeThrough,
      atlas: atlasLayout(tilesetsById.get(tilesetId), texturesById.get(def.tex)),
      lighting,
      tilePx: map.grid?.tilePx,
      edgeWidth: map.edgeWidth,
      edgeFade: map.edgeFade,
      cameraFx,
      unit: map.grid?.unit ?? 1,
      normalMap: normalTextures.get(def.tex),
      pointLights,
    });
    materials.set(key, material);
    tileMaterials.add(material);
    return material;
  };

  const unit = map.grid?.unit ?? 1;
  const offsetSteps = offsetStepsFor(assets.version ?? 1);



  /**
   * 配置光源の遮光体（GC-41）。まずはブロックだけ。マスの AABB として渡す。
   * 影を塗るのではなく光を遮るので、床でも壁でも同じ式で正しく暗くなる。
   */
  const occluderBuf = createOccluderArrays();
  let occluders: Occluder[] = [];

  /** `Shade` が立っているレイヤーだけの柱。厚み・オフセットは `solidVolumes` が畳んである。 */
  const shadeColumns = (): MaskColumn[] => {
    const solidInfo = new Map<string, SolidCell>();
    for (const layer of map.layers) {
      if (isContainerKind(layer.kind)) continue;
      if (!layerEffectivelyVisible(map.layers, layer)) continue;
      if (!layerCastsShade(layer)) continue;
      for (const [key, value] of solidByLayer.get(layer.id) ?? []) solidInfo.set(key, value);
    }
    return solidVolumes(solidInfo);
  };

  /**
   * ビルボードの遮光体（GC-43）。板は光源の方を向くカード。横板も立てて扱う（GC-44）。
   * シルエットはタイルセットを跨ぐので、1 枚のアトラスへ焼いてから渡す。
   *
   * **スタンプ gid が同じセルは 1 枚の絵**としてまとめる（GC-45）。2×3 のテーブルを
   * セルごとの板 6 枚にすると、板が 1 枚ずつ光源を向いて扇状に開き、影が横へ広がる。
   * まとめ方は塗りのシルエット影（`buildSilhouettes`）と同じ。
   */
  const occScratch = new Vector3();

  const collectBillboardOccluders = (): { list: Occluder[]; atlas: OccluderAtlas | null } => {
    const chips: AtlasChip[] = [];
    const slots = new Map<string, number>();
    const pending: Array<{ occluder: Occluder; slot: number }> = [];

    type ShadeCell = {
      x: number;
      y: number;
      z: number;
      shape: string;
      proto: ProtoDef | undefined;
      tile: number;
      rf: number;
      batch: BatchDef;
      image: CanvasImageSource;
      imageWidth: number;
      imageHeight: number;
    };

    for (const layer of map.layers) {
      if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
      if (!layerEffectivelyVisible(map.layers, layer)) continue;
      if (!layerCastsShade(layer)) continue;

      // gid ごとに束ねる。0 は単独のスタンプなので、セルごとに別の鍵にする。
      const pictures = new Map<string, ShadeCell[]>();
      let loose = 0;
      for (const batch of layer.batches) {
        if (!isBillboardShape(batch.shape)) continue;
        const def = materialsById.get(batch.mat);
        if (!def || def.kind === 'invisible') continue;
        const texture = textures.get(def.tex);
        const image = texture?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
        if (!image || !image.width || !image.height) continue;
        const cells = decodeCells(batch);
        const protoIndices = decodeProtoIndices(batch);
        const flags = decodeRotationFlags(batch);
        const gids = decodeStampGids(batch);
        for (let i = 0; i < batch.count; i += 1) {
          const proto = protosById.get(batch.protos[protoIndices[i] ?? 0]);
          if (!protoCastsShade(proto)) continue;
          const gid = gids[i] ?? 0;
          const key = gid ? `g${gid}` : `c${loose++}`;
          const rf = flags[i] ?? 0;
          const cell: ShadeCell = {
            x: cells[i * 3],
            y: cells[i * 3 + 1],
            z: cells[i * 3 + 2],
            shape: batch.shape,
            proto,
            tile: faceChips(proto).front,
            rf,
            batch,
            image,
            imageWidth: image.width,
            imageHeight: image.height,
          };
          const found = pictures.get(key);
          if (found) found.push(cell);
          else pictures.set(key, [cell]);
        }
      }

      for (const picture of pictures.values()) {
        let lowX = Infinity;
        let lowY = Infinity;
        let lowZ = Infinity;
        let highX = -Infinity;
        let highY = -Infinity;
        let highZ = -Infinity;
        for (const cell of picture) {
          lowX = Math.min(lowX, cell.x);
          lowY = Math.min(lowY, cell.y);
          lowZ = Math.min(lowZ, cell.z);
          highX = Math.max(highX, cell.x);
          highY = Math.max(highY, cell.y);
          highZ = Math.max(highZ, cell.z);
        }
        const flat = isBillboardFlat(picture[0].shape);
        // 横置きは Z を高さにする。`buildSilhouettes` と同じ判定。
        const useZTall = flat || highZ - lowZ > highY - lowY;
        const across = highX - lowX + 1;
        const tall = (useZTall ? highZ - lowZ : highY - lowY) + 1;

        // 絵の中の並び。上が row 0。縦置きは Y の高いほうが上、横置きは Z の小さいほうが上。
        const rowOf = (cell: ShadeCell) => (useZTall ? cell.z - lowZ : highY - cell.y);
        const sorted = [...picture].sort(
          (a, b) => rowOf(a) - rowOf(b) || a.x - b.x,
        );
        const key = sorted
          .map((cell) => `${cell.batch.ts}|${cell.batch.mat}|${cell.tile}|${cell.rf & 0b1100}|${cell.x - lowX},${rowOf(cell)}`)
          .join(';');
        let slot = slots.get(key);
        if (slot === undefined) {
          slot = chips.length;
          slots.set(key, slot);
          chips.push({
            cols: across,
            rows: tall,
            pieces: sorted.map((cell) => ({
              image: cell.image,
              imageWidth: cell.imageWidth,
              imageHeight: cell.imageHeight,
              col: cell.x - lowX,
              row: rowOf(cell),
              uv: chipUv(cell.batch, cell.tile, cell.rf),
            })),
          });
        }

        // 置き位置の微調整（`proto.offset`）は絵の左上のセルのものを使う。描画と同じずらし方。
        const corner = sorted[0];
        const nudge = corner.proto?.offset
          ? offsetInCells(corner.proto.offset, offsetSteps, occScratch).clone()
          : new Vector3();
        // 横板も**縦板と同じ立った板**として遮る（GC-44）。塗りのシルエット影
        // （`billboardCastsSpriteShadow`）が横板を縦扱いしているので、遮光側も揃える。
        // 横板は地面に置かれているとみなすので、Y の微調整（浮き）は影に載せない。
        pending.push({
          slot,
          occluder: {
            kind: OCC_CARD,
            centre: new Vector3(
              ((lowX + highX + 1) / 2 + nudge.x) * unit,
              (lowY + (flat ? 0 : nudge.y)) * unit + (tall / 2) * unit,
              ((lowZ + highZ + 1) / 2 + nudge.z) * unit,
            ),
            size: new Vector3(across * unit, tall * unit, 0),
            frame: new Vector4(),
          },
        });
      }
    }

    const atlas = bakeOccluderAtlas(chips);
    if (!atlas) return { list: [], atlas: null };
    for (const entry of pending) entry.occluder.frame.copy(atlas.rects[entry.slot]);
    return { list: pending.map((entry) => entry.occluder), atlas };
  };

  const collectOccluders = (): Occluder[] => {
    const out: Occluder[] = [];
    for (const column of shadeColumns()) {
      // マス一杯とは限らない。プレハブは厚みもオフセットも変わる。
      const foot = column.foot ?? {
        x0: column.cell.x,
        z0: column.cell.z,
        x1: column.cell.x + 1,
        z1: column.cell.z + 1,
      };
      const bottom = column.bottom ?? column.cell.y;
      const top = column.height;
      if (top - bottom < 0.001) continue;
      // 斜面は 4 隅の高さを渡して三角として扱う。箱だと薄い側で影が出すぎる。
      const corners = column.shape ? slopeCornerHeights(column.shape) : undefined;
      const turned = corners ? rotateCorners(corners, column.rotation ?? 0) : null;
      out.push({
        kind: turned ? OCC_SLOPE : OCC_BOX,
        centre: new Vector3(
          ((foot.x0 + foot.x1) / 2) * unit,
          ((bottom + top) / 2) * unit,
          ((foot.z0 + foot.z1) / 2) * unit,
        ),
        size: new Vector3(
          (Math.abs(foot.x1 - foot.x0) / 2) * unit,
          ((top - bottom) / 2) * unit,
          (Math.abs(foot.z1 - foot.z0) / 2) * unit,
        ),
        frame: turned
          ? new Vector4(turned[0], turned[1], turned[2], turned[3])
          : new Vector4(),
      });
    }
    const billboards = collectBillboardOccluders();
    occluderAtlas = billboards.atlas;
    return out.concat(billboards.list);
  };

  let occluderAtlas: OccluderAtlas | null = null;

  const applyOccluders = () => {
    fillOccluderUniforms(occluders, emittingPointLights(pointLights), unit, occluderBuf);
    for (const material of materials.values()) {
      applyOccluderUniforms(material, occluderBuf, occluderAtlas?.texture ?? null, 0.5);
    }
  };

  const group = new Group();
  group.name = map.name;

  const collision = new Set<string>();
  const objects = new Map<string, ObjectLayer>();
  const animated: AnimatedBatch[] = [];
  /**
   * マス → 差し替え口（GS-53）。**レイヤーをまたいで同じマスに複数あり得る**ので配列で持つ。
   * 名指しが無ければ最後に置いた物（一番上のレイヤー）から差し替える。
   */
  const cellSwaps = new Map<
    string,
    Array<{
      id: string;
      name: string;
      index: number;
      swap: (i: number, faces: Partial<Record<FaceName, number>>) => void;
    }>
  >();
  /**
   * レイヤーは**名前でも id でも指せる**ようにしておく。
   * 書く人が見ているのはエディタの名前（「宝箱」）で、id（`レイヤー_5`）ではない。
   */
  const rememberSwaps = (
    layer: { id: string; name?: string },
    built: { cellAt?: Map<string, number>; swapChip?: (i: number, faces: Partial<Record<FaceName, number>>) => void },
  ) => {
    if (!built.cellAt || !built.swapChip) return;
    const swap = built.swapChip;
    for (const [key, index] of built.cellAt) {
      const list = cellSwaps.get(key) ?? [];
      list.push({ id: layer.id, name: layer.name ?? layer.id, index, swap });
      cellSwaps.set(key, list);
    }
  };
  const groups = new Map<string, Group>();
  let drawCalls = 0;
  let tiles = 0;
  let hiddenFaces = 0;
  let ghostMaterial: MeshBasicMaterial | null = null;
  const ghostMaterialOf = (): Material => {
    if (!ghostMaterial) {
      ghostMaterial = sharedGhost ??= new MeshBasicMaterial({
        color: 0x9ed1ff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        side: DoubleSide,
      });
    }
    return ghostMaterial;
  };

  for (const layer of map.layers) {
    const layerGroup = new Group();
    layerGroup.name = layer.name;
    layerGroup.visible = layer.visible !== false;
    groups.set(layer.id, layerGroup);
  }
  for (const layer of map.layers) {
    attach(groups.get(layer.id) as Group, layer.parent, groups, group);
  }

  const hideKeys = new Set<string>();
  for (const layer of map.layers) {
    if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
    if (!layerEffectivelyVisible(map.layers, layer)) continue;
    for (const batch of layer.batches) {
      if (batch.shape !== 'box') continue;
      const def = materialsById.get(batch.mat);
      if (!def || def.kind === 'invisible' || def.transparent) continue;
      const coords = decodeCells(batch);
      const protoIndices = decodeProtoIndices(batch);
      for (let i = 0; i < batch.count; i += 1) {
        const proto = protosById.get(batch.protos[protoIndices[i]]);
        const cell: SolidCell = {
          shape: 'box',
          rotation: 0,
          thickness: readThickness(proto?.thickness),
          offset: proto?.offset ?? [0, 0, 0],
          shadowOffset: proto?.shadowOffset ?? [0, 0, 0],
        };
        if (isSplitSolid(cell)) continue;
        hideKeys.add(`${coords[i * 3]},${coords[i * 3 + 1]},${coords[i * 3 + 2]}`);
      }
    }
  }
  const faceHideAt = (x: number, y: number, z: number): number => {
    if (!hideKeys.has(`${x},${y},${z}`)) return 0;
    let mask = 0;
    const n = [
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [-1, 0, 0],
      [1, 0, 0],
    ] as const;
    for (let i = 0; i < n.length; i += 1) {
      if (hideKeys.has(`${x + n[i][0]},${y + n[i][1]},${z + n[i][2]}`)) mask |= 1 << i;
    }
    return mask;
  };

  // 「下に重ねる」の鎖を下から数える（DEC-191）。入れていないレイヤーで 0 に戻る。
  // 深すぎるとズームアウトで手前へ飛び出すので、鎖は 7 段で止める（DEC-128）。
  const overlayDepths = new Map<string, number>();
  {
    let step = 0;
    for (const layer of map.layers) {
      if (isContainerKind(layer.kind)) continue;
      step = layer.overlay === true ? Math.min(7, step + 1) : 0;
      overlayDepths.set(layer.id, step);
    }
  }

  /**
   * バッチの中身を 1 本の文字列にする（DEC-276）。これが同じなら形も同じ。
   * セルの並びは符号化済みの文字列なので、比べるのは安い。
   * **`faceHideAt`（接地面除去）は入れていない**——隣のレイヤーの都合まで見ると
   * 使い回しがほぼ効かなくなる。消したときに隣へ穴が残るのは承知のうえ。
   */
  const batchSignature = (layer: LayerDef, depth: number, see: boolean, ghost: boolean, batch: BatchDef): string => {
    const attr = (value: string | number[] | undefined): string =>
      typeof value === 'string' ? value : (value ?? []).join(',');
    return [
      layer.id, depth, see ? 1 : 0, ghost ? 1 : 0,
      batch.shape, batch.mat, batch.ts, batch.mode, batch.count, batch.enc, batch.cellEnc,
      batch.anim ? JSON.stringify(batch.anim) : '',
      batch.protos.join('|'),
      attr(batch.attrs.cell), attr(batch.attrs.proto), attr(batch.attrs.rf), attr(batch.attrs.gid),
    ].join('');
  };
  /** 今回のバッチの見取り図。次の組み直しへ渡す。 */
  const meshCache = new Map<string, CarriedMesh>();
  /** 引き継いだメッシュの受け入れ待ち（DEC-276）。差し替える直前にまとめて親を移す。 */
  const pendingAdopt: Array<{ group: Group; object: Object3D }> = [];

  for (const layer of map.layers) {
    if (layer.collision) collectCells(layer.batches, collision);
    if (layer.kind === 'object') objects.set(layer.id, describeObjectLayer(layer));
    if (isContainerKind(layer.kind) || layer.kind === 'object') continue;
    // 見えないレイヤーは形を作らない（DEC-270）。目を戻したときに組み直す。
    if (options.skipHidden && !layerEffectivelyVisible(map.layers, layer)) continue;

    const layerGroup = groups.get(layer.id) as Group;
    // 深度をずらす段数（DEC-191）。「下に重ねる」を入れたレイヤーだけが、
    // すぐ下のレイヤーより 1 段手前になる。入れていなければ 0 に戻る。
    const layerDepth = overlayDepths.get(layer.id) ?? 0;
    // 透過レイヤー（DEC-251）。そのレイヤーのチップだけ別シェーダにする。
    const seeLayer = layerSeeThrough(layer);
    if (seeLayer) {
      // 遮っているかを調べるためにマスを控える（DEC-252）。
      for (const batch of layer.batches) collectCells([batch], seeThroughCells);
    }
    const materialForLayer = seeLayer
      ? (m: string, t: string, bb: boolean, w?: boolean, c?: boolean, ff?: boolean, ld?: number) =>
          materialFor(m, t, bb, w, c, ff, ld, true)
      : materialFor;
    for (const batch of layer.batches) {
      const ghost = materialsById.get(batch.mat)?.kind === 'invisible';
      // ビルボードは同じレイヤーの他のセルを見て広がりを決めるので、使い回さない（DEC-276）。
      const reusable = !billboardFacesCamera(batch.shape);
      const sig = reusable ? batchSignature(layer, layerDepth, seeLayer, ghost, batch) : '';
      const kept = reusable ? carried?.meshes.get(sig) : undefined;
      if (kept) {
        carried?.meshes.delete(sig);
        pendingAdopt.push({ group: layerGroup, object: kept.object });
        meshCache.set(sig, kept);
        drawCalls += 1;
        tiles += kept.count;
        hiddenFaces += kept.hiddenFaces;
        if (kept.animated) animated.push(kept.animated);
        rememberSwaps(layer, kept);
        continue;
      }
      if (ghost) {
        if (!options.previewInvisible) continue;
        const mesh = buildBatch(batch, {
          unit,
          layerDepth,
          protosById,
          materialFor: () => ghostMaterialOf(),
          offsetSteps,
          spreadOf: billboardFacesCamera(batch.shape) ? spreadOf(batch, layer, unit) : undefined,
          faceHideAt,
        });
        layerGroup.add(mesh.object);
        drawCalls += 1;
        tiles += batch.count;
        hiddenFaces += mesh.hiddenFaces;
        if (reusable) {
          meshCache.set(sig, { object: mesh.object, hiddenFaces: mesh.hiddenFaces, count: batch.count, animated: null, cellAt: mesh.cellAt, swapChip: mesh.swapChip });
        }
        continue;
      }

      const mesh = buildBatch(batch, {
        unit,
        layerDepth,
        protosById,
        materialFor: materialForLayer,
        offsetSteps,
        spreadOf: billboardFacesCamera(batch.shape) ? spreadOf(batch, layer, unit) : undefined,
        faceHideAt,
      });
      layerGroup.add(mesh.object);
      drawCalls += 1;
      tiles += batch.count;
      hiddenFaces += mesh.hiddenFaces;
      if (mesh.animated) animated.push(mesh.animated);
      rememberSwaps(layer, mesh);
      if (reusable) {
        meshCache.set(sig, {
          cellAt: mesh.cellAt,
          swapChip: mesh.swapChip,
          object: mesh.object,
          hiddenFaces: mesh.hiddenFaces,
          count: batch.count,
          animated: mesh.animated ?? null,
        });
      }
    }
  }

  let floorShadow: ReturnType<typeof createFloorShadow> | null = null;
  let spriteMask: ShadowMaskData | null = null;
  let spriteShadowMap: ReturnType<typeof maskTexture> | null = null;
  let envLight = true;

  // 背景の書き割り（DEC-148）。マップの北端に立てる板 1 枚。
  const backdrop = createBackdrop();
  const applyBackdrop = () => {
    backdrop.update(map.view?.backdrop, map.grid?.width ?? 40, map.grid?.depth ?? map.grid?.width ?? 40, unit);
  };
  // 鏡像のときに切られないようにする（DEC-310）。斜め近平面を入れると視錐台の判定が
  // 当てにならなくなり、**大きな物ほど落ちる**。書き割りは 1 枚しかないので、常に描いてよい。
  backdrop.mesh.frustumCulled = false;
  group.add(backdrop.mesh);
  // 光の玉（DEC-314）。点光源の姿。地形と同じ入れ物に入れるので水へも映る。
  const lightBulbs = createLightBulbs();
  lightBulbs.setLights(pointLights, unit);
  group.add(lightBulbs.mesh);

  // 太陽の影（DEC-145）。旧方式（塗り）と切り替えて見比べる。既定は旧方式。
  const sunShadow = createSunShadow();
  const sunDepthMaterials = carried?.sunDepthMaterials ?? new Map<ShaderMaterial, ShaderMaterial>();
  let sunShadowOn = false;
  let sunShadowAxis = false;
  let sunShadowDirty = true;
  /** 枠を組み直す焼き直しか（DEC-155）。動く遮蔽体が動いただけなら false。 */
  let sunShadowRefit = true;

  /** マップの外にある遮蔽体（キャラなど。DEC-154）。 */
  const sunCasters: SunCaster[] = [];

  /** 外部モデルの遮蔽（DEC-288）。中の材質はまとめて 1 枚の深度材質で焼く。 */
  const sunModels: Object3D[] = [];
  let modelDepth: MeshDepthMaterial | null = null;

  /** タイルのマテリアルだけ深度を焼く。返さなかった Mesh は焼かない。 */
  const sunDepthFor = (material: ShaderMaterial): ShaderMaterial | null => {
    const caster = sunCasters.find((entry) => entry.material === material);
    if (caster) return caster.depth;
    // 外部モデル（DEC-288）。glb の材質はマップの物ではないので、印を見て通す。
    if ((material as { userData?: { mepModelCaster?: boolean } }).userData?.mepModelCaster) {
      modelDepth ??= new MeshDepthMaterial();
      return modelDepth as unknown as ShaderMaterial;
    }
    if (!tileMaterials.has(material)) return null;
    // 混ぜる面は焼かない（DEC-378）。透ける物が真っ黒な影を落とさないように。
    if ((material as { userData?: { mepBlend?: boolean } }).userData?.mepBlend) return null;
    let depth = sunDepthMaterials.get(material);
    if (!depth) {
      depth = createTileDepthMaterial(material);
      sunDepthMaterials.set(material, depth);
    }
    return depth;
  };

  const viewLighting = () => {
    if (envLight) return lighting;
    return resolveLighting({
      ...lighting,
      intensity: 0,
      billboard: lighting.ambient,
      blockShadow: false,
    });
  };

  const dropFloorShadow = () => {
    if (floorShadow) {
      group.remove(floorShadow);
      floorShadow.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material;
        if (!Array.isArray(mat)) mat.dispose();
      });
      floorShadow = null;
    }
    spriteMask = null;
    if (spriteShadowMap) {
      spriteShadowMap.dispose();
      spriteShadowMap = null;
    }
  };

  const applyOneShadowMask = (material: ShaderMaterial) => {
    const on = material.uniforms.mepShadowOn;
    if (!on) return;
    // 旧方式のマスクは 0..1 の式（DEC-220 の 1 超えは新方式だけ）。
    const strength = Math.min(1, blockShadowStrength(lighting));
    material.uniforms.mepShadowStrength.value = strength;
    material.uniforms.mepShadowUnit.value = unit;
    if (!spriteMask || !spriteShadowMap) {
      on.value = 0;
      return;
    }
    on.value = 1;
    material.uniforms.mepShadowMap.value = spriteShadowMap;
    material.uniforms.mepShadowOrigin.value.copy(spriteMask.origin);
    material.uniforms.mepShadowSize.value.set(spriteMask.width, spriteMask.height);
    material.uniforms.mepShadowBaseY.value = spriteMask.baseY;
    material.uniforms.mepShadowTpc.value = spriteMask.texelsPerCell;
  };

  const shadowMaskTargets: ShaderMaterial[] = [];
  const lightWallTargets: ShaderMaterial[] = [];

  const applySpriteShadowMask = () => {
    for (const material of materials.values()) applyOneShadowMask(material);
    for (const material of shadowMaskTargets) applyOneShadowMask(material);
  };

  /** 新方式が効いているか。環境光を切っていれば影も無い。 */
  const sunShadowActive = () => sunShadowOn && envLight && blockShadowsOn(lighting);

  const applySunShadowUniforms = () => {
    const on = sunShadowActive();
    const strength = blockShadowStrength(lighting);
    // 雲の影は深度と無関係（DEC-218）。環境光を切っているときだけ一緒に消す。
    // 雲の影も環境光源の向きに従わせる（DEC-262）。真上から落とすと、壁では
    // 高さが変わっても同じ模様を拾い続けて縦縞になる。
    // 低い太陽で影が伸びきらないよう、仰角の下限を切る（sin 15°）。
    const cloudDir = lightDirection(lighting);
    const cloudRise = Math.max(cloudDir.y, 0.26);
    sunShadow.setCloud({
      on: envLight && lighting.cloudShadow === true && lighting.cloudShadowAmount > 0,
      amount: lighting.cloudShadowAmount,
      scale: lighting.cloudShadowScale,
      speed: lighting.cloudShadowSpeed,
      slope: [cloudDir.x / cloudRise, cloudDir.z / cloudRise],
    });
    for (const material of materials.values()) sunShadow.apply(material, on, strength);
    for (const material of shadowMaskTargets) sunShadow.apply(material, on, strength);
  };

  const rebuildFloorShadow = () => {
    dropFloorShadow();
    const shown = viewLighting();
    // 新方式のときは旧方式の塗り（床影・面影・影マスク）を出さない（DEC-145）。
    if (!sunShadowOn && blockShadowsOn(shown)) {
      const columns = visibleColumns();
      const away = shadowDirection(shown);
      const length = blockShadowLength(shown);
      const lengthOf = (column: MaskColumn) => columnSunShadowLength(column, length, shown, lightWalls);
      floorShadow = createFloorShadow(
        columns,
        away,
        length,
        unit,
        shown,
        lengthOf,
        visibleBoardColumns(),
        (column) => column.groundY ?? groundUnder(column.cell.x, column.cell.z, column.bottom ?? column.cell.y),
      );
      if (floorShadow) group.add(floorShadow);
      const extent = maskExtent(columns, map);
      if (extent) {
        spriteMask = buildShadowMask(columns, away, length, extent.low, extent.high, lengthOf);
        if (spriteMask) spriteShadowMap = maskTexture(spriteMask);
      }
    }
    applySpriteShadowMask();
  };

  const applyNearFadeUniforms = () => {
    for (const material of materials.values()) {
      if (!material.uniforms.mepNearFadeOn) continue;
      material.uniforms.mepNearFadeOn.value = nearFadeOn;
      material.uniforms.mepNearFadeDist.value = nearFadeDist;
    }
  };

  const applyAllLightWalls = () => {
    const cellUnit = map.grid?.unit ?? 1;
    for (const material of materials.values()) applyLightWallUniforms(material, lightWalls, cellUnit);
    for (const material of lightWallTargets) applyLightWallUniforms(material, lightWalls, cellUnit);
  };

  const rebuildShadows = () => {
    rebuildFloorShadow();
    applyNearFadeUniforms();
    // 太陽の深度は次のフレームで焼き直す（DEC-145）。毎フレームは焼かない。
    sunShadowDirty = true;
    sunShadowRefit = true;
  };
  applyAllLightWalls();
  applyBackdrop();
  rebuildShadows();
  occluders = collectOccluders();
  applyOccluders();

  const applyFogUniforms = () => {
    const colour = fogColor(cameraFx);
    const apply = (material: ShaderMaterial) => {
      if (!material.uniforms.mepFogOn) return;
      material.uniforms.mepFogOn.value = cameraFx.fog;
      if (material.uniforms.mepFogColor) material.uniforms.mepFogColor.value = colour;
      material.uniforms.mepFogNear.value = cameraFx.fogNear;
      material.uniforms.mepFogFar.value = cameraFx.fogFar;
      material.uniforms.mepFogMax.value = cameraFx.fogMax;
    };
    for (const material of materials.values()) apply(material);
  };

  const applyLightingUniforms = () => {
    const shown = viewLighting();
    const direction = lightDirection(shown);
    for (const material of materials.values()) {
      (material.uniforms.lightDir.value as Vector3).copy(direction);
      material.uniforms.lightAmbient.value = shown.ambient;
      material.uniforms.lightIntensity.value = shown.intensity;
      material.uniforms.lightWrap.value = shown.wrap;
      material.uniforms.lightBillboard.value = shown.billboard;
    }
  };

  const applyPointLightUniforms = () => {
    const unit = map.grid?.unit ?? 1;
    for (const material of materials.values()) {
      const pos = material.uniforms.pointLightPos?.value as Vector3[] | undefined;
      const color = material.uniforms.pointLightColor?.value as Vector3[] | undefined;
      const ir = material.uniforms.pointLightIR?.value as Vector2[] | undefined;
      const dir = material.uniforms.pointLightDir?.value as Vector3[] | undefined;
      const extra = material.uniforms.pointLightExtra?.value as Vector3[] | undefined;
      const pulse = material.uniforms.pointLightPulse?.value as Vector3[] | undefined;
      if (!pos || !color || !ir || !dir || !extra || !pulse) continue;
      material.uniforms.pointLightCount.value = fillPointLightUniforms(pointLights, unit, {
        pos,
        color,
        ir,
        dir,
        extra,
        pulse,
      });
    }
  };

  let elapsed = 0;
  /** 持ち物を次へ渡したか（DEC-275）。渡したら `dispose` で捨てない。 */
  let handedOver = false;

  return {
    group,
    map,
    assets,
    collision,
    objects,
    properties: propertiesToRecord(map.properties),
    get lighting() {
      return lighting;
    },
    get cameraFx() {
      return cameraFx;
    },
    stats: { tiles, drawCalls, hiddenFaces },
    setLighting(patch: LightingDef) {
      const next = resolveLighting({ ...lighting, ...patch });
      const same =
        next.azimuth === lighting.azimuth &&
        next.elevation === lighting.elevation &&
        next.ambient === lighting.ambient &&
        next.intensity === lighting.intensity &&
        next.wrap === lighting.wrap &&
        next.billboard === lighting.billboard &&
        next.blockShadow === lighting.blockShadow &&
        next.blockShadowStrength === lighting.blockShadowStrength &&
        next.cloudShadow === lighting.cloudShadow &&
        next.cloudShadowAmount === lighting.cloudShadowAmount &&
        next.cloudShadowScale === lighting.cloudShadowScale &&
        next.cloudShadowSpeed === lighting.cloudShadowSpeed;
      if (same) return;
      lighting = next;
      applyLightingUniforms();
      rebuildShadows();
    },
    setPointLights(lights: PointLightDef[]) {
      pointLights = [...lights];
      applyPointLightUniforms();
      applyOccluders();
      lightBulbs.setLights(pointLights, map.grid?.unit ?? 1);
    },
    setEnvLight(on: boolean) {
      if (envLight === on) return;
      envLight = on;
      applyLightingUniforms();
      rebuildShadows();
    },
    setLightWalls(layers: LightWallLayer[]) {
      lightWalls = collectLightWalls(layers);
      applyAllLightWalls();
    },
    setCellChip(at, faces, layer) {
      const list = cellSwaps.get(`${at.x},${at.y},${at.z}`);
      if (!list || list.length === 0) return false;
      // 名指しが無ければ**最後に置いた物**（一番上のレイヤー）を差し替える。
      const hits = layer ? list.filter((entry) => entry.id === layer || entry.name === layer) : list.slice(-1);
      if (hits.length === 0) return false;
      for (const hit of hits) hit.swap(hit.index, faces);
      return true;
    },
    shadowField() {
      return {
        solid: visibleSolidAt,
        selfSolid: visibleDiagAt,
        surface: shadowSurfaceAt,
        top: shadowSurfaceTop,
      };
    },
    attachShadowMask(material: ShaderMaterial) {
      if (!shadowMaskTargets.includes(material)) shadowMaskTargets.push(material);
      applyOneShadowMask(material);
    },
    bindLightWalls(material: ShaderMaterial) {
      if (!lightWallTargets.includes(material)) lightWallTargets.push(material);
      applyLightWallUniforms(material, lightWalls, map.grid?.unit ?? 1);
    },
    setActorOccluder(state: ActorOccluder | null) {
      for (const material of materials.values()) {
        const on = material.uniforms.mepActorOn;
        if (!on) continue;
        if (!state) {
          on.value = 0;
          continue;
        }
        on.value = 1;
        material.uniforms.mepActorMap.value = state.texture;
        (material.uniforms.mepActorFrame.value as Vector4).set(
          state.frame.x,
          state.frame.y,
          state.frame.width,
          state.frame.height,
        );
        (material.uniforms.mepActorFoot.value as Vector3).copy(state.foot);
        (material.uniforms.mepActorSize.value as Vector2).set(state.size.width, state.size.height);
        material.uniforms.mepActorCutoff.value = state.alphaCutoff ?? 0.5;
      }
    },
    setSunActors(actors, facing, extra = []) {
      // 太陽の影が出ていないマップ（室内・環境光オフ）では、キャラの影も出さない（チップと同じ）。
      const list = sunShadowActive() ? actors : [];
      // 向きはチップの影を焼くときと同じ（DEC-145）。軸へ倒す設定もそのまま効かせる。
      const direction = lightDirection(lighting);
      if (sunShadowAxis) snapAzimuth(direction);
      const pixel = unit / (map.grid?.tilePx ?? 32);
      for (const material of materials.values()) applySunActors(material, list, direction, facing, pixel);
      for (const material of extra) applySunActors(material, list, direction, facing, pixel);
    },
    setView(next: GameViewDef) {
      map.view = { ...next };
      applyBackdrop();
    },
    setSunCasters(list: SunCaster[]) {
      sunCasters.length = 0;
      sunCasters.push(...list);
      sunShadowDirty = true;
      sunShadowRefit = true;
    },
    setSunModels(objects: Object3D[]) {
      sunModels.length = 0;
      sunModels.push(...objects);
      sunShadowDirty = true;
      sunShadowRefit = true;
    },
    markSunDirty() {
      // 枠は据え置く。動く物のために組み直すと影が一斉に揺れる（DEC-155）。
      sunShadowDirty = true;
    },
    setSunShadow(on: boolean) {
      if (sunShadowOn === on) return;
      sunShadowOn = on;
      rebuildFloorShadow();
      sunShadowDirty = true;
      sunShadowRefit = true;
      applySunShadowUniforms();
    },
    setSunShadowBlur(radius: number) {
      sunShadow.setBlur(radius);
      applySunShadowUniforms();
    },
    setSunShadowAxis(on: boolean) {
      if (sunShadowAxis === on) return;
      sunShadowAxis = on;
      sunShadowDirty = true;
      sunShadowRefit = true;
    },
    tickSunShadow(renderer: WebGLRenderer) {
      if (!sunShadowDirty) return;
      const refit = sunShadowRefit;
      sunShadowDirty = false;
      sunShadowRefit = false;
      if (sunShadowActive()) {
        // マップが 1 枚も出ないフレームは焼かない（DEC-288）。組み直しの途中に
        // 焼くと枠が外部モデルだけに縮み、マップ全体が影に沈む。
        const baked = sunShadow.bake(
          renderer,
          [
            { object: group, fit: true, required: true },
            // 外部モデルは動かないので枠に入れてよい（DEC-288）。入れないと、
            // マップの外へはみ出した屋根の影が枠の縁で切れる。
            ...sunModels.map((object) => ({ object, fit: true })),
            // 動く物は枠に入れない。入れると格子ごとずれて全部の影が揺れる（DEC-155）。
            ...sunCasters.map((entry) => ({ object: entry.object, fit: false })),
          ],
          {
            direction: lightDirection(lighting),
            unit,
            artPixel: unit / (map.grid?.tilePx ?? 32),
            snapAxis: sunShadowAxis,
            refit,
          },
          sunDepthFor,
        );
        if (!baked) {
          sunShadowDirty = true;
          sunShadowRefit = sunShadowRefit || refit;
          return;
        }
      }
      applySunShadowUniforms();
    },
    setCullHidden(on: boolean) {
      const value = on ? 1 : 0;
      for (const material of materials.values()) {
        if (material.uniforms.cullHidden) material.uniforms.cullHidden.value = value;
      }
    },
    setCameraFx(raw: CameraFxDef) {
      cameraFx = resolveCameraFx(raw);
      applyFogUniforms();
    },
    setEdge(width?: number, fade?: number) {
      if (width === undefined) delete map.edgeWidth;
      else map.edgeWidth = width;
      if (fade === undefined || fade === 0) delete map.edgeFade;
      else map.edgeFade = fade;
      const nextWidth = edgeWidthFor(map.grid?.tilePx, width);
      const nextFade = edgeFadeFor(fade);
      for (const material of materials.values()) {
        material.uniforms.edgeWidth.value = nextWidth;
        material.uniforms.edgeFade.value = nextFade;
      }
    },
    setSeeThrough(amount) {
      const value = Math.min(1, Math.max(0, amount));
      for (const material of materials.values()) {
        const flag = material.uniforms.mepSeeOn;
        if (flag) flag.value = value;
      }
    },
    seeThroughAt(x, y, z) {
      return seeThroughCells.has(`${x},${y},${z}`);
    },
    setNearFade(distance: number, wallMode = 0) {
      nearFadeOn = wallMode;
      nearFadeDist = Math.max(0, distance);
      applyNearFadeUniforms();
    },
    syncLayerVisibility(layers: Array<{ id: string; visible: boolean }>) {
      const byId = new Map(layers.map((entry) => [entry.id, entry.visible]));
      for (const layer of map.layers) {
        const visible = byId.get(layer.id);
        if (visible !== undefined) layer.visible = visible;
        const layerGroup = groups.get(layer.id);
        if (layerGroup) layerGroup.visible = layer.visible !== false;
      }
      rebuildShadows();
    },
    get time() {
      return elapsed;
    },
    get skyTexture() {
      return backdrop.texture();
    },
    update(deltaSeconds: number) {
      elapsed += deltaSeconds;
      // 玉の点滅はタイルと同じ時計で進める（DEC-314）。ずれると拍が合わない。
      lightBulbs.setTime(elapsed);
      for (const material of materials.values()) {
        if (material.uniforms.lightTime) material.uniforms.lightTime.value = elapsed;
        // 雲を流す（DEC-218）。焼き直しは要らないので時計だけ進める。
        if (material.uniforms.mepCloudTime) material.uniforms.mepCloudTime.value = elapsed;
      }
      for (const material of shadowMaskTargets) {
        if (material.uniforms.mepCloudTime) material.uniforms.mepCloudTime.value = elapsed;
      }
      if (animated.length === 0) return;
      for (const entry of animated) {
        const index = frameAt(entry.sequence, elapsed);
        if (index === entry.currentFrame) continue;
        entry.currentFrame = index;
        entry.apply(entry.sequence.steps[index].tile);
      }
    },
    carry() {
      handedOver = true;
      return { assets, textures, normalTextures, materials, sunDepthMaterials, meshes: meshCache };
    },
    adopt() {
      for (const entry of pendingAdopt) entry.group.add(entry.object);
      pendingAdopt.length = 0;
    },
    reclaim(carried) {
      for (const [key, material] of carried.materials) {
        if (!materials.has(key)) materials.set(key, material);
      }
      handedOver = false;
    },
    dispose() {
      group.traverse((object) => {
        const mesh = object as InstancedMesh;
        if (mesh.isInstancedMesh) mesh.geometry.dispose();
      });
      // 持ち物を渡したあとは捨てない（DEC-275）。次のシーンが使っている。
      if (!handedOver) {
        for (const material of materials.values()) material.dispose();
        for (const texture of textures.values()) texture.dispose();
        for (const texture of normalTextures.values()) texture.dispose();
        for (const material of sunDepthMaterials.values()) material.dispose();
      }
      // ゴーストはモジュールで使い回す（DEC-277）。ここで捨てない。
      if (!handedOver) sunDepthMaterials.clear();
      sunShadow.dispose();
      backdrop.dispose();
      lightBulbs.dispose();
      dropFloorShadow();
    },
  };
}

function columnSunShadowLength(
  column: MaskColumn,
  fullLength: number,
  lighting: ReturnType<typeof resolveLighting>,
  walls: LightWall[],
): number {
  const foot = column.foot;
  const x0 = foot?.x0 ?? column.cell.x;
  const z0 = foot?.z0 ?? column.cell.z;
  const x1 = foot?.x1 ?? column.cell.x + 1;
  const z1 = foot?.z1 ?? column.cell.z + 1;
  const y0 = column.bottom ?? 0;
  const y1 = column.height;
  return clipDirectionalShadowLength(
    { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 },
    y0,
    Math.max(0.2, y1 - y0),
    fullLength,
    lighting,
    walls,
  );
}

/**
 * バッチ 1 つを組んだ結果（GS-53）。
 * `swapChip` と `cellAt` は**マス 1 つの絵を後から差し替える**ための口。
 */
interface BuiltBatch {
  object: InstancedMesh;
  animated?: AnimatedBatch;
  hiddenFaces: number;
  /** マス（`x,y,z`）→ そのバッチの中の番号。 */
  cellAt?: Map<string, number>;
  /** その番号の絵を差し替える。書いた面だけ変える。 */
  swapChip?: (index: number, faces: Partial<Record<FaceName, number>>) => void;
}

interface AnimatedBatch {
  /** pingpong は展開済み。再生はリストを歩くだけ。 */
  sequence: PlaySequence;
  currentFrame: number;
  apply(tile: number): void;
}

interface BatchContext {
  unit: number;
  layerDepth: number;
  protosById: Map<string, ProtoDef>;
  materialFor(materialId: string, tilesetId: string, billboard: boolean, wall?: boolean, card?: boolean, flatFollow?: boolean, layerDepth?: number): Material;
  /** `proto.offset` の分母。アセット version による。 */
  offsetSteps: number;
  /** ビルボードが属するスプライト中央からのずれ（ワールド単位）。 */
  spreadOf?: (index: number) => number;
  faceHideAt?: (x: number, y: number, z: number) => number;
}

function buildBatch(
  batch: BatchDef,
  context: BatchContext,
): BuiltBatch {
  if (batch.mode === 'merged') {
    throw new Error(
      `mep3d: batch '${batch.id}' uses mode "merged", which this loader does not implement yet.`,
    );
  }

  const cells = decodeCells(batch);
  const protoIndices = decodeProtoIndices(batch);
  const flags = decodeRotationFlags(batch);
  const count = batch.count;

  const geometry = geometryFor(batch.shape).clone();
  const chips = new Float32Array(count * 4);
  // w に隠す面を畳んである。頂点属性の枠が 16 しかないため（GC-36）。
  const sides = new Float32Array(count * 4);
  const edges = new Float32Array(count);
  const emitAttr = new Float32Array(count);
  const thickYAttr = new Float32Array(count);
  const thickZAttr = new Float32Array(count);
  const thickXAttr = new Float32Array(count);
  const faceAnchorAttr = new Float32Array(count);
  const faceFitAttr = new Float32Array(count);
  geometry.setAttribute('chip', new InstancedBufferAttribute(chips, 4));
  geometry.setAttribute('chipSides', new InstancedBufferAttribute(sides, 4));
  geometry.setAttribute('chipEdge', new InstancedBufferAttribute(edges, 1));
  geometry.setAttribute('chipEmit', new InstancedBufferAttribute(emitAttr, 1));
  geometry.setAttribute('boxThickY', new InstancedBufferAttribute(thickYAttr, 1));
  geometry.setAttribute('boxThickZ', new InstancedBufferAttribute(thickZAttr, 1));
  geometry.setAttribute('boxThickX', new InstancedBufferAttribute(thickXAttr, 1));
  geometry.setAttribute('faceAnchor', new InstancedBufferAttribute(faceAnchorAttr, 1));
  geometry.setAttribute('faceFit', new InstancedBufferAttribute(faceFitAttr, 1));

  const facesCamera = billboardFacesCamera(batch.shape);
  const flatFollow = billboardFollowsYaw(batch.shape);
  const card = isBillboardShape(batch.shape) && !facesCamera && !flatFollow;
  const material = context.materialFor(batch.mat, batch.ts, facesCamera, isWallShape(batch.shape), card, flatFollow, context.layerDepth);
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.name = batch.id;
  mesh.frustumCulled = false;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3(context.unit, context.unit, context.unit);
  const offset = new Vector3();

  // 面 1 枚の形は厚みを持てないので、厚みを「切り取り」として使う（DEC-96）。
  const cropsFace = cropsFaceShape(batch.shape);
  const shapeOffset = offsetFor(batch.shape);
  // 重なりのずらしは深度だけ（DEC-123）。頂点を動かすと、レイヤーが深いほど
  // 絵が 1px ずれて見えた（プレハブは新しいレイヤーに入るので目立つ）。
  const layerLift = new Vector3();
  const lift = new Vector3();
  const scratch = new Vector3();

  for (let i = 0; i < count; i += 1) {
    const rf = flags[i] ?? 0;
    const rotation = shapeRotates(batch.shape) ? rf & ROTATION_MASK : 0;
    const proto = context.protosById.get(batch.protos[protoIndices[i]]);
    const nudge = proto?.offset;
    const [thickY, thickZ, thickX] = readThickness(proto?.thickness);
    // 箱は厚み、板は切り取り（DEC-96）。どちらも同じ属性で渡す。
    const thickness = batch.shape === 'box' || cropsFace;
    const hy = thickness ? boxHeight(thickY) : 1;
    const hz = thickness ? boxHeight(thickZ) : 1;
    const hx = thickness ? boxHeight(thickX) : 1;
    scale.set(context.unit, context.unit, context.unit);
    if (thickness && Math.abs(hy - 1) > 1e-6) {
      thickYAttr[i] = thickY < 0 ? -hy : hy;
    }
    if (thickness && Math.abs(hz - 1) > 1e-6) {
      thickZAttr[i] = thickZ < 0 ? -hz : hz;
    }
    if (thickness && Math.abs(hx - 1) > 1e-6) {
      thickXAttr[i] = thickX < 0 ? -hx : hx;
    }

    if (isEdgeWallShape(batch.shape)) {
      applyWallPose(rotation, offset, quaternion);
      offset.multiplyScalar(context.unit);
      offset.add(lift.copy(layerLift).applyQuaternion(quaternion));
    } else {
      quaternion.setFromAxisAngle(UP, (-rotation * Math.PI) / 2);
      offset.copy(shapeOffset).multiplyScalar(context.unit).applyQuaternion(quaternion);
      offset.add(lift.copy(layerLift).applyQuaternion(quaternion));
    }
    if (nudge) {
      offset.add(offsetInCells(nudge, context.offsetSteps, scratch).multiplyScalar(context.unit));
    }
    position
      .set(cells[i * 3] + 0.5, cells[i * 3 + 1] + 0.5, cells[i * 3 + 2] + 0.5)
      .multiplyScalar(context.unit)
      .add(offset);

    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);

    const faces = faceChips(proto);
    const top = context.spreadOf ? context.spreadOf(i) : faces.top;
    writeChip(chips, i, [top, faces.front, faces.bottom, rf]);
    sides[i * 4] = faces.back;
    sides[i * 4 + 1] = faces.left;
    sides[i * 4 + 2] = faces.right;
    edges[i] = EDGE_SHAPES.has(batch.shape) ? (proto?.edge ?? 0) : 0;
    emitAttr[i] = emitMaskOf(proto);
    // 板の切り取りの目印。隠す面（bit 0..5）とぶつからない 128 の位に置く（DEC-96）。
    if (cropsFace) sides[i * 4 + 3] = PLANE_CROP_BIT;
    // 上向きの明るさ（DEC-125）。面の向きに関わらず、光は真上から受けたことにする。
    if (shadeUpOf(proto)) sides[i * 4 + 3] |= SHADE_UP_BIT;
    if (batch.shape === 'box') {
      faceAnchorAttr[i] = packFaceAnchorAttr(proto?.faceAnchor);
      faceFitAttr[i] = packFaceFitAttr(proto?.faceFit);
      sides[i * 4 + 3] = context.faceHideAt?.(cells[i * 3], cells[i * 3 + 1], cells[i * 3 + 2]) ?? 0;
    }
  }

  let hiddenCount = 0;
  for (let i = 0; i < count; i += 1) {
    let bits = (sides[i * 4 + 3] | 0) & HIDE_FACE_MASK;
    while (bits) {
      hiddenCount += bits & 1;
      bits >>= 1;
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();

  /**
   * マス 1 つの絵を差し替える（GS-53）。**属性を書き換えるだけ**——
   * 形も材質も同じバッチの中の話なので、ジオメトリも組み直さない。
   * アニメーションするチップ（滝など）が毎フレームやっているのと同じ手口。
   */
  const swapChip = (index: number, faces: Partial<Record<FaceName, number>>): void => {
    if (index < 0 || index >= count) return;
    const proto = context.protosById.get(batch.protos[protoIndices[index]]);
    const now = faceChips(proto);
    const next = { ...now, ...faces };
    const top = context.spreadOf ? context.spreadOf(index) : next.top;
    writeChip(chips, index, [top, next.front, next.bottom, flags[index] ?? 0]);
    sides[index * 4] = next.back;
    sides[index * 4 + 1] = next.left;
    sides[index * 4 + 2] = next.right;
    // `sides[3]` は隠す面と切り取りの目印。**隣のマスで決まる話**なので触らない。
    (geometry.getAttribute('chip') as InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute('chipSides') as InstancedBufferAttribute).needsUpdate = true;
  };

  /** どのマスがどの番号か。差し替えのときに引く。 */
  const cellAt = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    cellAt.set(`${cells[i * 3]},${cells[i * 3 + 1]},${cells[i * 3 + 2]}`, i);
  }

  if (!batch.anim || batch.anim.frames.length === 0) {
    return { object: mesh, hiddenFaces: hiddenCount, swapChip, cellAt };
  }

  const chipAttribute = geometry.getAttribute('chip') as InstancedBufferAttribute;
  const sideAttribute = geometry.getAttribute('chipSides') as InstancedBufferAttribute;
  return {
    object: mesh,
    hiddenFaces: hiddenCount,
    swapChip,
    cellAt,
    animated: {
      sequence: playSequence(batch.anim),
      currentFrame: -1,
      apply(tile: number) {
        for (let i = 0; i < count; i += 1) {
          const top = context.spreadOf ? context.spreadOf(i) : tile;
          writeChip(chips, i, [top, tile, tile, flags[i] ?? 0]);
          sides[i * 4] = tile;
          sides[i * 4 + 1] = tile;
          sides[i * 4 + 2] = tile;
        }
        chipAttribute.needsUpdate = true;
        sideAttribute.needsUpdate = true;
      },
    },
  };
}

function writeChip(target: Float32Array, index: number, rect: [number, number, number, number]) {
  target[index * 4] = rect[0];
  target[index * 4 + 1] = rect[1];
  target[index * 4 + 2] = rect[2];
  target[index * 4 + 3] = rect[3];
}

/** 環境光を上向き面として受けるか（DEC-125）。エディタ側と同じ判定。 */
function shadeUpOf(proto: ProtoDef | undefined): boolean {
  return proto?.shadeUp === true;
}

function emitMaskOf(proto: ProtoDef | undefined): number {
  if (!proto) return 0;
  if (proto.emissive === true) return 63;
  if (typeof proto.emissive === 'number' && Number.isFinite(proto.emissive)) {
    return Math.round(proto.emissive) & 63;
  }
  return 0;
}

/**
 * `invisible` のゴースト（DEC-277）。中身が固定なのでモジュールで持ち回す。
 * シーンごとに作ると、組み直しのたびにプログラムのリンクが 1 本増える。
 */
let sharedGhost: MeshBasicMaterial | null = null;

/** チップ端を 0.01 テクセル内側へ。隣チップの 1px 線が出ないように。 */
const UV_INSET_TEXELS = 0.01;

function atlasLayout(tileset: TilesetDef | undefined, texture: TextureDef | undefined): AtlasLayout {
  if (!tileset || !texture) {
    return { cols: 1, origin: new Vector2(), step: new Vector2(1, 1), span: new Vector2(1, 1) };
  }
  const stride = tileset.tile + tileset.spacing;
  const inset = UV_INSET_TEXELS;
  return {
    cols: tileset.cols,
    origin: new Vector2(
      (tileset.margin + inset) / texture.w,
      (tileset.margin + inset) / texture.h,
    ),
    step: new Vector2(stride / texture.w, stride / texture.h),
    span: new Vector2(
      (tileset.tile - inset * 2) / texture.w,
      (tileset.tile - inset * 2) / texture.h,
    ),
  };
}

function faceChips(proto: ProtoDef | undefined): Record<FaceName, number> {
  const tile = proto?.tile ?? 0;
  const faces = proto?.faces;
  const side = faces?.side ?? tile;
  const at = (value: number) => normaliseFaceValue(value);
  return {
    top: at(faces?.top ?? tile),
    bottom: at(faces?.bottom ?? tile),
    front: at(faces?.front ?? side),
    back: at(faces?.back ?? side),
    left: at(faces?.left ?? side),
    right: at(faces?.right ?? side),
  };
}

function collectCells(batches: BatchDef[], into: Set<string>): void {
  for (const batch of batches) {
    const cells = decodeCells(batch);
    for (let i = 0; i + 2 < cells.length; i += 3) {
      into.add(`${cells[i]},${cells[i + 1]},${cells[i + 2]}`);
    }
  }
}

function isSloped(shape: Shape): boolean {
  return shape === 'slope' || shape === 'slope_corner' || shape === 'slope_corner_in';
}

function hasNudge(offset: [number, number, number]): boolean {
  return offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0;
}

/** 絵のずれ＋スタンプ全体の影開始。gid 組は 1 つの shadowOffset を共有する。 */

function markBoxVisual(
  into: Set<string>,
  x: number,
  y: number,
  z: number,
  thickness: [number, number, number],
  rotation: number,
  offset: [number, number, number],
  scratch: Vector3,
): void {
  const [ty, tz, tx] = thickness;
  if (
    Math.abs(ty) === OFFSET_STEPS &&
    Math.abs(tz) === OFFSET_STEPS &&
    Math.abs(tx) === OFFSET_STEPS &&
    !hasNudge(offset)
  ) {
    into.add(`${x},${y},${z}`);
    return;
  }
  const hy = boxHeight(ty);
  const y0 = ty < 0 ? y : y + 1 - hy;
  const foot = boxFootprint(x, z, tz, rotation, tx);
  offsetInCells(offset, OFFSET_STEPS, scratch);
  const x0 = foot.x0 + scratch.x;
  const x1 = foot.x1 + scratch.x;
  const z0 = foot.z0 + scratch.z;
  const z1 = foot.z1 + scratch.z;
  const ya = y0 + scratch.y;
  const yb = y0 + hy + scratch.y;
  const minX = Math.floor(x0 + 1e-6);
  const maxX = Math.ceil(x1 - 1e-6) - 1;
  const minY = Math.floor(ya + 1e-6);
  const maxY = Math.ceil(yb - 1e-6) - 1;
  const minZ = Math.floor(z0 + 1e-6);
  const maxZ = Math.ceil(z1 - 1e-6) - 1;
  for (let cy = minY; cy <= maxY; cy += 1) {
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        into.add(`${cx},${cy},${cz}`);
      }
    }
  }
}

function nudgeColumn(column: MaskColumn, offset: [number, number, number], shift: Vector3): void {
  if (!hasNudge(offset)) return;
  offsetInCells(offset, OFFSET_STEPS, shift);
  const foot = column.foot ?? {
    x0: column.cell.x,
    z0: column.cell.z,
    x1: column.cell.x + 1,
    z1: column.cell.z + 1,
  };
  column.foot = {
    x0: foot.x0 + shift.x,
    z0: foot.z0 + shift.z,
    x1: foot.x1 + shift.x,
    z1: foot.z1 + shift.z,
  };
  column.height += shift.y;
  if (column.bottom !== undefined) column.bottom += shift.y;
}

function isSplitSolid(cell: SolidCell | undefined): boolean {
  if (!cell) return true;
  if (isSloped(cell.shape) || hasNudge(cell.offset) || hasNudge(cell.shadowOffset)) return true;
  return (
    Math.abs(cell.thickness[0]) !== OFFSET_STEPS ||
    Math.abs(cell.thickness[1]) !== OFFSET_STEPS ||
    Math.abs(cell.thickness[2]) !== OFFSET_STEPS
  );
}

/** 箱は縦にまとめる。薄い箱・ずらした箱・斜面はセルごとに分け、頂点が箱にならないようにする。 */
function solidVolumes(info: Map<string, SolidCell>): MaskColumn[] {
  const visited = new Set<string>();
  const volumes: MaskColumn[] = [];
  const shift = new Vector3();
  for (const [key, cell] of info) {
    if (visited.has(key)) continue;
    const [x, y, z] = key.split(',').map(Number);
    const [thickY, thickZ, thickX] = cell.thickness;
    if (isSplitSolid(cell)) {
      visited.add(key);
      const hy = boxHeight(thickY);
      const column: MaskColumn = {
        cell: { x, y, z },
        height: thickY < 0 ? y + hy : y + 1,
        bottom: thickY < 0 ? y : y + 1 - hy,
        shape: cell.shape,
        rotation: shapeRotates(cell.shape) ? cell.rotation : 0,
      };
      if (Math.abs(thickZ) !== OFFSET_STEPS || Math.abs(thickX) !== OFFSET_STEPS) {
        column.foot = boxFootprint(x, z, thickZ, cell.rotation, thickX);
      }
      nudgeColumn(column, cell.offset, shift);
      nudgeColumn(column, cell.shadowOffset, shift);
      volumes.push(column);
      continue;
    }
    let lo = y;
    let hi = y;
    while (!isSplitSolid(info.get(`${x},${lo - 1},${z}`))) lo -= 1;
    while (!isSplitSolid(info.get(`${x},${hi + 1},${z}`))) hi += 1;
    for (let yy = lo; yy <= hi; yy += 1) visited.add(`${x},${yy},${z}`);
    volumes.push({
      cell: { x, y: hi, z },
      height: hi + 1,
      bottom: lo,
      shape: 'box',
      rotation: 0,
    });
  }
  return volumes;
}

/** 壁チップの厚み（マス）。板 1 枚なので絵の厚みは無いが、影を作るには幅が要る。 */
const WALL_FOOT = 2 / OFFSET_STEPS;

/**
 * 壁チップの足跡。板はマスの縁に立つので、その縁から**マスの内側へ**伸ばした細い帯にする。
 * 縁をまたがせると、影のシルエットがマスより 1/32 マス（＝1px）外へはみ出す（DEC-142）。
 */
function wallFoot(x: number, z: number, rotation: number): { x0: number; z0: number; x1: number; z1: number } {
  const width = WALL_FOOT;
  const r = ((rotation % 4) + 4) % 4;
  if (r === 0) return { x0: x, z0: z + 1 - width, x1: x + 1, z1: z + 1 };
  if (r === 1) return { x0: x + 1 - width, z0: z, x1: x + 1, z1: z + 1 };
  if (r === 2) return { x0: x, z0: z, x1: x + 1, z1: z + width };
  return { x0: x, z0: z, x1: x + width, z1: z + 1 };
}

/**
 * 壁チップの柱（DEC-76）。板だが絵としては光を遮るので、ブロック影と影マスクへ入れる。
 * 縦に続く同じ向きの壁は 1 本にまとめる。切ると継ぎ目に筋が出る。
 * 形は `box` として渡す。中身は「薄い箱」そのものなので、投影も受けも既存の式でよい。
 */
function wallVolumes(info: Map<string, SolidCell>): MaskColumn[] {
  const visited = new Set<string>();
  const volumes: MaskColumn[] = [];
  const shift = new Vector3();
  for (const [key, cell] of info) {
    if (visited.has(key)) continue;
    const [x, y, z] = key.split(',').map(Number);
    const joins = (at: string): boolean => {
      const other = info.get(at);
      return Boolean(other) && other?.rotation === cell.rotation && !hasNudge(cell.offset);
    };
    let lo = y;
    let hi = y;
    while (joins(`${x},${lo - 1},${z}`)) lo -= 1;
    while (joins(`${x},${hi + 1},${z}`)) hi += 1;
    for (let yy = lo; yy <= hi; yy += 1) visited.add(`${x},${yy},${z}`);
    const column: MaskColumn = {
      cell: { x, y: hi, z },
      height: hi + 1,
      bottom: lo,
      shape: 'box',
      rotation: 0,
      foot: wallFoot(x, z, cell.rotation),
      castOnly: true,
    };
    nudgeColumn(column, cell.offset, shift);
    nudgeColumn(column, cell.shadowOffset, shift);
    volumes.push(column);
  }
  return volumes;
}

/** 影マスクの範囲。マップ境界と遮蔽の両方を覆う。 */
function maskExtent(
  columns: MaskColumn[],
  map: MapDef,
): { low: { x: number; y: number; z: number }; high: { x: number; y: number; z: number } } | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const column of columns) {
    const x0 = column.foot?.x0 ?? column.cell.x;
    const x1 = column.foot?.x1 ?? column.cell.x;
    const z0 = column.foot?.z0 ?? column.cell.z;
    const z1 = column.foot?.z1 ?? column.cell.z;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, column.bottom ?? column.cell.y);
    minZ = Math.min(minZ, z0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, column.height);
    maxZ = Math.max(maxZ, z1);
  }
  if (!map.bounds.empty) {
    minX = Math.min(minX, map.bounds.min[0]);
    minY = Math.min(minY, map.bounds.min[1]);
    minZ = Math.min(minZ, map.bounds.min[2]);
    maxX = Math.max(maxX, map.bounds.max[0]);
    maxY = Math.max(maxY, map.bounds.max[1]);
    maxZ = Math.max(maxZ, map.bounds.max[2]);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    low: { x: Math.floor(minX), y: Math.floor(minY), z: Math.floor(minZ) },
    high: { x: Math.ceil(maxX), y: Math.ceil(maxY), z: Math.ceil(maxZ) },
  };
}

/** オブジェクトレイヤーはゲームでは描かない。形状は items。 */
function describeObjectLayer(layer: LayerDef): ObjectLayer {
  return {
    id: layer.id,
    name: layer.name,
    collision: layer.collision === true,
    properties: propertiesToRecord(layer.properties),
    items: (layer.objects ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      collision: entry.collision === true,
      properties: propertiesToRecord(entry.properties),
      ...(entry.space ? { space: entry.space } : {}),
      ...(entry.plane && entry.plane !== 'xz' ? { plane: entry.plane } : {}),
      y: entry.y,
      ...(entry.z !== undefined ? { z: entry.z } : {}),
      ...(entry.x !== undefined ? { x: entry.x } : {}),
      ...(entry.height && entry.height > 0 ? { height: entry.height } : {}),
      points: entry.points.map((point) => [point[0], point[1]] as [number, number]),
      ...(entry.cells?.length ? { cells: entry.cells.map((cell) => [cell[0], cell[1], cell[2]] as [number, number, number]) } : {}),
    })),
    cells: [],
  };
}

function attach(
  layerGroup: Group,
  parentId: string | undefined,
  groups: Map<string, Group>,
  root: Group,
): void {
  const parent = parentId ? groups.get(parentId) : undefined;
  (parent ?? root).add(layerGroup);
}

/**
 * 親をたどる用の id 索引。**呼ぶたびに組み直さない**（DEC-266）。
 * 影の判定は 1 フレームに数千回ここを通るので、毎回 Map を組むと
 * それだけで 1 回の影の組み直しが 50ms 掛かり、歩くたびに画面が止まる。
 * 索引が持つのは id → レイヤーの**参照**だけなので、`visible` を書き換えても古びない。
 * 配列そのものが差し替わったとき（＝マップを組み直したとき）だけ作り直す。
 */
let visibleIndexFor: LayerDef[] | null = null;
let visibleIndex = new Map<string, LayerDef>();

function layerEffectivelyVisible(layers: LayerDef[], layer: LayerDef): boolean {
  if (visibleIndexFor !== layers || visibleIndex.size !== layers.length) {
    visibleIndexFor = layers;
    visibleIndex = new Map(layers.map((entry) => [entry.id, entry]));
  }
  const byId = visibleIndex;
  let current: LayerDef | undefined = layer;
  let guard = 0;
  while (current && guard < layers.length) {
    if (current.visible === false) return false;
    current = current.parent ? byId.get(current.parent) : undefined;
    guard += 1;
  }
  return true;
}

async function loadTextures(defs: TextureDef[], assetBase: string): Promise<Map<string, Texture>> {
  const loader = new TextureLoader();
  const entries = await Promise.all(
    defs.map(async (def) => {
      const url = def.data ?? new URL(def.src, assetBase).href;
      const texture = await loader.loadAsync(url);
      texture.colorSpace = SRGBColorSpace;
      texture.flipY = false;
      const filter = def.filter === 'linear' ? LinearFilter : NearestFilter;
      texture.magFilter = filter;
      texture.minFilter = filter;
      texture.generateMipmaps = false;
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return [def.id, texture] as const;
    }),
  );
  return new Map(entries);
}

/**
 * タイルセット画像に対する法線マップの探し先。上から順に試す（DEC-53）。
 * 専用フォルダ `tilesets_normal/` を先に見る。同名でも `_normal` 付きでも拾う。
 */
function normalMapCandidates(src: string): string[] {
  const path = src.replace(/\\/g, '/');
  const slash = path.lastIndexOf('/');
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const dot = file.lastIndexOf('.');
  if (dot < 1) return [];
  const stem = file.slice(0, dot);
  const ext = file.slice(dot);
  if (stem.endsWith('_normal')) return [];
  const out: string[] = [];
  if (path.includes('/tilesets/')) {
    const normalDir = dir.replace('/tilesets/', '/tilesets_normal/');
    out.push(`${normalDir}${stem}${ext}`);
    out.push(`${normalDir}${stem}_normal${ext}`);
  }
  out.push(`${dir}${stem}_normal${ext}`);
  return [...new Set(out)];
}

/**
 * 法線マップの在り処（DEC-269）。**組み直しのたびに探し直さない**。
 * 開発サーバは無い絵にも index.html を 200 で返すので、外れの候補は「取れたが画像として
 * 読めない」で失敗する——1 枚あたり最大 3 回。エディタはチップを 1 個置くたびに
 * シーンを組み直すので、これを全タイルセットぶん繰り返して **120ms** 掛かっていた。
 * 憶えるのは URL だけ（無ければ null）。テクスチャ自体は今までどおり組み直しごとに作る
 * ——`dispose()` が持ち主として捨てるので、使い回すと次の組み直しで空になる。
 * 絵を後から置いたときは、エディタを開き直せば拾い直す。
 */
const normalMapUrls = new Map<string, string | null>();

async function findNormalMap(
  def: TextureDef,
  assetBase: string,
  hasFile?: (path: string) => boolean,
): Promise<string | null> {
  const cacheKey = def.data ? `inline:${def.id}` : new URL(def.src, assetBase).href;
  const known = normalMapUrls.get(cacheKey);
  if (known !== undefined) return known;
  let found: string | null = null;
  for (const companion of normalMapCandidates(def.src)) {
    const url = new URL(companion, assetBase).href;
    // 台帳があるなら**聞くだけ**（DEC-374）。無い絵を取りに行かなくて済む。
    if (hasFile) {
      if (!hasFile(companion)) continue;
      found = url;
      break;
    }
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) continue;
      // 開発サーバは無い絵に index.html を返す。中身の種類で弾かないと、
      // 画像として読めるまで候補を全部なめることになる。
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) continue;
      found = url;
      break;
    } catch {
      continue;
    }
  }
  normalMapUrls.set(cacheKey, found);
  return found;
}

async function loadNormalTextures(
  defs: TextureDef[],
  assetBase: string,
  hasFile?: (path: string) => boolean,
): Promise<Map<string, Texture>> {
  const loader = new TextureLoader();
  const entries = await Promise.all(
    defs.map(async (def) => {
      const url = await findNormalMap(def, assetBase, hasFile);
      if (url) {
        try {
          const texture = await loader.loadAsync(url);
          texture.colorSpace = NoColorSpace;
          texture.flipY = false;
          const filter = def.filter === 'linear' ? LinearFilter : NearestFilter;
          texture.magFilter = filter;
          texture.minFilter = filter;
          texture.generateMipmaps = false;
          texture.wrapS = ClampToEdgeWrapping;
          texture.wrapT = ClampToEdgeWrapping;
          texture.needsUpdate = true;
          return [def.id, texture] as const;
        } catch {
          return null;
        }
      }
      return null;
    }),
  );
  return new Map(entries.filter((entry): entry is readonly [string, Texture] => entry !== null));
}

function indexBy<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}
