'use client';

import { useEffect, useState } from 'react';
import { loadQuestBook, questBook, type QuestProgress } from '../../game/quests';
import { enemyDef } from '../../game/battle/book';

export function QuestsPage({ quests }: { quests: Map<string, QuestProgress> }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void loadQuestBook().then(() => { if (live) setReady(true); }, () => { if (live) setError('依頼を読み込めません。メニューを開き直してください。'); });
    return () => { live = false; };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!ready) return <p>依頼を読み込んでいます…</p>;
  const rows = [...quests].sort(([, a], [, b]) => Number(a.completed) - Number(b.completed));
  return <div className="quests-page">
    <h2>討伐依頼</h2>
    <p>受注後に倒した敵を数えます。達成したら依頼を受けた相手に報告してください。</p>
    {!rows.length ? <p>受注している依頼はありません。</p> : rows.map(([id, progress]) => {
      const def = questBook().quests[id];
      const status = progress.completed ? '報告済み' : def && progress.count >= def.count ? '達成・報告待ち' : '受注中';
      // 左に名前と説明、右に数・報酬・報告先（2026-11-01）。横いっぱいの 1 列だと右が空いて行が長くなるため。
      return <article key={id} className="quest-card" tabIndex={0} data-pick data-done={progress.completed || undefined}>
        <div className="quest-main">
          <h3>{def?.name ?? id} <small>{status}</small></h3>
          {!def ? <p>この依頼は台帳から削除されています。</p> : def.text ? <p>{def.text}</p> : null}
        </div>
        {def ? <dl className="quest-facts">
          <dt>討伐</dt>
          <dd>
            <span>{enemyDef(def.enemy)?.name ?? def.enemy}</span>
            <span className="quest-count">{progress.count} / {def.count} 体</span>
            <progress value={progress.count} max={def.count} aria-label={`${def.name}の討伐数`} />
          </dd>
          <dt>報酬</dt>
          <dd>{def.gold.toLocaleString('ja-JP')} G</dd>
          {def.client ? <><dt>報告先</dt><dd>{def.client}</dd></> : null}
        </dl> : null}
      </article>;
    })}
  </div>;
}
