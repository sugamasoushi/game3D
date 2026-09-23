// 戦闘中の操作・進行の契機。戦闘画面（`BattleView.tsx`）が発行する。
// 攻撃アクション等のアニメーション演出の契機に使う予定（Battle Presentation Editor BPE-14）。
// カメラ演出IDを結ぶ台帳の読み込み・引き当ては凍結し、コメントアウトで残す（BPE-15）。
// [凍結 BPE-15] 台帳を読むときに使っていた。
// import { assetUrl } from '../assets';

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
// [凍結 BPE-15] 戦闘演出エディタの味方ごとのカメラ割り当て（BPE-12）。
// /** 味方ごとに分けて割り当てられる契機（BPE-12）。コマンド画面を開く契機だけ。 */
// export const BATTLE_PRESENTATION_MEMBER_HOOKS = [
  // 'command.party.open',
  // 'command.attack.open',
  // 'command.skill.open',
  // 'command.magic.open',
  // 'command.item.open',
// ] as const satisfies readonly BattlePresentationHook[];
// /** 味方ごとの割り当ての人数。隊列の 1〜6 人目。 */
// export const BATTLE_PRESENTATION_MEMBER_SLOTS = 6;
// export type BattlePresentationMemberHook = (typeof BATTLE_PRESENTATION_MEMBER_HOOKS)[number];
// /** 台帳のキー。味方ごとの割り当ては `契機@人数`（例 `command.attack.open@2`）。 */
// export type BattlePresentationKey = BattlePresentationHook | `${BattlePresentationMemberHook}@${number}`;
/** 契機が起きた瞬間に戦闘画面が知っている動的な対象。台帳へキャラIDは保存しない。 */
export interface BattlePresentationContext {
  subject?: string;
  /** 隊列の何人目か（1 始まり）。凍結前は味方ごとのカメラ割り当てを引くのに使っていた（BPE-12）。 */
  slot?: number;
}
// [凍結 BPE-15] 戦闘演出エディタのカメラ割り当て台帳（`battlePresentation.json`）の読み込み・引き当て・下書きの差し替え。
// export interface BattlePresentationBook {
  // version: 1;
  // bindings: Partial<Record<BattlePresentationKey, string>>;
// }

// let book: BattlePresentationBook = { version: 1, bindings: {} };
// let pending: Promise<void> | undefined;

// export function loadBattlePresentation(): Promise<void> {
  // return pending ??= fetch(assetUrl('data/battlePresentation.json')).then(async (response) => {
    // if (!response.ok) throw new Error('戦闘演出台帳を読めません');
    // book = await response.json() as BattlePresentationBook;
  // }).catch((error) => {
    // pending = undefined;
    // throw error;
  // });
// }

// /**
 // * 契機に割り当てた演出を引く。**何人目かの割り当てがあればそれを優先し、無ければ全員共通**（BPE-12）。
 // * 返す `key` は実際に使った台帳のキーで、発生ログに出す。
 // */
// export function battlePresentationBinding(
  // hook: BattlePresentationHook,
  // slot?: number,
// ): { key: BattlePresentationKey; cue: string } {
  // if (slot && (BATTLE_PRESENTATION_MEMBER_HOOKS as readonly string[]).includes(hook)) {
    // const key = `${hook as BattlePresentationMemberHook}@${slot}` as const;
    // const cue = book.bindings[key];
    // if (cue) return { key, cue };
  // }
  // return { key: hook, cue: book.bindings[hook] ?? '' };
// }

// /** 未保存の割り当ては、開発用の戦闘演出エディタからだけ渡す。 */
// export function previewBattlePresentation(next: BattlePresentationBook): void {
  // book = structuredClone(next);
// }
