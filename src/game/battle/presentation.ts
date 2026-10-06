// 戦闘中の操作・進行の契機。戦闘画面（`BattleView.tsx`）が発行する。
// 攻撃アクション等のアニメーション演出の契機に使う予定（Battle Presentation Editor BPE-14）。
// カメラ演出IDを結ぶ台帳（`battlePresentation.json`）の読み込み・引き当ては凍結していたが、2026-10-06 に消した（BPE-15）。

export const BATTLE_PRESENTATION_HOOKS = [
  'battle.start',
  'command.party.open',
  'command.attack.open',
  'command.skill.open',
  'command.magic.open',
  'command.item.open',
  'target.enemy.open',
  'target.friend.open',
  'cursor.command.change',
  'cursor.target.change',
  'command.confirm',
  'command.party.complete',
  'command.back',
  'action.party.start',
  'action.enemy.start',
  'battle.win',
  'battle.lose',
  'battle.escape',
] as const;

export type BattlePresentationHook = (typeof BATTLE_PRESENTATION_HOOKS)[number];
/** 契機が起きた瞬間に戦闘画面が知っている動的な対象。台帳へキャラIDは保存しない。 */
export interface BattlePresentationContext {
  subject?: string;
  /** 隊列の何人目か（1 始まり）。 */
  slot?: number;
}
