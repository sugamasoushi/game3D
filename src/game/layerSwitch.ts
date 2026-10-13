// イベントで出し入れするレイヤー（GS-233。命令「レイヤーの出し入れ」= `layer`）。
//
// **レイヤーはプロパティ `Id` で指す**（レイヤーの id やレイヤー名ではない。プレハブを置くたびに
// 同じ名前が並ぶので）。`Id` はプレハブ（入れ物）に付けても、中のタイルレイヤーに付けてもよい——
// 入れ物に付けたら中身ごと出し入れする。
//
// - 最初の形: `StartHidden`（真偽）を付けたレイヤーは隠して始める（親に付けても効く）。
// - 出し入れした形は**セーブに残る**。覚えは `<マップ>/#<Id>/出す`（`state.self` に同居。
//   物の覚え `@<Id>` とは頭の字で分ける）。
// - **見た目だけ**。当たりは変えない（閉じた宝箱の当たりは開けても残る。今までと同じ）。
//
// 以前の `Opened`（宝箱の開いた形。GS-179）は、覚え `self:開けた` に連動して自動で入れ替えていた。
// それをやめ、イベントが明示的に出し入れする形にした（何が起きるかがイベントに全部書いてある）。

import type { LayerDef, MapDef, PropertyDef } from '../mep3d/types';
import { selfKey } from './state';

/** レイヤーのプロパティ名。エディタの「＋」から選ぶものと同じ綴り。 */
export const LAYER_ID_PROPERTY = 'Id';
export const START_HIDDEN_PROPERTY = 'StartHidden';
/** 出し入れの覚えの名前。 */
export const LAYER_SHOWN = '出す';

/** 出し入れの覚えのキー。 */
export function layerKey(map: string, id: string): string {
  return selfKey(map, `#${id}`, LAYER_SHOWN);
}

function textOf(list: PropertyDef[] | undefined, name: string): string {
  const hit = list?.find((entry) => entry.name === name);
  return hit === undefined || hit.value === undefined || hit.value === null ? '' : String(hit.value).trim();
}

function boolOf(list: PropertyDef[] | undefined, name: string): boolean {
  const hit = list?.find((entry) => entry.name === name);
  return hit !== undefined && (hit.value === true || String(hit.value).trim() === 'true');
}

/** 出し入れするタイルレイヤー 1 枚。 */
export interface SwitchLayer {
  /** タイルレイヤーの id。 */
  layer: string;
  /** 効く `Id`。**近い方から**（自分 → 親 → …）。覚えは最初に見つかったものを使う。 */
  ids: string[];
  /** 最初は隠すか（自分か親のどれかに `StartHidden`）。 */
  startHidden: boolean;
}

/** 親をたどって並べる（自分から）。輪になっていても止まる。 */
function chain(map: MapDef, layer: LayerDef): LayerDef[] {
  const byId = new Map(map.layers.map((one) => [one.id, one]));
  const out: LayerDef[] = [];
  const seen = new Set<string>();
  for (let at: LayerDef | undefined = layer; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
    seen.add(at.id);
    out.push(at);
  }
  return out;
}

/**
 * マップの中の、出し入れするタイルレイヤー（自分か親に `Id` か `StartHidden` があるもの）。
 * 描くのはタイルレイヤーなので、入れ物は中身へ割り振る。
 */
export function readSwitchLayers(map: MapDef): SwitchLayer[] {
  const out: SwitchLayer[] = [];
  for (const layer of map.layers) {
    if ((layer.kind ?? 'tile') !== 'tile') continue;
    const line = chain(map, layer);
    const ids = line.map((one) => textOf(one.properties, LAYER_ID_PROPERTY)).filter(Boolean);
    const startHidden = line.some((one) => boolOf(one.properties, START_HIDDEN_PROPERTY));
    if (ids.length || startHidden) out.push({ layer: layer.id, ids, startHidden });
  }
  return out;
}

/** その `Id` で指せるタイルレイヤー（中身まで）。 */
export function layersOfId(map: MapDef, id: string): string[] {
  return readSwitchLayers(map)
    .filter((one) => one.ids.includes(id))
    .map((one) => one.layer);
}

/**
 * そのレイヤーを出すか。覚え（近い `Id` から）があればそれ、無ければ最初の形。
 * `shownOf` は覚えを引く口（無ければ undefined）。
 */
export function switchLayerShown(layer: SwitchLayer, shownOf: (id: string) => boolean | undefined): boolean {
  for (const id of layer.ids) {
    const value = shownOf(id);
    if (value !== undefined) return value;
  }
  return !layer.startHidden;
}

/**
 * 描く用のマップ。**`StartHidden` のレイヤーはエディタで目を閉じていても組む**（親の入れ物も）。
 * 重ねて置くとエディタでは見づらいので、隠して始める形の目を閉じて作業してよいようにする——
 * 組まなければ、出しても何も出ない。出すかどうかは組んだあとで決める。
 */
export function withStartHiddenBuilt(map: MapDef): MapDef {
  const wake = new Set<string>();
  for (const layer of map.layers) {
    if ((layer.kind ?? 'tile') !== 'tile') continue;
    const line = chain(map, layer);
    if (!line.some((one) => boolOf(one.properties, START_HIDDEN_PROPERTY))) continue;
    for (const one of line) if (one.visible === false) wake.add(one.id);
  }
  if (!wake.size) return map;
  return { ...map, layers: map.layers.map((layer) => (wake.has(layer.id) ? { ...layer, visible: true } : layer)) };
}
