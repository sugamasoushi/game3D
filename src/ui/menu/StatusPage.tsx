'use client';

// ステータス（GS-67）。**数を全部 1 か所で見せる。**
//
// 左の柱（`Menu`）は歩きながら見る要点（Lv・HP・MP・お金）だけを出すので、
// 物理攻撃力・物理防御力・魔法攻撃力・魔法防御力・素早さ・経験はここで見る（呼び名は `statNames.ts`。2026-11-07）。
// **素の値と装備ぶんを分けて出す**——装備を替えたときに何がどれだけ変わったのか、これが無いと分からない。
// 種族と種族特性は「種族特性」の種類（`RacePage`）へ移した（2026-11-07）。

import { characterMenuImage } from '../../game/characters';
import { equipBonus, memberStats } from '../../game/battle/party';
import { POWER_KEYS, STAT_NAMES, powerWithGear } from '../../game/battle/statNames';
import { levelUpRule } from '../../game/battle/book';
import { expToNext } from '../../game/battle/growth';
import type { MemberState } from '../../game/state';

export function StatusPage({
  who,
  member,
}: {
  who: string;
  member: MemberState | null;
}) {
  if (!member) return <p className="menu-empty">まだ 仲間が いない</p>;

  const base = memberStats(who, member.level);
  const toNext = expToNext(member.exp, member.level, levelUpRule());
  const image = characterMenuImage(who);
  const gear = equipBonus(member.equip);

  return (
    <div className="menu-figured status">
      {/* 絵の場所は**いつも同じ幅と高さ**で取る。絵が無い・細い人でも、右の項目が左へ寄らない。 */}
      <div className="menu-figure-frame">{image ? <img className="menu-figure" src={image} alt="" /> : <span className="menu-figure-empty">No Data</span>}</div>
      {/* 名前は上の「見る仲間」に、装備は「装備」、種族は「種族特性」、状態異常は「コンディション」に出す。ここは数だけ。 */}
      <div className="menu-figured-body status-content">
        <div className="status-columns">
          <dl className="status-facts">
            <dt>レベル</dt><dd>{member.level}</dd>
            <dt>HP</dt>
            <dd>
              {member.hp} / {base.hp}
            </dd>
            <dt>MP</dt>
            <dd>
              {member.mp} / {base.mp}
            </dd>
            {POWER_KEYS.map((key) => [
              <dt key={`${key}-name`}>{STAT_NAMES[key]}</dt>,
              <dd key={`${key}-value`}>{powerWithGear(base, gear, key)}<Plus value={gear[key]} /></dd>,
            ])}
            <dt>経験値</dt>
            <dd>{member.exp}</dd>
            <dt>次のレベルまで</dt>
            <dd>{toNext > 0 ? toNext : '—'}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

/** 装備で増えた（減った）ぶん。0 なら出さない。 */
function Plus({ value }: { value: number }) {
  if (!value) return null;
  return <span className="equip-plus">（装備 {value > 0 ? `+${value}` : value}）</span>;
}
