// 開けたら入れ替わる見た目（GS-179）。宝箱の「閉じた形」と「開いた形」。
//
// **見た目はマップエディタで両方置いておく。** 同じマスに 2 つのプレハブを重ね、
// どちらのレイヤーにも同じ `Id` を書く。開いた形のレイヤーにだけ **`Opened`**（真偽）を付ける
// ——プレハブ「宝箱(開)」がレイヤーのプロパティとして持っているので、置けば付く。
//
// ゲームは**その物の覚え `self:開けた`** を見て、
//   開けていない … `Opened` の無いレイヤーを出し、`Opened` のレイヤーを隠す
//   開けた       … その逆
// にする。絵を書き換えるのではなく**出し入れ**なので、2 つの形も絵柄も違ってよい
// （箱 ⇔ ビルボードでもよい）。以前の「プレハブを読んで絵を書き換える」（GS-176）は
// 同じ形・同じタイルセットでしか使えず、ゲームがプレハブのファイルを読む必要もあった。
//
// **`Opened` のレイヤーが 1 枚も無い物は触らない**——閉じた形しか置いていない宝箱を
// 開けたとたんに消してしまわないように。

import type { LayerDef, MapDef, PropertyDef } from '../mep3d/types';
import { CHEST_OPENED } from './chests';

/** レイヤーのプロパティ名。エディタの「＋」から選ぶものと同じ綴り。 */
export const OPENED_PROPERTY = 'Opened';
const ID_PROPERTY = 'Id';

/** 出し入れするレイヤー 1 枚。 */
export interface OpenedLayer {
  /** レイヤーの id（名前ではない。プレハブを置くたびに同じ名前が並ぶ）。 */
  id: string;
  /** 物の名前（`Id`）。覚え `self:開けた` の行き先。 */
  owner: string;
  /** 開けたあとの形なら true。 */
  opened: boolean;
}

function textOf(list: PropertyDef[] | undefined, name: string): string {
  const hit = list?.find((entry) => entry.name === name);
  return hit === undefined || hit.value === undefined || hit.value === null ? '' : String(hit.value).trim();
}

function isOpened(list: PropertyDef[] | undefined): boolean {
  const hit = list?.find((entry) => entry.name === OPENED_PROPERTY);
  return hit !== undefined && (hit.value === true || String(hit.value).trim() === 'true');
}

/** マスを並べたレイヤーか（入れ物・オブジェクト・3D・光は除く）。 */
function isShapeLayer(layer: LayerDef): boolean {
  return (layer.kind ?? 'tile') === 'tile';
}

/**
 * マップの中の、出し入れするレイヤー。**`Opened` のレイヤーを持つ `Id` だけ**を返す
 * （閉じた形だけの物は入れない）。
 */
export function readOpenedLayers(map: MapDef): OpenedLayer[] {
  const all: OpenedLayer[] = [];
  for (const layer of map.layers) {
    if (!isShapeLayer(layer)) continue;
    const owner = textOf(layer.properties, ID_PROPERTY);
    if (!owner) continue;
    all.push({ id: layer.id, owner, opened: isOpened(layer.properties) });
  }
  const swapping = new Set(all.filter((one) => one.opened).map((one) => one.owner));
  return all.filter((one) => swapping.has(one.owner));
}

/** そのレイヤーを出すか。 */
export function openedLayerShown(layer: OpenedLayer, switchOn: (key: string, owner: string) => boolean): boolean {
  return layer.opened === switchOn(`self:${CHEST_OPENED}`, layer.owner);
}

/**
 * 描く用のマップ。**`Opened` のレイヤーはエディタで目を閉じていても組む**（親の入れ物も）。
 * 重ねて置くとエディタでは見づらいので、開いた形の目を閉じて作業してよいようにする——
 * 組まなければ、開けても何も出ない。出すかどうかは組んだあとで決める。
 */
export function withOpenedLayersBuilt(map: MapDef): MapDef {
  const byId = new Map(map.layers.map((layer) => [layer.id, layer]));
  const wake = new Set<string>();
  for (const layer of map.layers) {
    if (!isShapeLayer(layer) || !isOpened(layer.properties)) continue;
    let current: LayerDef | undefined = layer;
    let guard = 0;
    while (current && guard <= map.layers.length) {
      if (current.visible === false) wake.add(current.id);
      current = current.parent ? byId.get(current.parent) : undefined;
      guard += 1;
    }
  }
  if (!wake.size) return map;
  return { ...map, layers: map.layers.map((layer) => (wake.has(layer.id) ? { ...layer, visible: true } : layer)) };
}
