// マップに入るたびに戻る宝箱（GS-180）。**セーブに残らない宝箱**。
//
// 台帳（`chests.json`）に `respawn: true` と書いた宝箱は、
//   - **開けた覚えがマップに入るたびに消える**——出て戻ればまた閉じて、中身が入っている。
//     中身は開けるときに引く（`drawChest`）ので、`random` を書けば毎回引き直しになる。
//   - `chance`（0〜1）を書くと、**入るたびにその確率で出る**。出なければ見た目も当たりも調べる枠も無い。
//   - **同じ `Id` を何か所にも置くと、入るたびにどこか 1 か所にだけ出る**（置く場所の抽選）。
//     場所は「重なったレイヤーの組」で数える——閉じた形と開いた形を重ねた 1 組が 1 か所。
//
// **決めるのはマップを組む前**（`GameView` の `prepareMap`）。組んだ後に隠すと、
// 出なかった宝箱の当たりが見えない壁として残る。出なかった宝箱のレイヤーは**居ないことにして**組む。
//
// 覚えの消し方: 覚えはふつうのセルフスイッチ（`<マップ>/@<Id>/開けた`）のまま置き、
// 入るたびに `respawn` の宝箱の分だけ消す。セーブの形を変えずに済む
// （マップの中でセーブすると開けた覚えも入るが、読み込むとマップに入り直すので消える）。

import { decodeCells } from '../mep3d/decode';
import type { MapDef } from '../mep3d/types';
import type { ChestDef } from './chests';

const ID_PROPERTY = 'Id';

/** 置き場所 1 か所（重なったレイヤーの組）。 */
export interface ChestSpot {
  owner: string;
  /** その場所のレイヤー（閉じた形・開いた形）。 */
  layers: string[];
}

/** 入ったときに決めたこと。 */
export interface ChestVisit {
  /** 組まない（居ないことにする）レイヤー。 */
  removed: Set<string>;
  /** 出なかった宝箱（確率で外れた）。 */
  absent: Set<string>;
}

function textOf(list: MapDef['layers'][number]['properties'], name: string): string {
  const hit = list?.find((entry) => entry.name === name);
  return hit === undefined || hit.value === undefined || hit.value === null ? '' : String(hit.value).trim();
}

/**
 * 宝箱の置き場所を数える。`Id` を持つタイルレイヤーを、**マスが重なるものどうし**で組にする
 * （閉じた形と開いた形は同じマスに重ねるので 1 組になる。離れて置いた 2 つ目は別の組）。
 */
export function readChestSpots(map: MapDef): ChestSpot[] {
  const byOwner = new Map<string, Array<{ id: string; cells: Set<string> }>>();
  for (const layer of map.layers) {
    if ((layer.kind ?? 'tile') !== 'tile') continue;
    const owner = textOf(layer.properties, ID_PROPERTY);
    if (!owner) continue;
    const cells = new Set<string>();
    for (const batch of layer.batches ?? []) {
      const list = decodeCells(batch);
      for (let i = 0; i + 2 < list.length; i += 3) cells.add(`${list[i]},${list[i + 1]},${list[i + 2]}`);
    }
    const list = byOwner.get(owner) ?? [];
    list.push({ id: layer.id, cells });
    byOwner.set(owner, list);
  }
  const spots: ChestSpot[] = [];
  for (const [owner, layers] of byOwner) {
    // 重なりで繋がったものを 1 組に（小さな数なので素朴に回す）。
    const groups: Array<{ layers: string[]; cells: Set<string> }> = [];
    for (const layer of layers) {
      const touching = groups.filter((group) => [...layer.cells].some((cell) => group.cells.has(cell)));
      const merged = { layers: [layer.id], cells: new Set(layer.cells) };
      for (const group of touching) {
        merged.layers.unshift(...group.layers);
        for (const cell of group.cells) merged.cells.add(cell);
        groups.splice(groups.indexOf(group), 1);
      }
      groups.push(merged);
    }
    for (const group of groups) spots.push({ owner, layers: group.layers });
  }
  return spots;
}

/**
 * 入ったときの抽選。`respawn` の宝箱だけを見る——セーブに残る宝箱は、置いたとおりに全部出す。
 * `random` は `Math.random` の差し替え口（テスト用）。
 */
export function rollChestVisit(
  map: MapDef,
  chestOf: (id: string) => ChestDef | null,
  random: () => number = Math.random,
): ChestVisit {
  const removed = new Set<string>();
  const absent = new Set<string>();
  const byOwner = new Map<string, ChestSpot[]>();
  for (const spot of readChestSpots(map)) {
    const list = byOwner.get(spot.owner) ?? [];
    list.push(spot);
    byOwner.set(spot.owner, list);
  }
  for (const [owner, spots] of byOwner) {
    const def = chestOf(owner);
    if (!def?.respawn) continue;
    const chance = typeof def.chance === 'number' ? Math.max(0, Math.min(1, def.chance)) : 1;
    const shows = random() < chance;
    const chosen = shows ? Math.min(spots.length - 1, Math.floor(random() * spots.length)) : -1;
    if (!shows) absent.add(owner);
    spots.forEach((spot, index) => {
      if (index !== chosen) for (const id of spot.layers) removed.add(id);
    });
  }
  return { removed, absent };
}

/** 抽選の結果どおりに、組まないレイヤーを抜いたマップ。抜く物が無ければ元のまま。 */
export function applyChestVisit(map: MapDef, visit: ChestVisit): MapDef {
  if (!visit.removed.size) return map;
  return { ...map, layers: map.layers.filter((layer) => !visit.removed.has(layer.id)) };
}

/**
 * マップに入るたびに戻る宝箱の覚えを消す。覚えのキーは `<マップ>/@<Id>/<名前>`（`selfKey`）。
 * **どのマップの分も消す**——前に居たマップの覚えも、戻ったときには消えているべきなので。
 */
export function forgetRespawnChests(self: Map<string, boolean>, chestOf: (id: string) => ChestDef | null): number {
  let count = 0;
  for (const key of [...self.keys()]) {
    const owner = /^[^/]*\/@([^/]+)\//.exec(key)?.[1];
    if (owner && chestOf(owner)?.respawn) {
      self.delete(key);
      count += 1;
    }
  }
  return count;
}
