'use client';

// コンディション。**仲間の様子をひと目で見る**ページ（ほかの RPG のメニューの最初の画面に当たる）。
//
// 上の帯に所持金・遊んだ時間・現在地、その下に仲間 1 人ずつのカード（絵・名前・レベル・状態・
// HP・MP・経験値・攻撃／守り／素早さ・装備）。カードは**3 人分の場所をいつも取る**——人数が少なくても
// 1 枚の幅は変わらない（戦闘の隊列の窓と同じ考え）。絵は装備やステータスと同じメニュー用の絵、無ければ「No Data」。

import { equipBonus, memberStats } from '../../game/battle/party';
import { characterMenuImage, characterName } from '../../game/characters';
import { levelUpRule } from '../../game/battle/book';
import { expForLevel, expToNext } from '../../game/battle/growth';
import { itemName } from '../../game/items';
import { playTimeLabel } from '../../game/save';
import type { MemberState } from '../../game/state';
import { AilTags } from '../AilTags';

/** カードを並べる数（隊列の最大人数）。少ないときは空けておく。 */
const CARD_SLOTS = 3;

export function ConditionPage({
  party,
  members,
  gold,
  playSeconds,
  place,
}: {
  party: string[];
  members: Map<string, MemberState>;
  gold: number;
  playSeconds: number;
  place: string;
}) {
  return (
    <div className="condition-page">
      {/* 上の帯。所持金・遊んだ時間・現在地。 */}
      <dl className="condition-info">
        <div>
          <dt>所持金</dt>
          <dd>
            {gold.toLocaleString()}
            <small> G</small>
          </dd>
        </div>
        <div>
          <dt>プレイ時間</dt>
          <dd>{playTimeLabel(playSeconds)}</dd>
        </div>
        <div className="condition-place">
          <dt>現在地</dt>
          <dd>{place || '—'}</dd>
        </div>
      </dl>

      {party.length === 0 ? (
        <p className="menu-empty">まだ 仲間が いない</p>
      ) : (
        <ul className="condition-cards" style={{ gridTemplateColumns: `repeat(${Math.max(CARD_SLOTS, party.length)}, minmax(0, 1fr))` }}>
          {party.map((who) => {
            const member = members.get(who);
            return <ConditionCard key={who} who={who} member={member ?? null} />;
          })}
        </ul>
      )}
    </div>
  );
}

/** 仲間 1 人ぶんのカード。 */
function ConditionCard({ who, member }: { who: string; member: MemberState | null }) {
  const rule = levelUpRule();
  const level = member?.level ?? 1;
  const full = memberStats(who, level);
  const gear = equipBonus(member?.equip ?? {});
  const image = characterMenuImage(who);
  // 経験値のバーは**いまのレベルの中でどこまで来たか**。最大レベルなら満タン。
  const exp = member?.exp ?? 0;
  const toNext = expToNext(exp, level, rule);
  const from = expForLevel(level, rule);
  const span = Math.max(1, exp + toNext - from);
  const maxed = level >= rule.max;
  const weapon = member?.equip.weapon;
  const armor = member?.equip.armor;

  return (
    <li className={member && member.hp <= 0 ? 'condition-card down' : 'condition-card'}>
      <div className="condition-portrait">
        {image ? <img src={image} alt="" /> : <span className="menu-figure-empty">No Data</span>}
        <span className="condition-level">
          <small>Lv</small>
          {level}
        </span>
      </div>
      <div className="condition-head">
        <span className="condition-name">{characterName(who)}</span>
        {member && member.ailments.length > 0 ? <AilTags ids={member.ailments} /> : <span className="condition-ok">{member && member.hp <= 0 ? '戦闘不能' : '正常'}</span>}
      </div>
      <div className="condition-meters">
        <Meter label="HP" value={member?.hp ?? 0} max={full.hp} />
        <Meter label="MP" value={member?.mp ?? 0} max={full.mp} kind="mp" />
        <Meter
          label="EXP"
          value={maxed ? 1 : exp - from}
          max={maxed ? 1 : span}
          kind="exp"
          text={maxed ? 'MAX' : `あと ${toNext}`}
        />
      </div>
      <dl className="condition-stats">
        <div>
          <dt>攻撃</dt>
          <dd>{full.attack + gear.attack}</dd>
        </div>
        <div>
          <dt>守り</dt>
          <dd>{full.guard + gear.guard}</dd>
        </div>
        <div>
          <dt>素早さ</dt>
          <dd>{Math.max(1, full.speed + gear.speed)}</dd>
        </div>
      </dl>
      <dl className="condition-gear">
        <dt>武器</dt>
        <dd>{weapon ? itemName(weapon) : 'なし'}</dd>
        <dt>鎧</dt>
        <dd>{armor ? itemName(armor) : 'なし'}</dd>
      </dl>
    </li>
  );
}

/** カードの中の 1 本（HP・MP・経験値）。名前は左、数は帯に重ねる。作りは戦闘の帯と同じ。 */
function Meter({ label, value, max, kind = 'hp', text }: { label: string; value: number; max: number; kind?: 'hp' | 'mp' | 'exp'; text?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const low = kind === 'hp' && ratio <= 0.4;
  return (
    <div className="condition-meter">
      <span className="condition-meter-label">{label}</span>
      <span className={`battle-gauge${kind === 'mp' ? ' mp' : ''}${kind === 'exp' ? ' exp' : ''}${low ? ' low' : ''}`}>
        <span className="battle-gauge-trail" style={{ width: `calc((100% - 4px) * ${ratio})` }} />
        <span className="battle-gauge-fill" style={{ width: `calc((100% - 4px) * ${ratio})` }} />
        <b className="battle-gauge-num">{text ?? `${value} / ${max}`}</b>
      </span>
    </div>
  );
}

/** HP・MP の棒（アイテムの使い先を選ぶ小窓で使う。GS-208）。 */
export function Gauge({ value, max, mp = false }: { value: number; max: number; mp?: boolean }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return <span className={`condition-gauge${mp ? ' mp' : ''}${!mp && ratio <= 0.4 ? ' low' : ''}`}>
    <span style={{ width: `${ratio * 100}%` }} />
    <b>{value} / {max}</b>
  </span>;
}
