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
//   ShowIf … このスイッチが**入っているときだけ**出す
//   HideIf … このスイッチが**入っていると出さない**（倒したら現れないイベント敵など）

import type { MapDef, MapObjectDef, PropertyDef } from '../mep3d/types';
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
/** 出す・出さないの条件（GS-130）。値はスイッチの名前。 */
const SHOW_IF_PROPERTY = 'ShowIf';
const HIDE_IF_PROPERTY = 'HideIf';
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
 * その NPC を出すか（GS-130）。`ShowIf` は入っていれば出す、`HideIf` は入っていれば出さない。
 * **両方書いたら両方満たすときだけ**出す。どちらも無ければいつでも出す。
 */
export function npcShown(def: Pick<NpcDef, 'showIf' | 'hideIf'>, switchOn: (key: string) => boolean): boolean {
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
        ...(textOf(object.properties, SHOW_IF_PROPERTY) ? { showIf: textOf(object.properties, SHOW_IF_PROPERTY) } : {}),
        ...(textOf(object.properties, HIDE_IF_PROPERTY) ? { hideIf: textOf(object.properties, HIDE_IF_PROPERTY) } : {}),
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
