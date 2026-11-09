// 図鑑（2026-11-04）。**手に入れた持ち物**と**出会った・倒した魔物**を覚え、メニュー「図鑑」の中身を揃える。
// ここは台帳とセーブの入れ物だけを受け取る**決まりだけ**の所（画面も音も知らない）。
//
// 記録は 2 つ（セーブ版 10）。
//   `found`  手に入れたことのある持ち物の id。**袋（`ItemBag`）に 1 個以上入った時に自分で付く**——
//            宝箱・店・イベント・作る・依頼の受け渡しと入口が多いので、入口ごとに書くと付け忘れる。
//   `foes`   魔物の id → `{ met: 出会った数, beaten: 倒した数 }`。戦闘の始まりと勝ち（フィールドで倒したときも）で数える。
//
// 見せ方。
//   持ち物: 手に入れた物は名前・説明・作り方、まだの物は「？？？」。作り方の材料も、まだの物は「？？？」。
//   魔物:   出会った物は絵・名前・説明。1 体でも倒したら能力・取り分・倒した数も出す。まだの物は「？？？」。
//   台帳で `codex: false` の物は載せない（試し用の物など）。

import type { ItemDef } from './items';
import { craftNeeds } from './craft';

/**
 * 持ち物の袋。**1 個以上入れた id を `found` に足す**ほかは素の Map と同じ。
 * `found` はセーブの側が持つ集まりを握る（袋を作り直しても記録は残る）。
 */
export class ItemBag extends Map<string, number> {
  constructor(readonly found: Set<string>, entries?: Iterable<readonly [string, number]>) {
    // Map の constructor は this.set を呼ぶが、その時はまだ found が無い。中身は後から入れる。
    super();
    for (const [id, count] of entries ?? []) this.set(id, count);
  }

  override set(id: string, count: number): this {
    if (count > 0 && this.found) this.found.add(id);
    return super.set(id, count);
  }
}

/** 魔物 1 種類ぶんの記録。 */
export interface FoeRecord {
  met: number;
  beaten: number;
}

/** 出会った（戦闘が始まった）。並んだ数だけ数える。 */
export function noteFoesMet(state: { foes: Map<string, FoeRecord> }, enemies: readonly string[]): void {
  for (const id of enemies) {
    if (!id) continue;
    const now = state.foes.get(id) ?? { met: 0, beaten: 0 };
    state.foes.set(id, { ...now, met: now.met + 1 });
  }
}

/** 倒した。**倒したなら出会ってもいる**——フィールドで倒したときは戦闘が始まらないので、出会った数も足りなければ揃える。 */
export function noteFoesBeaten(state: { foes: Map<string, FoeRecord> }, enemies: readonly string[]): void {
  for (const id of enemies) {
    if (!id) continue;
    const now = state.foes.get(id) ?? { met: 0, beaten: 0 };
    const beaten = now.beaten + 1;
    state.foes.set(id, { met: Math.max(now.met, beaten), beaten });
  }
}

/** セーブから読んだ魔物の記録。おかしな値は 0、両方 0 の物は持たない。 */
export function readFoes(data: Record<string, Partial<FoeRecord>> | undefined): Map<string, FoeRecord> {
  const count = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);
  const foes = new Map<string, FoeRecord>();
  for (const [id, one] of Object.entries(data ?? {})) {
    const beaten = count(one?.beaten);
    const met = Math.max(count(one?.met), beaten);
    if (met > 0) foes.set(id, { met, beaten });
  }
  return foes;
}

/** 図鑑に載せるか。`codex: false` だけ外す。 */
export function inCodex(def: { codex?: boolean } | undefined): boolean {
  return def?.codex !== false;
}

/** 持ち物の図鑑の種類。メニューの「アイテム」の分け方と同じ（使える物＝道具、身に着ける物＝武具、どちらでもない物＝大事な物）。 */
export type CodexItemKind = '道具' | '武具' | '大事な物';

export function codexItemKind(def: ItemDef | undefined): CodexItemKind {
  return def?.use ? '道具' : def?.equip ? '武具' : '大事な物';
}

/** 作り方の材料 1 つぶん。まだ手に入れていない材料は名前を伏せる。 */
export interface CodexPart {
  id: string;
  count: number;
  known: boolean;
}

/** 持ち物の図鑑の 1 行。 */
export interface CodexItem {
  id: string;
  /** 台帳の並びでの番号（1 から。載せない物は数えない）。 */
  no: number;
  kind: CodexItemKind;
  /** 手に入れたことがあるか。false なら名前も説明も出さない。 */
  known: boolean;
  /** 作り方。作れない物は空。 */
  parts: CodexPart[];
}

/**
 * 持ち物の図鑑。**台帳の並び順**に、載せる物を全部並べる。
 * 手に入れたか（`found`）に加え、**いま身に着けている物**も手に入れた扱い（はじめから着ている物は袋を通らない）。
 */
export function codexItems(items: Record<string, ItemDef>, found: ReadonlySet<string>, equipped: Iterable<string> = []): CodexItem[] {
  const have = new Set([...found, ...equipped]);
  return Object.entries(items)
    .filter(([, def]) => inCodex(def))
    .map(([id, def], at) => ({
      id,
      no: at + 1,
      kind: codexItemKind(def),
      known: have.has(id),
      parts: [...craftNeeds(def)].map(([part, count]) => ({ id: part, count, known: have.has(part) })),
    }));
}

/**
 * 「つくる」の一覧に出す作り方（2026-11-04）。**作られる物か材料のどれかを手に入れたことがある**作り方だけ——
 * 何も知らない作り方を全部並べると、まだ見ていない物の数と名前が分かってしまう。
 */
export function codexRecipes(items: Record<string, ItemDef>, found: ReadonlySet<string>, equipped: Iterable<string> = []): CodexItem[] {
  return codexItems(items, found, equipped).filter((entry) => entry.parts.length > 0 && (entry.known || entry.parts.some((part) => part.known)));
}

/** 魔物の図鑑の 1 行。 */
export interface CodexFoe {
  id: string;
  no: number;
  /** unknown: まだ出会っていない（名前も伏せる） / met: 出会った / beaten: 倒した（能力まで出す）。 */
  state: 'unknown' | 'met' | 'beaten';
  met: number;
  beaten: number;
}

/** 魔物の図鑑。台帳の並び順に、載せる物を全部並べる。 */
export function codexFoes(enemies: Record<string, { codex?: boolean }>, foes: ReadonlyMap<string, FoeRecord>): CodexFoe[] {
  return Object.entries(enemies)
    .filter(([, def]) => inCodex(def))
    .map(([id], at) => {
      const now = foes.get(id);
      const met = now?.met ?? 0;
      const beaten = now?.beaten ?? 0;
      return { id, no: at + 1, state: beaten > 0 ? 'beaten' : met > 0 ? 'met' : 'unknown', met, beaten };
    });
}

/** 埋まり具合。`known` は分かっている数、`all` は載せる数、`rate` は 0〜100 の切り捨て。 */
export function codexRate(known: number, all: number): { known: number; all: number; rate: number } {
  return { known, all, rate: all > 0 ? Math.floor((known * 100) / all) : 0 };
}
