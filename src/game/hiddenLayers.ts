// ゲームでは描かないレイヤー（GS-57）。**当たりは残す。**
//
// 使いどころは「絵としては要らないが、通れない／足場にはしたい」形。
// たとえば見えない壁、木の根元だけの当たり、崖の縁の柵。
// エディタの目（`visible`）を閉じるのとは**別物**——あちらは当たりごと消える
// （`buildCollision` が見えないレイヤーを飛ばす）ので、隠すと通れてしまう。
//
// **やり方は「描く前にレイヤーを外す」だけ。** 描画側（`src/mep3d/`）には手を入れない——
// あそこは 3 プロジェクトで同じ物を保つ写しで、しかも面の隠し合い・影・光の遮りが
// レイヤーをまたいで絡んでいる。途中で 1 か所だけ飛ばすと、
// **隣のレイヤーの面が欠ける**ような直しにくい穴が開く。
// 最初から居ないことにすれば、そういう絡みがそもそも起きない。

import type { LayerDef, MapDef, PropertyDef } from '../mep3d/types';

/** レイヤーのプロパティ名。エディタの「＋」から選ぶものと同じ綴り。 */
export const HIDDEN_PROPERTY = 'Hidden';

function boolProperty(list: PropertyDef[] | undefined, name: string): boolean {
  const hit = list?.find((entry) => entry.name === name);
  return hit?.type === 'boolean' && hit.value === true;
}

/**
 * そのレイヤーをゲームで描かないか。**親をたどる**——
 * グループやプレハブに付けたら、中身も全部描かない。
 */
export function layerHiddenInGame(layers: LayerDef[], layer: LayerDef): boolean {
  const byId = new Map(layers.map((entry) => [entry.id, entry]));
  let current: LayerDef | undefined = layer;
  let guard = 0;
  while (current && guard <= layers.length) {
    if (boolProperty(current.properties, HIDDEN_PROPERTY)) return true;
    current = current.parent ? byId.get(current.parent) : undefined;
    guard += 1;
  }
  return false;
}

/**
 * 描く用のマップ。`Hidden` のレイヤーを抜いた**浅い写し**を返す。
 * 1 枚も無ければ元をそのまま返す——写しを作らないぶん、ふだんの読み込みは変わらない。
 *
 * **当たりには使わないこと。** `buildCollision` には元のマップを渡す。
 */
export function withoutHiddenLayers(map: MapDef): MapDef {
  const kept = map.layers.filter((layer) => !layerHiddenInGame(map.layers, layer));
  if (kept.length === map.layers.length) return map;
  return { ...map, layers: kept };
}
