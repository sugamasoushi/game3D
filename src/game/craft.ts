// 道具から道具を作る（2026-11-03）。**作り方は作られる側の持ち物に書く**（`items.json` の `craft`）。
//
//   "fine_herb": { "name": "上やくそう", ..., "craft": { "from": [{ "item": "herb", "count": 3 }] } }
//
// メニューの「アイテム」で材料の 1 つを選んで「つくる」と、その物を材料にする作り方が並ぶ。
// 材料をそろえて持っていれば作れる（材料を減らして 1 個増える）。
// ここは台帳とセーブの入れ物だけを受け取る**決まりだけ**の所（画面も音も知らない）。

import type { ItemDef } from './items';

/** 材料 1 つぶん。`count` を書かなければ 1 個。 */
export interface CraftPart {
  item: string;
  count?: number;
}

/** 作り方。`from` の材料を全部そろえて持っていれば作れる。 */
export interface ItemCraft {
  from: CraftPart[];
}

/** 材料の数。書いていない・おかしな数は 1。 */
const partCount = (part: CraftPart): number => {
  const count = Math.trunc(Number(part.count ?? 1));
  return Number.isFinite(count) && count >= 1 ? count : 1;
};

/**
 * 要る材料（id → 数）。同じ材料を 2 行に書いても足し合わせる。
 * 作り方が無い・材料が 1 つも無い物は空（作れない）。
 */
export function craftNeeds(def: ItemDef | undefined): Map<string, number> {
  const needs = new Map<string, number>();
  for (const part of def?.craft?.from ?? []) {
    if (!part || typeof part.item !== 'string' || !part.item) continue;
    needs.set(part.item, (needs.get(part.item) ?? 0) + partCount(part));
  }
  return needs;
}

/** `material` を材料にする物（作られる側の id）。台帳の並び順。 */
export function craftsUsing(book: Record<string, ItemDef>, material: string): string[] {
  return Object.entries(book)
    .filter(([, def]) => craftNeeds(def).has(material))
    .map(([id]) => id);
}

/** 持ち物（id → 数）で作れるか。 */
export function canCraft(items: Map<string, number>, def: ItemDef | undefined): boolean {
  const needs = craftNeeds(def);
  if (needs.size === 0) return false;
  for (const [id, count] of needs) if ((items.get(id) ?? 0) < count) return false;
  return true;
}

/**
 * 作る。材料を減らして `result` を 1 個増やす。**足りなければ何も動かさない**（false）。
 * 数が 0 になった材料は持ち物から消す（`spendItem` と同じ）。
 */
export function craftInto(items: Map<string, number>, result: string, def: ItemDef | undefined): boolean {
  if (!canCraft(items, def)) return false;
  for (const [id, count] of craftNeeds(def)) {
    const next = (items.get(id) ?? 0) - count;
    if (next > 0) items.set(id, next);
    else items.delete(id);
  }
  items.set(result, (items.get(result) ?? 0) + 1);
  return true;
}
