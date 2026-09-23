/** mep3d の JSON 型。1 オブジェクトにつき 1 インターフェース。このファイルだけでマップが読める。 */

export type Shape =
  | 'floor'
  /** 床の直角二等辺三角形（45/45/90）。名前は**直角の隅**。◤ nw / ◥ ne / ◢ se / ◣ sw。 */
  | 'floor_tri_nw'
  | 'floor_tri_ne'
  | 'floor_tri_se'
  | 'floor_tri_sw'
  /**
   * 傾いた床（坂の面）。マスを埋めない面 1 枚で、マスを斜めに切った断面と同じ。
   * 名前は**高いほうの辺**。`e` は東が高い（南から見て ／）、`w` は西が高い（＼）。
   * R で 90 度ずつ回すと南北へ傾く。
   */
  | 'floor_ramp_e'
  | 'floor_ramp_w'
  /**
   * 南北へ傾く坂（DEC-204）。`n` は北が高い（南から北へ上る）、`s` は南が高い。
   * **R で回すと絵も一緒に回る**ので、向きの違う坂は形状として分けてある。
   */
  | 'floor_ramp_n'
  | 'floor_ramp_s'
  /**
   * 2 マスにまたがる板（緩い坂）。2 マスで 1 マス上がる（DEC-93）。
   * `lo` が低いほう、`hi` が高いほう。既定は東へ上る。向きは R で回す。
   * 1 マスの `floor_ramp_*`（45 度）より緩く、2 マス三角（`floor_tri2_*`）と同じ勾配。
   */
  | 'floor_ramp2_lo'
  | 'floor_ramp2_hi'
  /**
   * 南北へ上る 2 マス板（DEC-363）。`n` は北が高い、`s` は南が高い。
   * 1 マスの `floor_ramp_n` / `_s` と同じ理由で、R では絵ごと回るので形状として分ける。
   */
  | 'floor_ramp2_n_lo'
  | 'floor_ramp2_n_hi'
  | 'floor_ramp2_s_lo'
  | 'floor_ramp2_s_hi'
  /** 2 マス板の左右反転（西へ上る）。R の 180 度と同じ形だが、形状として選べるようにした（DEC-109）。 */
  | 'floor_ramp2_lo_flip'
  | 'floor_ramp2_hi_flip'
  /**
   * 対角線方向に傾いた床（斜め坂）。隅の高さは 1 / 0.5 / 0 / 0.5。
   * 対角に 1 段ずつ下げて並べると**継ぎ目なしの 1 枚の平面**になる（DEC-85）。
   * 間のマスは Y を半マス（微Y −16）下げた同じ形で埋まる。
   */
  | 'floor_slant_nwse'
  | 'floor_slant_nesw'
  /**
   * 屋根の棟と谷（DEC-98）。マスの中央で折れた面 1 枚で、マスは埋めない。
   * `ridge` は中央が高い山型（屋根のてっぺん）、`valley` は中央が低い谷型。
   * 折れ目は Z 方向（南北）に走る。向きは R で回す。
   */
  | 'floor_ridge'
  | 'floor_valley'
  /** 頂上を高さ 0.5 に置いた棟。左右の斜面が 45 度になり、1 マスの坂（`floor_ramp_*`）と傾きが揃う。 */
  | 'floor_ridge_half'
  /**
   * 頂上を高さ 0.25 に置いた棟。左右の斜面が 2 マスで 1 マス上がる勾配になり、
   * `floor_ramp2_*`（2 マス板）と `floor_tri2_*`（2 マス三角）に繋がる。
   */
  | 'floor_ridge_quarter'
  /** 2 マス坂の棟を半マス（16px）持ち上げた版。坂の上端に合わせて置く（DEC-110）。 */
  | 'floor_ridge_quarter_up'
  /**
   * 2 マスにまたがる細長い直角三角形。長辺 2 マス・短辺 1 マス（DEC-86）。
   * `tip` が細いほう、`base` が太いほう。`a` / `b` は短辺がどちら側かの鏡像。
   * 向きは R で回す。4 形状 × 回転で 8 通り。
   */
  | 'floor_tri2_a_tip'
  | 'floor_tri2_a_base'
  | 'floor_tri2_b_tip'
  | 'floor_tri2_b_base'
  /**
   * 2 マス三角の左右反転（DEC-109）。`a` / `b` は短辺の側（床では前後）の鏡像なので、
   * 左右の鏡像はこちら。回転では作れない向きが要るときに使う。
   */
  | 'floor_tri2_a_tip_flip'
  | 'floor_tri2_a_base_flip'
  | 'floor_tri2_b_tip_flip'
  | 'floor_tri2_b_base_flip'
  /**
   * 切妻の妻壁（DEC-110）。棟の下を塞ぐ形。頂点はマスの上辺の中央で、肩は屋根の勾配ぶん下がる。
   * 勾配の名前は棟と揃えてある。急（接尾辞なし）は肩が下辺まで落ちて三角形になる。
   */
  | 'floor_gable'
  | 'floor_gable_half'
  | 'floor_gable_quarter'
  // 丸い床（DEC-371）。円はマスの中心、半円は北の面に平らな側を乗せる（半円柱と同じ足あと）。
  | 'floor_circle'
  | 'floor_round'
  /**
   * 折れ面（DEC-352 / DEC-353）。**チップを対角線で山折りにした 1 枚**。
   * 隅の高さは北西 0・北東 1・南東 0・南西 0。折り目は**南西—北東の対角線**で、
   * そこが尾根になる——南西の隅（0）から北東の隅（1）へ上り、両脇の北西・南東は底へ落ちる。
   * 寄棟の隅木と同じ形。上向き（床）と縦向き（壁）の中間なので「上＋縦」の輪に入れる。
   * 絵は真上から見た足跡で貼るので、折れ目で曲がって見える。向きは R で回す。
   */
  | 'floor_fold_ne'
  /** 折れ面の左右反転（DEC-354）。尾根が南東（0）から北西（1）へ上る（画面では ＼）。 */
  | 'floor_fold_nw'
  | 'ceil'
  /** 天井の直角二等辺三角形。床と同じ並び。 */
  | 'ceil_tri_nw'
  | 'ceil_tri_ne'
  | 'ceil_tri_se'
  | 'ceil_tri_sw'
  /** 傾いた天井。床と同じ並び。 */
  | 'ceil_ramp_e'
  | 'ceil_ramp_w'
  /** 南北へ傾く天井。床と同じ並び（DEC-204）。 */
  | 'ceil_ramp_n'
  | 'ceil_ramp_s'
  /** 2 マスにまたがる天井の板。床と同じ並び。 */
  | 'ceil_ramp2_lo'
  | 'ceil_ramp2_hi'
  /** 2 マス板の左右反転（西へ上る）。R の 180 度と同じ形だが、形状として選べるようにした（DEC-109）。 */
  | 'ceil_ramp2_lo_flip'
  | 'ceil_ramp2_hi_flip'
  /** 対角線方向に傾いた天井。床と同じ並び。 */
  | 'ceil_slant_nwse'
  | 'ceil_slant_nesw'
  /** 屋根の棟と谷の天井版。床と同じ並び。 */
  | 'ceil_ridge'
  | 'ceil_valley'
  /** 高さ半分の棟の天井版。 */
  | 'ceil_ridge_half'
  /** 高さ 1/4 の棟の天井版。 */
  | 'ceil_ridge_quarter'
  /** 2 マス坂の棟を半マス（16px）持ち上げた版。坂の上端に合わせて置く（DEC-110）。 */
  | 'ceil_ridge_quarter_up'
  /** 2 マスにまたがる細長い直角三角形の天井。床と同じ並び。 */
  | 'ceil_tri2_a_tip'
  | 'ceil_tri2_a_base'
  | 'ceil_tri2_b_tip'
  | 'ceil_tri2_b_base'
  /**
   * 2 マス三角の左右反転（DEC-109）。`a` / `b` は短辺の側（天井では前後）の鏡像なので、
   * 左右の鏡像はこちら。回転では作れない向きが要るときに使う。
   */
  | 'ceil_tri2_a_tip_flip'
  | 'ceil_tri2_a_base_flip'
  | 'ceil_tri2_b_tip_flip'
  | 'ceil_tri2_b_base_flip'
  /**
   * 切妻の妻壁（DEC-110）。棟の下を塞ぐ形。頂点はマスの上辺の中央で、肩は屋根の勾配ぶん下がる。
   * 勾配の名前は棟と揃えてある。急（接尾辞なし）は肩が下辺まで落ちて三角形になる。
   */
  | 'ceil_gable'
  | 'ceil_gable_half'
  | 'ceil_gable_quarter'
  | 'wall'
  /** 壁を斜めに切った三角形。名前は**直角の隅**（壁を正面から見て）。◤ tl / ◥ tr / ◢ br / ◣ bl。 */
  | 'wall_tri_tl'
  | 'wall_tri_tr'
  | 'wall_tri_br'
  | 'wall_tri_bl'
  /** マスの対角線に立つ 45 度の壁。幅は √2 マス。三角形の斜辺を塞ぐ用。 */
  | 'wall_diag_nwse'
  | 'wall_diag_nesw'
  /**
   * 2 マスにまたがる細長い直角三角形の壁（DEC-90）。長辺 2 マス（横）・短辺 1 マス（縦）。
   * 割り方と名前は床の `floor_tri2_*` と同じ。斜めの床の脇に立てて断面を塞ぐ用。
   */
  | 'wall_tri2_a_tip'
  | 'wall_tri2_a_base'
  | 'wall_tri2_b_tip'
  | 'wall_tri2_b_base'
  /**
   * 2 マス三角の左右反転（DEC-109）。`a` / `b` は短辺の側（壁では前後）の鏡像なので、
   * 左右の鏡像はこちら。回転では作れない向きが要るときに使う。
   */
  | 'wall_tri2_a_tip_flip'
  | 'wall_tri2_a_base_flip'
  | 'wall_tri2_b_tip_flip'
  | 'wall_tri2_b_base_flip'
  /**
   * 切妻の妻壁（DEC-110）。棟の下を塞ぐ形。頂点はマスの上辺の中央で、肩は屋根の勾配ぶん下がる。
   * 勾配の名前は棟と揃えてある。急（接尾辞なし）は肩が下辺まで落ちて三角形になる。
   */
  | 'wall_gable'
  | 'wall_gable_half'
  | 'wall_gable_quarter'
  /**
   * 縦に立つ半円柱（DEC-361）。マスの**中心**を軸に、半径 0.5 マスの半円を縦へ伸ばした面。
   * 弧はマスの中心線から南の面へ張り出し、外から見て凸。マスの南半分に収まる。
   * 辺ではなくマスの中心に据えるので、**R は本当に回る**（対角壁と同じ置き方）。
   */
  | 'wall_round'
  /** 縦に立つ丸ごとの円柱（DEC-362）。マスの中心を軸に半径 0.5 マス。ずらしは無し。 */
  | 'wall_cylinder'
  | 'box'
  | 'billboard'
  /** 縦のカード。カメラを向かない。Y 回転で向きを決める。 */
  | 'billboard_fixed'
  /** 横置きのカード。床に寝かせ、カメラを向かない。 */
  | 'billboard_flat'
  /** 横置きのカード。床に寝かせ、ヨーだけカメラを追う。 */
  | 'billboard_flat_follow'
  /**
   * 奥行きへ 3 枚重ねた縦のビルボード（DEC-205）。1 マスの中に絵を並べて厚みを出す。
   * `deep` は視点追従、`fixed_deep` は向き固定。**視点追従は視線の奥へ**、
   * 向き固定は R の向きの奥へ並ぶ。
   */
  | 'billboard_deep'
  | 'billboard_fixed_deep'
  /** 斜面。−Z 辺が上がる。 */
  | 'slope'
  /** 屋根の外隅。1 隅が上がる。 */
  | 'slope_corner'
  /** 屋根の内隅。3 隅が上がる。 */
  | 'slope_corner_in'
  | 'mesh';
export type Encoding = 'b64' | 'json';
export type CellEncoding = 'abs' | 'delta';
export type BatchMode = 'instanced' | 'merged';

/** セル下位バイト。下位 2bit 回転、bit2 は U 反転、bit3 は V 反転。 */
export const ROTATION_MASK = 0b11;

/** ブロックは回転しない。壁・床・斜面・板は R で回す（DEC-42）。 */
export function shapeRotates(shape: Shape): boolean {
  return shape !== 'box';
}

export function shapeRotation(shape: Shape, rf: number): number {
  return shapeRotates(shape) ? rf & ROTATION_MASK : 0;
}

/** 床の仲間。三角形も含む。 */
export function isFloorShape(shape: Shape | string): boolean {
  return shape === 'floor' || shape.startsWith('floor_');
}

/** 天井の仲間。三角形も含む。 */
export function isCeilShape(shape: Shape | string): boolean {
  return shape === 'ceil' || shape.startsWith('ceil_');
}

/**
 * マスの辺に立つ壁。`applyWallPose` で置く形。対角線の壁は含まない。
 * 壁の仲間はここに入れる決まりにした（DEC-115）。`wall_tri` だけを見ていたので、
 * 妻壁がマスの中央に立ち、厚み・位置調整・法線の反転からも漏れていた。
 */
export function isEdgeWallShape(shape: Shape | string): boolean {
  return (shape === 'wall' || shape.startsWith('wall_')) && !isCentreWallShape(shape);
}

/** マスの対角線に立つ 45 度の壁。 */
export function isDiagWallShape(shape: Shape | string): boolean {
  return shape.startsWith('wall_diag_');
}

/**
 * マスの**中心**に据える壁（DEC-361）。辺には貼らない。
 * 置き方は `loader` の「壁以外」と同じ道を通るので、**R が本当の回転**になる。
 * 平らな板は表裏が同じなので辺へ平行移動で足りるが、曲がった面はそれでは向きが変わらない。
 */
export function isCentreWallShape(shape: Shape | string): boolean {
  return isDiagWallShape(shape) || shape === 'wall_round' || shape === 'wall_cylinder';
}

/** 壁の仲間。辺の壁と、マスの中心に据える壁（対角・半円柱）。 */
export function isWallShape(shape: Shape | string): boolean {
  return isEdgeWallShape(shape) || isCentreWallShape(shape);
}

/** チップを板として出す形。 */
export function isBillboardShape(shape: Shape | string): boolean {
  return (
    shape === 'billboard' ||
    shape === 'billboard_fixed' ||
    shape === 'billboard_flat' ||
    shape === 'billboard_flat_follow' ||
    shape === 'billboard_deep' ||
    shape === 'billboard_fixed_deep'
  );
}

/** 床に寝かせるビルボード。 */
export function isBillboardFlat(shape: Shape | string): boolean {
  return shape === 'billboard_flat' || shape === 'billboard_flat_follow';
}

/** 縦に立つビルボード。積みの影は足元だけ。 */
export function billboardStandsUpright(shape: Shape | string): boolean {
  return (
    shape === 'billboard' ||
    shape === 'billboard_fixed' ||
    shape === 'billboard_deep' ||
    shape === 'billboard_fixed_deep'
  );
}

/** カメラの方を向く縦のビルボード。 */
export function billboardFacesCamera(shape: Shape | string): boolean {
  return shape === 'billboard' || shape === 'billboard_deep';
}

/** 横置きのヨー追従。床に寝かせたままカメラ方位へ回る。 */
export function billboardFollowsYaw(shape: Shape | string): boolean {
  return shape === 'billboard_flat_follow';
}

/** シルエット影を落とす。横置きも縦と同じ投射影にする（ゲーム表現）。 */
export function billboardCastsSpriteShadow(shape: Shape | string): boolean {
  return isBillboardShape(shape);
}

export interface TextureDef {
  id: string;
  /** 実行時に取るパス。アセット基点からの相対。 */
  src: string;
  w: number;
  h: number;
  filter: 'nearest' | 'linear';
  /** 任意の `data:` URI。単体ファイル用。 */
  data?: string | null;
}

export interface TilesetDef {
  id: string;
  tex: string;
  mat: string;
  /** チップサイズ（ピクセル）。 */
  tile: number;
  cols: number;
  rows: number;
  margin: number;
  spacing: number;
}

export interface MaterialDef {
  id: string;
  tex: string;
  /** `tiles` はアトラス／単色。`invisible` は描かない（当たり用）。省略時 tiles。 */
  kind?: 'tiles' | 'solid' | 'invisible';
  shading: 'unlit' | 'lambert';
  alphaTest: number;
  transparent: boolean;
  side: 'front' | 'double';
  depthWrite: boolean;
}

export interface AnimationDef {
  /** 秒あたりフレーム。`durations` が無いときの旧形式。 */
  fps: number;
  /** 繰り返し。`mode` が無いときの旧形式。 */
  loop: boolean;
  /** タイルセット内のチップ番号。 */
  frames: number[];
  /** 各フレームの長さ（ミリ秒）。 */
  durations?: number[];
  /** `pingpong` は往復（端を重ねない）。 */
  mode?: 'loop' | 'once' | 'pingpong';
}

/** ブロック固有軸での 6 面。 */
export type FaceName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** 面の貼り基準の並び。シェーダの packed 属性と同じ順。 */
export const FACE_PASTE_FACES: FaceName[] = ['top', 'bottom', 'front', 'back', 'left', 'right'];

/** 負値はパック色（`-1 - (r<<16|g<<8|b)`）。符号でチップ番号と分ける。 */
export function isFaceColor(value: number): boolean {
  return value < 0 || (value >= LEGACY_COLOR_BASE && value < LEGACY_COLOR_TOP);
}

/** 旧エンコード。正の基数＋チャンネル 5bit。当時のマップも読める。 */
const LEGACY_COLOR_BASE = 65536;
const LEGACY_COLOR_LEVELS = 32;
const LEGACY_COLOR_TOP = LEGACY_COLOR_BASE + LEGACY_COLOR_LEVELS ** 3;

/** 面の色を 0..1 sRGB に。シェーダと同じ。 */
export function decodeFaceColor(value: number): [number, number, number] {
  if (value < 0) {
    const packed = -1 - value;
    return [
      Math.floor(packed / 65536) / 255,
      (Math.floor(packed / 256) % 256) / 255,
      (packed % 256) / 255,
    ];
  }
  const packed = value - LEGACY_COLOR_BASE;
  const span = LEGACY_COLOR_LEVELS - 1;
  return [
    Math.floor(packed / LEGACY_COLOR_LEVELS ** 2) / span,
    (Math.floor(packed / LEGACY_COLOR_LEVELS) % LEGACY_COLOR_LEVELS) / span,
    (packed % LEGACY_COLOR_LEVELS) / span,
  ];
}

/** 色を現行の負値エンコードにする。 */
export function encodeFaceColor(r: number, g: number, b: number): number {
  const clamp = (c: number) => Math.min(255, Math.max(0, Math.round(c * 255)));
  return -1 - (clamp(r) * 65536 + clamp(g) * 256 + clamp(b));
}

/** 面の値を現行エンコードへ。旧 5bit 色もここを通す。 */
export function normaliseFaceValue(value: number): number {
  if (value >= LEGACY_COLOR_BASE && value < LEGACY_COLOR_TOP) {
    return encodeFaceColor(...decodeFaceColor(value));
  }
  return value;
}

/** 面ごとのチップ。ブロック固有軸。欠けは proto.tile。負値は単色。 */
export interface FaceChips {
  top?: number;
  bottom?: number;
  front?: number;
  back?: number;
  left?: number;
  right?: number;
  /** 旧 3 面スキーマ。未設定の側面の代わり。 */
  side?: number;
}

export type FaceAnchor = 'tl' | 'tr' | 'bl' | 'br';
export type FaceFit = 'clip' | 'stretch';
/** 面ごとの基準。欠けた面は左下。文字列は 6 面同じ（旧形式）。 */
export type FaceAnchorByFace = Partial<Record<FaceName, FaceAnchor>>;
export type FaceFitByFace = Partial<Record<FaceName, FaceFit>>;
export type FaceAnchors = Record<FaceName, FaceAnchor>;
export type FaceFits = Record<FaceName, FaceFit>;

const FACE_ANCHOR_CODE: Record<FaceAnchor, number> = { bl: 0, br: 1, tl: 2, tr: 3 };

function asFaceAnchor(raw: unknown): FaceAnchor {
  return raw === 'tl' || raw === 'tr' || raw === 'br' ? raw : 'bl';
}

function asFaceFit(raw: unknown): FaceFit {
  return raw === 'stretch' ? 'stretch' : 'clip';
}

export function expandFaceAnchors(raw: FaceAnchor | FaceAnchorByFace | undefined): FaceAnchors {
  if (!raw || typeof raw === 'string') {
    const a = asFaceAnchor(raw);
    return { top: a, bottom: a, front: a, back: a, left: a, right: a };
  }
  return {
    top: asFaceAnchor(raw.top),
    bottom: asFaceAnchor(raw.bottom),
    front: asFaceAnchor(raw.front),
    back: asFaceAnchor(raw.back),
    left: asFaceAnchor(raw.left),
    right: asFaceAnchor(raw.right),
  };
}

export function expandFaceFits(raw: FaceFit | FaceFitByFace | undefined): FaceFits {
  if (!raw || typeof raw === 'string') {
    const f = asFaceFit(raw);
    return { top: f, bottom: f, front: f, back: f, left: f, right: f };
  }
  return {
    top: asFaceFit(raw.top),
    bottom: asFaceFit(raw.bottom),
    front: asFaceFit(raw.front),
    back: asFaceFit(raw.back),
    left: asFaceFit(raw.left),
    right: asFaceFit(raw.right),
  };
}

/** 6 面 × 2bit を 1 float に。順は FACE_PASTE_FACES。 */
export function packFaceAnchorAttr(raw: FaceAnchor | FaceAnchorByFace | undefined): number {
  const map = expandFaceAnchors(raw);
  let packed = 0;
  let place = 1;
  for (const name of FACE_PASTE_FACES) {
    packed += FACE_ANCHOR_CODE[map[name]] * place;
    place *= 4;
  }
  return packed;
}

/** 6 面 × 1bit。stretch が 1。 */
export function packFaceFitAttr(raw: FaceFit | FaceFitByFace | undefined): number {
  const map = expandFaceFits(raw);
  let packed = 0;
  FACE_PASTE_FACES.forEach((name, i) => {
    if (map[name] === 'stretch') packed += 1 << i;
  });
  return packed;
}

/** 旧形式。面チップの 1/32 マスずれ。描画では使わない。 */
export interface FaceOffset {
  top?: [number, number];
  bottom?: [number, number];
  front?: [number, number];
  back?: [number, number];
  left?: [number, number];
  right?: [number, number];
}

export interface ProtoDef {
  id: string;
  name?: string;
  /**
   * 遮光体にするか（エディタ DEC-71）。省略時はレイヤーの `Shade` に従う。
   * レイヤー単位で足りない例外（小石は影を落とさない、など）のためのもの。
   */
  shade?: boolean;
  shape: Shape;
  mat: string;
  ts?: string;
  tile?: number;
  faces?: FaceChips;
  /** マス内のずれ（+X 右、+Y 上、+Z 奥）。rot では回らない。1 ステップ = 1/32。 */
  offset?: [number, number, number];
  /** 影の開始位置だけずらす（+X 右、+Y 上、+Z 奥）。絵・箱は動かない。1 ステップ = 1/32。 */
  shadowOffset?: [number, number, number];
  /** 影を光の向きへ伸ばす倍率。32 が標準（1 倍）。幅は変えない。 */
  shadowStretch?: number;
  /** 光から遠いほど薄くする。0 は均一、32 で先端が透明。 */
  shadowFade?: number;
  /** 箱の厚み。1 ステップ = 1/32。数値は Y のみ、`[y,z]` は高さ・奥行、`[y,z,x]` は幅も。符号は押し込み方向。32 超は見た目だけ複数マス。 */
  thickness?: number | [number, number] | [number, number, number];
  /** 面チップの貼り基準。文字列は 6 面同じ。オブジェクトは面ごと。`box` のみ。 */
  faceAnchor?: FaceAnchor | FaceAnchorByFace;
  /** `clip` ははみ出しを捨てる。`stretch` は面に合わせる。`box` のみ。 */
  faceFit?: FaceFit | FaceFitByFace;
  /** 旧形式の面ずれ。読み捨て。 */
  faceOffset?: FaceOffset;
  /** ずらし元の id。2 回目のずらしはここから。 */
  base?: string;
  /** 面の縁の色。省略で縁なし。床・天井・ビルボードには出さない。 */
  edge?: number;
  /** 発光。`true` は全面。数値は 6bit（top..right）。その面はチップ色のまま。 */
  emissive?: boolean | number;
  /**
   * 環境光を**上向き面として**受ける（DEC-125）。遠景の縦板を床と同じ明るさにする用。
   * 発光（`emissive`）と違い、光は当たる。当てる向きだけ真上に固定する。
   */
  shadeUp?: boolean;
  anim?: AnimationDef | null;
}

export interface AssetsDef {
  format: 'mep3d-assets';
  version: number;
  textures: TextureDef[];
  tilesets: TilesetDef[];
  materials: MaterialDef[];
  protos: ProtoDef[];
}

export interface BatchDef {
  id: string;
  shape: Shape;
  mat: string;
  ts: string;
  mode: BatchMode;
  anim: AnimationDef | null;
  /** このバッチが参照するプロトタイプ id。`proto` 属性の添字。 */
  protos: string[];
  count: number;
  enc: Encoding;
  cellEnc: CellEncoding;
  attrs: {
    /** x,y,z。絶対または軸ごとの差分（`cellEnc`）。 */
    cell: string | number[];
    /** `protos` の添字。 */
    proto: string | number[];
    /** 下位 2bit 回転、bit2 は U 反転、bit3 は V 反転。 */
    rf: string | number[];
    /** 複数チップを 1 枚の影にする組。0 は単独。省略は全部 0。 */
    gid?: string | number[];
  };
}

export type PropertyType = 'int' | 'float' | 'boolean' | 'string';

/** カスタムプロパティ。配列にして type を JSON に残す。意味はゲーム側が読む。 */
export interface PropertyDef {
  name: string;
  type: PropertyType;
  value: number | boolean | string;
}

/**
 * `tile` は景色。`object` は自由形状。`group` と `prefab` は入れ子。
 * `prefab` は中身を「1 個の物」として扱う（影は 1 枚のシルエットにまとまる。DEC-131）。
 */
/**
 * レイヤーの種類。`model` は**3D モデル**（DEC-288）——読み込んだ 3D を
 * **1 枚に 1 つ**置くだけで、セルもオブジェクトも持たない（DEC-292）。
 * 見た目だけなので当たり判定にも出ない。
 *
 * `light` は**光源レイヤー**（DEC-317）。点光源・スポット・面光源を束ねる。
 * オブジェクトレイヤーと同じで、**束ねる仕組みはレイヤーに一本化**してある——
 * 光源の側に別のグループを持たせない。
 */
export type LayerKind = 'tile' | 'object' | 'group' | 'prefab' | 'model' | 'light';

/** 入れ物のレイヤー。自分ではチップもオブジェクトも持たない。 */
export function isContainerKind(kind: LayerKind): boolean {
  return kind === 'group' || kind === 'prefab';
}

/** オブジェクトの形状。点は形を変えない。四角・円は軸平行。 */
export type MapObjectKind = 'rect' | 'polygon' | 'point' | 'circle' | 'box' | 'sphere' | 'ellipsoid';

/** 平面の向き。省略時は XZ（床）。XY は南北面、YZ は東西面。 */
export type MapObjectPlane = 'xz' | 'xy' | 'yz';

/** 平面（高さなし）か 3D（押し出し／ブロック）。省略時は height / cells から決める。 */
export type MapObjectSpace = 'plane' | 'solid';

/** オブジェクト 1 つ。平面・押し出しは連続座標。ブロックは整数セル。 */
export interface MapObjectDef {
  id: string;
  name: string;
  kind: MapObjectKind;
  visible?: boolean;
  /** 3D 上の名前・形状線。省略時は出す。目（オブジェクト自体の表示）とは別。 */
  guides?: boolean;
  collision: boolean;
  properties: PropertyDef[];
  /** 平面なら `plane`。3D 押し出し・ブロックは `solid`。 */
  space?: MapObjectSpace;
  /** 平面の向き。省略時 xz。3D 押し出しは常に XZ。 */
  plane?: MapObjectPlane;
  /** XZ 平面／押し出しの底面高さ（セル Y）。XY・YZ では点の高さ Y を `points` に持つ。 */
  y: number;
  /** XY 平面の位置（セル Z）。`plane === 'xy'` のとき。 */
  z?: number;
  /** YZ 平面の位置（セル X）。`plane === 'yz'` のとき。東西壁。 */
  x?: number;
  /** 3D 押し出しの高さ。楕円体では Y 直径。円・多角形に付けると円柱・角柱。 */
  height?: number;
  /**
   * 傾き（度。DEC-335）。0 で平ら。**0 でなければ見えない地面の坂**になる。
   * 床向き（XZ）の面だけ。`tiltTo` の向きへこの角度で上がる。
   */
  tilt?: number;
  /** 傾ける向き（度。DEC-335）。0 が北、90 が東。方向光と同じ回り。省略時 0。 */
  tiltTo?: number;
  /** 平面の頂点。四角・円は AABB の 4 隅。多角形は 3 点以上。点は 1 点。ブロックは空。 */
  points: [number, number][];
  /** ブロックの占有セル（整数 x,y,z）。隣接マスは 1 オブジェクト。 */
  cells?: [number, number, number][];
}

/**
 * 置いた 3D の見た目の調整（DEC-288）。生成した 3D は色が濁りやすいので、
 * 濃さと薄い発光で締める。既定は mapModels.ts の MODEL_LOOK_DEFAULTS。
 */
export interface ModelLook {
  /** 明るさ。1 が素のまま。 */
  brightness?: number;
  /** 色の濃さ。1 が素のまま。上げると色の滲みが減る。 */
  saturation?: number;
  /** 明るい色を薄く光らせる量。0 で無し。 */
  glow?: number;
  /** 光らせ始める明るさ。これより暗い色は光らせない。 */
  glowFloor?: number;
  /** 周りの明るさ。 */
  ambient?: number;
  /** 空と地からの明るさ。 */
  sky?: number;
  /** 直射の強さ。向きはマップの方向光と揃う。 */
  sun?: number;
  /** マップの点光源をどれだけ効かせるか（DEC-290）。0 で効かない。 */
  lights?: number;
  /** 影側を起こす 2 本目の光（DEC-295）。方向光の反対から当てる。 */
  rim?: number;
  /** 露出（DEC-295）。トーンを掛ける前に色へ掛ける。 */
  exposure?: number;
  /**
   * トーンマッピング（DEC-295）。0 で素のまま、1 で ACES。
   * **この置き物だけ**に掛かる。マップのチップは素のままなので、
   * 上げると 3D だけ白飛びしにくく、少し眠い絵になる。
   */
  tone?: number;
  /**
   * 「上のほう」の境目（DEC-296）。0..1 で、0 が底面・1 が てっぺん。
   * 屋根の飾りだけを別扱いにするための、**高さだけの絞り込み**。
   * 色では分けない——安く済ませるため。
   */
  topFrom?: number;
  /** 上のほうを光らせる量（DEC-296）。 */
  topGlow?: number;
  /** 上のほうの金属っぽさ（DEC-296）。上げると映り込み、下げるとつや消し。 */
  topMetal?: number;
  /**
   * 「上のほう」の**終わり**（DEC-298）。省略で 1（てっぺんまで）。
   * `topFrom` と挟んで帯にすると、屋根の段だけを狙える。
   */
  topTo?: number;
  /**
   * 色で選んで光らせる（DEC-298）。`#rrggbb`。空で切。
   * 元の頂点色と比べるので、**濃さや明るさを変えても選び直さなくてよい**。
   */
  pickColor?: string;
  /** どれくらい色が近ければ選ぶか（DEC-298）。0..1。 */
  pickRange?: number;
  /** 選んだ色を光らせる量（DEC-298）。強く光らせたいとき用に上限は広い。 */
  pickGlow?: number;
}

/**
 * マップに置いた 3D（DEC-288）。**見た目だけ**。ブロックにはならないので
 * 当たり判定にも影にも出ない。塞ぐならオブジェクトの `Collision` を重ねる。
 */
export interface MapModelDef {
  id: string;
  name: string;
  /** `public/assets/models/` の中のファイル名。 */
  file: string;
  /** 置いたマス。グリッドに合わせて置く（DEC-290）。 */
  x: number;
  y: number;
  z: number;
  /**
   * 原点の微調整（マス。DEC-290）。既定は `[0, 0, 0]` で、
   * **X・Z はマスの中心、Y はマスの床**に底面が来る。回転や大きさでは動かない。
   */
  origin?: [number, number, number];
  /** 大きさ。読み込んだ物の実寸に関わらず、この高さ（マス）になる。 */
  scale: number;
  /** Y 回転（度）。 */
  yaw: number;
  look?: ModelLook;
}

export interface LayerDef {
  id: string;
  name: string;
  kind: LayerKind;
  /** 親グループの id。最上段は ""。 */
  parent: string;
  visible: boolean;
  opacity: number;
  /** オブジェクトレイヤーで、中の名前・形状線をまとめて隠す。省略時は出す。 */
  guides?: boolean;
  /** ゲーム側で当たりにするか。 */
  collision: boolean;
  /**
   * 1 つ下のレイヤーに重ねる（DEC-191）。同じ面へ飾りを載せるときに入れる。
   * 入れたレイヤーは**すぐ下のレイヤーより 1 段手前**に描かれる。
   * 続けて入れると鎖になり、下から順に 1 段ずつ積み上がる。
   */
  overlay?: boolean;
  properties: PropertyDef[];
  batches: BatchDef[];
  /** `kind === 'object'` のとき。タイルの `batches` は空。 */
  objects?: MapObjectDef[];
  /** `kind === 'model'` のとき。置いた 3D（DEC-288）。 */
  models?: MapModelDef[];
}

/** マップ全体の方向光。欠落は lighting.ts の LIGHTING_DEFAULTS。 */
export interface LightingDef {
  /** 光の方位（度）。0 が北、90 が東。 */
  azimuth?: number;
  /** 地平からの仰角。90 が真上。 */
  elevation?: number;
  /** 光の裏の面の明るさ。 */
  ambient?: number;
  /** 環境光の上に足す直射。 */
  intensity?: number;
  /** 0 は境目はっきり、1 は全周に回る。 */
  wrap?: number;
  /** ビルボードの固定明るさ。法線が安定しないため。 */
  billboard?: number;
  /** ブロックが背後を遮るか。 */
  blockShadow?: boolean;
  /** ブロック影が直射を落とす割合。0..1。 */
  blockShadowStrength?: number;
  /**
   * 雲の影（DEC-218）。空の雲は要らず、**模様が地面を流れるだけ**。
   * 落とす側を持たないので、太陽の深度パス（DEC-145）とは別に効く。
   */
  cloudShadow?: boolean;
  /** 雲の影が落とす割合。0..2。1 までは直射、1 を超えると環境光も（DEC-220）。 */
  cloudShadowAmount?: number;
  /** 雲の大きさ。小さいほど雲が大きい。 */
  cloudShadowScale?: number;
  /** 雲が流れる速さ。 */
  cloudShadowSpeed?: number;
}

/**
 * 点光源・スポット・面光源。方向光とは別にマップへ複数置ける。
 * ブロック影は落とさない。ビルボードは方向光と同じ投影影を足す。
 * シェーダの明るさは可視のうち先頭 MAX_POINT_LIGHTS 個だけ使う。
 */
export interface PointLightDef {
  id: string;
  name: string;
  /** 省略時は点光源。`group` は入れ物だけで光らない。 */
  kind?: 'light' | 'spot' | 'area' | 'group';
  /**
   * 属する**光源レイヤー**の id（DEC-317）。省略時はどのレイヤーにも属さない。
   * 古いデータでは「光源グループの id」だった。読み込むときレイヤーへ移す。
   */
  parent?: string;
  visible?: boolean;
  /** 3D 上の名前・範囲・点アイコン。省略時は出す。目（発光）とは別。 */
  guides?: boolean;
  /** セル座標。連続。1 ピクセル = 1/32 マス。グループは使わない。 */
  x: number;
  y: number;
  z: number;
  /** `#rrggbb`。省略時は暖色。 */
  color?: string;
  /** 明るさ。方向光の直射と同じ目盛り。1 を超えてよい。省略時 0.7。上限 20。 */
  intensity?: number;
  /** 届く距離（セル）。省略時 6。 */
  range?: number;
  /** スポット／面の向き。方位は方向光と同じ（0 が北）。仰角 0 が水平、−90 が下。 */
  yaw?: number;
  pitch?: number;
  /** スポットの開き（度）。外側。省略時 40。 */
  cone?: number;
  /** 面光源の幅（セル）。省略時 2。 */
  width?: number;
  /** 面光源の高さ（セル）。省略時 1.5。 */
  height?: number;
  /**
   * 光の玉の大きさ（直径・マス。DEC-314）。0 / 省略で出さない。
   * 光源そのものの姿。明るさは点光源と別で、`bulbGain` で決める。
   */
  bulb?: number;
  /** 光の玉の明るさ。省略時 1。点滅・ゆらめきは光源と同じ拍で効く。 */
  bulbGain?: number;
  /** 点滅／炎のゆらめき。省略時はなし。 */
  pulse?: 'off' | 'blink' | 'flicker';
  /** 点滅・ゆらめきの速さ。1 が標準。省略時 1。 */
  pulseSpeed?: number;
  /** 明るさが落ちる幅。0〜1。省略時は点滅 1、炎 0.45。 */
  pulseAmount?: number;
}

/** カメラ距離の効果。欠落は camera.ts の CAMERA_FX_DEFAULTS。 */
export interface CameraFxDef {
  /** 背景色（6 桁 hex）。マップごと。フォグに合わせることが多い。 */
  background?: string;
  /** パノラマ画像。`assets/backscreen/` からの相対。無いときは単色。 */
  sky?: string;
  /** `scene.backgroundBlurriness`。0〜1。省略時 0。sky があるときだけ効く。 */
  skyBlur?: number;
  /** `scene.backgroundIntensity`。省略時 1。 */
  skyGain?: number;
  /** 水平回転（度）。`scene.backgroundRotation.y`。省略時 0。 */
  skyYaw?: number;
  /** 距離フォグを出すか。 */
  fog?: boolean;
  /** フォグ色（6 桁 hex。`#` 可）。 */
  fogColor?: string;
  /** フォグ開始距離（セル）。 */
  fogNear?: number;
  /** フォグが最大になる距離。 */
  fogFar?: number;
  /** 最遠のフォグ量。0..1。 */
  fogMax?: number;
  /** チルトシフト。ポストプロセス（タイルシェーダでは隣ピクセルが読めない）。 */
  tilt?: boolean;
  /** シャープ楕円の縦位置。0 が上、1 が下。 */
  tiltFocus?: number;
  /** 横位置。0 が左、1 が右。 */
  tiltFocusX?: number;
  /** シャープ楕円の半高（画面高の比）。 */
  tiltBand?: number;
  /** 半幅（画面幅の比）。 */
  tiltBandX?: number;
  /** 楕円から全ぼけまでの幅（楕円サイズ単位）。 */
  tiltFalloff?: number;
  /** 最大ぼけ半径（画面高の比）。 */
  tiltStrength?: number;
}

/** 編集状態。ゲーム側のローダは見ない。欠落しても読める。 */
export interface EditorStateDef {
  camera?: {
    target?: [number, number, number];
    yaw?: number;
    pitch?: number;
    distance?: number;
    orthographic?: boolean;
  };
  activeLayer?: string;
  height?: number;
  brush?: {
    tileset?: string;
    tile?: number;
    shape?: Shape;
    rotation?: number;
    color?: string;
    paint?: 'chip' | 'color' | 'invisible' | 'prefab';
    edgeEnabled?: boolean;
    edgeColor?: string;
    offset?: [number, number, number];
    thickness?: number | [number, number] | [number, number, number];
    faceAnchor?: FaceAnchor;
    faceFit?: FaceFit;
    faceOffset?: FaceOffset;
    prefabId?: string;
  };
  /** このマップに登録したプレハブ id。フォルダ全件は出さない。 */
  prefabs?: string[];
}

/**
 * 背景の書き割り（DEC-148）。マップの北端に立てる縦板 1 枚。
 * 無限遠のパノラマ（`CameraFxDef.sky`）とは別物で、こちらは**世界に置く板**。
 * カメラが動けば一緒に流れる（視差は付けない）。
 */
export interface BackdropDef {
  /** `assets/backscreen/` からの相対パス。空なら出さない。 */
  src: string;
  /** 板の下端の高さ（マス）。省略時 0。 */
  y?: number;
  /** 板の高さ（マス）。省略時は絵の縦横比から幅に合わせる。 */
  height?: number;
  /** 北端からさらに奥（−Z）へ下げる距離（マス）。省略時 0。 */
  offset?: number;
  /** 明るさ。直射も点光源も受けず、絵の色をこの倍率で出す。省略時 1。 */
  gain?: number;
  /**
   * 世界の Y 軸まわりに回す角度（度。DEC-330）。省略時 0。方位は方向光と同じで 0 が北。
   * 筒・球は絵が横へ流れ、板はマップの周りを回り込む。
   */
  spin?: number;
  /**
   * 形（DEC-151 / DEC-313）。`plane` はマップ北端の縦板 1 枚、`cylinder` はマップを囲む筒、
   * `sphere` はマップを囲む球（上も下も閉じる）。省略時 `plane`。
   */
  shape?: 'plane' | 'cylinder' | 'sphere';
  /**
   * 絵を横に何枚並べるか。省略・0・1 なら 1 枚（引き伸ばす）。
   * 板なら幅を、筒なら周を割る。**筒は偶数にすると回り込みの継ぎ目も消える。**
   */
  count?: number;
  /**
   * 繰り返すとき 1 枚おきに左右反転してつなぐ（DEC-149）。省略時 true。
   * そのまま並べると絵の左端と右端が接して継ぎ目が出る。反転すると隣り合う辺が同じ列になる。
   */
  mirror?: boolean;
}

/**
 * ゲーム画面の見え方（DEC-148）。**エディタが決めてゲームは従うだけ。**
 * カメラの縦横比・寄り・仰角は**マップのカスタムプロパティ**が持つ（DEC-152）ので、ここには無い。
 * スクロールの止め位置はそれと `grid.width` / `grid.depth` から出せるので、枠も持たない。
 */
export interface GameViewDef {
  backdrop?: BackdropDef;
}

/**
 * フィールドエフェクトの設定 1 つぶん（DEC-200）。マップに並べて持つ。
 * 同じ設定を何か所にも置けるよう、置き場所とは分けてある。
 */
export interface FieldEffectPresetDef {
  /** 参照される名前。**改名しても切れないよう表示名とは別に持つ。** */
  id: string;
  /** 一覧に出す名前。自由に変えてよい。 */
  name: string;
  /** fog / rain / snow / dapple / mote / water。 */
  kind: string;
  /** 出すか。切ると置いてあっても描かない。 */
  on?: boolean;
  /** 濃さ・数。 */
  amount?: number;
  /** 流れる速さ。 */
  speed?: number;
  /** 粒や模様の細かさ。 */
  scale?: number;
  /** 水面の歪み（DEC-302）。水面だけが使う。0 で歪めない。 */
  warp?: number;
  /** 水面の映り込み（DEC-303）。水面だけが使う。0 で映さない。 */
  mirror?: number;
  /**
   * 真正面から見たときの映りの強さ（DEC-321）。0〜1。省略時 0.22。
   * 映り込みの重みは `映り込み × (face + (1 - face) × フレネル)`。
   * 0 は真上から覗くと映らない（水らしい）、1 は角度によらず一定に映る（板ガラスの鏡）。
   */
  face?: number;
  /**
   * 映り込んだ絵を水の色で染める量（DEC-322）。0〜1。省略時 0。
   * 0 は素の色のまま、1 は水の色味を掛ける。明るさは落とさない。
   */
  dye?: number;
  /**
   * 水面へ映すか（DEC-345）。省略時は映す。
   * 映す側（水面・うねり・鏡面）は焼くあいだ必ず隠れるので、この札は見ない。
   */
  cast?: boolean;
  /** 6 桁 hex（`#` は付けても付けなくてもよい）。 */
  color?: string;
  /** 高さのずらし（マス）。置いた面から上下へ動かす（DEC-200）。 */
  lift?: number;
  /** 厚み（マス）。床に置いたときだけ効く。 */
  thick?: number;
}

/**
 * 画面エフェクト 1 つぶん（DEC-389 / DEC-390）。**画面全体にかかり、世界の場所を持たない。**
 * 置き場所を持つフィールドエフェクト（`FieldEffectPresetDef`）と対になる——
 * あちらはカメラが動けば流れ、こちらはどこを見ていても同じようにかかる。
 */
export interface ScreenEffectDef {
  /** 参照される名前。**改名しても切れないよう表示名とは別に持つ。** */
  id: string;
  /** 一覧に出す名前。自由に変えてよい。 */
  name: string;
  /** `fog`（霧）/ `dapple`（木漏れ日）。 */
  kind: string;
  /** 出すか。切ると一覧に残したまま消せる。省略時は出す。 */
  on?: boolean;
  /** 濃さ（0〜1）。 */
  amount?: number;
  /** 流れる速さ。 */
  speed?: number;
  /**
   * 霧は**模様の大きさ**（小さいほど大きな模様）、木漏れ日は**筋の細かさ**。
   * 同じ欄だが読み方が違う——画面のラベルも種類ごとに変えてある。
   */
  scale?: number;
  /** 色（6 桁 hex）。 */
  color?: string;
  /** 霧がどこまで上へ届くか（画面の高さの比。1 より大きくすると上まで濃い）。 */
  height?: number;
  /** 霧の下側を薄くする量（画面の高さの比。0 なら下端まで濃い）。 */
  bottom?: number;
  /** 木漏れ日の筋の太さ。小さいほど太い。 */
  thickness?: number;
}

export interface MapDef {
  format: 'mep3d-map';
  version: number;
  name: string;
  grid: {
    /** チップサイズ（ピクセル）。UV 計算用。 */
    tilePx: number;
    /** 1 マスのワールド単位。 */
    unit: number;
    /** マップの東西マス数。省略時は 40。格子と一致する。 */
    width?: number;
    /** マップの南北マス数。省略時は 40。 */
    depth?: number;
  };
  bounds: { min: [number, number, number]; max: [number, number, number]; empty: boolean };
  /** アセットファイルへのパス、または埋め込み。 */
  assets: string | AssetsDef;
  /** 方向光。無いファイルは旧形式。 */
  lighting?: LightingDef;
  /** 点光源。無いファイルは空。ゲームも同じ uniforms を読む。 */
  pointLights?: PointLightDef[];
  /** カメラ効果。無いファイルは旧形式。 */
  camera?: CameraFxDef;
  /** ゲーム画面の見え方と背景の書き割り（DEC-148）。無いファイルは既定。 */
  view?: GameViewDef;
  /**
   * フィールドエフェクトの見た目（DEC-200）。**置き場所は持たない**——
   * オブジェクトの `Effect` プロパティがここの `id` を指す。
   */
  fieldEffects?: FieldEffectPresetDef[];
  /**
   * 画面エフェクト（DEC-389）。**常時かかる**画作りで、置き場所は持たない。
   * 一覧に並べた順に上から重なる。
   */
  screenEffects?: ScreenEffectDef[];
  /** 編集状態。ゲーム側は無視してよい。 */
  editor?: EditorStateDef;
  /** 縁の太さ（面に対する割合）。省略時は絵の 1px。床・天井・ビルボードには出ない。 */
  edgeWidth?: number;
  /** 縁から中央へ向かうぼかし。省略時は 0。 */
  edgeFade?: number;
  /** マップ全体のカスタムプロパティ。 */
  properties: PropertyDef[];
  layers: LayerDef[];
  stats: { tiles: number; batches: number; drawCalls: number };
}
