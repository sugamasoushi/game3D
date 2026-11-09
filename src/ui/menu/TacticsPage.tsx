'use client';

// メニュー「作戦」（2026-11-07）。種類のタブ **フィールド**／**隊列** で分ける（クエストと同じ `quest-kinds`）。
//
// - フィールド: 仲間の作戦（`partyTactics.ts`。戦わない／移動・迎撃／移動・攻撃／自由に戦闘／待機・迎撃）の説明と切り替え。
//   選んだ作戦はその場で効く（キー C で回すのと同じ `tacticRef`）。作戦はセーブしない。
// - 隊列: コマンド戦闘の味方の並び（既定の隊形。`formationView.ts`）と、マス位置で変わる効果の説明。
//   **入れ替えはまだできない**（見せるだけ）。倍率の数は戦闘共通の台帳（`battleSettings.json` の `rates`）から出す。
//
// **種類のタブは流さない**（2026-11-07）。流れるのは下の中身（`.tactics-scroll`）だけ。
// 説明の行（注意書き・仲間ごとの位置・効果）にも**カーソルが止まる**（`Info`。押しても何も起きない。スキルの技の行と同じ）——
// 止まらないと ↓ で窓の下の説明まで行けない。カーソルを動かすと、その行が見える所までブラウザが流す（`focus()`）。

import { useRef, useState, type ReactNode } from 'react';
import { characterName } from '../../game/characters';
import { TACTICS, TACTIC_NAMES, type Tactic } from '../../game/partyTactics';
import { formationSeats, seatGrid } from '../../game/formationView';
import { defaultFormationDef, skillDef } from '../../game/battle/book';
import { backRowRate, fieldBattleSettings, heightRates } from '../../game/battle/settings';
import { COVER_COLS, COVER_ROWS } from '../../game/battle/cover';
import { rangeOf } from '../../game/battle/height';
import type { MemberState } from '../../game/state';

const KINDS = ['フィールド', '隊列'] as const;
type Kind = (typeof KINDS)[number];

/** 作戦ごとの説明。 */
const TACTIC_TEXT: Record<Tactic, string> = {
  follow: '主人公の通った道をたどって ついてくる。自分からは 攻めない。離れていた仲間は 列へ戻る。',
  fight: '近くで こちらに気づいている敵シンボルがいれば、列を離れて 自分のフィールドアタックで 攻める。いなくなれば 列へ戻る。',
  attack: '近くの敵シンボルを（気づいていなくても）列を離れて 攻める。先頭から離れすぎた敵は 追わない。いなくなれば 列へ戻る。',
  free: '敵シンボルを見つけたら（気づいていなくても）、先頭から離れても 攻め続ける。見つからなくなれば 列へ戻る。',
  stay: '今いる所に 留まる。届く所の敵シンボルは（気づいていなくても）攻める。',
};

/** 倍率を「50%」の字に。 */
const percent = (rate: number) => `${Math.round(rate * 100)}%`;

export function TacticsPage({
  tactic,
  onTactic,
  party,
  members,
}: {
  /** いまの作戦。 */
  tactic: Tactic;
  /** 作戦を変える（その場で効く）。 */
  onTactic(next: Tactic): void;
  party: string[];
  members: Map<string, MemberState>;
}) {
  const [kind, setKind] = useState<Kind>('フィールド');
  const [now, setNow] = useState<Tactic>(tactic);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="tactics-page">
      <div className="quest-kinds" role="tablist" aria-label="作戦の種類">
        {KINDS.map((one) => (
          <button key={one} type="button" role="tab" data-pick aria-selected={one === kind} className={one === kind ? 'on' : ''}
            // 種類のタブへ戻ったら中身を先頭へ流す（格子など、カーソルの止まらない所も見えるように）。
            onFocus={() => scrollRef.current?.scrollTo({ top: 0 })}
            onClick={() => setKind(one)}>
            {one}
          </button>
        ))}
      </div>
      <div className="tactics-scroll" ref={scrollRef}>
        {kind === 'フィールド' ? (
          <FieldTactics
            now={now}
            onPick={(next) => {
              setNow(next);
              onTactic(next);
            }}
          />
        ) : (
          <PartyFormation party={party} members={members} />
        )}
      </div>
    </div>
  );
}

/** 説明の 1 行。カーソルが止まるが、押しても何も起きない。 */
function Info({ className, children, as = 'li' }: { className?: string; children: ReactNode; as?: 'li' | 'div' }) {
  const Tag = as;
  return (
    <Tag className={className ? `tactics-info ${className}` : 'tactics-info'} data-pick tabIndex={0} aria-disabled="true">
      {children}
    </Tag>
  );
}

/** フィールドの作戦（選ぶと切り替わる）。 */
function FieldTactics({ now, onPick }: { now: Tactic; onPick(next: Tactic): void }) {
  const { together } = fieldBattleSettings();
  return (
    <div className="tactics-field">
      <ul className="tactics-list">
        {TACTICS.map((one) => (
          <li key={one}>
            <button type="button" data-pick className={one === now ? 'on' : ''} aria-pressed={one === now} onClick={() => onPick(one)}>
              <span className="tactics-mark">{one === now ? '●' : ''}</span>
              <span className="tactics-name">{TACTIC_NAMES[one]}</span>
              <span className="tactics-text">{TACTIC_TEXT[one]}</span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="tactics-notes">
        <Info>歩いている間は キー C（ゲームパッドの Select・画面のパッドの「作戦」）でも 順に切り替えられる。</Info>
        <Info>戦闘が始まったとき、先頭から {together} マスより離れている仲間は そのコマンド戦闘に入らない。</Info>
        <Info>倒れている仲間は 作戦に関わらず 列について歩く。イベントの間は 作戦を止める。</Info>
        <Info>作戦は セーブに残らない（記録を読むと「{TACTIC_NAMES.follow}」に戻る）。</Info>
      </ul>
    </div>
  );
}

/** その人が覚えている、マス位置に関わる技（かばう・離れた攻撃・貫通・全体）。 */
function positionSkills(member: MemberState | undefined): string[] {
  const out: string[] = [];
  for (const id of member?.skills ?? []) {
    const skill = skillDef(id);
    if (!skill) continue;
    const marks: string[] = [];
    if (skill.type === 'cover') marks.push('かばう');
    if (skill.type === 'attack' && rangeOf(skill) === 'ranged') marks.push('対空');
    if (skill.reach === 'pierce') marks.push('貫通');
    if (skill.reach === 'all') marks.push('全体');
    if (marks.length) out.push(skill.type === 'cover' ? skill.name : `${skill.name}［${marks.join('・')}］`);
  }
  return out;
}

/** コマンド戦闘の隊列（見せるだけ）と、マス位置の効果。 */
function PartyFormation({ party, members }: { party: string[]; members: Map<string, MemberState> }) {
  const seats = formationSeats(party, defaultFormationDef());
  const { cols, rows } = seatGrid(seats);
  const rates = heightRates();
  const back = backRowRate();
  const coverSkill = skillDef('cover')?.name ?? 'かばう';
  const stoneSkill = skillDef('throw_stone')?.name ?? '投石';

  return (
    <div className="tactics-formation">
      <div className="tactics-board-wrap">
        {seats.length ? (
          <>
            <p className="tactics-foe-side">▲ 敵の側</p>
            <div className="tactics-board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
              {rows.flatMap((row) =>
                cols.map((col) => {
                  const seat = seats.find((one) => one.col === col && one.row === row);
                  if (!seat) return <span key={`${col}:${row}`} className="tactics-cell empty" />;
                  return (
                    <div key={`${col}:${row}`} className={`tactics-cell ${seat.line}`}>
                      <span className="tactics-line">{seat.line === 'front' ? '前衛' : '後衛'}</span>
                      <b>{characterName(seat.who)}</b>
                    </div>
                  );
                }),
              )}
            </div>
            <p className="tactics-fixed">隊列の入れ替えは まだ できない。</p>
            <ul className="tactics-seats">
              {seats.map((seat) => {
                const skills = positionSkills(members.get(seat.who));
                return (
                  <Info key={seat.who}>
                    <b>{characterName(seat.who)}</b>
                    <span>
                      {seat.line === 'front' ? '前衛' : '後衛'}
                      {seat.guardedBy.length ? `（${seat.guardedBy.map(characterName).join('・')} に守られる）` : ''}
                      {skills.length ? `　${skills.join('　')}` : ''}
                    </span>
                  </Info>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="menu-empty">隊列を 並べられない</p>
        )}
      </div>

      <div className="tactics-detail">
        <div className="tactics-rules">
          <Info as="div" key={0}>
            <b>前衛と後衛</b>
            <span>いちばん前の行が 前衛。横の差 1 マス以内で 前に仲間がいる後衛は、単体の技と 通常攻撃で 狙われない（前の人が倒れると 狙われる）。</span>
          </Info>
          <Info as="div" key={1}>
            <b>貫通・全体</b>
            <span>貫通は 選んだ相手と その後ろ、全体は 全員に当たる。守られた後衛へのダメージは {percent(back)}。</span>
          </Info>
          <Info as="div" key={2}>
            <b>{coverSkill}</b>
            <span>使ったターンは、近く（横 {COVER_COLS} マス・前後 {COVER_ROWS} マス以内）の仲間への攻撃を 代わりに受ける（自分の防御力で計算）。飛ぶ敵の攻撃は かばえない。</span>
          </Info>
          <Info as="div" key={3}>
            <b>{stoneSkill}・離れた攻撃</b>
            <span>［対空］の技（{stoneSkill}・攻撃の魔法など）は 飛ぶ敵にも そのまま当たる。直接攻撃は 飛ぶ敵に {percent(rates.flyGuard)}、高台にいる相手に {percent(rates.highGuard)}。</span>
          </Info>
          <Info as="div" key={4}>
            <b>高台</b>
            <span>高台から 高台でない相手を攻めると {percent(rates.high)}。</span>
          </Info>
          <Info as="div" key={5}>
            <b>飛ぶ敵</b>
            <span>前衛・後衛の決まりの外。前に守られた後衛も 狙ってくる。</span>
          </Info>
        </div>
      </div>
    </div>
  );
}
