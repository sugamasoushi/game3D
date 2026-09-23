// マップに置いたオブジェクト → イベントの起動場所（GS-14）。
//
// **どのイベントか**はマップが持ち（オブジェクトのプロパティ `Event`）、
// **どう始まるか**はイベント JSON が持つ（`trigger`）。役割を分けておくと、
// マップを触らずにイベントの起動条件を変えられる。
//
// `MapMove` は行き先マップ名だけの近道。イベントを書かずにマップをつなげる。

import type { MapDef, MapObjectDef, PropertyDef } from '../mep3d/types';
import type { WalkDir } from './GameView';

/**
 * 行き先での立ち位置（GS-17）。`MoveTo` の書き方 2 通りを解いたもの。
 * どちらも無ければ行き先マップの `default` に立つ。
 */
export interface Landing {
  /** 行き先マップに置いた点オブジェクトの名前。 */
  marker: string;
  /** 直接書いた座標（**マス。整数**）。そのマスの中央に立つ。 */
  at: { x: number; y: number; z: number } | null;
}

/** 触れたと見なす余裕（マス）。チップ 32px なら 3 画素ほど。 */
const TOUCH_MARGIN = 0.1;

/** 起動場所。範囲はマス（小数）。 */
export interface EventSpot {
  /**
   * 起動場所の見分け（「いま踏んでいるのはどれか」）。同じイベントを複数箇所に置けるので、
   * イベント id とは別に持つ。
   *
   * **オブジェクトの id はレイヤーの中でしか一意でない**——エディタは
   * レイヤーごとに `obj_1` から振る。中身は `<レイヤー番号>/<オブジェクト id>`。
   */
  objectId: string;
  /**
   * オブジェクトの名前。**吹き出しを頭の上に出す宛先**（GS-55）。
   * `Event` プロパティで書いたときは名前とイベント id が別になるので、別に持つ。
   */
  name: string;
  /** 動かすイベントの id。`MapMove` の近道なら空。 */
  event: string;
  /** 行き先マップ（`MapMove` の近道）。 */
  mapMove: string;
  /** 行き先での立ち位置（`MoveTo`）。 */
  landing: Landing;
  /** 着いたときの向き（`Direction`）。空なら向きはそのまま。 */
  face: WalkDir | '';
  /**
   * 調べ物か（GS-55。旧作の `CLICKEVENT`）。**踏んでも起きない**——
   * 本棚や暖炉のように「そこに立てない物」なので、
   * **隣に立って向いて決定キー**でだけ動く。
   */
  examine: boolean;
  /**
   * 中身（GS-132。マップの `Item` / `Num`）。宝箱のように**中身だけマップが決める**物のため。
   * イベントの `getItem` で `id` を空にすると、これが使われる。
   */
  item: string;
  num?: number;
  /**
   * その枠の名前（GS-134。マップの `Id`）。**覚えの行き先**になる——
   * 同じイベントを何か所に置いても、`setSelfSwitch` が混ざらない。
   */
  owner: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** イベント id を書くプロパティ名。 */
const EVENT_PROPERTY = 'Event';
/**
 * ここに置いたものは**名前がイベント id**になるレイヤー名（GS-19）。
 * 旧作の Tiled と同じ並べ方（`EVENT010101` のような名前をそのまま使う）。
 * NPC レイヤー（GS-18）と同じ「レイヤー名＝役割」。
 */
const EVENT_LAYER = 'event';
/** 中身（GS-132）。宝箱の「何が」「いくつ」。旧作の SPRITE の `item` / `num` に当たる。 */
const ITEM_PROPERTY = 'Item';
const NUM_PROPERTY = 'Num';
/** その枠の名前（GS-134）。覚えの行き先。 */
const ID_PROPERTY = 'Id';
/**
 * 調べ物のレイヤー名（GS-55）。旧作の Tiled と同じ名前。
 * ここも**名前がイベント id**で、EVENT レイヤーと違うのは**起こし方だけ**
 * ——踏むのではなく、隣に立って向いて決定キー。
 */
const CLICK_LAYER = 'clickevent';
/**
 * NPC の姿を書くプロパティ名（GS-16）。**これが在るオブジェクトは踏み台にしない。**
 * NPC の `Event` は「話しかけたとき」に動くもので、床の起動場所ではない。
 */
const NPC_PROPERTY = 'Npc';
/** 行き先マップを書くプロパティ名（既にマップで使われている）。 */
const MAP_MOVE_PROPERTY = 'MapMove';
/** 行き先での立ち位置を書くプロパティ名（GS-17）。目印の名前か `x,y,z`。 */
const MOVE_TO_PROPERTY = 'MoveTo';
/** 着いたときの向きを書くプロパティ名。 */
const DIRECTION_PROPERTY = 'Direction';

/** 向きの書き方はどちらでも受ける。画面基準（up…）でも、絵の行の名前（north…）でも。 */
const FACINGS: Record<string, WalkDir> = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  north: 'up',
  south: 'down',
  west: 'left',
  east: 'right',
};

/**
 * `MoveTo` を解く（GS-17）。
 *
 * - `入口` のような**名前**なら、行き先マップのその点オブジェクトへ
 * - `21,10,37` のような**数 3 つ**なら、そのマス（x,y,z）の**中央**へ
 * - 空なら行き先マップの `default` へ
 *
 * 数はマスの番号。**小数は書かない**（書いてもマスに丸める）——
 * 半端な位置を書けるようにすると、書く側が小数を気にすることになる。
 * 名前で書くほうを勧める。座標はマップを描き直すとずれる。
 */
export function parseLanding(text: string): Landing {
  const trimmed = text.trim();
  if (!trimmed) return { marker: '', at: null };
  const parts = trimmed.split(',').map((part) => part.trim());
  if (parts.length === 3 && parts.every((part) => part !== '' && Number.isFinite(Number(part)))) {
    return { marker: '', at: { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) } };
  }
  return { marker: trimmed, at: null };
}

function textOf(properties: PropertyDef[] | undefined, name: string): string {
  const hit = properties?.find((entry) => entry.name === name);
  if (!hit || typeof hit.value !== 'string') return '';
  return hit.value.trim();
}

/** 数のプロパティ。**数で書いても文字で書いても受ける**（`npcs.ts` と同じ扱い）。 */
function numberOf(properties: PropertyDef[] | undefined, name: string): number | undefined {
  const hit = properties?.find((entry) => entry.name === name);
  if (!hit) return undefined;
  const value = typeof hit.value === 'number' ? hit.value : Number(String(hit.value).trim());
  return Number.isFinite(value) ? value : undefined;
}

/** 平面オブジェクトの外接四角（マス）。ブロックは占有セルから。 */
function footprint(object: MapObjectDef): { x0: number; x1: number; z0: number; z1: number } | null {
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
    return { x0, x1, z0, z1 };
  }
  const points = object.points ?? [];
  if (!points.length) return null;
  // 点だけのオブジェクトは 1 マスぶんの当たりにする。踏めない大きさだと起動できない。
  if (object.kind === 'point') {
    const [x, z] = points[0];
    return { x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 };
  }
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
  return { x0, x1, z0, z1 };
}

/** マップから起動場所を集める。XZ 平面（床向き）のものだけ見る。 */
export function readEventSpots(map: MapDef): EventSpot[] {
  const spots: EventSpot[] = [];
  for (const [index, layer] of map.layers.entries()) {
    if (layer.kind !== 'object') continue;
    const layerName = (layer.name ?? '').trim().toLowerCase();
    const eventLayer = layerName === EVENT_LAYER;
    const clickLayer = layerName === CLICK_LAYER;
    for (const object of layer.objects ?? []) {
      if ((object.plane ?? 'xz') !== 'xz') continue;
      if (textOf(object.properties, NPC_PROPERTY)) continue;
      // `Event` が在ればそれ。無ければ **EVENT レイヤーの名前**（GS-19）。
      const event =
        textOf(object.properties, EVENT_PROPERTY) || (eventLayer || clickLayer ? object.name.trim() : '');
      const mapMove = textOf(object.properties, MAP_MOVE_PROPERTY);
      if (!event && !mapMove) continue;
      const box = footprint(object);
      if (!box) continue;
      spots.push({
        // レイヤー番号を頭に付ける。**別のレイヤーの `obj_1` と同じ物に見えてしまう**——
        // 実測: 家のオープニング（EVENT レイヤーの `obj_1`）を見た直後、
        // 入口（MAPMOVE レイヤーの `obj_1`）を踏んでも外へ出られなかった。
        objectId: `${index}/${object.id}`,
        name: object.name.trim(),
        event,
        mapMove,
        landing: parseLanding(textOf(object.properties, MOVE_TO_PROPERTY)),
        face: FACINGS[textOf(object.properties, DIRECTION_PROPERTY).toLowerCase()] ?? '',
        examine: clickLayer,
        item: textOf(object.properties, ITEM_PROPERTY),
        owner: textOf(object.properties, ID_PROPERTY),
        ...(numberOf(object.properties, NUM_PROPERTY) !== undefined
          ? { num: Math.max(0, Math.trunc(numberOf(object.properties, NUM_PROPERTY) ?? 1)) }
          : {}),
        ...box,
      });
    }
  }
  return spots;
}

/**
 * その場所に立っているか。`reach` は体の太さ（マス。GS-17）。
 *
 * **中心点だけで見ない。** 入口の枠は壁と同じ位置に描くのが普通で、
 * 壁に体が当たって止まると中心は枠の手前で止まる——実測で 0.08 マス足りずに踏めなかった。
 * 体が触れたら起こす（エディタのヘルプもそう書いてある）。
 *
 * 体の太さちょうどでは足りない。壁の帯の厚みぶん、触れたつもりでも数ミリ届かない
 * （実測: 森側の入口で 0.01 マス足りなかった）。**指 1 本ぶんの余裕**を足す。
 */
export function spotUnder(spots: EventSpot[], at: { x: number; z: number }, reach = 0): EventSpot | null {
  const near = reach > 0 ? reach + TOUCH_MARGIN : 0;
  for (const spot of spots) {
    // 調べ物は踏んでも起きない（GS-55）。壁や家具の中なので、そもそも立てない。
    if (spot.examine) continue;
    if (at.x < spot.x0 - near || at.x > spot.x1 + near) continue;
    if (at.z < spot.z0 - near || at.z > spot.z1 + near) continue;
    return spot;
  }
  return null;
}

/**
 * 向いた先に在る調べ物（GS-55）。旧作の `checkPlayerClickEvent` に当たる。
 *
 * 旧作は「隣にいる」と「その方を向いている」を別々に見ていたが、
 * **体の先へ 1 マスぶん伸ばした線**が当たるかだけで同じことが言える——
 * 横に並んでいるだけの物には線が届かず、背を向ければ線は逆へ行く。
 *
 * **点 1 つでは見ない。** マップに置く四角は手で描くので、マスの境目にきっちり
 * 揃っているとは限らない（実測: 台所の四角は境目から 0.53 マス引っ込んでいて、
 * 点 1 つだと 0.01 マス足りずに調べられなかった）。線の上を刻んで見る。
 *
 * 高さは見ない。EVENT の起動場所（`spotUnder`）と同じ扱いで、
 * 上下に重ねて置いた調べ物は今のところ区別できない。
 */
export function spotAhead(
  spots: EventSpot[],
  at: { x: number; z: number },
  aim: { x: number; z: number },
  reach: number,
): EventSpot | null {
  let found: EventSpot | null = null;
  let near = Infinity;
  for (const spot of spots) {
    if (!spot.examine || !spot.event) continue;
    if (!crosses(spot, at, aim, reach)) continue;
    // 重なって置いてあれば近いほうを調べる。
    const span = Math.hypot((spot.x0 + spot.x1) / 2 - at.x, (spot.z0 + spot.z1) / 2 - at.z);
    if (span >= near) continue;
    near = span;
    found = spot;
  }
  return found;
}

/** 刻む幅（マス）。細い四角を跨がない大きさにする。 */
const EXAMINE_STEP = 0.2;

/** 体の縁から `reach` マス先までの線が、その四角に触れているか。 */
function crosses(spot: EventSpot, at: { x: number; z: number }, aim: { x: number; z: number }, reach: number): boolean {
  for (let t = 0; t <= reach + 1e-6; t += EXAMINE_STEP) {
    const x = at.x + aim.x * t;
    const z = at.z + aim.z * t;
    if (x < spot.x0 - TOUCH_MARGIN || x > spot.x1 + TOUCH_MARGIN) continue;
    if (z < spot.z0 - TOUCH_MARGIN || z > spot.z1 + TOUCH_MARGIN) continue;
    return true;
  }
  return false;
}
