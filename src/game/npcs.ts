// マップに置いたオブジェクト → NPC（GS-16）。
//
// イベントの起動場所（`eventSpots.ts`）と同じ考え方で、**マップは「誰がどこに居るか」だけ**を持つ。
// 何を喋るかは同じオブジェクトの `Event` が指すイベント JSON、
// どんな姿かは `actors.json`。3 つを別々に直せるようにしておく。
//
// **NPC になるのは 2 通り**（GS-18）。
//   1. `Npc` のプロパティが在るオブジェクト（レイヤーはどこでもよい）
//   2. **`NPC` という名前のオブジェクトレイヤー**に置いた「キャラ画像」（`Sprite`）
//
// 2 は旧作の Tiled と同じ並べ方（オブジェクトレイヤー名が役割）。エディタで
// 形状「キャラ画像」を置くと `Sprite` が自動で入るので、**置くだけで立つ**。
// レイヤー名で絞るのが要点——絵の目印として置いた「キャラ画像」（出発点の見本など）まで
// 動き出すと困る。
//
// オブジェクトのプロパティ
//   Npc    … 姿のキー（`actors.json` を引く）
//   Sprite … エディタが書く絵の指定（`chicken_walk.png#32x32#10`）。姿のキーとしても使う
//   Id     … その物の名前（GS-134）。イベントから `npc:<id>` で呼び、**覚えもこの名前に付く**
//            （`setSelfSwitch` の行き先。同じイベントを何個の宝箱で使っても混ざらない）。
//            省略すると姿のキーと同じ。`NpcId` は古い書き方で、同じ意味
//   Event  … 話しかけたときに動くイベントの id
//   Face   … 最初に向いている方（up / down / left / right）
//   EnemyData … 敵の台帳（`data/enemies.json`）のキー（GS-76）。書くと**シンボル**になり、
//               触ると戦闘が始まる。話しかけるイベントは持たない（触るのが用件）
//   Scale  … 絵の大きさの倍率（GS-130）。**見た目だけ**で、当たりも届く範囲も変わらない
//   Pose   … スイッチが入っているときの静止コマの名前（GS-133。`actors.json` の `poses`）
//   PoseIf … その `Pose` にするスイッチ。**見た目はイベントではなくここで決まる**
//            `self:開けた` と書くと**その物自身の覚え**（GS-134）。ふつうに書くと通しのスイッチ
//   StepInPlace … **常時その場で足踏みする**（GS-169）。値は真偽。進まず足だけ動く
//            （揺れる旗・回る風車・じっとしていない人）。**うろつきとは両立しない**
//   Hidden … **ゲームには出さない**（GS-160）。エディタでは見える。置き場所の目印用
//   Standby … **最初は出さない**（GS-157）。イベントの「置き直す」で出すまで居ない。
//             出入りはイベントが決めるので、**ここにイベント名は書かない**
//   ShowWhile … そのイベントが**動ける（条件を満たす）ときだけ**出す（GS-195）。値はイベント id。
//            イベントの条件を変えてもマップは直さなくてよい（ボスをイベントと一緒に出し入れする）
//   ShowIf … このスイッチが**入っているときだけ**出す（古い書き方。GS-157 を見よ）
//   HideIf … このスイッチが**入っていると出さない**（古い書き方。GS-157 を見よ）
//
// **出入りはイベントの命令で決める**（GS-157）。イベントが「消す」「置き直す」を通ると、
// その**キャラ自身の覚え**（`self:消えた` / `self:出た`）に書く——マップを読み直しても
// 消えたままだし、出たままになる。`ShowIf` / `HideIf` にイベント名を書いていた頃は、
// フラグの向きを変えるたびにマップを直す必要があった（GS-147 で実際に壊れた）。

import type { MapDef, MapObjectDef, PropertyDef } from '../mep3d/types';
import { HIDDEN_PROPERTY } from './hiddenLayers';
import type { WalkDir } from './GameView';

/** エディタの「キャラ画像」の指定（GS-18）。`ファイル名#幅x高さ#コマ番号`。 */
export interface SpriteRef {
  /** `chicken_walk.png`。 */
  file: string;
  /** 1 コマの大きさ（px）。省略されることもある。 */
  framePx?: [number, number];
}

/** 立たせる 1 人ぶん。位置はマス（小数）。 */
export interface NpcDef {
  /** イベントから呼ぶ名前。`npc:<id>`。 */
  id: string;
  /** 姿のキー。`actors.json` を引く。 */
  actor: string;
  /** エディタが書いた絵の指定（GS-18）。台帳に無い絵はこれで出す。 */
  sprite?: SpriteRef;
  /** 話しかけたときのイベント id。無ければ空。 */
  event: string;
  /**
   * 敵の台帳のキー（GS-76）。**書いてあれば「シンボル」**——触ると戦闘が始まる。
   * 中身（名前・数値・絵）は台帳から引くので、マップが持つのはこのキーだけ。
   */
  enemy?: string;
  /**
   * 絵の大きさの倍率（GS-130。マップの `Scale`）。旧作の NPC の `scale` に当たる。
   * **見た目だけ**——当たりも話しかけの届く範囲も 1 マスのまま。大物を大物らしく見せるためのもの。
   */
  scale?: number;
  /** このスイッチが入っているときだけ出す（GS-130。マップの `ShowIf`）。 */
  showIf?: string;
  /** このスイッチが入っていると出さない（GS-130。マップの `HideIf`）。 */
  hideIf?: string;
  /**
   * **最初は出さない**（GS-157。マップの `Standby`）。イベントが「置き直す」で出すまで居ない。
   * 「イベントで初めて現れる人」はこれ 1 つで足りる——**イベント名は要らない。**
   */
  standby?: boolean;
  /**
   * このイベントが動ける（`when` を満たす）ときだけ出す（GS-195。マップの `ShowWhile`）。
   * 問い合わせは `switchOn('event:<id>')`——条件を読むのは呼ぶ側（イベントを持っている方）。
   */
  showWhile?: string;
  /** 中身（GS-132。マップの `Item` / `Num`）。話しかけたイベントの `getItem` が使う。 */
  item?: string;
  num?: number;
  /**
   * **人ではなく物**（GS-133。`SPRITE` レイヤーに置いたもの）。
   * うろつかず、話しかけてもこちらを向かない。宝箱・立て札など。
   */
  thing?: boolean;
  /**
   * スイッチで変わる見た目（GS-133）。`poseIf` が入っているあいだ `pose` の静止コマにする。
   * **イベントに書かなくても、マップを読み直したときに勝手に戻る**——
   * 記録（スイッチ）から毎回導くので、見た目をセーブに入れなくてよい（GS-47 と同じ考え）。
   */
  pose?: string;
  poseIf?: string;
  /**
   * うろつく距離（GS-48）。マップのプロパティ `Wander`。
   * 書いてなければ undefined（台帳の言うとおり）、`0` なら**この個体だけ動かない**。
   */
  wander?: number;
  /**
   * **常時その場で足踏みする**（GS-169。マップの `StepInPlace`）。
   * イベントの「その場で足踏み」と同じ見せ方を、イベントの外でも続ける。
   * 踏んでいるあいだ**うろつきは入らない**（動かずに足だけ動く物・人のためのもの）。
   */
  stepping?: boolean;
  /**
   * **ピクセル単位で置いた**（GS-191。マップの `PixelPlace`）。置いた点の位置そのままに立つ。
   * 無ければ今までどおりマスの真ん中へ寄せる（今あるマップの NPC は点が小数でも真ん中に立っている）。
   * 歩かせたりうろつかせたりすると、歩き終わりにマスの真ん中へ戻る。
   */
  pixel?: boolean;
  x: number;
  y: number;
  z: number;
  facing: WalkDir;
}

const NPC_PROPERTY = 'Npc';
/** その物の名前（GS-134）。`NpcId` は古い書き方。 */
const ID_PROPERTY = 'Id';
const NPC_ID_PROPERTY = 'NpcId';
const EVENT_PROPERTY = 'Event';
const FACE_PROPERTY = 'Face';
/** エディタの「キャラ画像」が書くプロパティ（GS-18）。 */
const SPRITE_PROPERTY = 'Sprite';
/** うろつく距離（GS-48）。台帳の設定を個体ごとに上書きする。 */
const WANDER_PROPERTY = 'Wander';
/** 敵シンボル（GS-76）。値は `data/enemies.json` のキー。 */
const ENEMY_PROPERTY = 'EnemyData';
/** 絵の大きさの倍率（GS-130）。見た目だけ。 */
const SCALE_PROPERTY = 'Scale';
/** 出す・出さないの条件（GS-130）。値はスイッチの名前。**古い書き方**（GS-157）。 */
const SHOW_IF_PROPERTY = 'ShowIf';
/** そのイベントが動けるときだけ出す（GS-195）。値はイベント id。 */
const SHOW_WHILE_PROPERTY = 'ShowWhile';
/** `switchOn` に渡す「そのイベントは動けるか」の頭（GS-195）。 */
export const EVENT_READY_PREFIX = 'event:';
const HIDE_IF_PROPERTY = 'HideIf';
/** 最初は出さない（GS-157）。値は真偽（`true` / `"true"`）。 */
const STANDBY_PROPERTY = 'Standby';
/** 常時その場で足踏みする（GS-169）。値は真偽。 */
const STEP_IN_PLACE_PROPERTY = 'StepInPlace';
/** ピクセル単位で置く（GS-191）。値は真偽。 */
const PIXEL_PLACE_PROPERTY = 'PixelPlace';
/** 中身（GS-132）。宝箱の「何が」「いくつ」。 */
const ITEM_PROPERTY = 'Item';
const NUM_PROPERTY = 'Num';
/** スイッチで変わる見た目（GS-133）。`PoseIf` が入っているあいだ `Pose` の静止コマにする。 */
const POSE_PROPERTY = 'Pose';
const POSE_IF_PROPERTY = 'PoseIf';
/** ここに置いた「キャラ画像」は NPC になる、というレイヤー名（大文字小文字は問わない）。 */
const NPC_LAYER = 'npc';
/**
 * ここに置いた「キャラ画像」は**物**になる、というレイヤー名（GS-133）。旧作の Tiled と同じ名前。
 * NPC と同じ板 1 枚だが、**人として扱わない**——うろつかないし、話しかけてもこちらを向かない。
 * 宝箱・立て札のような「そこに在るだけの物」用。
 */
const SPRITE_LAYER = 'sprite';

/** 向きの書き方はどちらでも受ける。絵の行の名前（north…）でも、画面基準（up…）でも。 */
export const FACINGS: Record<string, WalkDir> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  north: 'up',
  south: 'down',
  west: 'left',
  east: 'right',
};

function textOf(properties: PropertyDef[] | undefined, name: string): string {
  const hit = properties?.find((entry) => entry.name === name);
  if (!hit || typeof hit.value !== 'string') return '';
  return hit.value.trim();
}

/**
 * 真偽のプロパティ（GS-157）。エディタは型を選べるので、**`true` でも `"true"` でも受ける**
 * （`1` / `yes` / `はい` も同じ扱い）。読めない値は false。
 */
function truthOf(properties: PropertyDef[] | undefined, name: string): boolean {
  const hit = properties?.find((entry) => entry.name === name);
  if (!hit) return false;
  if (typeof hit.value === 'boolean') return hit.value;
  return ['true', '1', 'yes', 'はい'].includes(String(hit.value).trim().toLowerCase());
}

/**
 * 数のプロパティ。**数で書いても文字で書いても受ける**——エディタのプロパティ欄は
 * 型を選べるので、同じ物が `4` でも `"4"` でも来る。読めない値は undefined。
 */
function numberOf(properties: PropertyDef[] | undefined, name: string): number | undefined {
  const hit = properties?.find((entry) => entry.name === name);
  if (!hit) return undefined;
  const value = typeof hit.value === 'number' ? hit.value : Number(String(hit.value).trim());
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 出入りの覚え（GS-157）。**その物自身のセルフスイッチ**（GS-134）なので、
 * 同じ姿を何人置いても混ざらない。書くのはイベントの「消す」「置き直す」だけ。
 */
export const NPC_GONE = '消えた';
export const NPC_CAME = '出た';

/**
 * その NPC を出すか（GS-130 / GS-157）。上から順に見て、最初に決まったところで止まる。
 *
 *   1. **キャラ自身の覚え**（`self:消えた` / `self:出た`）。イベントが書いたもの——一番強い
 *   2. マップの `Standby`（最初は出さない）
 *   3. マップの `ShowWhile`（そのイベントが動けるときだけ。GS-195）
 *   4. マップの `ShowIf` / `HideIf`（古い書き方）。**書いたものを全部満たすときだけ**出す
 *
 * どれも無ければいつでも出す。
 */
export function npcShown(
  def: Pick<NpcDef, 'showIf' | 'hideIf' | 'standby' | 'showWhile'>,
  switchOn: (key: string) => boolean,
): boolean {
  // イベントが消した人は、マップを読み直しても出さない（旧作の `setVisible(false)` が残る）。
  if (switchOn(`self:${NPC_GONE}`)) return false;
  // イベントが出した人は、`Standby` でも `ShowIf` でも出す。**命令のほうが後の話**。
  if (switchOn(`self:${NPC_CAME}`)) return true;
  if (def.standby) return false;
  if (def.showWhile && !switchOn(`${EVENT_READY_PREFIX}${def.showWhile}`)) return false;
  if (def.showIf && !switchOn(def.showIf)) return false;
  if (def.hideIf && switchOn(def.hideIf)) return false;
  return true;
}

/**
 * `Sprite` を解く（GS-18）。`chicken_walk.png#32x32#10` → ファイルと 1 コマの大きさ。
 * コマ番号はエディタが見本を出すためのもので、ゲームは向きから決めるので使わない。
 */
function parseSprite(text: string): SpriteRef | null {
  if (!text) return null;
  const [file, size] = text.split('#');
  if (!file) return null;
  const wh = size?.match(/^(\d+)x(\d+)$/i);
  return wh ? { file, framePx: [Number(wh[1]), Number(wh[2])] } : { file };
}

/** 絵のファイル名から姿のキーを作る。`chicken_walk.png` → `chicken_walk`。 */
const spriteKey = (file: string): string => file.replace(/\.[^.]+$/, '');

/** 立ち位置（マス）。点はその点、それ以外は外接四角の真ん中。 */
function standAt(object: MapObjectDef): { x: number; z: number } | null {
  if (object.cells?.length) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, , z] of object.cells) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z + 1);
    }
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  }
  const points = object.points ?? [];
  if (!points.length) return null;
  if (object.kind === 'point') return { x: points[0][0], z: points[0][1] };
  let sumX = 0;
  let sumZ = 0;
  for (const [x, z] of points) {
    sumX += x;
    sumZ += z;
  }
  return { x: sumX / points.length, z: sumZ / points.length };
}

/** マップから NPC を集める。XZ 平面（床向き）のものだけ見る。 */
export function readNpcs(map: MapDef): NpcDef[] {
  const npcs: NpcDef[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    const layerName = (layer.name ?? '').trim().toLowerCase();
    const npcLayer = layerName === NPC_LAYER;
    const thingLayer = layerName === SPRITE_LAYER;
    for (const object of layer.objects ?? []) {
      if ((object.plane ?? 'xz') !== 'xz') continue;
      // ゲームでは出さない物（GS-160。マップの `Hidden`）。レイヤーに付けたときと同じ言葉で、
      // **エディタには見えるがゲームには出ない**——置き場所の目印に使う。
      // 当たりや起動枠は今までどおり（`Hidden` は見た目の話。GS-57）。
      if (truthOf(object.properties, HIDDEN_PROPERTY)) continue;
      const named = textOf(object.properties, NPC_PROPERTY);
      const sprite = parseSprite(textOf(object.properties, SPRITE_PROPERTY));
      // `Npc` が在ればどこでも。無ければ **`NPC` / `SPRITE` レイヤーのキャラ画像**だけ。
      if (!named && !((npcLayer || thingLayer) && sprite)) continue;
      const actor = named || spriteKey(sprite!.file);
      const at = standAt(object);
      if (!at) continue;
      npcs.push({
        id: textOf(object.properties, ID_PROPERTY) || textOf(object.properties, NPC_ID_PROPERTY) || actor,
        actor,
        ...(sprite ? { sprite } : {}),
        event: textOf(object.properties, EVENT_PROPERTY),
        ...(textOf(object.properties, ENEMY_PROPERTY) ? { enemy: textOf(object.properties, ENEMY_PROPERTY) } : {}),
        ...(numberOf(object.properties, WANDER_PROPERTY) !== undefined
          ? { wander: Math.max(0, numberOf(object.properties, WANDER_PROPERTY) ?? 0) }
          : {}),
        // 倍率は 0 以下を受けない（消えてしまう）。上も程々で止める。
        ...(numberOf(object.properties, SCALE_PROPERTY) !== undefined
          ? { scale: Math.min(16, Math.max(0.1, numberOf(object.properties, SCALE_PROPERTY) ?? 1)) }
          : {}),
        ...(textOf(object.properties, SHOW_WHILE_PROPERTY)
          ? { showWhile: textOf(object.properties, SHOW_WHILE_PROPERTY) }
          : {}),
        ...(textOf(object.properties, SHOW_IF_PROPERTY) ? { showIf: textOf(object.properties, SHOW_IF_PROPERTY) } : {}),
        ...(textOf(object.properties, HIDE_IF_PROPERTY) ? { hideIf: textOf(object.properties, HIDE_IF_PROPERTY) } : {}),
        // 最初は出さない（GS-157）。イベントの「置き直す」で出す。
        ...(truthOf(object.properties, STANDBY_PROPERTY) ? { standby: true } : {}),
        ...(truthOf(object.properties, PIXEL_PLACE_PROPERTY) ? { pixel: true } : {}),
        // 常時その場で足踏み（GS-169）。イベントを書かなくても動いて見える。
        ...(truthOf(object.properties, STEP_IN_PLACE_PROPERTY) ? { stepping: true } : {}),
        ...(textOf(object.properties, ITEM_PROPERTY) ? { item: textOf(object.properties, ITEM_PROPERTY) } : {}),
        ...(numberOf(object.properties, NUM_PROPERTY) !== undefined
          ? { num: Math.max(0, Math.trunc(numberOf(object.properties, NUM_PROPERTY) ?? 1)) }
          : {}),
        ...(thingLayer ? { thing: true } : {}),
        ...(textOf(object.properties, POSE_PROPERTY) ? { pose: textOf(object.properties, POSE_PROPERTY) } : {}),
        ...(textOf(object.properties, POSE_IF_PROPERTY) ? { poseIf: textOf(object.properties, POSE_IF_PROPERTY) } : {}),
        x: at.x,
        y: object.y ?? 0,
        z: at.z,
        facing: FACINGS[textOf(object.properties, FACE_PROPERTY).toLowerCase()] ?? 'down',
      });
    }
  }
  return npcs;
}
