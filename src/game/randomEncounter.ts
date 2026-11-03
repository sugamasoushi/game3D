// ランダムエンカウント（GS-299）。マップの **RANDOM_ENCOUNT レイヤー**に置いた枠の中を歩くと、
// ときどき敵と出会う。
//
// - **どこで**: マップエディタで RANDOM_ENCOUNT という名前のオブジェクトレイヤーを作り、床向き（XZ）の
//   四角・多角形・円・ブロックを置く。点は枠にしない。レイヤー名は大文字・小文字を問わない（EVENT などと同じ）。
// - **どの敵と・どれくらいで**: マップの台帳（`maps.json`）のそのマップの `encounter`。台帳エディタの「マップ構成」で書く。
//   行（出る敵 1 体＋お供）を出やすさ（`weight`）の重みでくじ引きし、お供は敵シンボルと同じく 1 行ずつ抽選する。
//   間隔は `steps`（マス）。`encounter` が無い・行が無いマップでは、枠があっても出会わない。
// - 数え方は毒（GS-71）と同じ**歩いた距離**。毎回 `steps` の 0.5〜1.5 倍でばらつかせる。
//   枠の外では数えない（貯めたぶんは残る）。

import type { MapDef, MapObjectDef } from '../mep3d/types';
import { rollCompanions, type CompanionDef } from './mapNpcs';

/** 枠を置くレイヤーの名前（小文字で比べる）。 */
export const ENCOUNTER_LAYER = 'random_encount';
/** `steps` を書かなかったときの間隔（マス）。 */
export const ENCOUNTER_STEPS_DEFAULT = 20;
/** 台帳に書ける値の範囲（台帳エディタの `validate.mjs` と Game Checker の `values.ts` が同じ値を使う）。 */
export const ENCOUNTER_LIMITS = { steps: { min: 3, max: 999 }, weight: { min: 1, max: 100 } } as const;

/** マップの台帳の `encounter`（GS-299）。 */
export interface EncounterDef {
  /** 出会うまでに歩く距離（マス）の目安。毎回 0.5〜1.5 倍でばらつく。書かなければ `ENCOUNTER_STEPS_DEFAULT`。 */
  steps?: number;
  /** 出る敵の行。1 回の遭遇で 1 行を選ぶ。 */
  enemies: EncounterRow[];
}

/** 出る敵の 1 行。 */
export interface EncounterRow {
  /** 敵の台帳（`enemies.json`）のキー。先頭に立つ敵。 */
  enemy: string;
  /** 出やすさ（ほかの行との比。1 以上の整数）。書かなければ 1。 */
  weight?: number;
  /** お供（敵シンボルの `companions` と同じ）。1 行ずつ抽選して後ろに並ぶ。 */
  companions?: CompanionDef[];
}

/** これ以上の移動は「歩いた」ではない（マス）。マップ移動やイベントの場所替え。毒と同じ。 */
const JUMP = 3;

/** 出会う枠 1 つ。座標はマス。 */
export type EncounterArea =
  | { shape: 'box'; x0: number; x1: number; z0: number; z1: number }
  | { shape: 'ellipse'; cx: number; cz: number; rx: number; rz: number }
  | { shape: 'polygon'; points: [number, number][] }
  | { shape: 'cells'; cells: Set<string> };

function areaOf(object: MapObjectDef): EncounterArea | null {
  if ((object.plane ?? 'xz') !== 'xz') return null;
  if (object.cells?.length) {
    return { shape: 'cells', cells: new Set(object.cells.map(([x, , z]) => `${x},${z}`)) };
  }
  const points = object.points ?? [];
  if (object.kind === 'point' || points.length === 0) return null;
  if (object.kind === 'polygon' && points.length >= 3) {
    return { shape: 'polygon', points: points.map(([x, z]) => [x, z] as [number, number]) };
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
  if (!(x1 > x0 && z1 > z0)) return null;
  if (object.kind === 'circle' || object.kind === 'sphere' || object.kind === 'ellipsoid') {
    return { shape: 'ellipse', cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2, rz: (z1 - z0) / 2 };
  }
  return { shape: 'box', x0, x1, z0, z1 };
}

/** マップから出会う枠を集める。RANDOM_ENCOUNT レイヤーの床向きの物だけ。 */
export function readEncounterAreas(map: Pick<MapDef, 'layers'>): EncounterArea[] {
  const areas: EncounterArea[] = [];
  for (const layer of map.layers) {
    if (layer.kind !== 'object') continue;
    if ((layer.name ?? '').trim().toLowerCase() !== ENCOUNTER_LAYER) continue;
    for (const object of layer.objects ?? []) {
      const area = areaOf(object);
      if (area) areas.push(area);
    }
  }
  return areas;
}

function inside(area: EncounterArea, x: number, z: number): boolean {
  switch (area.shape) {
    case 'box':
      return x >= area.x0 && x <= area.x1 && z >= area.z0 && z <= area.z1;
    case 'ellipse': {
      const dx = (x - area.cx) / area.rx;
      const dz = (z - area.cz) / area.rz;
      return dx * dx + dz * dz <= 1;
    }
    case 'cells':
      return area.cells.has(`${Math.floor(x)},${Math.floor(z)}`);
    case 'polygon': {
      let hit = false;
      const list = area.points;
      for (let i = 0, j = list.length - 1; i < list.length; j = i++) {
        const [xi, zi] = list[i];
        const [xj, zj] = list[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
      }
      return hit;
    }
  }
}

/** 立っている場所の枠（体の中心で見る）。重なっていれば先に置いた物。無ければ null。 */
export function encounterAreaAt(areas: EncounterArea[], at: { x: number; z: number }): EncounterArea | null {
  return areas.find((area) => inside(area, at.x, at.z)) ?? null;
}

/** 行の出やすさ。書いていない・おかしな値は 1。 */
const weightOf = (row: EncounterRow) => (Number.isFinite(row.weight) && (row.weight as number) > 0 ? (row.weight as number) : 1);

/** 出会う敵を選ぶ。出やすさの重みで 1 行選び、先頭がその敵、続けてお供。行が無ければ空。 */
export function rollEncounter(rows: EncounterRow[] | undefined, random: () => number = Math.random): string[] {
  const list = (rows ?? []).filter((row) => row.enemy);
  if (list.length === 0) return [];
  const total = list.reduce((sum, row) => sum + weightOf(row), 0);
  let pick = random() * total;
  let row = list[list.length - 1];
  for (const one of list) {
    pick -= weightOf(one);
    if (pick < 0) {
      row = one;
      break;
    }
  }
  return [row.enemy, ...rollCompanions(row.companions, random)];
}

/** 間隔（マス）。書いていない・おかしな値は既定。 */
export function encounterSteps(def: EncounterDef | undefined): number {
  const steps = def?.steps;
  return typeof steps === 'number' && Number.isFinite(steps) && steps > 0 ? steps : ENCOUNTER_STEPS_DEFAULT;
}

/**
 * 歩いた距離を数えて、頃合いなら「出会った」と返す道具。
 * 枠の中を歩いたぶんだけ減らし、0 になったら true を返して数え直す。
 */
export function createEncounterCounter(random: () => number = Math.random) {
  let left: number | null = null;
  let last: { x: number; z: number } | null = null;
  const span = (steps: number) => steps * (0.5 + random());

  return {
    /** 数え直す（マップを移った・戦った後）。 */
    reset() {
      left = null;
      last = null;
    },
    /**
     * いまの場所と、枠の中に居るか・間隔（マス）を渡す。出会ったら true。
     * `counting` が false のときは**場所だけ覚えて数えない**（会話中・戦闘中・メニュー）。
     */
    at(now: { x: number; z: number }, inArea: boolean, steps: number, counting: boolean): boolean {
      const before = last;
      last = { x: now.x, z: now.z };
      if (!counting || !before || !inArea) return false;
      const moved = Math.hypot(now.x - before.x, now.z - before.z);
      if (moved >= JUMP || moved <= 0) return false;
      const rest = (left ?? span(steps)) - moved;
      if (rest > 0) {
        left = rest;
        return false;
      }
      left = null;
      return true;
    },
  };
}
