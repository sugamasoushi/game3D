// フィールド戦闘の段階 2（2026-11-05 / GS-304）。**その場で戦う・周りの敵の巻き込み・撤退**の決まり。
//
// - その場で戦う: 敵シンボルとランダムエンカウントの戦闘は、主人公の立つマスを舞台の真ん中にする
//   （マップの `maps.json` の `battleAt: "stage"` なら今までどおり舞台の点。イベントの戦闘はいつも舞台の点）。
// - 巻き込み: 触れた敵シンボルの近く（`battleSettings.json` の `fieldBattle.join` マス以内）で**こちらに気づいている**
//   敵シンボルも、1 体ずつ戦闘に加わる。加われるのは、その場で敵が立てる枠の数まで（狭い所ほど少ない）。
// - 撤退: 技の種類 `retreat`。必ず成功し、技の MP を払う。生き残った敵シンボルはフィールドの元の位置へ戻り、
//   減った HP のまま `fieldBattle.retreatStun` ミリ秒怯む。そのあいだは触れても戦闘にならない。
//
// ここは数と決まりだけ（画面・乱数なし）。

/** 戦闘に出た敵シンボル 1 体ぶん。`from`〜`to`（含まない）が敵の並び（`enemies`）の中での範囲。 */
export interface SymbolGroup {
  /** NPC の id（マップの名前）。 */
  npc: string;
  /** 敵の台帳のキー（シンボルの敵）。 */
  enemy: string;
  from: number;
  to: number;
  /** 触れたときの居場所（マス）と向き。撤退で戻す所。 */
  at: { x: number; y: number; z: number };
}

/** 巻き込む候補 1 体。 */
export interface JoinCandidate {
  npc: string;
  enemy: string;
  /** 主人公からの距離（マス）。 */
  distance: number;
  /** こちらに気づいているか（交戦中）。 */
  engaged: boolean;
}

/** 巻き込みの既定（マス）。0 なら巻き込まない。 */
/** `together` は先頭からこれより離れた仲間がコマンド戦闘に入らない距離（マス。GS-305。`partyTactics.ts`）。 */
// 撤退の怯みは 2026-11-08 に 1500 から 500 へ縮めた（「！」も怯みと重ねる）。
export const FIELD_BATTLE_DEFAULTS = { join: 4, retreatStun: 500, together: 5 } as const;
export const FIELD_BATTLE_LIMITS = { join: { min: 0, max: 12 }, retreatStun: { min: 0, max: 10000 }, together: { min: 1, max: 30 } } as const;
/** 戦闘に並ぶ敵の数の上限（`mapNpcs.ts` の `MAX_FOES` と同じ）。 */
const MAX_FOES = 6;

/**
 * 巻き込む敵シンボルを選ぶ。気づいていて `join` マス以内の物を、近い順に `room` 体まで。
 * `room` はその場で敵が立てる枠の数 − 触れた組の数（上限 6 からも引く）。
 */
export function pickJoiners(candidates: readonly JoinCandidate[], join: number, room: number): JoinCandidate[] {
  if (!(join > 0) || room <= 0) return [];
  return candidates
    .filter((one) => one.engaged && one.distance <= join + 1e-6)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, Math.floor(room)));
}

/** 巻き込める数。その場で敵が立てる枠 `standable` と上限 6 から、触れた組の数を引く。 */
export function joinRoom(standable: number, touched: number): number {
  return Math.max(0, Math.min(standable, MAX_FOES) - touched);
}

/**
 * 撤退のあと、フィールドへ戻す敵シンボル。組の中に生き残りがいれば戻す。
 * HP は**シンボルと同じ敵**の生き残りのうち一番多い HP（同じ敵がいなければ満タン = undefined）。
 * 組がみんな倒れていれば戻さない（倒した扱い）。`hp` は敵の並びと同じ順の残り HP。
 */
export function retreatSurvivors(
  groups: readonly SymbolGroup[],
  enemies: readonly string[],
  hp: readonly number[],
): Array<{ group: SymbolGroup; hp: number | undefined }> {
  const out: Array<{ group: SymbolGroup; hp: number | undefined }> = [];
  for (const group of groups) {
    let any = false;
    let best: number | undefined;
    for (let at = group.from; at < group.to; at += 1) {
      const left = hp[at] ?? 0;
      if (left <= 0) continue;
      any = true;
      if (enemies[at] === group.enemy) best = Math.max(best ?? 0, left);
    }
    if (any) out.push({ group, hp: best });
  }
  return out;
}

/** 撤退したとき、倒れていた敵（取り分・討伐・図鑑に数える）。 */
export function beatenBeforeRetreat(enemies: readonly string[], hp: readonly number[]): string[] {
  return enemies.filter((_, at) => (hp[at] ?? 0) <= 0);
}

/**
 * 隊列の交戦中（2026-11-05）。攻撃のやり取り（敵の技を受けた・フィールドアタックを当てた）で始まり、
 * 気づいている敵シンボルがいなくなって最後のやり取りから `ENGAGED_LINGER_MS` たつと終わる。
 * 交戦中は隊列の HP の帯を出し続け、コマンド戦闘になったら近くの敵シンボルを気づいていなくても巻き込む。
 */
export const ENGAGED_LINGER_MS = 4000;

/**
 * 隊列が交戦中か。`lastExchange` は最後のやり取りの時刻（0 ならやり取りが無い）、`noticing` は気づいている敵シンボルがいるか、
 * `hunting` はイベントの戦闘から撤退して追われているか（追われているあいだはいつも交戦中）。
 */
export function partyEngaged(lastExchange: number, now: number, noticing: boolean, hunting: boolean): boolean {
  if (hunting) return true;
  if (lastExchange <= 0) return false;
  return noticing || now - lastExchange < ENGAGED_LINGER_MS;
}
