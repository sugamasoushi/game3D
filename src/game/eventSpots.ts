// マップに置いたオブジェクト → イベントの起動場所（GS-14）。
//
// **どのイベントか**はマップが持ち（オブジェクトのプロパティ `Event`）、
// **どう始まるか**はイベント JSON が持つ（`trigger`）。役割を分けておくと、
// マップを触らずにイベントの起動条件を変えられる。
//
// マップ移動の入口は **MAPMOVE レイヤーの物の `MapMove`**（行き先をカンマ区切り。GS-211）。
// 条件・立ち位置・向きはイベント JSON の `mapMoves`（`mapMoves.ts`）。

import { decodeCells } from '../mep3d/decode';
import type { MapDef, MapObjectDef, PropertyDef } from '../mep3d/types';
import { parseMapMoves } from './mapMoves';

/**
 * 行き先での立ち位置（GS-17）。マス（`at`）か目印の名前（`marker`）。
 * どちらも無ければ行き先マップの `default` に立つ。決めるのはイベント JSON の `mapMoves`（GS-211）。
 */
export interface Landing {
  /** 行き先マップに置いた点オブジェクトの名前。 */
  marker: string;
  /** 直接書いた座標（**マス。整数**）。そのマスの中央に立つ。 */
  at: { x: number; y: number; z: number } | null;
  /** マス内のずれ（ピクセル。GS-191）。`at` のマスの真ん中から。 */
  px?: { x: number; y?: number; z: number };
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
  /** 動かすイベントの id。マップ移動の入口なら空。 */
  event: string;
  /**
   * 行き先マップの並び（GS-211。MAPMOVE レイヤーの `MapMove`）。空ならマップ移動の入口ではない。
   * どれへ行くかはイベント JSON の `mapMoves` で `moveObject` を引いて決める。
   */
  mapMoves: string[];
  /** MAPMOVE レイヤーの中の物の id（`mapMoves[].object` と突き合わせる）。入口でなければ空。 */
  moveObject: string;
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
  /**
   * ブロックそのものを調べる枠にしたとき（GS-175）の**そのマス**。
   * オブジェクトの枠は床に描くので高さを持たないが、ブロックは高さまで決まっている——
   * 宝箱の開け閉め（マスの絵の差し替え）は、この `y` が無いと当てる先が分からない。
   */
  cell?: { x: number; y: number; z: number };
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
/** 行き先マップを書くプロパティ名。値は `0201,0106` のようにカンマ区切り（GS-211）。 */
const MAP_MOVE_PROPERTY = 'MapMove';
/**
 * マップ移動の入口を置くレイヤー名（GS-211）。**ここ（と、その下のレイヤー）の物だけが入口**。
 * イベントエディタも同じ決まりで入口を並べる。外に `MapMove` を書いても動かない。
 */
export const MAP_MOVE_LAYER = 'mapmove';

/** そのレイヤーが MAPMOVE か、MAPMOVE グループの下にあるか。 */
function inMapMoveLayer(map: MapDef, layer: MapDef['layers'][number]): boolean {
  const byId = new Map(map.layers.map((one) => [one.id, one]));
  const seen = new Set<string>();
  for (let at: MapDef['layers'][number] | undefined = layer; at && !seen.has(at.id); at = byId.get(at.parent ?? '')) {
    seen.add(at.id);
    if ((at.name ?? '').trim().toLowerCase() === MAP_MOVE_LAYER) return true;
  }
  return false;
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

/**
 * タイルレイヤーのマスを調べる枠にする（GS-175）。`Event` が無ければ何もしない。
 *
 * **1 マスにつき 1 枠**にする。まとめて外接四角にすると、離れて置いた同じレイヤーの
 * ブロックの**あいだの空きマス**まで枠になってしまう。
 * **踏む起動にはしない**（`examine`）——ブロックは当たりを持つので、そもそも上に立てない。
 */
function pushCellSpots(spots: EventSpot[], layer: MapDef['layers'][number], index: number): void {
  const event = textOf(layer.properties, EVENT_PROPERTY);
  const owner = textOf(layer.properties, ID_PROPERTY);
  // **`Id` だけでも枠になる**（GS-178）。宝箱は台帳が動きを決めるので、
  // マップに `Event` を書かなくてよい——書かせると「台帳とマップのどちらが正か」が毎回問題になる。
  // 宝箱でない物に `Id` だけ付けたときは、空の枠ができて**何も起きない**（動くイベントが無い）。
  if (!event && !owner) return;
  const item = textOf(layer.properties, ITEM_PROPERTY);
  const num = numberOf(layer.properties, NUM_PROPERTY);
  const name = (layer.name ?? '').trim();
  for (const batch of layer.batches ?? []) {
    const cells = decodeCells(batch);
    for (let i = 0; i + 2 < cells.length; i += 3) {
      const x = cells[i];
      const y = cells[i + 1];
      const z = cells[i + 2];
      spots.push({
        objectId: `${index}/cell:${x},${y},${z}`,
        name,
        event,
        mapMoves: [],
        moveObject: '',
        examine: true,
        item,
        owner,
        ...(num !== undefined ? { num: Math.max(0, Math.trunc(num)) } : {}),
        cell: { x, y, z },
        x0: x,
        x1: x + 1,
        z0: z,
        z1: z + 1,
      });
    }
  }
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
    // ブロックそのものを調べる枠にする（GS-175）。**レイヤーに `Event` を書く。**
    // マスには名前が持てないので、どの宝箱かは**レイヤーが持つ**——プレハブを置いた
    // レイヤーへ `Event` と `Id` を足せば、起動用のオブジェクトを別に置かなくてよい。
    if (layer.kind === 'tile') {
      pushCellSpots(spots, layer, index);
      continue;
    }
    if (layer.kind !== 'object') continue;
    const layerName = (layer.name ?? '').trim().toLowerCase();
    const eventLayer = layerName === EVENT_LAYER;
    const clickLayer = layerName === CLICK_LAYER;
    const moveLayer = inMapMoveLayer(map, layer);
    for (const object of layer.objects ?? []) {
      if ((object.plane ?? 'xz') !== 'xz') continue;
      if (textOf(object.properties, NPC_PROPERTY)) continue;
      // `Event` が在ればそれ。無ければ **EVENT レイヤーの名前**（GS-19）。
      const event =
        textOf(object.properties, EVENT_PROPERTY) || (eventLayer || clickLayer ? object.name.trim() : '');
      // 点は入口にしない（着地の目印。`default` も MAPMOVE に置く）。
      const mapMoves =
        moveLayer && object.kind !== 'point' ? parseMapMoves(textOf(object.properties, MAP_MOVE_PROPERTY)) : [];
      if (!event && !mapMoves.length) continue;
      const box = footprint(object);
      if (!box) continue;
      spots.push({
        // レイヤー番号を頭に付ける。**別のレイヤーの `obj_1` と同じ物に見えてしまう**——
        // 実測: 家のオープニング（EVENT レイヤーの `obj_1`）を見た直後、
        // 入口（MAPMOVE レイヤーの `obj_1`）を踏んでも外へ出られなかった。
        objectId: `${index}/${object.id}`,
        name: object.name.trim(),
        event,
        mapMoves,
        moveObject: mapMoves.length ? object.id : '',
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
    // `Id` だけの枠も拾う（GS-178）。宝箱は台帳が動きを決めるので、マップに `Event` が無い。
    if (!spot.examine || (!spot.event && !spot.owner)) continue;
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
