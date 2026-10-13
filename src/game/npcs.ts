// マップに置いたオブジェクト → NPC（GS-16）。
//
// イベントの起動場所（`eventSpots.ts`）と同じ考え方で、**マップは「誰がどこに居るか」だけ**を持つ。
// 何を喋るかは同じオブジェクトの `Event` が指すイベント JSON、
// 誰か（名前・絵）はキャラクターの台帳（`characterdata.json`）。3 つを別々に直せるようにしておく。
//
// **NPC になるのは、`NPC` / `SPRITE` という名前のオブジェクトレイヤーに置いた、`Character` を持つ物**（2026-10-08）。
// レイヤー名で絞るのが要点——絵の目印として置いた物（出発点の見本など）まで動き出すと困る。
//
// **絵はキャラクターから引く**（2026-10-08）。`Character` → `characterdata.json` の `sheet`（画像）→ 区切りと立ち姿。
// それまでは `Sprite`（エディタが書く絵の指定）の**ファイル名から**姿のキーを推し量っていたが、
// 台帳から誰がどこに居るか追えず、同じ絵を使う人を区別できなかったのでやめた（`Sprite` と `Npc` は外した）。
//
// オブジェクトのプロパティ
//   Character … キャラクターのキー（`characterdata.json`）。誰か——名前・会話の絵・フィールドの絵
//   Id     … その物の名前（GS-134）。イベントから `npc:<id>` で呼び、**覚えもこの名前に付く**
//            （`setSelfSwitch` の行き先。同じイベントを何個の宝箱で使っても混ざらない）。
//            **マップエディタが置いたときに書く**（2026-10-08。1 体目はキャラクターのキー、2 体目から `slime2`・`slime3`…）。
//            省略されていればキャラクターのキー。NPC の設定（`mapNpcs.json`）もこの名前で引く
//   Event  … 話しかけたときに動くイベントの id
//   Face   … 最初に向いている方（up / down / left / right）
//   EnemyData … 敵の台帳（`data/enemies.json`）のキー（GS-76）。書くと**シンボル**になり、
//               触ると戦闘が始まる。話しかけるイベントは持たない（触るのが用件）
//   Scale  … 絵の大きさの倍率（GS-130）。**見た目だけ**で、当たりも届く範囲も変わらない
//   Pose   … スイッチが入っているときの静止コマの名前（GS-133。立ち姿 `actors.json` の `poses`）
//   PoseIf … その `Pose` にするスイッチ。**見た目はイベントではなくここで決まる**
//            `self:開けた` と書くと**その物自身の覚え**（GS-134）。ふつうに書くと通しのスイッチ
//   （うろつき `Wander`・その場の足踏み `StepInPlace`・最初は出さない `Standby`・出す条件 `ShowIf` / `HideIf` / `ShowWhile` は
//    2026-10-08 にマップから外し、NPC の設定の台帳 `mapNpcs.json`（マップ＋1 体）へ移した。`mapNpcs.ts`）
//   Opacity … **不透明度（%）**（GS-207）。幽霊のような半透明の人に。0〜100、書かなければ 100。
//            イベントの「置き直す」の不透明度は、その場かぎり（マップを読み直すとこちらに戻る）
//   Hidden … **ゲームには出さない**（GS-160）。エディタでは見える。置き場所の目印用
//   ShowIn … **この時間帯だけ**出す（GS-222）。光のプリセットの id のカンマ区切り。マップの見た目の話なのでマップに残す
//
// **出入りはイベントの命令で決める**（GS-157）。イベントが「消す」「置き直す」を通ると、
// その**キャラ自身の覚え**（`self:消えた` / `self:出た`）に書く——マップを読み直しても
// 消えたままだし、出たままになる。最初は出さない・出す条件は台帳（`mapNpcs.json`）が持つ。

import type { MapDef, MapObjectDef, PropertyDef } from '../mep3d/types';
import type { IfCondition } from '../event/types';
import type { MapNpcDef } from './mapNpcs';
import { HIDDEN_PROPERTY } from './hiddenLayers';
import type { WalkDir } from './GameView';

/** 立たせる 1 人ぶん。位置はマス（小数）。 */
export interface NpcDef {
  /** イベントから呼ぶ名前。`npc:<id>`。 */
  id: string;
  /** キャラクターのキー（`characterdata.json`。マップの `Character`）。絵はここから引く。 */
  character: string;
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
  /**
   * この時間帯だけ出す（GS-222。マップの `ShowIn`）。光のプリセットの id のカンマ区切り。
   * 時間帯なし（基準）では出す。
   */
  showIn?: string;
  /**
   * **最初は出さない**（GS-157。台帳 `mapNpcs.json` の `standby`）。イベントが「置き直す」で出すまで居ない。
   */
  standby?: boolean;
  /**
   * この条件を満たす間だけ出す（GS-230。台帳の `showWhen`）。イベントの条件と同じ書き方。
   * 判定は呼ぶ側（記録を持っている画面）——`npcShown` の `meets`。
   */
  showWhen?: IfCondition[];
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
   * **ピクセル単位で置いた**（GS-191。マップの `PixelPlace`）。置いた点の位置そのままに立つ。
   * 無ければ今までどおりマスの真ん中へ寄せる（今あるマップの NPC は点が小数でも真ん中に立っている）。
   * 歩かせたりうろつかせたりすると、歩き終わりにマスの真ん中へ戻る。
   */
  pixel?: boolean;
  /** 不透明度（0〜1。GS-207。マップの `Opacity` は % で書く）。無ければ不透明。 */
  opacity?: number;
  x: number;
  y: number;
  z: number;
  facing: WalkDir;
}

/** キャラクターのキー（2026-10-08。`characterdata.json`）。 */
export const CHARACTER_PROPERTY = 'Character';
/** その物の名前（GS-134）。 */
const ID_PROPERTY = 'Id';
const EVENT_PROPERTY = 'Event';
const FACE_PROPERTY = 'Face';
/** 敵シンボル（GS-76）。値は `data/enemies.json` のキー。 */
const ENEMY_PROPERTY = 'EnemyData';
/** 絵の大きさの倍率（GS-130）。見た目だけ。 */
const SCALE_PROPERTY = 'Scale';
const SHOW_IN_PROPERTY = 'ShowIn';
/** 時間帯の問い合わせ（GS-222）。`time:<id,id>` は、いまの時間帯がどれか（時間帯なしなら真）。 */
export const TIME_PREFIX = 'time:';
/** ピクセル単位で置く（GS-191）。値は真偽。 */
const PIXEL_PLACE_PROPERTY = 'PixelPlace';
/** 不透明度（GS-207）。% で書く（0〜100）。 */
const OPACITY_PROPERTY = 'Opacity';
/** スイッチで変わる見た目（GS-133）。`PoseIf` が入っているあいだ `Pose` の静止コマにする。 */
const POSE_PROPERTY = 'Pose';
const POSE_IF_PROPERTY = 'PoseIf';
/** ここに置いた、キャラクター（`Character`）を持つ物は NPC になる、というレイヤー名（大文字小文字は問わない）。 */
const NPC_LAYER = 'npc';
/**
 * ここに置いた、キャラクターを持つ物は**物**になる、というレイヤー名（GS-133）。旧作の Tiled と同じ名前。
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
 *   2. 台帳の `standby`（最初は出さない）
 *   3. マップの `ShowIn`（その時間帯だけ。GS-222。時間帯なしでは出す）
 *   4. 台帳の `showWhen`（この条件を満たす間だけ。GS-230。イベントの条件と同じ書き方）
 *
 * どれも無ければいつでも出す。`meets` は条件の判定（記録を持っている画面が渡す）。
 * 渡さなければ、スイッチと覚えだけを `switchOn` で見る（変数・持ち物などは満たさない扱い）。
 */
export function npcShown(
  def: Pick<NpcDef, 'standby' | 'showWhen' | 'showIn'>,
  switchOn: (key: string) => boolean,
  meets?: (when: IfCondition[]) => boolean,
): boolean {
  // イベントが消した人は、マップを読み直しても出さない（旧作の `setVisible(false)` が残る）。
  if (switchOn(`self:${NPC_GONE}`)) return false;
  // イベントが出した人は、`standby` でも条件でも出す。**命令のほうが後の話**。
  if (switchOn(`self:${NPC_CAME}`)) return true;
  if (def.standby) return false;
  if (def.showIn && !switchOn(`${TIME_PREFIX}${def.showIn}`)) return false;
  if (def.showWhen?.length) {
    const ok = meets
      ? meets(def.showWhen)
      : def.showWhen.every((one) =>
          'switch' in one ? switchOn(one.switch) === (one.is ?? true) : 'self' in one ? switchOn(`self:${one.self}`) === (one.is ?? true) : false,
        );
    if (!ok) return false;
  }
  return true;
}

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

/**
 * マップから NPC を集める。XZ 平面（床向き）のものだけ見る。
 * `settings` はそのマップの NPC の設定（台帳 `mapNpcs.json`。1 体の名前 → 設定）——最初は出さない・出す条件をここから足す。
 */
export function readNpcs(map: MapDef, settings: Record<string, MapNpcDef> = {}): NpcDef[] {
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
      // **`NPC` / `SPRITE` レイヤーの、キャラクターを持つ物**だけ（2026-10-08）。
      if (!npcLayer && !thingLayer) continue;
      const character = textOf(object.properties, CHARACTER_PROPERTY);
      if (!character) continue;
      const at = standAt(object);
      if (!at) continue;
      const id = textOf(object.properties, ID_PROPERTY) || character;
      const setting = settings[id];
      npcs.push({
        id,
        character,
        event: textOf(object.properties, EVENT_PROPERTY),
        ...(textOf(object.properties, ENEMY_PROPERTY) ? { enemy: textOf(object.properties, ENEMY_PROPERTY) } : {}),
        // 倍率は 0 以下を受けない（消えてしまう）。上も程々で止める。
        ...(numberOf(object.properties, SCALE_PROPERTY) !== undefined
          ? { scale: Math.min(16, Math.max(0.1, numberOf(object.properties, SCALE_PROPERTY) ?? 1)) }
          : {}),
        ...(textOf(object.properties, SHOW_IN_PROPERTY) ? { showIn: textOf(object.properties, SHOW_IN_PROPERTY) } : {}),
        // 最初は出さない・出す条件は台帳から（GS-230）。
        ...(setting?.standby ? { standby: true } : {}),
        ...(setting?.showWhen?.length ? { showWhen: setting.showWhen } : {}),
        ...(truthOf(object.properties, PIXEL_PLACE_PROPERTY) ? { pixel: true } : {}),
        // 不透明度（GS-207）。% で書く。100 以上は書いていないのと同じ。
        ...((numberOf(object.properties, OPACITY_PROPERTY) ?? 100) < 100
          ? { opacity: Math.max(0, numberOf(object.properties, OPACITY_PROPERTY) ?? 100) / 100 }
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
