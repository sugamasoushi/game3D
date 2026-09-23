// ゲーム画面のカメラ（DEC-152）。マップのカスタムプロパティで持つ。名前と既定はここが正。
// 専用の JSON ブロックを作らないのは、ゲームが `Mep3DScene.properties` を素通しで読めるため。

/** ゲーム画面の大きさ（DEC-162）。**固定**。ウィンドウには合わせず、余白は黒帯にする。 */
export const GAME_SCREEN_WIDTH = 1280;
export const GAME_SCREEN_HEIGHT = 720;
export const GAME_SCREEN_ASPECT = GAME_SCREEN_WIDTH / GAME_SCREEN_HEIGHT;

export const CAMERA_DISTANCE_PROPERTY_NAME = 'CameraDistance';
export const CAMERA_PITCH_PROPERTY_NAME = 'CameraPitch';
/**
 * カメラの水平角（度。DEC-253）。0 が南から北を見る向き。
 * 仰角と対で**マップが持つ**。ゲームはこの向きで始める。
 */
export const CAMERA_YAW_PROPERTY_NAME = 'CameraYaw';

/**
 * 平行投影で見せるか（DEC-267）。既定は**透視**（0）。
 * エディタ左パネルの切替は外した（DEC-403）。ゲームはまだ読むが、書く画面は無い。
 */
export const CAMERA_ORTHO_PROPERTY_NAME = 'CameraOrtho';

/**
 * スクロールの範囲（DEC-153）。カメラが映してよい枠を**エディタが決める**。
 * マップのセル座標。既定はマップの外周（読み込み時にマップの大きさから入れる）。
 */
export const SCROLL_MIN_X_PROPERTY_NAME = 'ScrollMinX';
export const SCROLL_MAX_X_PROPERTY_NAME = 'ScrollMaxX';
export const SCROLL_MIN_Z_PROPERTY_NAME = 'ScrollMinZ';
export const SCROLL_MAX_Z_PROPERTY_NAME = 'ScrollMaxZ';
/**
 * スクロール範囲をマップ全体にするか（DEC-170）。0 なら下の 4 つの値、1 ならマップの外周。
 * **1 にしても 4 つの値は書き換えない。**「マップ全体」を選んで戻したときに、
 * 手で決めた枠がそのまま残るようにするため。
 */
export const SCROLL_WHOLE_PROPERTY_NAME = 'ScrollWhole';

/**
 * 屋内のマップか（DEC-250）。**オン/オフ**。
 * 今はゲームの見た目を変えないが、屋内・屋外で処理を分けたいときの目印として持つ。
 */
export const INDOOR_PROPERTY_NAME = 'Indoor';

/** 未設定のときの値。エディタの表示とゲームの初期値で同じものを使う。 */
export const CAMERA_PROPERTY_DEFAULTS: Record<string, number> = {
  [CAMERA_DISTANCE_PROPERTY_NAME]: 20,
  [CAMERA_PITCH_PROPERTY_NAME]: -20,
  [CAMERA_YAW_PROPERTY_NAME]: 0,
  // 既定は透視。HD-2D の見え方はこちら。
  [CAMERA_ORTHO_PROPERTY_NAME]: 0,
  [SCROLL_MIN_X_PROPERTY_NAME]: 0,
  [SCROLL_MAX_X_PROPERTY_NAME]: 0,
  [SCROLL_MIN_Z_PROPERTY_NAME]: 0,
  [SCROLL_MAX_Z_PROPERTY_NAME]: 0,
  // 既定は 0（下の 4 つの値を使う）。1 を既定にすると、枠を決めてある既存のマップが全体へ広がる。
  [SCROLL_WHOLE_PROPERTY_NAME]: 0,
};

/** 正射カメラの縦半径。distance に対する係数。 */
export const ORTHO_SCALE = 0.32;
/** 透視カメラの画角（度）。ゲームの既定はこちら（GC-51）。 */
export const PERSP_FOV = 45;

export interface ScrollRect {
  /** セル座標。マップは原点中心なので、40 マスなら −20〜20。 */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** マップの外周。スクロール範囲の既定。 */
export function mapScrollRect(width: number, depth: number): ScrollRect {
  return { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 };
}

/** 4 つとも 0 なら「未設定」。読み込み時にマップの外周を入れる。 */
export function isEmptyScrollRect(rect: ScrollRect): boolean {
  return rect.minX === 0 && rect.maxX === 0 && rect.minZ === 0 && rect.maxZ === 0;
}

/**
 * 床の上で画面に入る半径（セル）。奥行きは仰角で伸びる。
 * 正射と透視で縦半径の出し方だけ違う。**エディタの表示とゲームの止め位置で同じ式を使う。**
 */
export function visibleHalfCells(view: {
  distance: number;
  pitch: number;
  perspective: boolean;
  /** 省略時は固定の画面比（DEC-162）。 */
  aspect?: number;
}): { x: number; z: number } {
  const half = view.perspective
    ? view.distance * Math.tan((PERSP_FOV * Math.PI) / 360)
    : view.distance * ORTHO_SCALE;
  const rise = Math.max(Math.sin((Math.abs(view.pitch) * Math.PI) / 180), 0.02);
  return { x: half * (view.aspect ?? GAME_SCREEN_ASPECT), z: half / rise };
}

/** `Mep3DScene.properties` から数を読む。無い・壊れているときは既定。 */
export function cameraNumber(
  properties: Record<string, number | boolean | string> | undefined,
  name: string,
  fallback = CAMERA_PROPERTY_DEFAULTS[name] ?? 0,
): number {
  const raw = properties?.[name];
  const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** マップのオン/オフのプロパティを読む（DEC-250）。無ければ false。 */
export function mapFlag(
  properties: Record<string, number | boolean | string> | undefined,
  name: string,
): boolean {
  const raw = properties?.[name];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    return text !== '' && text !== '0' && text !== 'false';
  }
  return false;
}

/** 「マップ全体」を選んでいるか（DEC-170）。 */
export function isWholeMapScroll(
  properties: Record<string, number | boolean | string> | undefined,
): boolean {
  return cameraNumber(properties, SCROLL_WHOLE_PROPERTY_NAME) !== 0;
}

/**
 * 手で決めた枠（DEC-170）。「マップ全体」を選んでいても**こちらは変わらない**。
 * エディタのスライダはこれを出す。実際にカメラが使う枠は `scrollRectOf()`。
 */
export function storedScrollRect(
  properties: Record<string, number | boolean | string> | undefined,
  width: number,
  depth: number,
): ScrollRect {
  const rect: ScrollRect = {
    minX: cameraNumber(properties, SCROLL_MIN_X_PROPERTY_NAME),
    maxX: cameraNumber(properties, SCROLL_MAX_X_PROPERTY_NAME),
    minZ: cameraNumber(properties, SCROLL_MIN_Z_PROPERTY_NAME),
    maxZ: cameraNumber(properties, SCROLL_MAX_Z_PROPERTY_NAME),
  };
  if (isEmptyScrollRect(rect)) return mapScrollRect(width, depth);
  // 逆に入っていても枠として扱えるように直す。
  return {
    minX: Math.min(rect.minX, rect.maxX),
    maxX: Math.max(rect.minX, rect.maxX),
    minZ: Math.min(rect.minZ, rect.maxZ),
    maxZ: Math.max(rect.minZ, rect.maxZ),
  };
}

/** カメラが実際に使う枠。「マップ全体」ならマップの外周、そうでなければ手で決めた枠。 */
export function scrollRectOf(
  properties: Record<string, number | boolean | string> | undefined,
  width: number,
  depth: number,
): ScrollRect {
  if (isWholeMapScroll(properties)) return mapScrollRect(width, depth);
  return storedScrollRect(properties, width, depth);
}
