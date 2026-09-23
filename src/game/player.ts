// プレイヤー。スプライトシート 1 枚のビルボードと足元の影。移動はセル当たり判定で止める。

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type ShaderMaterial,
  type Texture,
} from 'three';
import { createActorMaterial, createActorShadowMaterial } from '../mep3d/actorMaterial';
import { blockShadowLength, resolveLighting, shadowDirection } from '../mep3d/lighting';
import { MAX_WALK, SEGMENTS_PER_CELL, drape, profile } from '../mep3d/shadowCast';
import { cellOf, type CollisionMap } from '../mep3d/collision';
import type { CameraFxDef, LightingDef, PointLightDef } from '../mep3d/types';

/** 行の添字。シートの既定の並び（上から 下・左・右・上）。 */
const ROW = { south: 0, west: 1, east: 2, north: 3 } as const;
/** 向き。絵の並び（行）と同じ名前（DEC-190）。 */
export type Facing = keyof typeof ROW;

/**
 * キャラのスプライトシート 1 枚ぶん（GS-16）。**プレイヤーも NPC も同じ形**で持つ。
 * 中身は public/data/actors.json が決める（assets.ts / actors.ts）。
 */
export interface ActorSheet {
  url: string;
  /** 横のコマ数（歩き）と縦の行数（向き）。 */
  cols: number;
  rows: number;
  /** 1 コマの大きさ（px）。チップ 32px に対する比がそのまま背丈になる。 */
  framePx: [number, number];
  /** 行の並び。省略すると 下・左・右・上（旧作の既定と同じ）。 */
  order?: Facing[];
  /**
   * 歩きの見せ方（GS-47）。**シートごとに違ってよい**ので台帳が持つ。
   * 省くと今までどおり（3 コマなら真ん中が止まり絵、1 コマ 0.16 秒）。
   */
  walk?: { stand?: number; ms?: number };
  /**
   * **1 コマの中で、足元が下端から何画素上にあるか**（GS-52）。
   *
   * シートによっては絵の下に余白があり、そのまま置くと**足が地面から浮く**。
   * 絵を描き直さずに合わせるための補正で、**その画素ぶん絵を下げる**。
   * 逆に絵が地面へ沈むときは負の数で持ち上げる。
   *
   * 動かすのは**見せる板だけ**。立ち位置・当たり・影の出どころは足元のまま
   * ——ここをずらすと「見えている足元」と「居る場所」が食い違う。
   */
  footPx?: number;
  /**
   * 静止コマに付けた名前（GS-47）。宝箱の開閉のような**向きを持たない物**用。
   * イベントから `pose` で指す。番号でなく名前にしておくと、
   * シートを描き直してコマの順が変わってもイベントを直さずに済む。
   *
   * 値は**通し番号**（左上から右へ、行を折り返して数える）。
   * 例: 横 4 列のシートで `4` は 2 行目の左端。
   */
  poses?: Record<string, number>;
}

/**
 * 既定のシート。横 3 コマ（歩き）× 縦 4 行（向き）。
 * 行は上から **下・左・右・上**。1 コマ 32×40 px（チップ 32px に対して身長 1.25 マス）。
 */
export const ACTOR_SHEET: ActorSheet = {
  url: '/assets/spritesheet/meina2_32_40.png',
  cols: 3,
  rows: 4,
  framePx: [32, 40],
};

/**
 * 歩きのコマ順。3 コマなら真ん中が止まり絵で行って戻る、それ以外は順に回す。
 * 旧作の spritetype 0304 / 0404 と同じ考え方（GS-16）。
 */
const walkPatternFor = (cols: number): number[] =>
  cols === 3 ? [0, 1, 2, 1] : Array.from({ length: Math.max(cols, 1) }, (_, i) => i);
const STEP_SECONDS = 0.16;
const RUN_STEP_SECONDS = 0.1;

/** 体の高さ（マス）。頭がつかえるかの判定に使う（GOPEN-2）。 */
const BODY_CELLS = 2;
/**
 * 体の細さ（マスに対する割合）。**足元の面を探す範囲**と、踏んだ・調べたの目安に使う（DEC-247）。
 * 壁の当たりは `BODY_HALF` の四角で見る（GS-116）ので、ここは当たりの太さではない。
 */
const RADIUS = 0.28;
/**
 * 体の当たりの半分（マス。GS-116）。**マス 1 つぶんの四角**で当たりを取る。
 * マップのマス目と見た目が一致し、1 マス幅の通路は**マスに揃っていないと入れない**。
 * 揃えるのは `laneSlip`（通路へ半分以上かかっていれば自分で寄る）。
 */
const BODY_HALF = 0.5;
/**
 * 四角の縁をほんの少し内へ入れる（マス）。ちょうど境目の点は隣のマスにも乗るので、
 * 揃って立っているだけで両隣を塞ぎ扱いにしてしまう。
 */
const BODY_EDGE = BODY_HALF - 0.002;
/** 歩き・走りの速さ（マス毎秒）。 */
const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
/**
 * 登れる段差（マス）。**既定は 0＝どこも登れない**（DEC-256）。
 * ブロックの上へ勝手に昇られると、通れないつもりの所を越えてしまう。
 * 登らせたい場所は `Climb` のオブジェクトで指定する（DEC-237）。
 */
const STEP_UP = 0;
/**
 * はしごの上端で乗り移り先を探す高さ（マス。DEC-256）。
 * `STEP_UP` とは別に持つ——段差を登れなくしても、はしごは上まで行けないと困る。
 */
const LADDER_EXIT_REACH = 1;
/** はしごを上り下りする速さ（マス毎秒。DEC-237）。歩きと同じにして、落下とは切り離す。 */
const LADDER_SPEED = WALK_SPEED;
/** 落下の加速と上限（マス毎秒）。 */
const GRAVITY = 24;
const FALL_MAX = 20;
/** これより下は奈落。落ち続けないように止める。 */
const VOID_Y = -32;
/**
 * 坂を追う許容（マス。DEC-210）。**1 マス未満**にしておく——1 以上にすると、
 * 庇や 2 階の床の下を歩いただけで、その上へ吸い上げられてしまう。
 * 1 フレームで上がる量（走り 8 マス毎秒 × 45 度で 0.14 マス）より十分大きければよい。
 */
const SLOPE_REACH = 0.6;
/**
 * 接地しているあいだ、これだけ下の面までは落とさず貼り付ける（マス。DEC-210）。
 * 無いと下り坂で毎フレーム浮いては落ちるので、段差を降りるようにガタつく。
 */
const GROUND_SNAP = 0.6;
/** 埋まったときに上へ逃がす最大の高さ（マス。DEC-209）。 */
const UNSTICK_UP = 4;
/** 揃ったとみなす差（マス）。これ以下なら通路の真ん中へ置き直す。 */
const LANE_SNAP = 0.001;
/** 上へ逃げられないときに横へ探す範囲（マス。DEC-209）。 */
const UNSTICK_OUT = 3;

/** 1 フレーム分の入力。move はワールド方向、axis は画面基準（カメラから見た前後左右）。 */
export interface PlayerInput {
  move: { x: number; z: number };
  axis: { x: number; y: number };
  running: boolean;
  /**
   * カメラの方位（度。GS-116）。通路へ寄せるときに**その向きへ体を向ける**ために要る。
   * 絵の向き（`facing`）は画面基準なので、ワールドの向きから戻すのにカメラの角度がいる。
   * 省くと寄せている間の向きは変えない。
   */
  yaw?: number;
  /**
   * 1 秒あたりのマス数（GS-50）。省くと歩き／走りの既定。
   * **うろつきはこれを下げて使う**——歩きの速さのままだと、短い距離を一瞬で詰めてしまい
   * 絵が 1 コマも変わらない（歩いているように見えない）。
   */
  speed?: number;
  /**
   * 向きも足も**動かさずに**運ぶ（GS-155）。殴られて後ろへ飛ぶ、氷の上を滑る、など。
   * 位置だけが動き、絵は立ち止まったまま——「歩いて下がった」と「飛ばされた」は別物。
   */
  slide?: boolean;
}

export interface Player {
  group: Group;
  /** 足元のワールド座標。 */
  position: Vector3;
  /** 立っているセル。HUD 表示用。 */
  cell(): { x: number; y: number; z: number };
  /** 床の上へ置き直す。 */
  placeAt(x: number, y: number, z: number): void;
  /**
   * いま居るマスの真ん中へ静かに戻す（GS-117）。**歩き終わりに呼ぶ。**
   *
   * 歩く向きはカメラ基準（画面の上下左右）なので、マスの軸とはわずかにずれる。
   * 1 歩ずつのずれが積もると、**絵の立ち位置と塞ぐマスが食い違う**——
   * 人はマス 1 つを塞ぐ（GS-35）ので、端に寄った人には話しかけられなくなる。
   * **収まらない場所へは動かさない**（壁ぎわで止まったときに壁へ押し込まないため）。
   */
  settle(collision: CollisionMap): void;
  /** 立てるマスを探して置く。見つからなければ false。 */
  spawn(collision: CollisionMap, bounds: { min: number[]; max: number[]; empty: boolean }): boolean;
  update(deltaSeconds: number, input: PlayerInput, collision: CollisionMap): void;
  /**
   * 向きだけ変える（GS-13）。イベントの `turn` から呼ぶ。
   * 歩かないので足は止まったまま——立ち止まって振り向く絵になる。
   */
  face(to: Facing): void;
  /** いま向いている方（GS-16）。目の前に居る相手を探すのに使う。 */
  facingNow(): Facing;
  /**
   * 静止コマを指名する（GS-47）。宝箱の開閉のような**絵だけを切り替える**もの。
   * 名前は台帳の `poses`。**コマ番号を直に渡してもよい**（GS-135。宝箱の台帳は番号で持つ）。
   * `null` で指名を外し、歩きと向きの絵に戻る。知らない名前なら何もせず false を返す。
   */
  pose(name: string | number | null): boolean;
  /** カメラの方位（ラジアン）へ向ける。 */
  /**
   * 影が歩く地形を渡す（DEC-159）。`Mep3DScene.shadowField()` の中身。
   * 渡さないと平らな床として出る。
   */
  setShadowField(
    solid: (x: number, y: number, z: number, fx?: number, fz?: number, dirX?: number, dirZ?: number) => boolean,
    surface: (x: number, y: number, z: number) => boolean,
    /** 面の高さ（DEC-215）。渡すと坂の上で影が斜めになる。省略時はマスの底で平ら。 */
    top?: (x: number, y: number, z: number, fx: number, fz: number) => number | null,
    /** 自分のマスの中で塞ぐか（DEC-241）。対角壁と同じマスに立ったときに効く。 */
    selfSolid?: (x: number, y: number, z: number, fx: number, fz: number, dirX: number, dirZ: number) => boolean,
  ): void;
  faceCamera(yaw: number): void;
  /** マップの光を反映する。読み込み直後に呼ぶ（GF-3.7）。 */
  setLighting(lighting: LightingDef, pointLights: PointLightDef[], unit: number, cameraFx: Required<CameraFxDef>): void;
  /** 点滅・炎のゆらぎを進める。経過秒。 */
  setTime(seconds: number): void;
  /** ブロック影マスクを受け取るマテリアル（GC-34）。 */
  bodyMaterial: ShaderMaterial;
  /** 影のシルエットに使うシート。 */
  texture: Texture;
  /** 板の高さ（マス）。影の長さに使う。 */
  tallCells: number;
  /** 絵を下げている量（GS-52。ワールド）。頭の上に何かを置くときに引く。 */
  footLift: number;
  /** いま出しているコマの UV（左下原点）。遮光体に渡す（GC-39）。 */
  frame(): { x: number; y: number; width: number; height: number };
  /** 板の大きさ（ワールド）。 */
  size: { width: number; height: number };
  /**
   * 体の半分（マス）。踏んだ判定の範囲に使う（DEC-247）。
   * **当たりと同じマス 1 つぶんの四角**（GS-116）——踏む所に体が重なったら踏んだことにする。
   */
  radius: number;
  dispose(): void;
}

export function createPlayer(unit: number, tilePx: number, sheet: ActorSheet = ACTOR_SHEET): Player {
  const group = new Group();
  group.name = 'player';

  // 行の添字。シートが並びを持っていればそれに従う（GS-16）。
  const rowOf = (to: Facing): number => {
    const order = sheet.order;
    const at = order ? order.indexOf(to) : -1;
    const row = at >= 0 ? at : ROW[to];
    // **行の数を超えない**（GS-47）。宝箱のような 1 行のシートでもはみ出さない。
    return row < sheet.rows ? row : 0;
  };
  const WALK_PATTERN = walkPatternFor(sheet.cols);
  /** 止まり絵のコマ。台帳が言えばそれ、無ければ 3 コマなら真ん中・それ以外は先頭。 */
  const STAND = sheet.walk?.stand ?? (sheet.cols === 3 ? 1 : 0);
  /** 1 コマの秒数（GS-47）。走りは歩きの 0.625 倍（もとの 0.16 / 0.1 と同じ比）。 */
  const STEP_S = (sheet.walk?.ms ?? STEP_SECONDS * 1000) / 1000;
  const RUN_STEP_S = STEP_S * (RUN_STEP_SECONDS / STEP_SECONDS);
  /**
   * 指名された静止コマ（GS-47）。**入っている間は歩きも向きも絵に出さない。**
   * 宝箱のように「開いたら開いたまま」でいてほしい物のための止め具。
   */
  let posed: number | null = null;

  const texture = new TextureLoader().load(sheet.url);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;

  // マップのビルボードと同じ光の当て方にする（GF-3.7）。
  const skin = createActorMaterial(texture);
  const width = (sheet.framePx[0] / tilePx) * unit;
  const height = (sheet.framePx[1] / tilePx) * unit;
  const body = new Mesh(new PlaneGeometry(width, height), skin.material);
  /** 絵を下げる量（GS-52）。台帳の `footPx` をワールドの長さへ直したもの。 */
  const footLift = ((sheet.footPx ?? 0) / tilePx) * unit;
  body.position.y = height / 2 - footLift;
  group.add(body);
  // 太陽の影は頭の少し上で引く（DEC-156）。自分も深度に入っているので、
  // 体の高さで引くと自分の板を踏んで下半身が黒くなる。
  skin.material.uniforms.sunLift.value = height * 1.1;

  // 足元の影は**絵を地面の起伏に沿わせて寝かせる**（DEC-157 / DEC-158）。
  // 深度パスに入れないので焼き直しが要らず、動いてもチラつかない。
  // 壁に当たったら折れて壁を這い上がる。数え方はマップのビルボード影と同じ（DEC-66）。
  // 帯は細かめに割る（DEC-163）。壁の縁で切れるのは 1 本ぶんなので、細いほど欠けが目立たない。
  const SHADOW_STRIPS = 16;
  /**
   * 帯を切るしきい値。マップのビルボード影（`BREAK_HEIGHT` / `BREAK_ALONG` = 0.5）より**緩い**。
   * キャラは 1 マス幅しかないので、壁の角では隣の帯と 1 マス近く離れるのが普通。
   * 0.5 で切ると壁際に立つたびに影が欠ける。繋いだ側は角を回り込む薄い斜面になるだけ。
   */
  const SHADOW_BREAK_HEIGHT = 1.5;
  const SHADOW_BREAK_ALONG = 2;
  const SHADOW_SEGMENTS = Math.max(4, Math.round((height / unit) * SEGMENTS_PER_CELL));
  const SHADOW_ROWS = SHADOW_SEGMENTS + 1;
  const SHADOW_LANES = SHADOW_STRIPS + 1;
  const shadowVerts = new Float32Array(SHADOW_LANES * SHADOW_ROWS * 3);
  const shadowGeometry = new BufferGeometry();
  shadowGeometry.setAttribute('position', new BufferAttribute(shadowVerts, 3));
  {
    const uvs = new Float32Array(SHADOW_LANES * SHADOW_ROWS * 2);
    let at = 0;
    for (let row = 0; row < SHADOW_ROWS; row += 1) {
      for (let lane = 0; lane < SHADOW_LANES; lane += 1) {
        uvs[at] = lane / SHADOW_STRIPS;
        uvs[at + 1] = row / SHADOW_SEGMENTS;
        at += 2;
      }
    }
    shadowGeometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  }
  const shadowIndex = new Uint16Array(SHADOW_STRIPS * SHADOW_SEGMENTS * 6);
  shadowGeometry.setIndex(new BufferAttribute(shadowIndex, 1));
  const shadow = new Mesh(shadowGeometry, createActorShadowMaterial(skin.material));
  shadow.frustumCulled = false;
  shadow.renderOrder = 1;
  // 塗りの影は出さない（DEC-393）。太陽の影は受ける側（マップ・キャラの材質）が光を遮って作るので、
  // チップと同じく透けた所に乗らない。塗りは地形に沿って折るだけで、受ける絵の透けを知らなかった。
  shadow.visible = false;

  const shadowUp = new Vector3(0, 1, 0);
  const shadowRight = new Vector3(1, 0, 0);
  /** 影が伸びる水平方向（ワールド）。光の向きから出す。 */
  const shadowAway = new Vector3(0, 0, 1);
  /** 高さ 1 に対して地面で何倍に伸びるか。1/tan(仰角)。 */
  let shadowStretch = 1;
  /** 面から浮かせる量（DEC-161）。絵の 1 画素。これ以上出すと影が面から離れて見える。 */
  const shadowLift = unit / tilePx;
  const shadowStart = new Vector2();
  const shadowLanes: Vector2[][] = [];
  /**
   * 影が歩く地形（DEC-159）。**当たり判定とは別物**で、マップのビルボード影と同じ物を使う。
   * 無ければ平らな床とみなす。
   */
  let shadowSolid: ((x: number, y: number, z: number) => boolean) | null = null;
  let shadowSurface: ((x: number, y: number, z: number) => boolean) | undefined;
  /** 面の高さ（DEC-215）。マス内の位置まで見るので、坂の上で影が段々にならない。 */
  let shadowTop: ((x: number, y: number, z: number, fx: number, fz: number) => number | null) | undefined;

  const position = new Vector3();

  /** 絵を地面へ寝かせ直す。位置・光・当たり判定が変わったら呼ぶ。 */
  /** 使い回しの受け皿（DEC-208）。毎フレーム作り直すと GC でカクつく。 */
  const laneHeights: Float32Array[] = [];
  const laneDrape: Vector2[][] = [];
  /** 前回組んだときの入力。同じなら組み直さない。 */
  let shadowKey = '';
  /** 自分のマスの中で塞ぐか（DEC-241）。`setShadowField` で受け取る。 */
  let shadowSelf:
    | ((x: number, y: number, z: number, fx: number, fz: number, dirX: number, dirZ: number) => boolean)
    | undefined;

  const layoutShadow = () => {
    // 塗りの影を出さないあいだは組まない（DEC-393）。動くたびの組み直しがそのまま要らなくなる。
    if (!shadow.visible) return;
    // 位置も向きも光も変わっていなければ何もしない（DEC-208）。
    // `faceCamera()` は毎フレーム呼ばれるので、ここで止めないと止まっていても組み直す。
    const key =
      `${position.x.toFixed(4)},${position.y.toFixed(4)},${position.z.toFixed(4)},` +
      `${group.rotation.y.toFixed(4)},${shadowStretch.toFixed(4)},${onGround},` +
      `${shadowAway.x.toFixed(4)},${shadowAway.y.toFixed(4)},${shadowAway.z.toFixed(4)}`;
    if (key === shadowKey) return;
    shadowKey = key;
    // グループの yaw を打ち消して、ワールドの軸で組めるようにする。
    shadow.rotation.y = -group.rotation.y;
    shadowRight.crossVectors(shadowAway, shadowUp).normalize();

    const cells = 1 / unit;
    const baseY = position.y * cells;
    const tall = height * cells;
    const wide = width * cells;
    const reach = Math.min(MAX_WALK, tall * shadowStretch + 2);
    const isSolid = shadowSolid ?? (() => false);

    shadowLanes.length = 0;
    for (let lane = 0; lane < SHADOW_LANES; lane += 1) {
      const across = (lane / SHADOW_STRIPS - 0.5) * wide;
      shadowStart.set(
        position.x * cells + shadowRight.x * across,
        position.z * cells + shadowRight.z * across,
      );
      const heights = profile(
        isSolid,
        shadowStart,
        baseY,
        shadowAway,
        reach,
        baseY + tall,
        { x: Math.floor(position.x * cells), z: Math.floor(position.z * cells) },
        // 上向き面も受け手にする（DEC-144）。板 1 枚は固体に入らない。
        shadowSurface,
        laneHeights[lane],
        shadowSelf,
        shadowTop,
      );
      // **宙に浮いている間は足元より下へ落とさない**（DEC-238）。
      // `casterTop` は足元の下 2 マスまで床を探すので（DEC-219）、はしごを登り始めた
      // 2 マスぶんだけ影の起点が地面まで下がり、2 マス目でぷつっと切り替わる。
      // 足元で切っておけば下への広がりも切り替わりも消え、**壁への追従はそのまま**残る。
      // 地面に立っているときは触らない——崖ぎわで影が下の段へ垂れるのは正しい。
      if (!onGround) {
        for (let i = 0; i < heights.length; i += 1) {
          if (heights[i] < baseY) heights[i] = baseY;
        }
      }
      laneHeights[lane] = heights;
      shadowLanes.push(drape(heights, baseY, shadowStretch, 0, tall, SHADOW_SEGMENTS, laneDrape[lane]));
      laneDrape[lane] = shadowLanes[shadowLanes.length - 1];
    }

    let at = 0;
    for (let row = 0; row < SHADOW_ROWS; row += 1) {
      for (let lane = 0; lane < SHADOW_LANES; lane += 1) {
        const line = shadowLanes[lane];
        const point = line[row];
        const across = (lane / SHADOW_STRIPS - 0.5) * width;
        // **面の法線へ逃がす**（DEC-161）。真上へ持ち上げるだけだと、壁を這う部分は
        // 面に沿ってずり上がるだけで浮かず、同じ座標で描いて明滅する。
        // 前後の点から折れ線の向きを取り、その垂線（光の側）へ 1 画素ぶん出す。
        const back = line[Math.max(row - 1, 0)];
        const ahead = line[Math.min(row + 1, SHADOW_ROWS - 1)];
        const runX = ahead.x - back.x;
        const runY = ahead.y - back.y;
        const run = Math.hypot(runX, runY) || 1;
        // 床なら真上、壁なら光のほうへ。斜面はその中間。
        const offAway = (-runY / run) * shadowLift;
        const offUp = (runX / run) * shadowLift;
        shadowVerts[at] = shadowRight.x * across + shadowAway.x * (point.x * unit + offAway);
        shadowVerts[at + 1] = point.y * unit + offUp;
        shadowVerts[at + 2] = shadowRight.z * across + shadowAway.z * (point.x * unit + offAway);
        at += 3;
      }
    }
    shadowGeometry.attributes.position.needsUpdate = true;

    // 段差をまたぐ帯はつながない。角で空中に板が立つのを防ぐ（DEC-66）。
    let out = 0;
    for (let row = 1; row < SHADOW_ROWS; row += 1) {
      for (let lane = 0; lane < SHADOW_STRIPS; lane += 1) {
        const here = shadowLanes[lane];
        const beside = shadowLanes[lane + 1];
        if (
          Math.abs(here[row].y - beside[row].y) > SHADOW_BREAK_HEIGHT ||
          Math.abs(here[row - 1].y - beside[row - 1].y) > SHADOW_BREAK_HEIGHT ||
          Math.abs(here[row].x - beside[row].x) > SHADOW_BREAK_ALONG ||
          Math.abs(here[row - 1].x - beside[row - 1].x) > SHADOW_BREAK_ALONG
        ) {
          continue;
        }
        const a = (row - 1) * SHADOW_LANES + lane;
        const b = a + SHADOW_LANES;
        shadowIndex[out] = a;
        shadowIndex[out + 1] = a + 1;
        shadowIndex[out + 2] = b;
        shadowIndex[out + 3] = a + 1;
        shadowIndex[out + 4] = b + 1;
        shadowIndex[out + 5] = b;
        out += 6;
      }
    }
    shadowIndex.fill(0, out);
    shadowGeometry.setDrawRange(0, out);
    (shadowGeometry.index as BufferAttribute).needsUpdate = true;
  };

  let fallSpeed = 0;
  /** 前のフレームで面に乗っていたか（DEC-210）。坂の追従と貼り付けは接地中だけ効かせる。 */
  let onGround = false;
  /** はしごに掴まっているか（DEC-237）。掴まっている間は重力を切り、上下だけ動く。 */
  let onLadder = false;
  let facing: Facing = 'south';
  let stepTime = 0;
  let stepIndex = 0;

  /**
   * シートのコマを選ぶ。UV は左下原点なので行は下から数える。
   * 枠はぴったりで渡す——隣のコマを拾わない締めは
   * `actorMaterial` の `frameClamp` が受け持つ（DEC-271）。
   */
  const frameUv = { x: 0, y: 0, width: 1 / sheet.cols, height: 1 / sheet.rows };
  const showFrame = (col: number, row: number) => {
    frameUv.x = col / sheet.cols;
    frameUv.y = 1 - (row + 1) / sheet.rows;
    skin.setFrame(frameUv.x, frameUv.y, frameUv.width, frameUv.height);
  };
  showFrame(WALK_PATTERN[STAND], rowOf('south'));

  /** いま出すべきコマを絵に反映する。固定されていればそれを優先する。 */
  const refreshFrame = () => {
    if (posed !== null) {
      // **通し番号**で持つ（GS-47）。左上から右へ、行を折り返して数える——
      // シートを見て数えるときの数え方と同じ（旧作の `generateFrameNumbers` も同じ）。
      showFrame(posed % sheet.cols, Math.floor(posed / sheet.cols));
      return;
    }
    showFrame(WALK_PATTERN[stepIndex], rowOf(facing));
  };

  /** その足元位置に体が入るか。半径の四隅で見る。 */
  /**
   * 体の当たりを取る点（DEC-244）。**八角形。中心からの距離はどの向きも `RADIUS`。**
   *
   * 四隅を `(±R, ±R)` で取ると、**斜め方向だけ半径が `R√2`（1.4 倍）に太る**。
   * 45 度の壁ではその角が法線を向くので、壁沿いにずらそうとしても角が帯へ入って動けない
   * （実測: 斜面を滑って階段状の角で停止した）。軸方向の広がりは `±R` のままなので、
   * 軸に沿った壁の当たりは今までと変わらない。
   */
  const BODY_RING: Array<[number, number]> = (() => {
    const d = Math.SQRT1_2;
    return [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-d, -d],
      [-d, d],
      [d, -d],
      [d, d],
    ];
  })();

  /** マス 1 つぶんの四角の四隅（GS-116）。四角が重なるマスはこの 4 点で全部出る。 */
  const BODY_SQUARE: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  /**
   * いま四角の体で当たりを見ているか（GS-116）。
   *
   * **壁ぎわに置かれた NPC など、四角が最初から収まらない場所に立っていることがある。**
   * そのまま四角で見ると一歩も動けなくなるので、収まっていないあいだだけ四角の判定を外す。
   * 動いて収まる場所へ出れば、次のフレームから四角に戻る。
   */
  let squareBody = true;

  /**
   * そこに体が入るか（GS-116）。**見方が 2 つある。**
   *
   * - **マス 1 つぶんの四角**が、丸ごと塞がるマス（ブロック・斜面・人）へ重ならないこと。
   *   これが「当たり判定はマスの四角」。1 マス幅の通路はマスに揃っていないと入れない。
   * - **細い体（八角形）**が、薄い壁チップの帯（DEC-236）へ当たらないこと。
   *   薄い壁は**歩けるマスの中**に描いてあるので、四角で見ると壁ぎわの床に立てなくなる。
   */
  const fits = (wx: number, wy: number, wz: number, collision: CollisionMap): boolean => {
    const r = RADIUS * unit;
    const edge = BODY_EDGE * unit;
    const base = cellOf(wy + 0.001 * unit, unit);
    for (let level = 0; level < BODY_CELLS; level += 1) {
      for (const [ox, oz] of BODY_RING) {
        // セル座標は小数のまま渡す（DEC-236）。壁チップは帯だけを塞ぐ。
        if (collision.blockedAt((wx + ox * r) / unit, base + level, (wz + oz * r) / unit)) {
          return false;
        }
      }
      if (!squareBody) continue;
      for (const [ox, oz] of BODY_SQUARE) {
        if (collision.solidCellAt((wx + ox * edge) / unit, base + level, (wz + oz * edge) / unit)) {
          return false;
        }
      }
    }
    return true;
  };

/** 足元を見る点。中心と四隅（DEC-210）。中心が要るのは、坂の高さが場所で変わるため。 */
  const FEET: Array<[number, number]> = [
    [0, 0],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  /** 足元の面を探す。`pick` は柱 1 本ぶんの高さを返すもの。一番高いものを取る。 */
  const highestUnder = (
    pick: (x: number, z: number, feetY: number, fx: number, fz: number) => number | null,
    wx: number,
    wy: number,
    wz: number,
  ): number | null => {
    const r = RADIUS * unit;
    let best: number | null = null;
    for (const [sx, sz] of FEET) {
      const px = (wx + sx * r) / unit;
      const pz = (wz + sz * r) / unit;
      const cx = Math.floor(px);
      const cz = Math.floor(pz);
      const found = pick(cx, cz, wy, px - cx, pz - cz);
      if (found !== null && (best === null || found > best)) best = found;
    }
    return best;
  };

  /** 足元にある一番高い床面。坂はマス内の位置で高さが変わる（DEC-210）。 */
  const surface = (wx: number, wy: number, wz: number, collision: CollisionMap): number | null =>
    highestUnder((x, z, feetY, fx, fz) => collision.surfaceUnder(x, z, feetY, fx, fz), wx, wy, wz);

  /**
   * 落下が止まる高さ。`surface` と違い**塞ぐマスの上面も受ける**（DEC-209）。
   * 壁チップは足場を出さないので、これが無いと斜め壁の柱へ落ちたとき中まで抜けて動けなくなる。
   * 登れるかの判定には使わない——使うと壁の横から 1 マスずつ登れてしまう。
   */
  const footing = (wx: number, wy: number, wz: number, collision: CollisionMap): number | null =>
    highestUnder((x, z, feetY, fx, fz) => collision.landingUnder(x, z, feetY, fx, fz), wx, wy, wz);

  /**
   * 体が塞ぐマスに埋まっていたら逃がす（DEC-209）。まず真上、だめなら近い空きマスへ。
   * 落下側は `footing` で入らないようにしてあるが、マップを描き替えた直後や
   * 置き直しで埋まることはある。動けなくなるのが一番まずいので保険を置く。
   */
  const unstick = (collision: CollisionMap): void => {
    if (fits(position.x, position.y, position.z, collision)) return;
    for (let step = 1; step <= UNSTICK_UP; step += 1) {
      const up = position.y + step * unit;
      if (!fits(position.x, up, position.z, collision)) continue;
      position.y = up;
      fallSpeed = 0;
      onGround = false;
      return;
    }
    const cx = cellOf(position.x, unit);
    const cz = cellOf(position.z, unit);
    for (let ring = 1; ring <= UNSTICK_OUT; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dz = -ring; dz <= ring; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const wx = (cx + dx + 0.5) * unit;
          const wz = (cz + dz + 0.5) * unit;
          if (!fits(wx, position.y, wz, collision)) continue;
          position.x = wx;
          position.z = wz;
          fallSpeed = 0;
          onGround = false;
          return;
        }
      }
    }
  };

  /** 1 軸だけ動かす。塞がっていれば 1 マスまで登る。だめならその軸は動かさない。 */
  /**
   * 斜めの壁に沿ってずらす（DEC-243）。**1 歩も動けなかったときだけ**呼ぶ。
   *
   * 軸ごとに動かすやり方（`slide`）だと、軸に沿った壁は自然に滑るが、
   * **45 度の壁は X も Z も塞がるので止まってしまう**（実測: 斜面へ W を 1 秒押して 0.49 マスで停止）。
   * そこで進みたい向きを 45 度ずらして試す。壁に沿う成分は `cos45` なので長さもそのぶん落とす。
   * 内側の角では両方とも塞がるので、今までどおり止まる。
   */
  const deflect = (dx: number, dz: number, collision: CollisionMap): void => {
    if (dx === 0 && dz === 0) return;
    // ±45 度回して cos45 を掛けたもの。結局どちらも係数 1/2 になる。
    const tries: [number, number][] = [
      [(dx - dz) / 2, (dx + dz) / 2],
      [(dx + dz) / 2, (dz - dx) / 2],
    ];
    for (const [rx, rz] of tries) {
      if (!fits(position.x + rx, position.y, position.z + rz, collision)) continue;
      position.x += rx;
      position.z += rz;
      return;
    }
  };

  /**
   * 通路へ入るためのマス寄せ（GS-116。GS-29 の「角の逃がし」を作り直したもの）。
   * **進めなかったときだけ**呼ぶ。
   *
   * 体はマス 1 つぶんの四角なので、1 マス幅の通路へは**マスに揃っていないと入れない**。
   * そこで、体が**半分以上かかっているマス**——つまり中心が居るマス——の真ん中へ、
   * 進みたい向きと直角に歩いて揃える。揃えば次のフレームからキーの向きへ進む。
   *
   * 揃えるのは「揃えば前へ進める」ときだけ。そうしないと、ただの行き止まりでも
   * 体が横へ滑って「押しているのに違う方へ動く」ことになる。
   * 返すのは寄せているあいだ向く方（ワールドの向き）。寄せないなら null。
   */
  const laneSlip = (
    dx: number,
    dz: number,
    step: number,
    collision: CollisionMap,
  ): { x: number; z: number } | null => {
    if (dx === 0 && dz === 0) return null;
    // 主に進みたい向きだけを見る。斜め入力は `slide` が軸ごとに片付けている。
    const alongX = Math.abs(dx) >= Math.abs(dz);
    const forward = (alongX ? Math.sign(dx) : Math.sign(dz)) * step;
    const here = alongX ? position.z : position.x;
    // 揃える先は、体の中心が居るマスの真ん中。
    const lane = (Math.floor(here / unit) + 0.5) * unit;
    const gap = lane - here;
    // もう揃っている。進めないのは通路が無いからで、寄せても意味がない。
    if (Math.abs(gap) <= LANE_SNAP * unit) return null;
    // 揃った先から前へ進めるか。
    const aheadX = alongX ? position.x + forward : lane;
    const aheadZ = alongX ? lane : position.z + forward;
    if (!fits(aheadX, position.y, aheadZ, collision)) return null;
    // 1 フレームで動くのは進む速さぶんまで。届くなら**ぴったり真ん中へ**置く
    // ——ここがずれていると、1 マス幅の通路に永久に入れない。
    const next = Math.abs(gap) <= step ? lane : here + Math.sign(gap) * step;
    const nx = alongX ? position.x : next;
    const nz = alongX ? next : position.z;
    // 寄る道自体も空いていること。
    if (!fits(nx, position.y, nz, collision)) return null;
    position.x = nx;
    position.z = nz;
    return alongX ? { x: 0, z: Math.sign(gap) } : { x: Math.sign(gap), z: 0 };
  };

  /**
   * 壁の手前まで詰める（GS-116）。1 フレームぶん丸ごとは進めないとき、**進める分だけ**進む。
   * これが無いと壁との間に最大 1 フレームぶん（走りで 0.13 マス）の隙間が残り、
   * マス 1 つぶんの四角で当たりを取ると「マスに入り切っていない」のが見えてしまう。
   */
  const creep = (axis: 'x' | 'z', delta: number, collision: CollisionMap): void => {
    let lo = 0;
    let hi = delta;
    for (let i = 0; i < 5; i += 1) {
      const mid = (lo + hi) / 2;
      const tx = axis === 'x' ? position.x + mid : position.x;
      const tz = axis === 'z' ? position.z + mid : position.z;
      if (fits(tx, position.y, tz, collision)) lo = mid;
      else hi = mid;
    }
    if (lo === 0) return;
    if (axis === 'x') position.x += lo;
    else position.z += lo;
  };

  const slide = (axis: 'x' | 'z', delta: number, collision: CollisionMap): void => {
    if (delta === 0) return;
    const nx = axis === 'x' ? position.x + delta : position.x;
    const nz = axis === 'z' ? position.z + delta : position.z;
    if (fits(nx, position.y, nz, collision)) {
      position.x = nx;
      position.z = nz;
      return;
    }
    // 登れる高さは場所で変わる（DEC-237）。`Climb` のオブジェクトの中では高くなる。
    const reach = Math.ceil(collision.climbAt(position.x / unit, position.y / unit, position.z / unit, STEP_UP));
    for (let step = 1; step <= reach; step += 1) {
      const up = position.y + step * unit;
      if (!fits(nx, up, nz, collision)) continue;
      if (!fits(position.x, up, position.z, collision)) continue;
      // 登った先に足場が要る。これが無いと壁の横で 1 マスずつ浮いて登れてしまう。
      // 足場は `up` ちょうどでなくてよい（DEC-210）。坂の上なら少し下に来る。
      // ただし今の足元より下ではだめで、その高さで体が収まることも要る。
      const landing = surface(nx, up + 0.001 * unit, nz, collision);
      if (landing === null) continue;
      if (landing > up + 0.001 * unit || landing < position.y - 0.001 * unit) continue;
      if (!fits(nx, landing, nz, collision)) continue;
      position.x = nx;
      position.z = nz;
      position.y = landing;
      fallSpeed = 0;
      onGround = true;
      return;
    }
  };

  /** 画面基準の入力から向きを決める。入力が無ければ今の向きのまま。 */
  const facingFor = (axis: { x: number; y: number }): Facing => {
    if (axis.x === 0 && axis.y === 0) return facing;
    if (Math.abs(axis.x) > Math.abs(axis.y)) return axis.x < 0 ? 'west' : 'east';
    return axis.y > 0 ? 'south' : 'north';
  };

  /**
   * ワールドの向きから絵の向きを決める（GS-116）。絵の向きは画面基準なので、
   * カメラの方位で画面の軸へ戻してから `facingFor` に渡す（`GameView.moveVector` の逆）。
   */
  const facingForWorld = (wx: number, wz: number, yaw: number): Facing => {
    const yawR = (yaw * Math.PI) / 180;
    const right = { x: Math.cos(yawR), z: -Math.sin(yawR) };
    const forward = { x: -Math.sin(yawR), z: -Math.cos(yawR) };
    return facingFor({ x: wx * right.x + wz * right.z, y: -(wx * forward.x + wz * forward.z) });
  };

  const player: Player = {
    group,
    position,
    face(to) {
      facing = to;
      stepIndex = STAND;
      refreshFrame();
    },
    facingNow: () => facing,
    pose(name) {
      if (name === null) {
        posed = null;
        refreshFrame();
        return true;
      }
      // 番号で来たらそのまま。名前なら台帳（`poses`）を引く。
      const col = typeof name === 'number' ? name : sheet.poses?.[name];
      if (col === undefined || !Number.isFinite(col) || col < 0) return false;
      posed = col;
      refreshFrame();
      return true;
    },
    cell: () => ({
      x: cellOf(position.x, unit),
      y: cellOf(position.y + 0.001 * unit, unit),
      z: cellOf(position.z, unit),
    }),
    placeAt(x, y, z) {
      position.set(x, y, z);
      group.position.copy(position);
      fallSpeed = 0;
      onGround = false;
      onLadder = false;
    },
    settle(collision) {
      const cx = (Math.floor(position.x / unit) + 0.5) * unit;
      const cz = (Math.floor(position.z / unit) + 0.5) * unit;
      if (cx === position.x && cz === position.z) return;
      if (!fits(cx, position.y, cz, collision)) return;
      position.x = cx;
      position.z = cz;
      group.position.copy(position);
      skin.setShadowBase(position.x, position.y, position.z);
      layoutShadow();
    },
    spawn(collision, bounds) {
      const minX = bounds.empty ? 0 : bounds.min[0];
      const maxX = bounds.empty ? 0 : bounds.max[0];
      const minZ = bounds.empty ? 0 : bounds.min[2];
      const maxZ = bounds.empty ? 0 : bounds.max[2];
      const top = bounds.empty ? 1 : bounds.max[1] + 1;
      const cx = Math.round((minX + maxX) / 2);
      const cz = Math.round((minZ + maxZ) / 2);
      const span = Math.max(maxX - minX, maxZ - minZ) + 2;
      // 中央から外へ渦巻き状に探し、床があって頭がつかえないマスを取る。
      for (let ring = 0; ring <= span; ring += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          for (let dz = -ring; dz <= ring; dz += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const x = cx + dx;
            const z = cz + dz;
            const wx = (x + 0.5) * unit;
            const wz = (z + 0.5) * unit;
            const wy = collision.surfaceUnder(x, z, (top + 1) * unit);
            if (wy === null) continue;
            if (!fits(wx, wy, wz, collision)) continue;
            player.placeAt(wx, wy, wz);
            return true;
          }
        }
      }
      player.placeAt((cx + 0.5) * unit, top * unit, (cz + 0.5) * unit);
      return false;
    },
    update(deltaSeconds, input, collision) {
      const { move, axis, running } = input;
      // 壁ぎわに置かれていて四角が収まらないあいだは細い体で動かす（GS-116）。
      squareBody = true;
      if (!fits(position.x, position.y, position.z, collision)) squareBody = false;
      unstick(collision);

      // --- はしご（DEC-237）。掴まっている間は重力も横移動も止め、上下だけ動かす。 ---
      const ladder = collision.ladderAt(position.x / unit, position.y / unit, position.z / unit);
      if (!ladder) onLadder = false;
      // はしごの筒へ寄せる（DEC-237）。**既にその列に居るなら 1 ミリも動かさない。**
      // マスの中心へ吸い寄せると、2 マス幅のはしごで横に飛ぶ。
      // 外れているときも中心ではなく**縁まで**寄せる——動く量が最小で、壁にも近いまま。
      const holdTo = (world: number, cell: number | null, lo: number, hi: number): number => {
        if (cell === null) return world;
        if (Math.floor(world / unit) === cell) return world;
        const margin = RADIUS * unit;
        const want = Math.min(
          Math.max(world, cell * unit + margin),
          (cell + 1) * unit - margin,
        );
        return Math.min(Math.max(want, lo * unit), hi * unit);
      };
      if (ladder && !onLadder) {
        // 掴む条件は上下で別（DEC-237）。**端では普通に歩けるようにする。**
        // 下端で S、上端で W を握ってもはしごに吸い付かないので、
        // はしごの根元や上の平地を横切っても止まらない。
        const cellY = position.y / unit;
        const grab = axis.y < 0 ? cellY < ladder.maxY - 0.01 : axis.y > 0 ? cellY > ladder.minY + 0.01 : false;
        if (grab) {
          onLadder = true;
          // 壁のマスも含めて描くので、掴んだ瞬間に**縦に空いている筒**へ寄せる。
          // 寄せるのは筒から外れている向きだけ。横位置はそのまま持ち上がる。
          position.x = holdTo(position.x, ladder.shaftX, ladder.minX, ladder.maxX);
          position.z = holdTo(position.z, ladder.shaftZ, ladder.minZ, ladder.maxZ);
        }
      }
      if (onLadder && ladder) {
        fallSpeed = 0;
        onGround = false;
        // W が -1、S が +1。筒から外れている向きだけ押さえて、上下だけ動かす。
        position.x = holdTo(position.x, ladder.shaftX, ladder.minX, ladder.maxX);
        position.z = holdTo(position.z, ladder.shaftZ, ladder.minZ, ladder.maxZ);
        position.y += -axis.y * LADDER_SPEED * unit * deltaSeconds;
        const eps = 0.001 * unit;
        const low = ladder.minY * unit;
        const high = ladder.maxY * unit;
        if (position.y <= low) {
          // 下端。足場があればそこへ降りる。
          position.y = low;
          const ground = footing(position.x, position.y + eps, position.z, collision);
          if (ground !== null) position.y = ground;
          onLadder = false;
        } else if (position.y >= high) {
          position.y = high;
          // 上端。**はしごの範囲の中**で上面のあるマスを探して乗り移る。
          // 壁に立てかけたはしごなら、壁の上のマスがここで見つかる。
          let landX: number | null = null;
          let landZ = 0;
          let landY = 0;
          let near = Infinity;
          // 乗り移り先も**今の横位置をできるだけ保つ**。マスが同じ向きは動かさない。
          const alongCell = (world: number, cell: number): number => {
            if (Math.floor(world / unit) === cell) return world;
            const margin = RADIUS * unit;
            return Math.min(Math.max(world, cell * unit + margin), (cell + 1) * unit - margin);
          };
          for (let cz = Math.floor(ladder.minZ); cz < Math.ceil(ladder.maxZ); cz += 1) {
            for (let cx = Math.floor(ladder.minX); cx < Math.ceil(ladder.maxX); cx += 1) {
              const wx = alongCell(position.x, cx);
              const wz = alongCell(position.z, cz);
              const top = footing(wx, high + LADDER_EXIT_REACH * unit, wz, collision);
              if (top === null || top < high - unit * 0.5) continue;
              if (!fits(wx, top, wz, collision)) continue;
              const d = (wx - position.x) ** 2 + (wz - position.z) ** 2;
              if (d >= near) continue;
              near = d;
              landX = wx;
              landZ = wz;
              landY = top;
            }
          }
          if (landX !== null) {
            position.x = landX;
            position.z = landZ;
            position.y = landY;
            onLadder = false;
            onGround = true;
          }
        }
        // 絵は歩きのまま。**常に背中を見せる**ので向きは北で固定。
        facing = 'north';
        if (axis.y !== 0) {
          stepTime += deltaSeconds;
          const per = running ? RUN_STEP_S : STEP_S;
          while (stepTime >= per) {
            stepTime -= per;
            stepIndex = (stepIndex + 1) % WALK_PATTERN.length;
          }
        } else {
          stepTime = 0;
          stepIndex = STAND;
        }
        // はしごは背中を見せて登る。向きを合わせてから絵を出す。
        facing = 'north';
        refreshFrame();
        group.position.copy(position);
        skin.setShadowBase(position.x, position.y, position.z);
        // 影は普通どおり地形へドレープする。**登っている壁に沿って上がる**（DEC-238）。
        layoutShadow();
        return;
      }

      const speed = (input.speed ?? (running ? RUN_SPEED : WALK_SPEED)) * unit * deltaSeconds;
      const heldX = position.x;
      const heldZ = position.z;
      slide('x', move.x * speed, collision);
      slide('z', move.z * speed, collision);
      if (position.x === heldX && position.z === heldZ) {
        deflect(move.x * speed, move.z * speed, collision);
      }
      // それでも 1 ミリも動けないなら、通路の縁に当たっている（GS-116）。
      // 半分以上かかっているマスの真ん中へ、直角に歩いて揃える。
      let slip: { x: number; z: number } | null = null;
      if (position.x === heldX && position.z === heldZ) {
        slip = laneSlip(move.x * speed, move.z * speed, speed, collision);
      }
      // 寄せる先も無いなら壁。**残った隙間ぶんだけ詰める**（GS-116）。
      // 1 フレームぶん丸ごと進めないと止まる作りなので、これが無いと壁との間に隙間が残る。
      if (position.x === heldX && position.z === heldZ) {
        creep('x', move.x * speed, collision);
        creep('z', move.z * speed, collision);
      }

      // 通路へ寄せているあいだは**寄る方へ体を向ける**（GS-116）。真横へ滑って見えない。
      // **滑らせているときは向きも足もそのまま**（GS-155）——飛ばされた人は前を向いたまま下がる。
      if (!input.slide) {
        facing = slip && input.yaw !== undefined ? facingForWorld(slip.x, slip.z, input.yaw) : facingFor(axis);
      }
      // 壁に押し当てているだけでも足踏みさせる。止まったように見えないため。
      const walking = !input.slide && (axis.x !== 0 || axis.y !== 0);
      if (walking) {
        stepTime += deltaSeconds;
        const per = running ? RUN_STEP_S : STEP_S;
        while (stepTime >= per) {
          stepTime -= per;
          stepIndex = (stepIndex + 1) % WALK_PATTERN.length;
        }
      } else {
        stepTime = 0;
        stepIndex = STAND;
      }
      refreshFrame();

      // 接地中は少し上まで面を探す（坂を登る）。空中では今の足元から下だけ見る（DEC-210）。
      const reach = onGround ? SLOPE_REACH * unit : 0;
      const ground = footing(position.x, position.y + reach, position.z, collision);
      const eps = 0.001 * unit;
      // 接地中は少し下の面へも貼り付ける。下り坂で浮いては落ちるガタつきを消す。
      const grabs =
        ground !== null &&
        (position.y <= ground + eps || (onGround && position.y - ground <= GROUND_SNAP * unit));
      if (grabs) {
        position.y = ground as number;
        fallSpeed = 0;
        onGround = true;
      } else {
        onGround = false;
        fallSpeed = Math.min(fallSpeed + GRAVITY * unit * deltaSeconds, FALL_MAX * unit);
        const next = position.y - fallSpeed * deltaSeconds;
        if (ground !== null && next <= ground) {
          position.y = ground;
          fallSpeed = 0;
          onGround = true;
        } else {
          position.y = Math.max(next, VOID_Y * unit);
        }
      }

      group.position.copy(position);
      skin.setShadowBase(position.x, position.y, position.z);
      layoutShadow();
    },
    setShadowField(solid, surface, top, selfSolid) {
      shadowSolid = solid;
      shadowSurface = surface;
      shadowTop = top;
      shadowSelf = selfSolid;
      // 地形が変わったら位置が同じでも組み直す。
      shadowKey = '';
      layoutShadow();
    },
    faceCamera(yaw) {
      group.rotation.y = yaw;
      layoutShadow();
    },
    setLighting(lighting, pointLights, cellSize, cameraFx) {
      skin.setLighting(lighting, pointLights, cellSize);
      skin.setCameraFx(cameraFx);
      const resolved = resolveLighting(lighting);
      shadowAway.copy(shadowDirection(resolved));
      shadowStretch = blockShadowLength(resolved);
      // 出す・出さないはマップの影と同じ判定（DEC-214）。`blockShadow` だけを見ていたので、
      // 「濃さ 0」でマップの影が消えてもキャラの影だけ残っていた。
      // 塗りの影は出さない（DEC-393）。出す・出さないは受ける側の太陽の影が決める。
      layoutShadow();
    },
    setTime(seconds) {
      skin.setTime(seconds);
    },
    bodyMaterial: skin.material,
    texture,
    tallCells: height / unit,
    footLift,
    frame: () => frameUv,
    size: { width, height },
    // 踏んだ判定も四角に合わせる（GS-116）。細いままだと、四角で壁の手前に止まったとき
    // 壁のマスに描いた起動場所（扉など）に届かなくなる。
    radius: BODY_HALF,
    dispose() {
      body.geometry.dispose();
      skin.dispose();
      texture.dispose();
      shadow.geometry.dispose();
      (shadow.material as ShaderMaterial).dispose();
    },
  };

  return player;
}
