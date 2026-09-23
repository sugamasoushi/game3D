// ゲーム側の 3D ビュー。エディタが保存した JSON をそのまま読み、同じ描画コード（src/mep3d/）で出す。
// エディタ固有のもの（作業格子・配置ゴースト・透明ブロックのプレビュー）は載せない。

import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  TextureLoader,
  type ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildMep3DScene, type Mep3DScene } from '../mep3d/loader';
import { MAX_SUN_ACTORS, type SunActor } from '../mep3d/material';
import { collectMapModels, createMapModels, type MapModels } from '../mep3d/mapModels';
import { createSkyBinder } from '../mep3d/camera';
import { createTiltShiftPass } from '../mep3d/tiltshift';
import { createFieldEffects, readFieldVolumes } from '../view/fieldEffects';
import { CAMERA_SHOT_DEFAULTS, applyCameraShot, createCameraShots, type CameraShot } from '../view/cameraShots';
import { createScreenEffects } from '../view/screenEffects';
import type { AssetsDef, FaceName, MapDef } from '../mep3d/types';
import { buildCollision, type CollisionMap, type LayerVerdict } from '../mep3d/collision';
import { createCollisionWires, type CollisionWires } from '../mep3d/collisionWires';
import { createCameraRig, HD2D_PITCH, HD2D_YAW } from './cameraRig';
import { battleStageMarker } from './battleStageMarker';
import {
  cameraNumber,
  CAMERA_DISTANCE_PROPERTY_NAME,
  CAMERA_PITCH_PROPERTY_NAME,
  CAMERA_ORTHO_PROPERTY_NAME,
  CAMERA_YAW_PROPERTY_NAME,
  GAME_SCREEN_HEIGHT,
  GAME_SCREEN_WIDTH,
  scrollRectOf,
} from '../mep3d/mapCamera';
import { createInput } from './input';
import { createPlayer, type Facing, type Player } from './player';
import { loadActorBook, sheetOf, wanderOf, WANDER_DEFAULT, type WanderDef } from './actors';
import { canWalk, useUi } from '../ui/store';
import { loadFileIndex } from './fileIndex';
import { readNpcs, npcShown, FACINGS, type NpcDef } from './npcs';
import { withoutHiddenLayers } from './hiddenLayers';
import {
  cameraCue,
  createCuePlayer,
  loadCameraCues,
  type CameraCueState,
  type CameraIllustrationSample,
} from './cameraCues';
import { createBattleCameraPlayer, type BattleCamera } from './battle/battleCamera';
import { entryForFile, type MapEntry } from './mapIndex';
import { battleFormationSlots, chooseBattleFormation } from './battle/book';

/** カメラモードの平行移動（マス毎秒）。 */
const PAN_SPEED = 8;
/** プレイのカメラ距離（マス）。編集時の寄りをそのまま使うと近すぎる。 */
const PLAY_DISTANCE = 18;
/** 出発点に使うオブジェクトの名前（GC-14）。 */
const SPAWN_OBJECT = 'default';
/** 主人公の姿（`actors.json` のキー。GS-16）。 */
const PLAYER_ACTOR = 'meina';
/**
 * 話しかけられる範囲は**マスで数える**（GS-117。もとは距離 1.4 マス＋正面 45 度の網）。
 * 目の前の 1 マスと自分のマス（`npcInFront`）。体の太さや立ち位置のずれに左右されない。
 */
/** 話しかけられる高さの差（マス）。上の階に居る相手には届かせない。 */
const TALK_RISE = 1.5;
/** これより下へ落ちたら出発点へ戻す（マス）。 */
const VOID_DEPTH = -30;
/** 遮りを調べる体の高さ（背丈に対する割合。DEC-252）。足元寄り・胸・頭。 */
const SEE_SAMPLES = [0.2, 0.55, 0.9];
/** 遮り調べの刻みの上限。寄りが遠いときに歩きすぎないため。 */
const SEE_MAX_STEPS = 120;
/**
 * 透過の切り替えにかける秒（DEC-281）。ここで溶ける。
 * 短いと点滅に近く、長いと壁の向こうのキャラを見失う。
 */
const SEE_FADE_SECONDS = 0.18;

export type GameMode = 'camera' | 'play';

export interface GameStatus {
  map: string;
  mode: GameMode;
  cell: { x: number; y: number; z: number } | null;
  fps: number;
  tiles: number;
  drawCalls: number;
  orthographic: boolean;
  /** カメラの向きと寄り。マップの設定がそのまま出る（DEC-260）。 */
  yaw: number;
  pitch: number;
  distance: number;
  /** 出発点をどこから取ったか。 */
  spawn: 'default' | 'auto';
  /** 当たり判定のデバッグ表示。 */
  showCollision: boolean;
  /** 隠面除去（N-10）で落とした面の数。ゲームでは**常に効かせる**（DEC-267）。 */
  hiddenFaces: number;
  /** 足場の面数・塞ぐマス数と、レイヤーごとの解釈。 */
  collision: { surfaces: number; blockers: number; layers: LayerVerdict[] } | null;
  loading: boolean;
  error: string;
}

/** イベントから見た向き。画面基準（構想 §4.1 の `move`）。 */
export type WalkDir = 'up' | 'down' | 'left' | 'right';

/**
 * 戦闘の舞台（GS-92）。ゲーム台帳がマップの目印を参照する。カメラ演出は別の共通台帳。
 */
export interface BattleStageSpec {
  /** 舞台の真ん中（マス）。点の位置。 */
  at: { x: number; y: number; z: number };
  /** 舞台を組む基準の向き（現在はマップの向き）。 */
  yaw: number;
  /** 場面の基準仰角。カメラ台帳で上書きできる。 */
  pitch: number;
  /** 場面の基準距離倍率。 */
  zoom: number;
  /** 初期配置を読む `battleFormations.json` のID。 */
  formation: string;
}

/**
 * 戦闘の舞台に立たせる 1 人（GS-87）。立ち絵の板として置く。
 * `height` はマス。0 なら絵の高さから決める（190px で 1 マス、0.9〜3.2）。
 */
export interface BattleFigure {
  id: string;
  side: 'party' | 'enemy';
  image: string;
  height: number;
}

/** 舞台の板の見せ方（GS-87）。立ち上がり（偽→真）で動きが始まる。 */
export interface FigurePose {
  /** 選ばれている（明るさ 1⇄0.5 を 400ms で往復。旧作と同じ）。 */
  picking?: boolean;
  /** 当たった点滅（100ms ごとに半透明。旧作 `blinking`）。 */
  flash?: boolean;
  /** 仰け反り（上へ跳ねて戻る。旧作 `leanBack`）。 */
  lean?: boolean;
  /** 攻めかかり（少し待ってひと回り大きくなる。旧作 `attackTween`）。 */
  lunge?: boolean;
  /** 倒れた（うすく暗くなる）。 */
  gone?: boolean;
  /** コマンドを選んでいる味方（画面の左端へ立つ。GS-103）。位置は `STAGE_COMMAND_FIGURE`。 */
  commanding?: boolean;
}

export interface GameView {
  load(name: string): Promise<void>;
  setMode(mode: GameMode): void;
  /**
   * イベントからプレイヤーを**1 マス歩かせる**（GS-13）。着いたら `true`。
   * 壁で進めないときは少し待って諦め、`false` を返す——イベントがそこで止まらないように。
   * 歩いているあいだキー入力は効かない（構想 §5.2）。
   */
  /** `slide` を立てると**向きも足も動かさずに**運ぶ（GS-155。殴られて後ろへ飛ぶ絵）。 */
  walk(dir: WalkDir, run?: boolean, slide?: boolean): Promise<boolean>;
  /** イベントから向きだけ変える。 */
  face(dir: WalkDir): void;
  /** NPC を 1 マス歩かせる（GS-16）。居ない相手なら false。`slide` は `walk` と同じ。 */
  walkNpc(id: string, dir: WalkDir, run?: boolean, slide?: boolean): Promise<boolean>;
  /** NPC の向きを変える。 */
  faceNpc(id: string, dir: WalkDir): void;
  /**
   * NPC を**その場でマスへ置き直す**（GS-137）。歩かせず、一瞬で移す。
   * イベントの出だしで「画面の外から歩いて来る」を作るためのもの——
   * 出番の前に道の奥へ置いておき、そこから歩かせる。
   * 置いた場所（`home`）も移すので、そのあとうろついても元の場所へは帰らない。
   * 居ない相手なら false。
   */
  placeNpc(id: string, x: number, y: number, z: number, face?: WalkDir): boolean;
  /**
   * その人をプレイヤーの方へ向ける（GS-118）。**話しかけたときに呼ぶ。**
   * 重なって立っていて向きが決まらないときと、居ないときは false。
   */
  faceNpcToPlayer(id: string): boolean;
  /**
   * カメラ演出を鳴らす（DEC-391 / GS-73）。**値はイベントが持つ**ので、
   * マップの一覧は引かない。**返すのは長さ（ミリ秒）**——待つかどうかはイベント側が決める。
   */
  playShot(shot: CameraShot): number;
  playCameraCue(id: string): number;
  /**
   * 戦闘用のカメラ（GS-105）。**イベント用のカメラ演出とは別の再生器**で、舞台のカメラへ重ねる。
   * 舞台を片づけると止まる。返すのは長さ（ミリ秒）。
   */
  playBattleCamera(camera: BattleCamera): number;
  /** エディタが次のキーへ引き継ぐ、直前の演出状態。場面の既定値だけなら null。 */
  cameraCueState(): CameraCueState | null;
  seekCameraCue(ms: number): void;
  pauseCameraCue(paused: boolean): void;
  stopCameraCue(): void;
  /** 現在のカメラ演出が画面に出すイラスト。DOM層が描画周期ごとに読む。 */
  cameraIllustrations(): CameraIllustrationSample[];
  /** 残している演出（`hold` の暗転・寄り）を戻す。 */
  releaseShot(): void;
  /**
   * NPC を消す（GS-76）。倒した敵シンボルを引っ込めるのに使う。
   * **マップは書き換えない**ので、入り直せば戻ってくる。居なければ false。
   */
  removeNpc(id: string): boolean;
  /** その名前の NPC がこのマップに居るか。 */
  hasNpc(id: string): boolean;
  /** NPC の居る所と向き（マス。小数）。居なければ null。 */
  npcAt(id: string): { x: number; y: number; z: number; facing: WalkDir } | null;
  /**
   * いまの場所から行き先のマスまでの**道順**（GS-138 / GS-139）。返すのは画面基準の向きの並び。
   *
   * 歩く向きは**カメラの方位で回る**（`moveVector`）ので、「x が 3 増える」が
   * どの向きの何歩になるかは、ここでしか分からない。だからイベント側は
   * マスだけ言って、道順の組み立てはここに任せる。
   *
   * **壁は避けない**単純な L 字。`first` でどちらの向きから先に詰めるかを選ぶ
   * （`leftRight` は画面の横から、`upDown` は縦から）。
   */
  routeTo(
    from: { x: number; z: number },
    to: { x: number; z: number },
    first?: 'leftRight' | 'upDown',
  ): WalkDir[];
  /**
   * 目の前に立っている NPC の名前（GS-16）。話しかける相手を決めるのに使う。
   * 向きと距離で選ぶ——足元の四角を踏ませる作りだと、相手の上に乗る必要が出てしまう。
   */
  npcInFront(): string | null;
  /**
   * マス 1 つの絵を差し替える（GS-53）。宝箱の開閉のように**見た目だけ**変える。
   * 形も絵柄（タイルセット）も変わらないので、当たりも影もそのまま。
   * 差し替える物がそのマスに無ければ false。
   */
  setCellChip(
    at: { x: number; y: number; z: number },
    faces: Partial<Record<FaceName, number>>,
    layer?: string,
  ): boolean;
  /** 静止コマを指名する（GS-47）。台帳の `poses` に無い名前なら false。 */
  posePlayer(name: string | null): boolean;
  /** 名前でもコマ番号でもよい（GS-135）。 */
  poseNpc(id: string, name: string | number | null): boolean;
  /**
   * プレイヤーの居る所（マス。小数。GS-14）。まだ読み込んでいなければ null。
   * イベントの起動場所（オブジェクトの四角）と重ねるのに使う——マス目に丸めると、
   * 1 マスに満たない細い帯（出入口など）を踏んでも気づけない。
   */
  playerAt(): { x: number; y: number; z: number } | null;
  /** 体の太さ（マス。GS-17）。起動場所に触れたかを見るのに使う。 */
  playerRadius(): number;
  /** プレイヤーの向き。マップ移動の着地やセーブで使う。 */
  playerFacing(): WalkDir | null;
  /**
   * プレイヤーが**世界の座標で**どちらを向いているか（GS-55）。長さ 1。
   * `playerFacing` は画面基準（上下左右）で、マップの x/z とは**カメラの方位ぶん回っている**
   * ——調べ物のように「向いた先に何があるか」を見るときは、こちらを使う。
   */
  facingVector(): { x: number; z: number } | null;
  /**
   * その人の**頭の上**が画面のどこに来るか（GS-23）。吹き出しを置くのに使う。
   * 返すのは 1280×720 の中の座標。画面の外なら null。
   */
  headAt(who: 'player' | string): { x: number; y: number } | null;
  /**
   * プレイヤーを置き直す（マップ移動の着地。GS-17）。
   * **マスで指定し、必ずそのマスの中央・床の上に立つ。** 小数を渡してもマスに丸める——
   * 半端な位置を書けるようにすると、書く側が小数を気にすることになる。
   */
  placePlayer(x: number, y: number, z: number): void;
  /**
   * マップに置いた**点オブジェクトの名前**でプレイヤーを置き直す（GS-17）。
   * 高さは出発点と同じで、その柱の足場に乗せる。見つからなければ false。
   */
  placeAtMarker(name: string): boolean;
  /**
   * マップに書いた戦闘の舞台（GS-89）。点オブジェクトの `BattleStage=true` を検出し、
   * その点の位置を舞台の真ん中にする。表示名には依存せず、無ければ null。
   */
  battleStage(formation?: string): BattleStageSpec | null;
  /**
   * 戦闘の舞台を組む（GS-87 / GS-89 / GS-90）。舞台の真ん中を挟んで**味方は手前・敵は奥**に横一列で立たせ、
   * カメラを**味方の側へ回して少し後ろから**写す。プレイヤーの板と、フィールドの敵は隠す。
   * 片付けるまでカメラの向き・寄りはマップの値から外れる（DEC-260 の例外。戦闘のあいだだけ）。
   */
  stageBattle(spec: BattleStageSpec, figures: BattleFigure[], debugGrid?: boolean): void;
  /** 舞台を片付けて、カメラとプレイヤーを元へ戻す。 */
  unstageBattle(): void;
  /** 舞台の板が画面のどこにあるか（画素）。HP の帯や数字を重ねる用。絵が来ていなければ null。 */
  figureRect(id: string): { left: number; top: number; width: number; height: number } | null;
  /** 舞台の板の見せ方を変える。 */
  figurePose(id: string, pose: FigurePose): void;
  /** 1 フレーム分だけ進めて描く。ふだんは描画ループが呼ぶ。目視確認の自動化からも呼べる。 */
  step(deltaSeconds: number): void;
  dispose(): void;
}

/**
 * 戦闘の舞台（GS-94 / GS-95）。場所は床向きの点の `BattleStage=true`、並びは `battleFormations.json`。
 * カメラの既定はフィールドのまま（水平角 0・仰角そのまま・寄せ 1）で、角度や寄せは
 * 戦闘演出の割り当て（`battlePresentation.json`）が指すカメラ演出が決める（イベントの `battle.camera` は GS-98 で廃止）。
 * マップ台帳の基準カメラ（`battleStage.camera`）は GS-97 で廃止した。
 * マップの点のプロパティ（旧 `StageYaw` など。GS-89）は廃止した。
 */
/** 見る高さ（マス）。胸のあたり。 */
const STAGE_LOOK_Y = 1.2;
/** 見る先を敵の列から味方の列へどれだけ寄せるか（0＝敵、1＝味方。GS-90）。 */
const STAGE_FOCUS_PARTY = 0.3;
/** 敵の板の大きさを絵の高さから決めるときの比（px / マス）。 */
const STAGE_PX_PER_CELL = 190;
/** 仰け反り・攻めかかり（旧作 `leanBack` / `attackTween` と同じ長さ）。 */
const STAGE_LEAN_S = 0.2;
const STAGE_LEAN_CELLS = 0.5;
/**
 * 敵が攻めかかる動き（GS-109 / GS-110）。**溜め `STAGE_LUNGE_DELAY_S` の後に、`STAGE_LUNGE_S` かけて大きくなって戻る**。
 * 全体で 0.3 ＋ 0.2 ＝ 500ms（GS-110 で 800ms にして、戻した）。戦闘画面は溜めが終わる瞬間に音と揺れを出し、動きが終わるまで次（味方の点滅）へ進まない。
 * 2D の CSS（`mep-lunge`）も戦闘画面がこの値を `--lunge-delay` / `--lunge-ms` で渡すので、ここだけ変えればよい。
 */
export const STAGE_LUNGE_DELAY_S = 0.3;
export const STAGE_LUNGE_S = 0.2;
const STAGE_LUNGE_GROW = 0.06;
/** 呼吸（GS-88 / GS-90）。縦に 1.0% を 2.6 秒で 1 往復——「止まっていない」と分かる程度に留める。 */
const STAGE_BREATH = 0.01;
const STAGE_BREATH_S = 2.6;
/**
 * コマンド選択中の味方の板を、画面の左端へ立たせる（GS-103）。**見た目はこの値で調整する。**
 * カメラから `depth` マス前の床の高さに置き、画面の横位置が `x` になるよう横へずらす。
 * カメラの位置と向きから決めるので、戦闘開始の演出でカメラが動いていても同じ見え方になる。
 * 左端にいるあいだは**ほかの板や地形より手前に描く**（奥行きで敵に隠れない）。
 * - `x`: 板の中心の横位置。画面の幅に対する割合（0 が左端、1 が右端）。左端で切れるときは大きくする。
 * - `depth`: カメラからの距離（マス）。小さいほど大きく、画面の下の方に立つ（2.5 で画面の高さくらい）。
 * - `scale`: 板の大きさの倍率（1 で絵のまま）。距離を変えずに大きさだけ変えたいときに使う。
 * - `moveS`: 隊形の位置と左端を行き来する秒数（0 で瞬時）。
 * - `offsetX` / `offsetY` / `offsetZ`: **位置の微調整（マス）**（GS-108）。上の値で決めた位置から、
 *   カメラから見て `offsetX` 右へ（負で左）、`offsetY` 上へ（負で下）、`offsetZ` 奥へ（負で手前）ずらす。
 *   影は床に残したまま、横と奥だけ一緒に動く。奥へずらすと遠くなるので少し小さく見える。
 * 開発中はブラウザの Console で `__stageCommandFigure.depth = 3` のように書き換えると、その場で試せる
 * （読み直すと元に戻る。決めた値はここへ書く）。
 */
export const STAGE_COMMAND_FIGURE = { x: 0.10, depth: 2, scale: 1, moveS: 0.25, offsetX: 0, offsetY: 0, offsetZ: 0 };
/** 左端の板を描く順番。地形・ほかの板（0）より後に描いて手前に見せる。 */
const STAGE_COMMAND_RENDER_ORDER = 10;

/**
 * 画面に入る範囲の外でも、この距離（マス）までは太陽の影を落とす人に数える（GS-96）。
 * 影は仰角しだいで数マス伸びるので、画面の外にいる人の影が画面に入ってくる。
 */
const SUN_ACTOR_REACH_CELLS = 8;

/** 外から渡す物（GS-130）。**いまは「スイッチが入っているか」だけ**。 */
export interface GameViewOptions {
  /**
   * マップの `ShowIf` / `HideIf` / `PoseIf` を見るための問い合わせ先。
   * **記録は React 側が持つ**ので、3D 側は聞きに行くだけにする（構想 §5.3）。
   * `owner` はその物の名前（マップの `Id`）——`self:開けた` のような
   * **その物自身の覚え**を引くのに要る（GS-134）。
   * 渡さなければ、条件付きの NPC は「条件なし」と同じに出る。
   */
  switchOn?: (key: string, owner?: string) => boolean;
  /**
   * 宝箱の見た目（GS-135）。その名前の宝箱の「閉じている／開いた」コマ番号を返す。
   * **台帳は React 側が持つ**ので、3D 側は聞きに行くだけ（`switchOn` と同じ考え）。
   */
  chestOf?: (id: string) => { closed?: number; opened?: number } | null;
}

export function createGameView(
  canvas: HTMLCanvasElement,
  onStatus: (status: GameStatus) => void,
  options: GameViewOptions = {},
): GameView {
  /** スイッチを聞く。渡されていなければ「入っていない」。 */
  const switchOn = (key: string, owner?: string): boolean => options.switchOn?.(key, owner) ?? false;
  // ブロック影がステンシルを使うので stencil は要る（DEC-29）。
  const renderer = new WebGLRenderer({ canvas, antialias: true, stencil: true });
  // 画面が 1280×720 固定なので、描くのもちょうどその画素数にする（DEC-162）。
  // 高 DPI で 2 倍に焼くと、ドット絵の 1 画素が画面の 1 画素と一致しなくなる。
  renderer.setPixelRatio(1);

  const scene = new Scene();
  // 世界に置くエフェクト（DEC-198）。置き場所はマップのオブジェクト、見た目は既定。
  const fieldEffects = createFieldEffects();
  /** カメラ演出（DEC-388）。マップを移ると止める——前のマップの揺れを持ち越さない。 */
  const shots = createCameraShots();
  const cuePlayer = createCuePlayer();
  /** 戦闘用のカメラ（GS-105）。イベント用の `cuePlayer` とは分ける。 */
  const battleCameraPlayer = createBattleCameraPlayer();
  let renderedIllustrations: CameraIllustrationSample[] = [];
  let battleSetup: MapEntry['battleStage'];
  let renderedYaw = 0;
  /** 画面エフェクト（DEC-389）。マップの一覧をそのまま出す。 */
  const screenEffects = createScreenEffects();
  scene.add(fieldEffects.group);
  const sky = createSkyBinder(scene);
  const rig = createCameraRig();
  const input = createInput();
  const tilt = createTiltShiftPass();

  let built: Mep3DScene | null = null;
  /** マップに置いた 3D（DEC-288）。絵として重ねるだけ。 */
  let mapModels: MapModels | null = null;
  let collision: CollisionMap | null = null;
  /**
   * NPC を壁として足した当たり（GS-35）。**プレイヤーの更新にだけ**渡す。
   * NPC 側には渡さない——イベントの歩きが人にぶつかって止まると、話がそこで詰まる。
   */
  let playerCollision: CollisionMap | null = null;
  let wires: CollisionWires | null = null;
  let player: Player | null = null;
  /** マップに立っている NPC（GS-16）。作りはプレイヤーと同じで、入力の代わりにイベントが動かす。 */
  interface NpcActor {
    def: NpcDef;
    actor: Player;
    walk: ScriptWalk | null;
    /** うろつき方（GS-48）。null ならうろつかない。 */
    wander: Required<WanderDef> | null;
    /** いまうろついている最中（GS-50）。マスではなく距離で進む。 */
    wandering: {
      axis: { x: number; y: number };
      from: { x: number; z: number };
      goal: number;
      speed: number;
      best: number;
      stall: number;
    } | null;
    /** 次にうろつくまでの残り秒。 */
    wanderIn: number;
    /** 置いた場所。奈落へ落ちたときはここへ戻す。 */
    home: Vector3;
  }
  const npcs = new Map<string, NpcActor>();
  /**
   * 出す条件（GS-130）で**作らなかった**人（GS-153）。
   * イベントが `place` で名指ししたときだけ、その場で作って出す——旧作の `setVisible(true)`。
   * 勝手には湧かない（条件が満たされただけでは出さない）。
   */
  const hiddenNpcs = new Map<string, NpcDef>();
  /** 1 人ぶんを作る手。マップを読んだときに `load()` が入れる。 */
  let makeNpc: ((def: NpcDef) => boolean) | null = null;

  /** 同じ高さと見なす差（マス）。体は 2 マスぶんあるので、その範囲を塞ぐ。 */
  const NPC_LEVEL = 1.5;

  /**
   * そこに NPC が立っているか（GS-35）。`blockedAt` に足して、人をすり抜けないようにする。
   *
   * **塞ぐのは立っているマス 1 つ。固定。** 体の太さで測らない——絵の大きさを変えるたびに
   * 止まる距離が変わってしまうし、置き場所も立ち位置もマスの中央で揃えてある（GS-18）ので、
   * 「1 マスは人が 1 人」で数えられるほうが分かりやすい。
   *
   * **すでに同じマスに立っているぶんは通す。** 置き場所がプレイヤーと重なっていると、
   * 四方が塞がって動けなくなる——出られなくなるより、その 1 人だけすり抜けるほうがまし。
   */
  const npcBlocks = (x: number, y: number, z: number): boolean => {
    if (!npcs.size || !player || !collision) return false;
    const unit = collision.unit || 1;
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const px = Math.floor(player.position.x / unit);
    const pz = Math.floor(player.position.z / unit);
    for (const npc of npcs.values()) {
      const nx = Math.floor(npc.actor.position.x / unit);
      const nz = Math.floor(npc.actor.position.z / unit);
      if (cx !== nx || cz !== nz) continue;
      if (Math.abs(y - npc.actor.position.y / unit) > NPC_LEVEL) continue;
      if (px === nx && pz === nz) continue;
      return true;
    }
    return false;
  };

  /** 当たりに NPC を足したもの。マップを読むたび作り直す。 */
  const withNpcBodies = (base: CollisionMap): CollisionMap => ({
    ...base,
    blockedAt: (x, y, z) => base.blockedAt(x, y, z) || npcBlocks(x, y, z),
    // 人は立っているマスを丸ごと塞ぐ（GS-116）。四角の体はそのマスへ重ならない。
    solidCellAt: (x, y, z) => base.solidCellAt(x, y, z) || npcBlocks(x, y, z),
  });
  let mapDef: MapDef | null = null;
  let buildGen = 0;
  /** 奈落に落ちたときに戻す位置。 */
  const spawnPoint = new Vector3();
  /**
   * マップ移動の受け付け（DEC-247）。着いた先でも同じ範囲に立っていることがあるので、
   * **一度その範囲から出るまで次の移動を受け付けない。** 出ないと 2 枚のマップを往復し続ける。
   */

  const status: GameStatus = {
    map: '',
    // 既定はプレイ。WASD がプレイヤーを動かす（GC-18）。
    mode: 'play',
    cell: null,
    fps: 0,
    tiles: 0,
    drawCalls: 0,
    // ゲームは透視投影が既定（GC-51）。
    orthographic: false,
    yaw: HD2D_YAW,
    pitch: HD2D_PITCH,
    distance: PLAY_DISTANCE,
    spawn: 'auto',
    showCollision: false,
    hiddenFaces: 0,
    collision: null,
    loading: false,
    error: '',
  };
  const report = () => {
    // 向きは rig が持っている（丸めやクランプ後の値）ので、出す直前に写す。
    status.yaw = Math.round(rig.yaw);
    status.pitch = Math.round(rig.pitch);
    status.distance = Math.round(rig.distance * 10) / 10;
    onStatus({ ...status, cell: status.cell ? { ...status.cell } : null });
  };

  const paintBackground = () => {
    sky.apply(mapDef?.camera);
  };

  /**
   * キャラを置く所（GS-17 / GS-18）。**必ずそのマスの中央・床の上**。
   * 出発点も、マップ移動の着地も、NPC も同じ——エディタで点を置いた位置は
   * マスの縁に寄ることがあり、半マスずれて立つと「正面の相手」が斜めになる（実測で話しかけられなかった）。
   */
  const standOn = (x: number, y: number, z: number, unit: number): { x: number; y: number; z: number } => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    const top = collision?.surfaceUnder(cx, cz, (cy + 1) * unit) ?? null;
    return { x: (cx + 0.5) * unit, y: top ?? cy * unit, z: (cz + 0.5) * unit };
  };

  let sizedW = 0;
  /** マップのプロパティで決まるプレイ時の寄り（DEC-152）。 */
  let playDistance = PLAY_DISTANCE;
  let playPitch = HD2D_PITCH;
  let playYaw = HD2D_YAW;
  let playOrtho = false;
  /** いまの透過の濃さ（0..1。DEC-281）。 */
  let seeFade = 0;
  /** マップのカメラ値をリグへ。ここ以外で向きと寄りを触らない（DEC-260）。 */
  const applyMapCamera = () => {
    rig.distance = playDistance;
    rig.pitch = playPitch;
    rig.yaw = playYaw;
    rig.orthographic = playOrtho;
    status.orthographic = playOrtho;
  };
  let sizedH = 0;

  /**
   * ゲーム画面は 1280×720 固定（DEC-162）。ウィンドウに合わせて広げない。
   * 描く大きさは常に同じで、CSS 側で枠に収まるだけ拡縮する（余白は黒帯）。
   */
  const resize = () => {
    const w = GAME_SCREEN_WIDTH;
    const h = GAME_SCREEN_HEIGHT;
    // 変わっていなければ何もしない。毎フレーム呼ばれてもバッファを組み直さない（GC-24）。
    if (w === sizedW && h === sizedH) return;
    sizedW = w;
    sizedH = h;
    const ratio = renderer.getPixelRatio();
    renderer.setSize(w, h, false);
    rig.resize(w, h, ratio);
    tilt.setSize(w, h, ratio);
  };

  /**
   * 読み込みの内訳を測る（GS-26）。**遅いと感じたときに、どこが遅いのかを数字で出す。**
   * 開発中だけコンソールへ出す。合計だけ見ても「絵が重い」のか「形を組むのが重い」のか分からない。
   */
  const stopwatch = () => {
    const marks: Array<[string, number]> = [];
    let last = performance.now();
    return {
      lap(name: string) {
        const now = performance.now();
        marks.push([name, now - last]);
        last = now;
      },
      report(name: string) {
        if (process.env.NODE_ENV !== 'development') return;
        const total = marks.reduce((sum, [, ms]) => sum + ms, 0);
        console.log(
          `[load] ${name} ${Math.round(total)}ms  ` +
            marks.map(([label, ms]) => `${label} ${Math.round(ms)}`).join(' / '),
        );
      },
    };
  };

  const load = async (name: string): Promise<void> => {
    cuePlayer.stop();
    battleCameraPlayer.stop();
    shots.stop();
    const gen = ++buildGen;
    const watch = stopwatch();
    status.loading = true;
    status.error = '';
    status.map = name;
    report();
    try {
      const response = await fetch(`/mapdata/${encodeURIComponent(name)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const map = (await response.json()) as MapDef;
      await loadCameraCues();
      battleSetup = (await entryForFile(name))?.battleStage;
      watch.lap('json');
      logMap(name, map);
      // キャラの絵の台帳（GS-16）と法線マップの台帳（GS-26）。
      // どちらも 1 回読んだら使い回すので、マップごとの待ちは無い。
      const [book, files] = await Promise.all([loadActorBook(), loadFileIndex()]);
      if (typeof map.assets === 'string') {
        throw new Error('assets が外部ファイル参照。エディタが書いた 1 ファイル形式のみ読める（DEC-04）');
      }
      // `Hidden` のレイヤーは**描く前に外す**（GS-57）。当たりには元のマップを渡すので、
      // 見えないまま通れなくできる。描画側を書き換えないのは、面の隠し合いや影が
      // レイヤーをまたいで絡んでいるため——居ないことにするのが一番安全。
      const shown = withoutHiddenLayers(map);
      // 目を閉じたレイヤーは形を作らない（DEC-270）。ゲームは目を戻さないので素直に省ける。
      // 法線マップは**台帳で決める**（DEC-374）。無い絵を取りに行かせない——
      // 開発サーバの 404 が高くつく（実測 32 秒 → 0.5 秒）。
      const next = await buildMep3DScene(shown, shown.assets as AssetsDef, {
        skipHidden: true,
        hasFile: files.has,
      });
      watch.lap('scene');
      if (gen !== buildGen) {
        next.dispose();
        return;
      }
      if (built) {
        scene.remove(built.group);
        built.dispose();
      }
      mapDef = map;
      built = next;
      scene.add(built.group);
      // 置いた 3D（DEC-288）。見た目だけ。当たりにも影にも出ないのですり抜ける。
      mapModels?.dispose();
      mapModels = null;
      // 置いた 3D も同じ扱い（GS-57）。隠したレイヤーの物は出さない。
      const models = collectMapModels(shown);
      if (models.length) {
        // 読み込みは後から届く。届いたら影を焼き直す（DEC-288）。
        // レンダラは映り込みを焼くのに要る（DEC-296）。
        mapModels = createMapModels({ onLoad: () => built?.setSunModels([mapModels!.group]), renderer });
        scene.add(mapModels.group);
        mapModels.apply(models, map.grid?.unit ?? 1, map.lighting, map.camera, map.pointLights);
        built.setSunModels([mapModels.group]);
      }
      built.setPointLights(map.pointLights ?? []);
      fieldEffects.setVolumes(readFieldVolumes(map), map.grid?.unit ?? 1);
      // 画面エフェクト（DEC-389）。**隠したレイヤーとは無関係**——置き場所を持たない。
      screenEffects.set(map.screenEffects ?? []);

      // 水面へ映すもの（DEC-303）。マップと置いた 3D。キャラは下で足す。
      fieldEffects.setReflectSources(
        mapModels ? [built.group, mapModels.group, fieldEffects.group] : [built.group, fieldEffects.group],
      );

      // **当たりは元のマップから**（GS-57）。`Hidden` は見た目だけの話。
      collision = buildCollision(map);
      playerCollision = withNpcBodies(collision);
      watch.lap('collision');
      wires?.dispose();
      wires = createCollisionWires(scene, collision);
      wires.setVisible(status.showCollision);
      status.collision = { ...wires.stats, layers: collision.layers };
      watch.lap('wires');

      const unit = map.grid?.unit ?? 1;
      player?.dispose();
      player?.group.removeFromParent();
      const tilePx = map.grid?.tilePx ?? 32;
      // **前のマップの歩きは打ち切る**（GS-17）。イベントの `move` の途中で入口を踏むと、
      // 新しいマップのプレイヤーが前の歩きを続けて、着地点から数センチずれる。
      endWalk(hero, false);
      player = createPlayer(unit, tilePx, sheetOf(book, PLAYER_ACTOR));
      const marker = markerObject(map, SPAWN_OBJECT);
      if (marker) {
        // 点は床の位置を指す。立つのはそのマスの中央、高さは柱の足場から。
        const spot = standOn(marker.x, marker.y, marker.z, unit);
        player.placeAt(spot.x, spot.y, spot.z);
        const look = FACINGS[marker.face.toLowerCase()];
        if (look) player.face(DIR_FACE[look]);
      } else {
        player.spawn(collision, map.bounds);
      }
      // キャラをマップの光に合わせる（GF-3.7）。
      player.setLighting(map.lighting ?? {}, map.pointLights ?? [], unit, built.cameraFx);
      // ブロックの投射影をキャラにも効かせる（GC-34）。
      built.attachShadowMask(player.bodyMaterial);
      built.bindLightWalls(player.bodyMaterial);
      // キャラの影が歩く地形（DEC-159）。当たり判定ではなくマップの影の高さ場を渡す。
      const field = built.shadowField();
      player.setShadowField(field.solid, field.surface, field.top, field.selfSolid);
      applyActorOccluder();
      status.spawn = marker ? 'default' : 'auto';
      spawnPoint.copy(player.position);
      // カメラモードでも出しておく。見えないと「置けていない」のか区別がつかない（GC-16）。
      player.faceCamera((rig.yaw * Math.PI) / 180);
      scene.add(player.group);

      // --- NPC（GS-16）--------------------------------------------------
      // マップのオブジェクトが「誰がどこに居るか」を持つ。作りはプレイヤーと同じ板で、
      // 光も影も同じ手順で合わせる——ここを別の作りにすると、NPC だけ浮いて見える。
      for (const npc of npcs.values()) {
        npc.actor.group.removeFromParent();
        npc.actor.dispose();
      }
      npcs.clear();
      hiddenNpcs.clear();
      // 1 人ぶんを作る（GS-153）。**関数にしてあとからも呼べるようにする**——
      // 条件で隠していた人を、イベントの `place` がその場に出せる。
      // 景色（`built`）はこのマップのものを掴んでおく。読み直せば新しい手に入れ替わる。
      const scenery = built;
      const build = (def: NpcDef): boolean => {
        if (!scenery) return false;
        if (npcs.has(def.id)) {
          // 名前が重なると `npc:<id>` がどちらを指すか決まらない。**後の 1 人は置かない**。
          console.warn(`[npc] 名前が重なっている: ${def.id}`);
          return false;
        }
        // 大きさの倍率（GS-130）。**絵だけ**大きくする——1 コマの画素数を掛けると、
        // 板の高さも足元の補正もそのまま比で付いてくる。当たりは 1 マスのまま。
        const plain = sheetOf(book, def.actor, def.sprite);
        const sheet =
          def.scale && def.scale !== 1
            ? {
                ...plain,
                framePx: [plain.framePx[0] * def.scale, plain.framePx[1] * def.scale] as [number, number],
                ...(plain.footPx !== undefined ? { footPx: plain.footPx * def.scale } : {}),
              }
            : plain;
        const actor = createPlayer(unit, tilePx, sheet);
        // 立つのはそのマスの中央（GS-18）。足場はプレイヤーの出発点と同じ取り方（GC-14）。
        const spot = standOn(def.x, def.y, def.z, unit);
        actor.placeAt(spot.x, spot.y, spot.z);
        actor.face(DIR_FACE[def.facing]);
        actor.setLighting(map.lighting ?? {}, map.pointLights ?? [], unit, scenery.cameraFx);
        scenery.attachShadowMask(actor.bodyMaterial);
        scenery.bindLightWalls(actor.bodyMaterial);
        actor.setShadowField(field.solid, field.surface, field.top, field.selfSolid);
        actor.faceCamera((rig.yaw * Math.PI) / 180);
        scene.add(actor.group);
        // 見た目をスイッチから導く（GS-133）。**マップを読み直しても開いたまま**になる。
        if (def.pose && def.poseIf && switchOn(def.poseIf, def.id)) actor.pose(def.pose);
        // 宝箱は台帳のコマで出す（GS-135）。**取得済みなら開いた絵**で置く。
        const chest = options.chestOf?.(def.id);
        if (chest) {
          const frame = switchOn('self:開けた', def.id) ? chest.opened : chest.closed;
          if (frame !== undefined) actor.pose(frame);
        }
        // うろつき方（GS-48）。**台帳が既定、マップの `Wander` が上書き**。
        // **物（`SPRITE` レイヤー）は動かない**——宝箱が歩き回ると困る（GS-133）。
        const base = def.thing ? null : wanderOf(book, def.actor, def.sprite);
        const wander =
          def.thing || def.wander === 0
            ? null
            : def.wander !== undefined
              ? { ...WANDER_DEFAULT, ...(base ?? {}), range: def.wander }
              : base
                ? { ...WANDER_DEFAULT, ...base }
                : null;
        npcs.set(def.id, {
          def,
          actor,
          walk: null,
          wander,
          wandering: null,
          // 最初の 1 歩をばらけさせる。全員が同じ拍子で動き出すと機械じみて見える。
          wanderIn: wander ? Math.random() * (wander.ms[1] / 1000) : 0,
          home: actor.position.clone(),
        });
        return true;
      };
      makeNpc = build;
      for (const def of readNpcs(map)) {
        // 出す条件（GS-130）。倒したら現れないイベント敵などは**そもそも作らない**——
        // 作ってから消すと 1 フレームだけ映る。**隠した人は覚えておく**（GS-153）。
        if (!npcShown(def, (key) => switchOn(key, def.id))) {
          hiddenNpcs.set(def.id, def);
          continue;
        }
        build(def);
      }

      // キャラもエフェクトも水面に映す（DEC-303 / DEC-344）。
      {
        const cast = [built.group, player.group, fieldEffects.group];
        if (mapModels) cast.push(mapModels.group);
        for (const npc of npcs.values()) cast.push(npc.actor.group);
        fieldEffects.setReflectSources(cast);
      }

      watch.lap('actors');
      // 寄り・仰角・水平角はマップのプロパティが決める（DEC-152 / DEC-253）。
      // エディタ左パネルの「カメラ角度」がそのまま届く。無ければゲームの既定。
      playDistance = cameraNumber(built.properties, CAMERA_DISTANCE_PROPERTY_NAME, PLAY_DISTANCE);
      playPitch = cameraNumber(built.properties, CAMERA_PITCH_PROPERTY_NAME, HD2D_PITCH);
      playYaw = cameraNumber(built.properties, CAMERA_YAW_PROPERTY_NAME, HD2D_YAW);
      // 投影もマップが決める（DEC-267）。既定は透視。
      playOrtho = cameraNumber(built.properties, CAMERA_ORTHO_PROPERTY_NAME, 0) > 0.5;
      applyMapCamera();
      // スクロール範囲はエディタが決める（DEC-153）。未設定ならマップの外周。
      const rect = scrollRectOf(
        built.properties,
        map.grid?.width ?? 40,
        map.grid?.depth ?? map.grid?.width ?? 40,
      );
      rig.setBounds({
        minX: rect.minX * unit,
        maxX: rect.maxX * unit,
        minZ: rect.minZ * unit,
        maxZ: rect.maxZ * unit,
      });
      rig.target.copy(player.position);
      sizedW = 0;
      resize();
      paintBackground();
      tilt.update(map.camera ?? {});

      built.setCullHidden(true);
      // 太陽の影は正射深度 1 枚（DEC-145）。旧方式の塗りは出さない。
      built.setSunShadow(true);
      // キャラの影は深度パスに入れない（DEC-157）。地面へ寝かせた絵で出すので焼き直しが要らない。
      built.setSunCasters([]);
      status.tiles = built.stats.tiles;
      status.drawCalls = built.stats.drawCalls;
      status.hiddenFaces = built.stats.hiddenFaces;
      status.loading = false;
      watch.lap('finish');
      watch.report(name);
      report();
    } catch (error) {
      if (gen !== buildGen) return;
      status.loading = false;
      status.error = error instanceof Error ? error.message : String(error);
      report();
    }
  };

  /** 吹き出しの置き所を測る受け皿（GS-23）。毎回作らない。 */
  const headSpot = new Vector3();
  /** 遮り調べの使い回し（DEC-252）。毎フレーム作らない。 */
  const seeFrom = new Vector3();
  const seeStep = new Vector3();

  /**
   * **キャラがカメラから見えなくなったら透過レイヤーを透かす**（DEC-252）。
   *
   * カメラとキャラの間を刻んで歩き、`SeeThrough` のレイヤーのマスを通るかを見る。
   * 体の高さ 3 点で調べ、1 本でも通れば隠れているとみなす。
   * カメラモードや読み込み前は透かさない（編集中の絵をいじらない）。
   */
  const applySeeThrough = (dt: number) => {
    if (!built) return;
    if (!player || status.mode !== 'play') {
      seeFade = 0;
      built.setSeeThrough(0);
      return;
    }
    const camera = rig.active();
    const unit = collision?.unit ?? 1;
    let hidden = false;
    for (const at of SEE_SAMPLES) {
      seeFrom.copy(player.position);
      seeFrom.y += player.size.height * at;
      seeStep.copy(camera.position).sub(seeFrom);
      const span = seeStep.length();
      if (span <= 0) continue;
      // 半マスずつ歩く。マスを跨がない刻みなら取りこぼさない。
      const steps = Math.min(Math.ceil(span / (0.5 * unit)), SEE_MAX_STEPS);
      seeStep.multiplyScalar(1 / steps);
      for (let i = 1; i <= steps; i += 1) {
        const x = Math.floor((seeFrom.x + seeStep.x * i) / unit);
        const y = Math.floor((seeFrom.y + seeStep.y * i) / unit);
        const z = Math.floor((seeFrom.z + seeStep.z * i) / unit);
        if (built.seeThroughAt(x, y, z)) {
          hidden = true;
          break;
        }
      }
      if (hidden) break;
    }
    // **急に切り替えない**（DEC-281）。行き先へ一定の速さで寄せる。
    // ディザは 16 段なので、段が増えていって溶けるように見える。
    const step = dt / SEE_FADE_SECONDS;
    const want = hidden ? 1 : 0;
    seeFade = want > seeFade ? Math.min(want, seeFade + step) : Math.max(want, seeFade - step);
    built.setSeeThrough(seeFade);
  };

  /** キャラの遮光を毎フレーム渡す（GC-39）。影を塗るのではなく光を遮って暗くする。 */
  // ── 戦闘の舞台（GS-87）────────────────────────────────
  // 戦いのあいだ、マップの 3D の上に**立ち絵の板（ビルボード）**を並べ、カメラを味方の少し後ろへ回す。
  // 板は画面の向きへ回すだけの縦の板（キャラと同じ見せ方）。点滅・仰け反りなどはここで動かし、
  // HP の帯や数字は画面（DOM）が `figureRect` の位置へ重ねる。
  interface StageFigure {
    def: BattleFigure;
    mesh: Mesh;
    material: MeshBasicMaterial;
    shadow: Mesh;
    base: Vector3;
    /** 影を置く床の高さ。初期位置を持ち上げても影は床に残す。 */
    groundY: number;
    width: number;
    height: number;
    pose: FigurePose;
    leanAt: number;
    lungeAt: number;
    goneAt: number;
    /** 同じ陣営の画面左からの番号（1始まり）。演出台帳の意味的な対象指定に使う。 */
    slot: number;
    /** 呼吸の位相（GS-88）。全員が同じ拍子で息をすると機械じみて見える。 */
    breathPhase: number;
    /** 左端へ寄せた割合（0＝隊形の位置、1＝左端。GS-103）。`moveS` かけて行き来する。 */
    commandK: number;
    /** 左端で持ち上げた高さ（ワールド。`offsetY` の反映ぶん。GS-108）。画面上の枠の高さに足す。 */
    commandLift: number;
  }
  let stage: {
    focus: Vector3;
    figures: Map<string, StageFigure>;
    saved: { yaw: number; pitch: number; distance: number };
    /** マップに書いた舞台（GS-89）。カメラと並べ方はこの値で決まる。 */
    spec: BattleStageSpec;
    /** 戦いのあいだ隠したフィールドの敵（GS-88）。片付けたら出し直す。 */
    hiddenNpcs: string[];
    /** カメラエディタの仮配置だけに出す1マス間隔の破線。 */
    grid: LineSegments | null;
    /** BattleStageを原点とするX/Z中心線。 */
    axes: LineSegments | null;
  } | null = null;
  const stageLoader = new TextureLoader();
  const stageCorner = new Vector3();
  const disposeFigure = (figure: StageFigure) => {
    scene.remove(figure.mesh);
    scene.remove(figure.shadow);
    figure.mesh.geometry.dispose();
    figure.material.map?.dispose();
    figure.material.dispose();
    figure.shadow.geometry.dispose();
    (figure.shadow.material as MeshBasicMaterial).dispose();
  };

  const createStageGrid = (at: { x: number; y: number; z: number }, unit: number): LineSegments => {
    const radius = 8;
    const floor = standOn(at.x, at.y, at.z, unit).y + 0.025 * unit;
    const points: number[] = [];
    for (let offset = -radius; offset <= radius; offset++) {
      if (offset === 0) continue;
      points.push(
        (at.x - radius) * unit, floor, (at.z + offset) * unit,
        (at.x + radius) * unit, floor, (at.z + offset) * unit,
        (at.x + offset) * unit, floor, (at.z - radius) * unit,
        (at.x + offset) * unit, floor, (at.z + radius) * unit,
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const material = new LineDashedMaterial({ color: 0x000000, transparent: true, opacity: 0.62,
      dashSize: 0.22 * unit, gapSize: 0.18 * unit, depthTest: false, depthWrite: false });
    const grid = new LineSegments(geometry, material);
    // 地形の後、半透明のビルボードより前に描く。線がキャラの上へ重ならないようにする。
    grid.renderOrder = -10;
    grid.computeLineDistances();
    return grid;
  };

  const createStageAxes = (at: { x: number; y: number; z: number }, unit: number): LineSegments => {
    const radius = 8;
    const floor = standOn(at.x, at.y, at.z, unit).y + 0.03 * unit;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      (at.x - radius) * unit, floor, at.z * unit,
      (at.x + radius) * unit, floor, at.z * unit,
      at.x * unit, floor, (at.z - radius) * unit,
      at.x * unit, floor, (at.z + radius) * unit,
    ], 3));
    const axes = new LineSegments(geometry, new LineBasicMaterial({ color: 0x000000,
      transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }));
    axes.renderOrder = -9;
    return axes;
  };

  const unstage = () => {
    if (!stage) return;
    cuePlayer.stop();
    battleCameraPlayer.stop();
    for (const figure of stage.figures.values()) disposeFigure(figure);
    if (stage.grid) {
      scene.remove(stage.grid);
      stage.grid.geometry.dispose();
      if (Array.isArray(stage.grid.material)) stage.grid.material.forEach((material) => material.dispose());
      else stage.grid.material.dispose();
    }
    if (stage.axes) {
      scene.remove(stage.axes);
      stage.axes.geometry.dispose();
      if (Array.isArray(stage.axes.material)) stage.axes.material.forEach((material) => material.dispose());
      else stage.axes.material.dispose();
    }
    // 隠していたフィールドの敵を出し直す（GS-88）。倒して消えた相手は npcs に居ないので出ない。
    for (const id of stage.hiddenNpcs) {
      const npc = npcs.get(id);
      if (npc) npc.actor.group.visible = true;
    }
    // カメラをマップの値へ戻す。注視点は次のフレームで追従が入れ直す。
    rig.yaw = stage.saved.yaw;
    rig.pitch = stage.saved.pitch;
    rig.distance = stage.saved.distance;
    stage = null;
    if (player) {
      player.group.visible = true;
      rig.target.copy(player.position);
    }
    rig.apply();
  };

  /** 舞台のカメラと板を 1 フレームぶん進める。**追従の後**に呼ぶ（上書きする）。 */
  const applyStage = () => {
    if (!stage) return;
    const unit = collision?.unit || 1;
    rig.yaw = stage.saved.yaw + stage.spec.yaw;
    rig.pitch = stage.spec.pitch;
    rig.distance = stage.saved.distance * stage.spec.zoom;
    rig.target.copy(stage.focus);
    rig.apply();
    const yawR = (rig.yaw * Math.PI) / 180;
    for (const figure of stage.figures.values()) {
      const pose = figure.pose;
      const leanK = figure.leanAt >= 0 ? (elapsed - figure.leanAt) / STAGE_LEAN_S : 1;
      const lungeK = figure.lungeAt >= 0 ? (elapsed - figure.lungeAt - STAGE_LUNGE_DELAY_S) / STAGE_LUNGE_S : 1;
      const lift = leanK >= 0 && leanK < 1 ? Math.sin(Math.PI * leanK) * STAGE_LEAN_CELLS * unit : 0;
      const grow = lungeK >= 0 && lungeK < 1 ? 1 + STAGE_LUNGE_GROW * Math.sin(Math.PI * lungeK) : 1;
      figure.mesh.position.set(figure.base.x, figure.base.y + lift, figure.base.z);
      figure.mesh.rotation.y = yawR;
      figure.shadow.position.set(figure.base.x, figure.groundY + 0.02 * unit, figure.base.z);
      figure.shadow.scale.set(figure.width * 0.9, figure.width * 0.35, 1);
      // 呼吸（GS-88）。**足元を支点に縦へわずかに伸び縮み**（板の原点は足元）。倒れたら止める。
      const breath = pose.gone
        ? 1
        : 1 + STAGE_BREATH * Math.sin((elapsed / STAGE_BREATH_S) * Math.PI * 2 + figure.breathPhase);
      figure.mesh.scale.set(grow, grow * breath, grow);
      // 明るさ: 選ばれていれば 1⇄0.5 を 400ms で往復（旧作の 255⇄128）。倒れたら暗く。
      const tone = pose.gone ? 0.45 : pose.picking ? 0.75 + 0.25 * Math.cos((elapsed / 0.4) * Math.PI) : 1;
      figure.material.color.setScalar(tone);
      // 透け: 当たった点滅は 100ms ごとに半透明（旧作 `blinking`）。倒れたら 0.4 秒でうすく。
      const fade = pose.gone && figure.goneAt >= 0 ? Math.min(1, (elapsed - figure.goneAt) / 0.4) : 0;
      const flash = pose.flash && Math.floor(elapsed * 10) % 2 === 0 ? 0.5 : 1;
      figure.material.opacity = flash * (1 - 0.82 * fade);
      figure.shadow.visible = figure.mesh.visible && !pose.gone;
    }
  };

  const commandSpot = new Vector3();
  /**
   * コマンド選択中の味方の板を画面の左端へ寄せる（GS-103）。**カメラ演出を重ねた後**に呼ぶ——
   * 画面の位置はそのフレームの最終的なカメラで決まる（戦闘開始の演出はカメラを動かしたまま保持する）。
   * 隊形の位置はカメラの後ろになることがある（戦闘開始の演出は敵の方へ進む）ので、隊形の位置は使わず
   * カメラから前へ `depth` マスの所に置き、画面の横位置だけを `x` に合わせる。
   */
  const applyCommandFigures = (dt: number) => {
    if (!stage) return;
    const look = STAGE_COMMAND_FIGURE;
    const unit = collision?.unit || 1;
    const camera = rig.active();
    camera.updateMatrixWorld();
    const step = look.moveS > 0 ? dt / look.moveS : 1;
    // カメラの向こう側（水平）。板の並びと同じ向き（`applyFieldObjectEffects` の toward の逆）。
    const yawR = (rig.yaw * Math.PI) / 180;
    const awayX = -Math.sin(yawR);
    const awayZ = -Math.cos(yawR);
    for (const figure of stage.figures.values()) {
      const want = figure.pose.commanding && !figure.pose.gone;
      figure.commandK = want ? Math.min(1, figure.commandK + step) : Math.max(0, figure.commandK - step);
      // 左端にいるあいだは手前に重ねて描く。戻り切ったら元の描き方へ。
      const front = figure.commandK > 0;
      figure.material.depthTest = !front;
      figure.mesh.renderOrder = front ? STAGE_COMMAND_RENDER_ORDER : 0;
      figure.commandLift = 0;
      if (!front) continue;
      // カメラから前へ depth マス、高さは隊形の足元のまま。そこを画面へ写し、横位置だけ x に替えて戻す。
      // 奥行きと縦位置が同じなので、戻した点も同じ高さのまま横へずれるだけ（カメラは傾けない）。
      commandSpot.set(camera.position.x + awayX * look.depth * unit, figure.base.y, camera.position.z + awayZ * look.depth * unit);
      commandSpot.project(camera);
      if (commandSpot.z <= -1 || commandSpot.z >= 1) continue;
      commandSpot.x = look.x * 2 - 1;
      commandSpot.unproject(camera);
      // 出入りはなめらかに（始めと終わりをゆっくり）。
      const k = figure.commandK * figure.commandK * (3 - 2 * figure.commandK);
      // 微調整（GS-108）。カメラから見た右（板の右向き）と奥（awayX/Z）へ、マスで足す。
      const shiftX = (Math.cos(yawR) * look.offsetX + awayX * look.offsetZ) * unit;
      const shiftZ = (-Math.sin(yawR) * look.offsetX + awayZ * look.offsetZ) * unit;
      const dx = (commandSpot.x + shiftX - figure.base.x) * k;
      const dz = (commandSpot.z + shiftZ - figure.base.z) * k;
      const grow = 1 + (look.scale - 1) * k;
      figure.commandLift = look.offsetY * unit * k;
      figure.mesh.position.x += dx;
      figure.mesh.position.y += figure.commandLift;
      figure.mesh.position.z += dz;
      figure.mesh.scale.multiplyScalar(grow);
      figure.shadow.position.x += dx;
      figure.shadow.position.z += dz;
      figure.shadow.scale.multiplyScalar(grow);
    }
  };

  const applyActorOccluder = () => {
    if (!built || !player) return;
    built.setActorOccluder({
      texture: player.texture,
      frame: player.frame(),
      foot: player.position,
      size: player.size,
    });
  };

  /**
   * 太陽の影を落とすキャラを渡す（DEC-393 / GS-96）。**プレイヤーとカメラに近い NPC** を近い順に上限まで。
   * 画面に入る範囲に影の届く分を足した外にいる人は渡さない——**遠い NPC の影は描かない**。
   * 隠している人（戦闘の舞台で隠したプレイヤーやシンボル）も渡さない。
   * 影を受ける側にはキャラの材質も入れる（NPC どうし・プレイヤーにも影が落ちる）。
   */
  const sunActorPicks: Array<{ actor: Player; far: number }> = [];
  const sunActorList: SunActor[] = [];
  const sunActorMaterials: ShaderMaterial[] = [];
  const sunActorFacing = new Vector3();
  const applySunActors = () => {
    if (!built) return;
    sunActorPicks.length = 0;
    sunActorMaterials.length = 0;
    const half = rig.visibleHalf();
    const reach = Math.hypot(half.x, half.z) + SUN_ACTOR_REACH_CELLS * (collision?.unit || 1);
    const consider = (actor: Player) => {
      sunActorMaterials.push(actor.bodyMaterial);
      if (!actor.group.visible) return;
      const far = Math.hypot(actor.position.x - rig.target.x, actor.position.z - rig.target.z);
      if (far <= reach) sunActorPicks.push({ actor, far });
    };
    if (player) consider(player);
    for (const npc of npcs.values()) consider(npc.actor);
    sunActorPicks.sort((a, b) => a.far - b.far);
    sunActorList.length = 0;
    for (let i = 0; i < Math.min(sunActorPicks.length, MAX_SUN_ACTORS); i += 1) {
      const actor = sunActorPicks[i]!.actor;
      sunActorList.push({ texture: actor.texture, frame: actor.frame(), foot: actor.position, size: actor.size });
    }
    // 板はカメラを向く（`faceCamera(yaw)`）。その向き＝カメラ側の水平ベクトル。
    const yaw = (rig.yaw * Math.PI) / 180;
    sunActorFacing.set(Math.sin(yaw), 0, Math.cos(yaw));
    built.setSunActors(sunActorList, sunActorFacing, sunActorMaterials);
  };

  const setMode = (mode: GameMode) => {
    if (status.mode === mode) return;
    status.mode = mode;
    status.cell = mode === 'play' ? (player?.cell() ?? null) : null;
    if (mode === 'play' && player) {
      rig.target.copy(player.position);
      applyMapCamera();
    }
    rig.apply();
    report();
  };

  // --- 入力 ---------------------------------------------------------------

  // カメラの向き・寄りはマップが決める。ゲーム側からは一切動かせない（DEC-260）。
  // ここで振れると、エディタで見ている画とゲームの画が黙ってずれる。
  const onPointerDown = () => canvas.focus();
  const onContext = (event: MouseEvent) => event.preventDefault();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('contextmenu', onContext);

  /** 押しっぱなしでないキー。1 フレームに 1 回だけ効く。 */
  const handleTaps = () => {
    let changed = false;
    if (input.pressed('KeyP')) {
      setMode(status.mode === 'play' ? 'camera' : 'play');
      return;
    }
    if (input.pressed('KeyC')) {
      status.showCollision = !status.showCollision;
      wires?.setVisible(status.showCollision);
      changed = true;
    }
    if (input.pressed('KeyR') && player) {
      player.placeAt(spawnPoint.x, spawnPoint.y, spawnPoint.z);
      rig.target.copy(player.position);
      changed = true;
    }
    if (changed) {
      rig.apply();
      report();
    }
  };

  /**
   * イベントが操作しているあいだの状態（GS-13）。
   * `from` からの距離が 1 マスぶんになったら終わり。**進まなくなったら諦める**——
   * 壁に向かって歩かせるイベントを書いてしまっても、そこで止まらないように。
   */
  interface ScriptWalk {
    axis: { x: number; y: number };
    from: { x: number; z: number };
    goal: number;
    run: boolean;
    /** 向きも足も動かさずに運ぶ（GS-155）。殴られて後ろへ飛ぶ絵。 */
    slide?: boolean;
    best: number;
    stall: number;
    resolve(arrived: boolean): void;
  }
  /** 歩きの入れ物。プレイヤーも NPC も**同じ仕組み**で動かす（GS-16）。 */
  interface Walker {
    walk: ScriptWalk | null;
  }
  /** プレイヤーの歩き。ここに入っているあいだはキー入力より優先する。 */
  const hero: Walker = { walk: null };

  /** 画面基準の向き → 入力の軸。奥（画面の上）が −y。 */
  /**
   * 「行き先まで歩く」で組む道順の上限（GS-138）。**歩数で止める。**
   * 座標を打ち間違えたときに、画面の外へ延々と歩き続けさせないため。
   */
  const ROUTE_LIMIT = 64;

  const DIR_AXIS: Record<WalkDir, { x: number; y: number }> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  /** 同じ向きの、絵の行の名前。 */
  const DIR_FACE: Record<WalkDir, Facing> = { up: 'north', down: 'south', left: 'west', right: 'east' };
  /** その逆。向いている絵から画面基準の向きへ戻す（GS-16）。 */
  const FACE_DIR: Record<Facing, WalkDir> = { north: 'up', south: 'down', west: 'left', east: 'right' };
  /** 動かないときの軸。毎フレーム作らない。 */
  const STILL = { x: 0, y: 0 };

  /** 歩きを終わらせる。二重に解かないよう、必ずここを通す。 */
  const endWalk = (who: Walker, arrived: boolean) => {
    const walk = who.walk;
    who.walk = null;
    walk?.resolve(arrived);
  };

  /** 1 マス歩き始める。着いたか諦めたかで解ける約束を返す。 */
  const beginWalk = (who: Walker, actor: Player | null, dir: WalkDir, run: boolean, slide = false): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (!actor || !collision || status.mode !== 'play') {
        resolve(false);
        return;
      }
      // 前の歩きが残っていたら打ち切る。1 人を 2 か所へは歩かせられない。
      endWalk(who, false);
      who.walk = {
        axis: DIR_AXIS[dir],
        from: { x: actor.position.x, z: actor.position.z },
        goal: collision.unit,
        run,
        slide,
        best: 0,
        stall: 0,
        resolve,
      };
    });


  // ---- うろつき（GS-48）--------------------------------------------------
  //
  // **イベントの歩きと同じ道**（`beginWalk`）を通す。別の動かし方を書くと、
  // 壁の扱いや当たりが 2 通りになる（GS-13 と同じ考え）。
  //
  // 止まる条件（GS-50）。**旧作に合わせる。**
  //   - イベントが動いている（`busy`）
  //   - そのイベントが自分を歩かせている最中
  //   - **プレイヤーが近くに居る**（旧作は 40px＝1.25 マス。近づいたら止まる）
  //   - 置いた場所から離れすぎる向きしか無い

  /**
   * いまイベント中か（GS-48）。**話しかけられたらその場で止まる**ための目印。
   * 画面の状態は `useUi` の `busy` が持っているので、毎フレームそこを見る
   * （`uiEventContext` も同じ store を直に見ている）。並行イベントは `busy` を立てないので、
   * 裏で何か動いていてもうろつきは止まらない——それが並行の持ち場。
   */
  let eventBusy = false;

  /**
   * プレイヤーがこれより近ければうろつかない（GS-50。マス）。
   * 旧作は 40px、チップ 32px なので 1.25 マス。**歩いている途中でも止める。**
   */
  const WANDER_STOP_NEAR = 1.25;

  /** 立ち止まっている時間を配る。最初の 1 歩もばらけさせる。 */
  const nextWanderAt = (def: Required<WanderDef>): number =>
    (def.ms[0] + Math.random() * Math.max(0, def.ms[1] - def.ms[0])) / 1000;

  /** プレイヤーとの距離（マス）。居なければ無限。 */
  const spanToPlayer = (npc: NpcActor, unit: number): number => {
    if (!player) return Infinity;
    return Math.hypot(npc.actor.position.x - player.position.x, npc.actor.position.z - player.position.z) / unit;
  };

  /**
   * うろつきを 1 体ぶん進める（GS-50）。**マス単位では動かない。**
   * 旧作と同じで、短い距離をゆっくり動いては立ち止まる。
   */
  const advanceWander = (npc: NpcActor, dt: number, unit: number) => {
    const def = npc.wander;
    if (!def || def.range <= 0) return;
    // イベントが歩かせている間は触らない（取り合わない）。
    if (npc.walk) {
      npc.wandering = null;
      return;
    }
    // 会話中と、プレイヤーが近いときは**その場で止まる**（歩いている途中でも）。
    if (eventBusy || spanToPlayer(npc, unit) < WANDER_STOP_NEAR) {
      npc.wandering = null;
      return;
    }

    // 歩いている最中。進んだ距離が目標に届いたら止める。
    const going = npc.wandering;
    if (going) {
      const moved = Math.hypot(npc.actor.position.x - going.from.x, npc.actor.position.z - going.from.z);
      if (moved >= going.goal - 0.001 * unit) {
        // 着いたらマスの真ん中へ（GS-117）。端に立たれると話しかけられない。
        if (collision) npc.actor.settle(collision);
        npc.wandering = null;
        npc.wanderIn = nextWanderAt(def);
        return;
      }
      // 壁に当たって進まなくなったら諦める。壁に体を押し付け続けない。
      if (moved > going.best + 0.0005 * unit) {
        going.best = moved;
        going.stall = 0;
      } else {
        going.stall += dt;
        if (going.stall > 0.4) {
          npc.wandering = null;
          npc.wanderIn = nextWanderAt(def);
        }
      }
      return;
    }

    // 立ち止まっている。時間が来たら次の一歩を決める。
    npc.wanderIn -= dt;
    if (npc.wanderIn > 0) return;

    // 進むのは**マス単位**（GS-117）。半端な歩幅だとマスの端に立ってしまう。
    const dist = Math.max(1, Math.round(def.step));
    // 置いた場所から離れすぎない向きだけを選ぶ。
    const home = npc.home;
    const here = npc.actor.position;
    const choices: WalkDir[] = [];
    for (const dir of ['up', 'down', 'left', 'right'] as WalkDir[]) {
      const to = moveVector(DIR_AXIS[dir]);
      const nx = (here.x + to.x * dist * unit - home.x) / unit;
      const nz = (here.z + to.z * dist * unit - home.z) / unit;
      if (Math.hypot(nx, nz) <= def.range + 0.001) choices.push(dir);
    }
    if (choices.length === 0) {
      npc.wanderIn = nextWanderAt(def);
      return;
    }
    const dir = choices[Math.floor(Math.random() * choices.length)];
    npc.wandering = {
      axis: DIR_AXIS[dir],
      from: { x: here.x, z: here.z },
      goal: dist * unit,
      // その距離を `walkMs` かけて歩く速さ。**歩きの速さより桁が 1 つ小さい。**
      speed: dist / (def.walkMs / 1000),
      best: 0,
      stall: 0,
    };
  };
  /** 歩きの進み具合を見る。1 マス進んだら終わり、進まなくなったら諦める。 */
  const advanceWalk = (who: Walker, actor: Player, dt: number, unit: number) => {
    const walk = who.walk;
    if (!walk) return;
    const moved = Math.hypot(actor.position.x - walk.from.x, actor.position.z - walk.from.z);
    if (moved >= walk.goal - 0.02 * unit) {
      // 着いたらマスの真ん中へ戻す（GS-117）。歩く向きはカメラ基準なのでマスの軸と少しずれ、
      // 積もると絵の立ち位置と塞ぐマスが食い違う。
      if (collision) actor.settle(collision);
      endWalk(who, true);
    } else if (moved > walk.best + 0.001 * unit) {
      walk.best = moved;
      walk.stall = 0;
    } else {
      // 0.3 秒進まなければ壁。諦めて次の命令へ渡す。
      walk.stall += dt;
      if (walk.stall > 0.3) endWalk(who, false);
    }
  };

  /**
   * ワールドの向きを、画面基準の 4 方向へ丸める（GS-118。`moveVector` の逆）。
   * 絵の向きは画面基準なので、「相手の方を向く」にはカメラの方位ぶん戻してから決める。
   */
  const screenDirOf = (wx: number, wz: number): WalkDir => {
    const yawR = (rig.yaw * Math.PI) / 180;
    const right = { x: Math.cos(yawR), z: -Math.sin(yawR) };
    const forward = { x: -Math.sin(yawR), z: -Math.cos(yawR) };
    const sx = wx * right.x + wz * right.z;
    const sy = -(wx * forward.x + wz * forward.z);
    if (Math.abs(sx) > Math.abs(sy)) return sx < 0 ? 'left' : 'right';
    return sy > 0 ? 'down' : 'up';
  };

  /** カメラの方位から見た平面の向き。奥（−Z 側）が前。 */
  const moveVector = (axis: { x: number; y: number }): { x: number; z: number } => {
    const yawR = (rig.yaw * Math.PI) / 180;
    const forward = { x: -Math.sin(yawR), z: -Math.cos(yawR) };
    const right = { x: Math.cos(yawR), z: -Math.sin(yawR) };
    return {
      x: right.x * axis.x + forward.x * -axis.y,
      z: right.z * axis.x + forward.z * -axis.y,
    };
  };

  // --- ループ -------------------------------------------------------------

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  // ResizeObserver はタブが隠れているあいだ配送されない。取りこぼすと描画バッファが
  // 既定の 300×150 のままになり、ブラウザが引き伸ばして滲む。窓のリサイズでも呼ぶ。
  window.addEventListener('resize', resize);
  resize();

  let fpsAccum = 0;
  let fpsFrames = 0;
  /** 点滅・炎のゆらぎ用の経過秒。タイル側と同じ時計にする。 */
  let elapsed = 0;
  const lookAt = new Vector3();

  const step = (dt: number) => {
    resize();
    handleTaps();

    // イベントが歩かせているあいだはキー入力を読まない（構想 §5.2）。
    // メニュー中・イベント中も同じ（GS-59）。**止める理由は `canWalk` に集める**——
    // 「メニューがキーを飲み込むから止まる」に頼ると、入力の出どころが増えたときに崩れる。
    const playable = canWalk(useUi.getState());
    const axis = hero.walk ? hero.walk.axis : playable ? input.axis() : { x: 0, y: 0 };
    const running = hero.walk ? hero.walk.run : playable && input.shift();
    const unit = collision?.unit ?? 1;
    eventBusy = useUi.getState().busy;
    if (status.mode === 'play' && player && collision) {
      // 人にはぶつかる（GS-35）。壁と同じ仕組みなので、通路へのマス寄せ（GS-116）もそのまま効く。
      player.update(
        // 滑らせているあいだは向きも足も止める（GS-155）。
        dt,
        { move: moveVector(axis), axis, running, yaw: rig.yaw, ...(hero.walk?.slide ? { slide: true } : {}) },
        playerCollision ?? collision,
      );
      advanceWalk(hero, player, dt, unit);
      // NPC も同じ更新を通す（GS-16）。入力の代わりにイベントの歩きを渡すだけ。
      // 通しておけば足場に乗り、光も影もプレイヤーと同じ手順で付く。
      for (const npc of npcs.values()) {
        // うろつきの判断は**動かす前**に。止める指示がその場で効く（GS-50）。
        advanceWander(npc, dt, unit);
        const npcAxis = npc.walk ? npc.walk.axis : (npc.wandering?.axis ?? STILL);
        npc.actor.update(
          dt,
          {
            move: moveVector(npcAxis),
            axis: npcAxis,
            running: npc.walk?.run ?? false,
            yaw: rig.yaw,
            ...(npc.walk?.slide ? { slide: true } : {}),
            // うろつきは歩きよりずっと遅い（GS-50）。イベントの歩きは今までの速さのまま。
            ...(npc.walk ? {} : npc.wandering ? { speed: npc.wandering.speed } : {}),
          },
          collision,
        );
        advanceWalk(npc, npc.actor, dt, unit);
        // 置き場所が悪くて落ちても消えないように、置いた所へ戻す。
        if (npc.actor.position.y <= VOID_DEPTH * unit) {
          npc.actor.placeAt(npc.home.x, npc.home.y, npc.home.z);
        }
      }
      // 奈落まで落ちたら出発点へ戻す。マップの外へ出ても操作不能にならないため（GC-10）。
      if (player.position.y <= VOID_DEPTH * unit) {
        player.placeAt(spawnPoint.x, spawnPoint.y, spawnPoint.z);
        rig.target.copy(player.position);
      }
      lookAt.copy(player.position);
      lookAt.y += 0.6 * unit;
      rig.follow(lookAt);
      const at = player.cell();
      // セルが変わったときだけ差し替える。毎フレーム React を起こさない。
      if (!status.cell || status.cell.x !== at.x || status.cell.y !== at.y || status.cell.z !== at.z) {
        status.cell = at;
      }
    } else if (axis.x !== 0 || axis.y !== 0) {
      const move = moveVector(axis);
      const speed = PAN_SPEED * unit * dt * (input.shift() ? 2.5 : 1);
      rig.target.x += move.x * speed;
      rig.target.z += move.z * speed;
      rig.apply();
    }
    // 戦闘の舞台（GS-87）。**追従の後**でカメラを舞台へ向け直す。キャラの向きもこの向きに合わせる。
    applyStage();
    // 演出は描画する間だけリグへ重ねる。次の歩行・場面には持ち越さない。
    // 重ねる相手は場面のカメラ（フィールド・戦闘の舞台）だけ。マップ台帳の基準の演出は持たない（GS-97）。
    const baseCamera = { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance, target: rig.target.clone() };
    // 戦闘用のカメラ（GS-105）。舞台のカメラへ先に重ね、イベント用の演出はその上に重ねる。
    const battleCamera = stage ? battleCameraPlayer.update(dt, rig.pitch) : null;
    if (battleCamera) {
      const unit = mapDef?.grid?.unit ?? 1;
      rig.yaw += battleCamera.yaw;
      rig.pitch = battleCamera.pitch;
      rig.distance *= battleCamera.distance;
      rig.target.add(new Vector3(battleCamera.x * unit, battleCamera.y * unit, battleCamera.z * unit));
      rig.apply();
      for (const figure of stage?.figures.values() ?? []) figure.mesh.rotation.y = rig.yaw * Math.PI / 180;
    }
    // イベント用のカメラ演出（GS-115 で戦闘の板を動かす・注視する機能は削除）。
    const cue = cuePlayer.update(dt, rig.pitch);
    renderedIllustrations = cue?.illustrations ?? [];
    if (cue) {
      rig.yaw += cue.yaw;
      rig.pitch = cue.pitch;
      rig.distance *= cue.distance;
      const unit = mapDef?.grid?.unit ?? 1;
      rig.target.add(new Vector3(cue.x * unit, cue.y * unit, cue.z * unit));
      rig.apply();
      for (const figure of stage?.figures.values() ?? []) figure.mesh.rotation.y = rig.yaw * Math.PI / 180;
    }
    // コマンド選択中の味方を左端へ（GS-103）。カメラが決まった後で寄せる。
    applyCommandFigures(dt);
    renderedYaw = rig.yaw;
    tilt.update({
      ...mapDef?.camera,
      ...(battleCamera?.tilt === undefined ? {} : { tilt: battleCamera.tilt }),
      ...(cue?.tilt === undefined ? {} : { tilt: cue.tilt }),
    });
    // ビルボードなのでどちらのモードでもカメラを向く。
    player?.faceCamera((rig.yaw * Math.PI) / 180);
    for (const npc of npcs.values()) npc.actor.faceCamera((rig.yaw * Math.PI) / 180);

    // キャラが動くたびに遮光の位置とコマを渡し直す（GC-39）。
    applyActorOccluder();
    // 太陽の影を落とすキャラ（DEC-393）。位置・コマ・カメラの向きが変わるので毎フレーム。
    applySunActors();
    // 透過レイヤーの入切も毎フレーム（DEC-252）。カメラが動くだけでも変わる。
    applySeeThrough(dt);
    elapsed += dt;
    player?.setTime(elapsed);
    for (const npc of npcs.values()) npc.actor.setTime(elapsed);
    built?.update(dt);
    // 置いた 3D の実ライトも点滅させる（DEC-294）。時計はチップと同じ物を使う。
    if (built && mapModels) mapModels.tick(built.time);
    // 書き割りの絵を「うねり」へ渡す（DEC-316）。読み込みは非同期なので毎フレーム。
    fieldEffects.setSkyTexture(built?.skyTexture ?? null);
    fieldEffects.update(dt);
    // マップか太陽が変わった次のフレームで 1 回だけ焼く（DEC-145）。
    built?.tickSunShadow(renderer);
    // カメラ演出（DEC-388）。**`rig.apply()` の後**——リグが組んだ位置と投影に足す。
    const shot = shots.update(dt);
    if (cue) {
      shot.shakeX += cue.shot.shakeX;
      shot.shakeY += cue.shot.shakeY;
      shot.zoom *= cue.shot.zoom;
      if (cue.shot.veilAlpha > shot.veilAlpha) {
        shot.veil.copy(cue.shot.veil);
        shot.veilAlpha = cue.shot.veilAlpha;
      }
    }
    applyCameraShot(rig.active(), shot, mapDef?.grid?.unit ?? 1);
    tilt.setVeil(shot.veil, shot.veilAlpha);
    tilt.render(renderer, scene, rig.active());
    // 画面エフェクト（DEC-389）。**一番上**に重ねる（絵ができてから貼る 1 枚）。
    screenEffects.render(renderer, dt);
    rig.yaw = baseCamera.yaw;
    rig.pitch = baseCamera.pitch;
    rig.distance = baseCamera.distance;
    rig.target.copy(baseCamera.target);

    fpsAccum += dt;
    fpsFrames += 1;
    if (fpsAccum >= 0.5) {
      status.fps = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
      report();
    }
  };

  // dt は rAF が渡すタイムスタンプの差で取る（GC-21）。
  // Clock.getDelta() はコールバックに入った時刻の差で、表示時刻とずれる。
  let lastTime = 0;
  renderer.setAnimationLoop((time: number) => {
    const dt = lastTime === 0 ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    step(dt);
  });

  return {
    load,
    setMode,
    step,
    walk(dir, run = false, slide = false) {
      return beginWalk(hero, player, dir, run, slide);
    },
    face(dir) {
      player?.face(DIR_FACE[dir]);
    },
    walkNpc(id, dir, run = false, slide = false) {
      const npc = npcs.get(id);
      if (!npc) {
        // 居ない相手を歩かせようとしても止めない。イベントはそのまま次へ進む。
        console.warn(`[npc] 居ない: ${id}`);
        return Promise.resolve(false);
      }
      return beginWalk(npc, npc.actor, dir, run, slide);
    },
    faceNpc(id, dir) {
      const npc = npcs.get(id);
      if (!npc) {
        console.warn(`[npc] 居ない: ${id}`);
        return;
      }
      npc.actor.face(DIR_FACE[dir]);
    },
    routeTo(from, to, first = 'leftRight') {
      // 行き先はマスの真ん中。置き直し（`standOn`）と同じ数え方で揃える。
      const dx = Math.floor(to.x) + 0.5 - from.x;
      const dz = Math.floor(to.z) + 0.5 - from.z;
      // 画面の右と上がワールドでどちらを向くか。カメラの方位で回っている。
      const right = moveVector({ x: 1, y: 0 });
      const up = moveVector({ x: 0, y: -1 });
      const across = Math.round(dx * right.x + dz * right.z);
      const along = Math.round(dx * up.x + dz * up.z);
      const steps: WalkDir[] = [];
      // 片方ずつ詰める L 字。**曲がる順は書いた人が決める**（GS-139）——
      // どちらから行くかで通る道が変わるので、行き止まりを避けたいときに要る。
      const sideways = () => {
        for (let i = 0; i < Math.abs(across) && steps.length < ROUTE_LIMIT; i += 1) {
          steps.push(across > 0 ? 'right' : 'left');
        }
      };
      const lengthways = () => {
        for (let i = 0; i < Math.abs(along) && steps.length < ROUTE_LIMIT; i += 1) {
          steps.push(along > 0 ? 'up' : 'down');
        }
      };
      if (first === 'upDown') {
        lengthways();
        sideways();
      } else {
        sideways();
        lengthways();
      }
      if (Math.abs(across) + Math.abs(along) > ROUTE_LIMIT) {
        // 打ち切ったことは黙らない。**着かない理由が座標の間違いだったとき**に気づけない。
        console.warn(
          `[move] 行き先が遠すぎる: ${Math.abs(across) + Math.abs(along)} 歩（${ROUTE_LIMIT} 歩で打ち切り）`,
        );
      }
      return steps;
    },
    placeNpc(id, x, y, z, face) {
      let npc = npcs.get(id);
      // 隠していた人は、**名指しで置かれたときだけ**その場に出す（GS-153。旧作の `setVisible(true)`）。
      if (!npc && hiddenNpcs.has(id) && makeNpc) {
        const def = hiddenNpcs.get(id) as NpcDef;
        if (makeNpc(def)) {
          hiddenNpcs.delete(id);
          npc = npcs.get(id);
        }
      }
      if (!npc || !collision) {
        console.warn(`[npc] 居ない: ${id}`);
        return false;
      }
      const unit = collision.unit || 1;
      // 歩き・うろつきの途中なら打ち切る。残っていると**置いた先から元の目的地へ歩き出す**。
      endWalk(npc, false);
      npc.wandering = null;
      // 立つのはそのマスの中央（GS-18）。足場の取り方はプレイヤーの置き直しと同じ。
      const spot = standOn(x, y, z, unit);
      npc.actor.placeAt(spot.x, spot.y, spot.z);
      // うろつきの起点も移す（GS-48）。移さないと、置いたそばから元の場所へ帰ろうとする。
      npc.home.copy(npc.actor.position);
      if (face) npc.actor.face(DIR_FACE[face]);
      return true;
    },
    faceNpcToPlayer(id) {
      const npc = npcs.get(id);
      if (!npc || !player) return false;
      const dx = player.position.x - npc.actor.position.x;
      const dz = player.position.z - npc.actor.position.z;
      // 同じマスに重なって立っているときは向きが決まらない。そのままにする。
      if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return false;
      npc.actor.face(DIR_FACE[screenDirOf(dx, dz)]);
      return true;
    },
    setCellChip: (at, faces, layer) => built?.setCellChip(at, faces, layer) ?? false,
    posePlayer: (name) => player?.pose(name) ?? false,
    poseNpc(id, name) {
      return npcs.get(id)?.actor.pose(name) ?? false;
    },
    playCameraCue(id) {
      const cue = cameraCue(id);
      cuePlayer.play(cue);
      return cue.duration;
    },
    playBattleCamera(camera) {
      battleCameraPlayer.play(camera);
      return camera.duration;
    },
    cameraCueState: () => cuePlayer.state(),
    seekCameraCue: (ms) => cuePlayer.seek(ms),
    pauseCameraCue: (paused) => cuePlayer.pause(paused),
    stopCameraCue: () => cuePlayer.stop(),
    cameraIllustrations: () => renderedIllustrations,
    playShot(shot) {
      const kind = shot.kind as keyof typeof CAMERA_SHOT_DEFAULTS;
      const fallback = CAMERA_SHOT_DEFAULTS[kind];
      if (!fallback) {
        console.warn('[shot] 知らない演出: ' + shot.kind);
        return 0;
      }
      shots.play(shot);
      return Math.max(0, shot.ms ?? fallback.ms);
    },

    releaseShot() {
      shots.release();
      cuePlayer.stop();
    },

    removeNpc(id) {
      const npc = npcs.get(id);
      if (!npc) return false;
      scene.remove(npc.actor.group);
      npc.actor.dispose();
      npcs.delete(id);
      // 影と遮光の相手からも外す（消えた人の影が残らないように）。
      applyActorOccluder();
      return true;
    },

    hasNpc: (id) => npcs.has(id),
    npcAt(id) {
      const npc = npcs.get(id);
      if (!npc || !collision) return null;
      const unit = collision.unit || 1;
      return {
        x: npc.actor.position.x / unit,
        y: npc.actor.position.y / unit,
        z: npc.actor.position.z / unit,
        facing: FACE_DIR[npc.actor.facingNow()],
      };
    },
    npcInFront() {
      if (!player || !collision || !npcs.size) return null;
      const unit = collision.unit || 1;
      // 向いている絵 → 画面基準の向き → ワールドの向き。カメラの方位ぶん回っている。
      const aim = moveVector(DIR_AXIS[FACE_DIR[player.facingNow()]]);
      /**
       * **マスで数える**（GS-117）。目の前の 1 マスに居る人へ話しかける。
       *
       * 距離で見ていたが、体がマス 1 つぶんの四角になった（GS-116）ので、
       * 相手のマスの手前で止まると中心どうしは 1 マス離れる。そこへ相手がマスの端に立つと
       * 1.4 マスの網から外れ、**目の前に見えているのに話しかけられない**（実測: 0102 の猫）。
       * マスで数えれば、体の太さにも立ち位置のずれにも左右されない。
       */
      const step = Math.abs(aim.x) >= Math.abs(aim.z)
        ? { x: Math.sign(aim.x), z: 0 }
        : { x: 0, z: Math.sign(aim.z) };
      const px = Math.floor(player.position.x / unit);
      const pz = Math.floor(player.position.z / unit);
      let found: string | null = null;
      let near = Infinity;
      for (const [id, npc] of npcs) {
        if (Math.abs(npc.actor.position.y - player.position.y) / unit > TALK_RISE) continue;
        const nx = Math.floor(npc.actor.position.x / unit);
        const nz = Math.floor(npc.actor.position.z / unit);
        // 同じマス（重なって立っている）か、向いている先の 1 マス。
        const here = nx === px && nz === pz;
        if (!here && !(nx === px + step.x && nz === pz + step.z)) continue;
        // 同じマスに何人も居るときは近いほうへ。
        const span = Math.hypot(npc.actor.position.x - player.position.x, npc.actor.position.z - player.position.z);
        if (span >= near) continue;
        near = span;
        found = id;
      }
      return found;
    },
    playerAt() {
      if (!player || !collision) return null;
      const unit = collision.unit || 1;
      return { x: player.position.x / unit, y: player.position.y / unit, z: player.position.z / unit };
    },
    playerRadius: () => player?.radius ?? 0,
    playerFacing: () => (player ? FACE_DIR[player.facingNow()] : null),
    facingVector: () => (player ? moveVector(DIR_AXIS[FACE_DIR[player.facingNow()]]) : null),
    headAt(who) {
      const actor = who === 'player' ? player : (npcs.get(who)?.actor ?? null);
      const unit = collision?.unit || 1;
      if (actor) {
        // 頭のすこし上。板の高さは人によって違う（鶏は 1 マス、メイナは 1.25 マス）。
        // 絵を下げているぶんは引く（GS-52）——見えている頭の上に置きたいので。
        headSpot.copy(actor.position);
        headSpot.y += (actor.size.height - actor.footLift) * 1.05;
      } else {
        // 人が居なければ**マップに置いた物**を探す（GS-55）。調べ物の吹き出しはこの上に出る。
        const box = mapDef ? objectHeadSpot(mapDef, who) : null;
        if (!box) return null;
        // 四角の中心はマスの座標そのまま（`+0.5` は要らない）——
        // 1 マスの四角 `-5..-4` の中心は `-4.5` で、これはマス `-5` の中央と同じ。
        headSpot.set(box.x * unit, box.y * unit, box.z * unit);
      }
      headSpot.project(rig.active());
      // −1〜1 を画素へ。奥（z > 1）なら画面の外。
      if (headSpot.z > 1) return null;
      return {
        x: ((headSpot.x + 1) / 2) * GAME_SCREEN_WIDTH,
        y: ((1 - headSpot.y) / 2) * GAME_SCREEN_HEIGHT,
      };
    },
    placePlayer(x, y, z) {
      if (!player || !collision) return;
      const unit = collision.unit || 1;
      endWalk(hero, false);
      // マスの真ん中へ。高さは出発点や目印と同じ取り方で、そのマスの床に乗せる。
      const spot = standOn(x, y, z, unit);
      player.placeAt(spot.x, spot.y, spot.z);
      rig.target.copy(player.position);
    },
    placeAtMarker(name) {
      if (!player || !collision || !mapDef) return false;
      const marker = markerObject(mapDef, name);
      if (!marker) {
        // 目印が無いことは黙って直せない。**着地に失敗すると入口の前で止まる**ので印を出す。
        console.warn(`[map] 目印が無い: ${name}`);
        return false;
      }
      const unit = collision.unit || 1;
      // 出発点と同じ置き方（GC-14）。そのマスの中央・床の上。
      const spot = standOn(marker.x, marker.y, marker.z, unit);
      endWalk(hero, false);
      player.placeAt(spot.x, spot.y, spot.z);
      const look = FACINGS[marker.face.toLowerCase()];
      if (look) player.face(DIR_FACE[look]);
      rig.target.copy(player.position);
      return true;
    },
    battleStage(formation) {
      if (!mapDef) return null;
      const marked = battleStageMarker(mapDef);
      if (!marked) return null;
      const at = { ...marked, face: '' };
      return { at, yaw: 0, pitch: playPitch, zoom: 1,
        formation: chooseBattleFormation(formation, battleSetup?.formations, () => 0) };
    },
    stageBattle(spec, figures, debugGrid = false) {
      unstage();
      if (!collision) return;
      const unit = collision.unit || 1;
      const at = spec.at;
      stage = {
        focus: new Vector3(),
        figures: new Map(),
        saved: { yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance },
        spec,
        hiddenNpcs: [],
        grid: debugGrid ? createStageGrid(at, unit) : null,
        axes: debugGrid ? createStageAxes(at, unit) : null,
      };
      const current = stage;
      if (current.grid) scene.add(current.grid);
      if (current.axes) scene.add(current.axes);
      // **フィールドの敵（`EnemyData` を持つ NPC）は隠す**（GS-88）。舞台に同じ敵が板で立つので、
      // 後ろに小さなシンボルが残っていると同じ相手が 2 回見える。
      for (const [id, npc] of npcs) {
        if (!npc.def.enemy || !npc.actor.group.visible) continue;
        npc.actor.group.visible = false;
        current.hiddenNpcs.push(id);
      }
      // 立ち位置（GS-95）。人数別スロットは隊形台帳だけを正本とする。
      // across/depth はカメラ基準なので、マップの向きによらず画面上で同じ隊形になる。
      const camYaw = ((rig.yaw + spec.yaw) * Math.PI) / 180;
      const right = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
      const toward = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
      const count = {
        party: figures.filter((one) => one.side === 'party').length,
        enemy: figures.filter((one) => one.side === 'enemy').length,
      };
      const seen = { party: 0, enemy: 0 };
      const formation = {
        party: battleFormationSlots(spec.formation, 'party', count.party),
        enemy: battleFormationSlots(spec.formation, 'enemy', count.enemy),
      };
      for (const side of ['party', 'enemy'] as const) if (count[side] > 0 && !formation[side]) {
        console.warn(`[battle-formation] ${spec.formation || '（未指定）'} に ${side} ${count[side]}人の配置がありません`);
      }
      const partySum = new Vector3();
      const enemySum = new Vector3();
      for (const def of figures) {
        const index = seen[def.side]++;
        const slot = formation[def.side]?.[index];
        const across = slot?.across ?? 0;
        const depth = slot?.depth ?? 0;
        const cx = at.x + right.x * across + toward.x * depth;
        const cz = at.z + right.z * across + toward.z * depth;
        const spot = standOn(cx, at.y, cz, unit);
        // 高さだけ床から取り、横と奥は**マスに丸めない**（丸めると列ががたつく）。
        const base = new Vector3(cx * unit, spot.y + (slot?.height ?? 0) * unit, cz * unit);
        (def.side === 'party' ? partySum : enemySum).add(base);
        const material = new MeshBasicMaterial({ transparent: true, alphaTest: 0.05, side: DoubleSide });
        const mesh = new Mesh(new PlaneGeometry(1, 1), material);
        mesh.visible = false;
        const shadow = new Mesh(
          new CircleGeometry(0.5, 24),
          new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(base.x, spot.y + 0.02 * unit, base.z);
        shadow.visible = false;
        const figure: StageFigure = {
          def,
          mesh,
          material,
          shadow,
          base,
          groundY: spot.y,
          width: 0,
          height: 0,
          pose: {},
          leanAt: -1,
          lungeAt: -1,
          goneAt: -1,
          slot: index + 1,
          breathPhase: Math.random() * Math.PI * 2,
          commandK: 0,
          commandLift: 0,
        };
        current.figures.set(def.id, figure);
        scene.add(mesh);
        scene.add(shadow);
        // 絵が来てから大きさを決める（縦横比は絵しだい）。**来る前に片付いていたら何もしない**。
        stageLoader.load(def.image, (texture) => {
          if (stage !== current) {
            texture.dispose();
            return;
          }
          texture.colorSpace = SRGBColorSpace;
          const img = texture.image as { width: number; height: number };
          const cells = def.height > 0 ? def.height : Math.min(3.2, Math.max(0.9, img.height / STAGE_PX_PER_CELL));
          figure.height = cells * unit;
          figure.width = (figure.height * img.width) / img.height;
          mesh.geometry.dispose();
          mesh.geometry = new PlaneGeometry(figure.width, figure.height).translate(0, figure.height / 2, 0);
          material.map = texture;
          material.needsUpdate = true;
          shadow.scale.set(figure.width * 0.9, figure.width * 0.35, 1);
          mesh.visible = true;
        });
      }
      // 見る先（GS-90）。**敵の列寄り**——味方は手前の下の方に入り、敵が画面の真ん中に来る
      // （味方の肩越しに敵を見る形）。両方の真ん中を見ると、手前の味方が奥の敵を隠していた。
      const partyAt = count.party > 0 ? partySum.divideScalar(count.party) : null;
      const enemyAt = count.enemy > 0 ? enemySum.divideScalar(count.enemy) : null;
      const middle =
        enemyAt && partyAt
          ? enemyAt.clone().lerp(partyAt, STAGE_FOCUS_PARTY)
          : (enemyAt ?? partyAt ?? new Vector3(at.x * unit, at.y * unit, at.z * unit));
      current.focus.set(middle.x, middle.y + STAGE_LOOK_Y * unit, middle.z);
      if (player) player.group.visible = false;
    },
    unstageBattle() {
      unstage();
    },
    figureRect(id) {
      const figure = stage?.figures.get(id);
      if (!figure || !figure.mesh.visible) return null;
      const camera = rig.active();
      const yawR = (renderedYaw * Math.PI) / 180;
      // 左端へ寄せた板（GS-103）や演出で動かした板にも枠を合わせる。横と奥は表示中の位置、高さは床基準。
      const grow = figure.mesh.scale.x;
      // 板の右向き（ワールド）。y 軸で yaw だけ回した x 軸。
      const rx = (Math.cos(yawR) * figure.width * grow) / 2;
      const rz = (-Math.sin(yawR) * figure.width * grow) / 2;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const corners: Array<[number, number]> = [
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, 1],
      ];
      for (const [sx, sy] of corners) {
        stageCorner
          .set(figure.mesh.position.x + rx * sx, figure.base.y + figure.commandLift + figure.height * grow * sy, figure.mesh.position.z + rz * sx)
          .project(camera);
        const px = ((stageCorner.x + 1) / 2) * GAME_SCREEN_WIDTH;
        const py = ((1 - stageCorner.y) / 2) * GAME_SCREEN_HEIGHT;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
    },
    figurePose(id, pose) {
      const figure = stage?.figures.get(id);
      if (!figure) return;
      // 立ち上がりで動きを始める（ずっと真のあいだ繰り返さない）。
      if (pose.lean && !figure.pose.lean) figure.leanAt = elapsed;
      if (pose.lunge && !figure.pose.lunge) figure.lungeAt = elapsed;
      if (pose.gone && !figure.pose.gone) figure.goneAt = elapsed;
      figure.pose = { ...pose };
    },
    dispose() {
      unstage();
      buildGen += 1;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('contextmenu', onContext);
      input.dispose();
      player?.dispose();
      for (const npc of npcs.values()) npc.actor.dispose();
      npcs.clear();
      wires?.dispose();
      mapModels?.dispose();
      built?.dispose();
      scene.remove(fieldEffects.group);
      fieldEffects.dispose();
      screenEffects.dispose();
      tilt.dispose();
      renderer.dispose();
    },
  };
}

/** 読み込んだマップ JSON をコンソールに出す。中身の確認用（GF-4.8）。 */
function logMap(name: string, map: MapDef): void {
  const assets = typeof map.assets === 'string' ? null : map.assets;
  console.groupCollapsed(`[map] ${name}`);
  console.log('JSON', map);
  console.table(
    map.layers.map((layer) => ({
      name: layer.name,
      kind: layer.kind,
      collision: layer.collision === true,
      visible: layer.visible !== false,
      batches: layer.batches?.length ?? 0,
      objects: layer.objects?.length ?? 0,
      properties: (layer.properties ?? []).map((p) => `${p.name}=${p.value}`).join(' '),
    })),
  );
  console.log('grid', map.grid, 'bounds', map.bounds);
  console.log('lighting', map.lighting, 'camera', map.camera);
  console.log('pointLights', map.pointLights?.length ?? 0, 'properties', map.properties);
  if (assets) {
    console.log(
      'assets',
      `textures=${assets.textures?.length ?? 0}`,
      `tilesets=${assets.tilesets?.length ?? 0}`,
      `materials=${assets.materials?.length ?? 0}`,
      `protos=${assets.protos?.length ?? 0}`,
    );
  }
  console.groupEnd();
}

/**
 * オブジェクトレイヤーから名前で点を探す。XZ 平面の点だけ見る。
 * 出発点（`default`）も、マップ移動の着地点も同じ引き方（GC-14 / DEC-39 / GS-17）。
 * `points[0]` は連続座標の [x, z]、`y` はセルの高さ。
 */
/**
 * その名前で置いた物の**上**の画面座標（GS-55）。調べ物の吹き出しを出す先。
 *
 * 人と違って板の高さが無いので、**箱の上の面**を頭と見なす。
 * 見つからなければ null——呼ぶ側は下の会話ウィンドウへ落とす。
 */
function objectHeadSpot(map: MapDef, name: string): { x: number; y: number; z: number } | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    for (const object of layer.objects ?? []) {
      if ((object.plane ?? 'xz') !== 'xz') continue;
      if (object.name.trim().toLowerCase() !== want) continue;
      const points = object.points ?? [];
      if (points.length === 0) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const [x, z] of points) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      return { x: (x0 + x1) / 2, y: (object.y ?? 0) + (object.height ?? 1), z: (z0 + z1) / 2 };
    }
  }
  return null;
}

function markerObject(map: MapDef, name: string): { x: number; y: number; z: number; face: string } | null {
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    for (const object of layer.objects ?? []) {
      if (object.kind !== 'point') continue;
      if ((object.plane ?? 'xz') !== 'xz') continue;
      if (object.name.trim().toLowerCase() !== name.trim().toLowerCase()) continue;
      const point = object.points?.[0];
      if (!point) continue;
      // 目印は向きも持てる（GS-19）。`Direction` を書いておくと、そこに立ったときの向きになる。
      const face = object.properties?.find((entry) => entry.name === 'Direction')?.value;
      return { x: point[0], y: object.y ?? 0, z: point[1], face: typeof face === 'string' ? face.trim() : '' };
    }
  }
  return null;
}
