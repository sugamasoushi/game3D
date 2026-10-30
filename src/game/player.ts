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
import { createPartySilhouette } from './partySilhouette';
import { blockShadowLength, resolveLighting, shadowDirection } from '../mep3d/lighting';
import { MAX_WALK, SEGMENTS_PER_CELL, drape, profile } from '../mep3d/shadowCast';
import { cellOf } from '../mep3d/collision';
import type { PhysicsBody, Terrain } from './physics';
import { createLaneAligner } from './lane';import type { CameraFxDef, LightingDef, PointLightDef } from '../mep3d/types';

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
  /**
   * 1 コマの大きさ（px）。マップの 1 マスの画素（`grid.tilePx`）に対する比がそのまま背丈になる。
   * **キャラの絵の 1 画素＝マップの絵の 1 画素**（RPG ツクールと同じ。2026-10-22）。48px のマップで 64×64 のコマは約 1.33 マス。
   */
  framePx: [number, number];
  /**
   * **絵だけ**の倍率（2026-10-22）。台帳の画像ごとの `actorScale` に、配置した物の `Scale` を掛けたもの。書かなければ 1。
   * 板の大きさ・足元の補正・頭のすき間に掛かり、当たり・歩く速さには掛からない。
   * コマの区切り（`framePx`）は画像の画素のまま——ここを伸ばすと、頭のすき間を測るときのコマの切り方がずれる。
   */
  scale?: number;
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
 * 歩きのコマ順。3 コマなら真ん中が止まり絵で行って戻る、それ以外は順に回す。
 * 旧作の spritetype 0304 / 0404 と同じ考え方（GS-16）。
 */
const walkPatternFor = (cols: number): number[] =>
  cols === 3 ? [0, 1, 2, 1] : Array.from({ length: Math.max(cols, 1) }, (_, i) => i);
const STEP_SECONDS = 0.16;
const RUN_STEP_SECONDS = 0.1;

/**
 * 体の背丈（マス。GS-239）。Rapier の体（カプセル）の高さ。頭がつかえるかもこれで決まる。
 * ゲーム（`GameView`）が体を作るときも同じ値を使う。
 */
export const BODY_TALL_CELLS = 1.4;
/**
 * 体の幅の半分（マス。GS-241）。Rapier の体は**マス目に揃った四角い柱**（前の作りの GS-116 と同じ考え方）で、
 * 幅はマスより少しだけ細い——Rapier は面から 0.02 の隙間を空けて止めるので、0.5 だと 1 マス幅の通路に入れない。
 * 1 マス幅の通路へは、マスの揃え（`lane.ts`）でほぼ真ん中へ寄せて入る。足元の面を探す範囲にも使う。
 * ゲーム（`GameView`）が体を作るときも同じ値を使う。
 */
export const BODY_WIDTH_HALF = 0.46;
/**
 * 踏んだ・調べたの届く範囲の半分（マス。GS-116）。**マス 1 つぶんの四角**——
 * 壁の手前で止まっても、壁のマスに描いた起動場所（扉など）に届くように。
 */
const BODY_HALF = 0.5;

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
  /** その場の足踏み用のコマ時間。移動速度とは独立。 */
  stepMs?: number;
  /**
   * マスの揃え（`lane.ts`。角での自動寄せ）を使わない。**NPC は全部これ**（2026-10-20）——
   * NPC はうろつき・イベントの歩き・経路のどれもマス単位で動くので角を考えなくてよく、
   * 寄せると寄せている間だけ絵が横を向いた（home の grandpaNpc）。プレイヤーだけが寄せる。
   */
  noLane?: boolean;
  /**
   * 向きも足も**動かさずに**運ぶ（GS-155）。殴られて後ろへ飛ぶ、氷の上を滑る、など。
   * 位置だけが動き、絵は立ち止まったまま——「歩いて下がった」と「飛ばされた」は別物。
   */
  slide?: boolean;
}

export interface Player {
  /** フィールドの隊列だけ、遮蔽物の裏を白く表示する。 */
  setSilhouette(on: boolean): void;
  group: Group;
  /** 足元のワールド座標。 */
  position: Vector3;
  /** 立っているセル。HUD 表示用。 */
  cell(): { x: number; y: number; z: number };
  /** 床の上へ置き直す。 */
  placeAt(x: number, y: number, z: number): void;
  /** 通過済みの道をたどる仲間用。物理移動を重ねず、位置・歩行コマ・影を更新する。 */
  /** `facing` を渡すと、動いている間はその向き（GS-185。主人公がそこを通ったときの向き）。 */
  followAt(at: { x: number; y: number; z: number }, dt: number, yaw: number, facing?: Facing): void;
  /**
   * 歩いた後のずれを直す（GS-117 / GS-194）。**歩き終わりに呼ぶ。**
   *
   * 歩く向きはカメラ基準（画面の上下左右）なので、マスの軸とはわずかにずれる。
   * 1 歩ずつのずれが積もると、**絵の立ち位置と塞ぐマスが食い違う**——
   * 人はマス 1 つを塞ぐ（GS-35）ので、端に寄った人には話しかけられなくなる。
   * `from`（歩き出した所）を渡すと、そこから**ちょうどマス何個ぶん**の所へ揃える——
   * マスの中のどこに立っていたかはそのまま（真ん中へ寄せない。GS-194）。
   * 渡さなければ今居るマスの真ん中。
   * **収まらない場所へは動かさない**（壁ぎわで止まったときに壁へ押し込まないため）。
   */
  settle(terrain: Terrain, from?: { x: number; z: number }): void;
  /** 立てるマスを探して置く。見つからなければ false。 */
  spawn(terrain: Terrain, bounds: { min: number[]; max: number[]; empty: boolean }): boolean;
  /**
   * 1 フレーム動かす（GS-239）。**横移動・坂・段差・落下は Rapier の体（`body`）が受け持つ。**
   * はしごと `Climb` の範囲は `terrain` に聞く。
   */
  update(deltaSeconds: number, input: PlayerInput, terrain: Terrain, body: PhysicsBody): void;
  /**
   * 向きだけ変える（GS-13）。イベントの `turn` から呼ぶ。
   * 歩かないので足は止まったまま——立ち止まって振り向く絵になる。
   */
  face(to: Facing): void;
  /**
   * 足を 1 回踏み替えるのにかかる時間（秒。GS-168）。**絵の台帳しだい**なので外から聞けるようにする
   * ——「その場で足踏み」の歩数を時間に直すのに要る。走ると速い。
   */
  stepSeconds(run?: boolean): number;
  /** いま向いている方（GS-16）。目の前に居る相手を探すのに使う。 */
  facingNow(): Facing;
  /**
   * 静止コマを指名する（GS-47）。宝箱の開閉のような**絵だけを切り替える**もの。
   * 名前は台帳の `poses`。**コマ番号を直に渡してもよい**（GS-135。宝箱の台帳は番号で持つ）。
   * `null` で指名を外し、歩きと向きの絵に戻る。知らない名前なら何もせず false を返す。
   */
  pose(name: string | number | null): boolean;
  /**
   * 絵だけ浮かせる（GS-184。イベントの「ジャンプ」）。単位はマス、0 で地面。
   * **立ち位置・影・当たりは動かさない**——跳ねて着地するだけの絵なので。
   */
  hop(lift: number): void;
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
  /** スプライトが読み込まれ、最初の描画に使える状態になるまで待つ。 */
  ready: Promise<void>;
  /** 板の高さ（マス）。影の長さに使う。 */
  tallCells: number;
  /** 絵を下げている量（GS-52。ワールド）。頭の上に何かを置くときに引く。 */
  footLift: number;
  /** いま出しているコマの UV（左下原点）。遮光体に渡す（GC-39）。 */
  frame(): { x: number; y: number; width: number; height: number };
  /** 板の大きさ（ワールド）。 */
  size: { width: number; height: number };
  /**
   * 描いている板の下端の真ん中（ワールド。GS-243）。足元から `footLift` を下げ、跳ねている高さを足した所。
   * 影を落とす板（遮光体・太陽の影）はここから立てる——足元から立てると絵より `footPx` だけ高くなり、
   * 影の足元が絵の足元からずれる。返す値は使い回すので、持ち続けないこと。
   */
  boardFoot(): Vector3;
  /**
   * 板の上の辺から**見えている絵の上端**（髪の上など）までの透明なすき間（ワールド。GS-205）。
   * 全部のコマのうち一番上まで描いてあるコマで測る（歩きで上下しないように）。読み込む前は 0。
   */
  headPad(): number;
  /** 見た目（GS-207）。不透明度と白く光らせる量（どちらも 0〜1）。 */
  setLook(opacity: number, glow: number): void;
  /**
   * 体の半分（マス）。踏んだ判定の範囲に使う（DEC-247）。
   * **当たりと同じマス 1 つぶんの四角**（GS-116）——踏む所に体が重なったら踏んだことにする。
   */
  radius: number;
  dispose(): void;
}

/** 絵だけの倍率。書いていない・壊れた値は 1。 */
function artScale(scale: number | undefined): number {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** シートごとの「コマの上の透明な行数」（GS-205）。同じ絵を何人が使っても 1 度だけ数える。 */
const headPadPx = new Map<string, number>();

/** コマの上の透明な行数（画素）。全部のコマのうち一番少ないもの。読めなければ 0。 */
function measureHeadPad(image: CanvasImageSource & { width: number; height: number }, sheet: ActorSheet): number {
  const [fw, fh] = sheet.framePx;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let pad = fh;
  for (let row = 0; row < sheet.rows; row += 1) {
    for (let col = 0; col < sheet.cols; col += 1) {
      for (let y = 0; y < Math.min(pad, fh); y += 1) {
        const py = row * fh + y;
        let seen = false;
        for (let x = col * fw; x < (col + 1) * fw && !seen; x += 1) seen = data[(py * image.width + x) * 4 + 3] > 0;
        if (seen) {
          pad = y;
          break;
        }
      }
    }
  }
  return pad >= fh ? 0 : pad;
}

/**
 * `scale` はマップ全体のキャラクターの大きさ（2026-10-11。マップの `CharacterScale`）。
 * **絵も当たりも同じ倍率で**大きくする——体の四角・細い体・体の高さ・踏んだ判定の範囲まで。
 * 動く速さ（歩き・走り・うろつき・はしご）にも同じ倍率を掛ける。
 * 1 マス幅の通路に入れるかは設定者の責任（1 より大きいと入れない通路が出る）。
 * `tilePx` はマップの 1 マスの絵の画素。背丈（コマの画素 ÷ これ）と、影を面から浮かせる 1 画素に使う。
 */
export function createPlayer(unit: number, tilePx: number, sheet: ActorSheet,{ scale = 1 }: { scale?: number } = {}): Player {
  const size = Number.isFinite(scale) && scale > 0 ? scale : 1;
  /** 体の大きさ（マス）。倍率を掛けたもの。 */
  const bodyHalfWidth = BODY_WIDTH_HALF * size;
  const bodyHalf = BODY_HALF * size;
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

  let markTextureReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    markTextureReady = resolve;
  });
  const texture = new TextureLoader().load(
    sheet.url,
    (loaded) => {
      // 見えている絵の上端（GS-205）。吹き出しの角がここを指す。
      if (!headPadPx.has(sheet.url)) {
        try {
          headPadPx.set(sheet.url, measureHeadPad(loaded.image as HTMLImageElement, sheet));
        } catch {
          headPadPx.set(sheet.url, 0);
        }
      }
      markTextureReady();
    },
    undefined,
    markTextureReady,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;

  // マップのビルボードと同じ光の当て方にする（GF-3.7）。
  const skin = createActorMaterial(texture);
  // 背丈は絵の画素 ÷ マップの 1 マスの画素（ツクールと同じく、キャラとマップの 1 画素をそろえる）。
  // 絵だけの倍率（画像ごとの `actorScale` × 物の `Scale`）は板にだけ掛ける。当たり（`size`）には掛けない。
  const art = size * artScale(sheet.scale);
  const width = (sheet.framePx[0] / tilePx) * unit * art;
  const height = (sheet.framePx[1] / tilePx) * unit * art;
  const body = new Mesh(new PlaneGeometry(width, height), skin.material);
  let silhouette: Group | null = null;
  /** 絵を下げる量（GS-52）。台帳の `footPx` をワールドの長さへ直したもの。 */
  const footLift = ((sheet.footPx ?? 0) / tilePx) * unit * art;
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
  /** `boardFoot()` の受け皿。 */
  const boardFootAt = new Vector3();

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

  /** 体の背丈（マス）。Rapier の体（カプセル）と同じ（GS-239）。 */
  const bodyTall = BODY_TALL_CELLS * size;
  /** マスの揃え（GS-245）。寄せ始めたら中央に着くまでやり切る。 */
  const aligner = createLaneAligner();

  /** その足元位置に体が入るか（地形だけを見る。GS-239）。 */
  const fits = (wx: number, wy: number, wz: number, terrain: Terrain): boolean =>
    terrain.fits(wx, wy, wz, bodyHalfWidth, bodyTall);

  /** 足元を見る点。中心と四隅（DEC-210）。中心が要るのは、坂の高さが場所で変わるため。 */
  const FEET: Array<[number, number]> = [
    [0, 0],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  /** 足元にある一番高い床面（はしごの乗り降りに使う）。坂はマス内の位置で高さが変わる（DEC-210）。 */
  const surface = (wx: number, wy: number, wz: number, terrain: Terrain): number | null => {
    const r = bodyHalfWidth * unit;
    let best: number | null = null;
    for (const [sx, sz] of FEET) {
      const px = (wx + sx * r) / unit;
      const pz = (wz + sz * r) / unit;
      const cx = Math.floor(px);
      const cz = Math.floor(pz);
      const found = terrain.surfaceUnder(cx, cz, wy, px - cx, pz - cz);
      if (found !== null && (best === null || found > best)) best = found;
    }
    return best;
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
    // 足を 1 回踏み替える時間（GS-168）。台帳の `walk.ms` から出す。
    stepSeconds: (run = false) => (run ? RUN_STEP_S : STEP_S),
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
      aligner.reset();
      position.set(x, y, z);
      group.position.copy(position);
      onGround = false;
      onLadder = false;
    },
    followAt(at, dt, yaw, lead) {
      const dx = at.x - position.x;
      const dz = at.z - position.z;
      const distance = Math.hypot(dx, at.y - position.y, dz);
      if (distance > 0.0001 * unit && dt > 0) {
        if (lead) facing = lead;
        else if (Math.hypot(dx, dz) > 0.0001 * unit) facing = facingForWorld(dx, dz, yaw);
        stepTime += dt;
        const per = distance / dt > 6 * unit ? RUN_STEP_S : STEP_S;
        while (stepTime >= per) {
          stepTime -= per;
          stepIndex = (stepIndex + 1) % WALK_PATTERN.length;
        }
      } else {
        stepTime = 0;
        stepIndex = STAND;
      }
      position.set(at.x, at.y, at.z);
      group.position.copy(position);
      refreshFrame();
      skin.setShadowBase(position.x, position.y, position.z);
      layoutShadow();
    },
    settle(terrain, from) {
      const cx = from
        ? from.x + Math.round((position.x - from.x) / unit) * unit
        : (Math.floor(position.x / unit) + 0.5) * unit;
      const cz = from
        ? from.z + Math.round((position.z - from.z) / unit) * unit
        : (Math.floor(position.z / unit) + 0.5) * unit;
      if (cx === position.x && cz === position.z) return;
      if (!fits(cx, position.y, cz, terrain)) return;
      position.x = cx;
      position.z = cz;
      group.position.copy(position);
      skin.setShadowBase(position.x, position.y, position.z);
      layoutShadow();
    },
    spawn(terrain, bounds) {
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
            const wy = terrain.surfaceUnder(x, z, (top + 1) * unit);
            if (wy === null) continue;
            if (!fits(wx, wy, wz, terrain)) continue;
            player.placeAt(wx, wy, wz);
            return true;
          }
        }
      }
      player.placeAt((cx + 0.5) * unit, top * unit, (cz + 0.5) * unit);
      return false;
    },
    update(deltaSeconds, input, terrain, body) {
      const { move, axis, running } = input;
      // 外から置き直された（イベント・マップ移動・はしご・`settle`）なら体も置き直す。
      if (Math.hypot(body.feet.x - position.x, body.feet.y - position.y, body.feet.z - position.z) > 0.0001 * unit) {
        body.teleport(position.x, position.y, position.z);
      }

      // --- はしご（DEC-237）。掴まっている間は重力も横移動も止め、上下だけ動かす。 ---
      const ladder = terrain.ladderAt(position.x / unit, position.y / unit, position.z / unit);
      if (!ladder) onLadder = false;
      // はしごの筒へ寄せる（DEC-237）。**既にその列に居るなら 1 ミリも動かさない。**
      // マスの中心へ吸い寄せると、2 マス幅のはしごで横に飛ぶ。
      // 外れているときも中心ではなく**縁まで**寄せる——動く量が最小で、壁にも近いまま。
      const holdTo = (world: number, cell: number | null, lo: number, hi: number): number => {
        if (cell === null) return world;
        if (Math.floor(world / unit) === cell) return world;
        const margin = bodyHalfWidth * unit;
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
        onGround = false;
        // W が -1、S が +1。筒から外れている向きだけ押さえて、上下だけ動かす。
        position.x = holdTo(position.x, ladder.shaftX, ladder.minX, ladder.maxX);
        position.z = holdTo(position.z, ladder.shaftZ, ladder.minZ, ladder.maxZ);
        position.y += -axis.y * LADDER_SPEED * size * unit * deltaSeconds;
        const eps = 0.001 * unit;
        const low = ladder.minY * unit;
        const high = ladder.maxY * unit;
        if (position.y <= low) {
          // 下端。足場があればそこへ降りる。
          position.y = low;
          const ground = surface(position.x, position.y + eps, position.z, terrain);
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
            const margin = bodyHalfWidth * unit;
            return Math.min(Math.max(world, cell * unit + margin), (cell + 1) * unit - margin);
          };
          for (let cz = Math.floor(ladder.minZ); cz < Math.ceil(ladder.maxZ); cz += 1) {
            for (let cx = Math.floor(ladder.minX); cx < Math.ceil(ladder.maxX); cx += 1) {
              const wx = alongCell(position.x, cx);
              const wz = alongCell(position.z, cz);
              const top = surface(wx, high + LADDER_EXIT_REACH * unit, wz, terrain);
              if (top === null || top < high - unit * 0.5) continue;
              if (!fits(wx, top, wz, terrain)) continue;
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
          const per = input.stepMs !== undefined ? input.stepMs / 1000 : running ? RUN_STEP_S : STEP_S;
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

      // 速さもキャラクターの大きさに合わせる（2026-10-11。マップの `CharacterScale`）。
      // 歩き・走り・うろつき（`input.speed`）・イベントの歩きのどれも同じ倍率——小さい人はゆっくり進む。
      const speed = (input.speed ?? (running ? RUN_SPEED : WALK_SPEED)) * size * unit * deltaSeconds;

      {
        // --- Rapier の体（GS-237 / GS-239）。壁に沿った滑り・坂・落下は Rapier に任せる。 ---
        // 登れる段差は今までどおり `Climb` の範囲だけ（DEC-237 / DEC-256）。
        const climb = terrain.climbAt(position.x / unit, position.y / unit, position.z / unit, STEP_UP);
        // マスの揃え（GS-240 / GS-245）。1 マス幅の通路へずれて入ろうとしたら、列の中央に着くまで横だけ動かす。
        const lane = input.slide || input.noLane
          ? { x: move.x * speed, z: move.z * speed, aligning: false }
          : aligner.step(position, move, speed, {
              unit,
              half: bodyHalfWidth,
              fits: (wx, wy, wz, half) => terrain.fits(wx, wy, wz, half, bodyTall),
            });
        if (input.slide || input.noLane) aligner.reset();
        const moved = body.move(lane.x, lane.z, deltaSeconds, climb);
        position.set(moved.x, moved.y, moved.z);
        onGround = moved.grounded;
        if (!input.slide) {
          // 寄せている間は**寄せる向き**を向く（GS-116 / GS-245）。中央に着いてから進む向きへ向き直す。
          facing =
            lane.aligning && input.yaw !== undefined && Math.hypot(lane.x, lane.z) > 0
              ? facingForWorld(lane.x, lane.z, input.yaw)
              : facingFor(axis);
        }
        const stepping = !input.slide && (axis.x !== 0 || axis.y !== 0);
        if (stepping) {
          stepTime += deltaSeconds;
          const per = input.stepMs !== undefined ? input.stepMs / 1000 : running ? RUN_STEP_S : STEP_S;
          while (stepTime >= per) {
            stepTime -= per;
            stepIndex = (stepIndex + 1) % WALK_PATTERN.length;
          }
        } else {
          stepTime = 0;
          stepIndex = STAND;
        }
        refreshFrame();
        group.position.copy(position);
        skin.setShadowBase(position.x, position.y, position.z);
        layoutShadow();
      }
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
    setLook(opacity, glow) {
      skin.setLook(opacity, glow);
    },
    setSilhouette(on) {
      if (on && !silhouette) silhouette = createPartySilhouette(body, skin.material);
      if (silhouette) silhouette.visible = on;
    },
    setTime(seconds) {
      skin.setTime(seconds);
    },
    hop(lift) {
      body.position.y = height / 2 - footLift + lift * unit;
    },
    bodyMaterial: skin.material,
    texture,
    ready,
    tallCells: height / unit,
    footLift,
    frame: () => frameUv,
    size: { width, height },
    boardFoot: () => boardFootAt.set(position.x, position.y + body.position.y - height / 2, position.z),
    headPad: () => ((headPadPx.get(sheet.url) ?? 0) / tilePx) * unit * art,
    // 踏んだ判定も四角に合わせる（GS-116）。細いままだと、四角で壁の手前に止まったとき
    // 壁のマスに描いた起動場所（扉など）に届かなくなる。
    radius: bodyHalf,
    dispose() {
      if (silhouette) {
        ((silhouette.children[0] as Mesh).material as ShaderMaterial).dispose();
        silhouette.removeFromParent();
      }
      body.geometry.dispose();
      skin.dispose();
      texture.dispose();
      shadow.geometry.dispose();
      (shadow.material as ShaderMaterial).dispose();
    },
  };

  return player;
}
