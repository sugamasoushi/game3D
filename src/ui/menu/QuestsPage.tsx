'use client';

// メニュー「クエスト」（2026-11-02。それまでの「依頼」）。本筋・サブストーリー・依頼を種類のタブで分けて並べる。
// 中身の形は `questLog.ts` が揃える。種類のタブは中身の先頭の行（←→ で隣へ、決定で切り替え）。

import { useEffect, useState } from 'react';
import { loadQuestBook, questBook, questLevelInfo, type QuestProgress } from '../../game/quests';
import { loadStoryBook, storyBook } from '../../game/story';
import { loadSubstoryBook, substoryBook } from '../../game/substories';
import { enemyDef } from '../../game/battle/book';
import { itemName } from '../../game/items';
import {
  mainQuest,
  QUEST_KIND_LABEL,
  QUEST_STATUS_LABEL,
  requestQuests,
  sortQuests,
  subQuests,
  type QuestEntry,
  type QuestKind,
} from '../../game/questLog';

const KINDS: readonly QuestKind[] = ['main', 'sub', 'request'];
const EMPTY: Record<QuestKind, string> = {
  main: 'いまの目的はありません。',
  sub: '始まっているサブストーリーはありません。',
  request: '受注している依頼はありません。',
};

export function QuestsPage({
  story,
  substories,
  quests,
  questExp = 0,
  items,
}: {
  story: string;
  substories: Map<string, string>;
  quests: Map<string, QuestProgress>;
  /** 依頼経験値（2026-11-02）。台帳に依頼レベルの表があれば「依頼」の上に依頼レベルと次までを出す。 */
  questExp?: number;
  /** 収集の依頼の数と報告待ちは今の持ち物で見る。 */
  items: Map<string, number>;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<QuestKind>('main');
  useEffect(() => {
    let live = true;
    void Promise.all([loadQuestBook(), loadStoryBook(), loadSubstoryBook()]).then(
      () => { if (live) setReady(true); },
      () => { if (live) setError('クエストを読み込めません。メニューを開き直してください。'); },
    );
    return () => { live = false; };
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!ready) return <p>クエストを読み込んでいます…</p>;

  const lists: Record<QuestKind, QuestEntry[]> = {
    main: [mainQuest(storyBook(), story)].filter((one): one is QuestEntry => one !== null),
    sub: sortQuests(subQuests(substoryBook(), substories)),
    request: sortQuests(requestQuests(questBook(), quests, (id) => enemyDef(id)?.name ?? id, items, itemName)),
  };
  const rows = lists[kind];
  return <div className="quests-page">
    <div className="quest-kinds" role="tablist" aria-label="クエストの種類">
      {KINDS.map((one) => {
        const open = lists[one].filter((entry) => entry.status !== 'done').length;
        return <button key={one} type="button" role="tab" data-pick aria-selected={one === kind} className={one === kind ? 'on' : ''} onClick={() => setKind(one)}>
          {QUEST_KIND_LABEL[one]}{open ? <small>{open}</small> : null}
        </button>;
      })}
    </div>
    {kind === 'request' && questBook().levels?.length ? <QuestLevel exp={questExp} /> : null}
    {kind === 'request' ? <p>討伐は受注後に倒した敵を、収集は今の持ち物を数えます。達成したら依頼を受けた相手に報告してください。</p> : null}
    {!rows.length ? <p>{EMPTY[kind]}</p> : rows.map((entry) => <QuestCard key={`${entry.kind}:${entry.id}`} entry={entry} />)}
  </div>;
}

/** 依頼レベルと次のレベルまで。最後のレベルなら「最大」。 */
function QuestLevel({ exp }: { exp: number }) {
  const info = questLevelInfo(exp);
  return <div className="quest-level" data-pick tabIndex={0}>
    <span>依頼レベル <strong>{info.level}</strong></span>
    {info.next === null
      ? <span className="quest-count">依頼経験値 {exp.toLocaleString('ja-JP')}（最大）</span>
      : <>
        <span className="quest-count">次のレベルまで {(info.next - exp).toLocaleString('ja-JP')}</span>
        <progress value={exp - info.floor} max={info.next - info.floor} aria-label="次の依頼レベルまで" />
      </>}
  </div>;
}

function QuestCard({ entry }: { entry: QuestEntry }) {
  const request = entry.request;
  const facts = request || entry.client;
  return <article className="quest-card" tabIndex={0} data-pick data-done={entry.status === 'done' || undefined}>
    <div className="quest-main">
      {entry.chapter ? <p className="quest-chapter">{entry.chapter}</p> : null}
      <h3>{entry.title} <small>{QUEST_STATUS_LABEL[entry.status]}</small></h3>
      {entry.goal ? <p className="quest-goal">{entry.goal}</p> : null}
      {entry.text ? <p>{entry.text}</p> : null}
      {entry.kind === 'request' && !request ? <p>この依頼は台帳から削除されています。</p> : null}
      {/* 開け閉めの箱にしない: メニューはキーを全部止めるので、パッドで開けられない。ページがそのまま流れる。 */}
      {entry.log.length ? <section className="quest-log" aria-label="これまでの話">
        <h4>これまでの話</h4>
        <ol>{entry.log.map((line, at) => <li key={at}>{line}</li>)}</ol>
      </section> : null}
    </div>
    {facts ? <dl className="quest-facts">
      {request ? <>
        <dt>{request.label}</dt>
        <dd className="quest-hunt">
          <span>{request.target}</span>
          {request.unit ? <>
            <span className="quest-count">{request.now} / {request.count} {request.unit}</span>
            <progress value={request.now} max={request.count} aria-label={`${entry.title}の${request.label}の数`} />
          </> : <span className="quest-count">{request.target && request.count > 1 ? `${request.count} 個` : ''}</span>}
        </dd>
        {request.to ? <><dt>届け先</dt><dd>{request.to}</dd></> : null}
        {request.result ? <><dt>結果</dt><dd>{request.result}</dd></> : null}
        <dt>報酬</dt>
        <dd>{request.gold.toLocaleString('ja-JP')} G{request.exp ? `・依頼経験値 ${request.exp.toLocaleString('ja-JP')}` : ''}</dd>
      </> : null}
      {entry.client ? <><dt>{entry.kind === 'request' ? '報告先' : '案内'}</dt><dd>{entry.client}</dd></> : null}
    </dl> : null}
  </article>;
}
