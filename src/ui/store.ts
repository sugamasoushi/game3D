// 画面に出す状態だけを持つ（構想 §5.3）。
// **プレイヤー座標や FPS は入れない**——毎フレーム変わるものを React に持たせると描き直しになる。
// ここに入るのは「会話文」「選択肢」「暗さ」「立ち絵」で、どれも 1 秒に数回しか変わらない。

import { create } from 'zustand';

/** 表示中の 1 メッセージ。 */
export interface Talk {
  /** 名前欄。空なら地の文。 */
  name: string;
  /** 本文の行。 */
  lines: string[];
  /**
   * 吹き出しで出すときの相手（GS-23）。`player` かその NPC の名前。
   * 空なら下の会話ウィンドウ。
   */
  bubble?: string;
  /** 顔アイコンの URL（吹き出しのとき）。無ければ絵なし。 */
  icon?: string;
}

/** 流れる文字（GS-23）。オープニングのような読み物。 */
export interface ScrollText {
  lines: string[];
  /**
   * **1 行ぶんが流れるのにかかる時間**（ミリ秒。GS-144）。総時間ではない。
   * 総時間で決めていたころは、5 行のエンディングが 16 行のオープニングの
   * 3 倍の速さで流れて読めなかった。
   */
  speed: number;
  /** 背景をどれだけ暗くするか（0〜1）。 */
  dim: number;
}

/**
 * 流れ切るまでの時間（ミリ秒。GS-144）。
 * 運ぶ距離は**画面の高さ ＋ 文字の高さ**（下から出て上へ抜け切る）。
 * それを 1 行の高さで割った「何行ぶん運ぶか」に `speed` を掛ける。
 */
export function scrollMs(screenH: number, textH: number, lineH: number, speed: number): number {
  const lines = (screenH + textH) / Math.max(lineH, 1);
  return Math.round(lines * speed);
}

/**
 * キャライラストの出入りにかける時間（ミリ秒。GS-31 / GS-143）。
 * **CSS の `.portrait` の遷移と同じ長さ**にする——出切ってから消すため。
 */
export const PORTRAIT_MS = 280;

/** 絵が出入りする向き（GS-143）。画面のどの辺から来て、どの辺へ帰るか。 */
export type PortraitSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * 出しているキャライラスト 1 枚（GS-20 / GS-143）。
 *
 * **`id` がこのイベントの中での名前**。省略して出すと `slot` と同じ名前になるので、
 * 今までどおり「左の絵」「右の絵」として扱える。名前を付ければ 4 枚以上でも
 * 1 枚ずつ指して効果をかけられる（`imageFx`）。
 */
export interface Portrait {
  id: string;
  /** 置き場所（left / right / center）。同じ場所に重ねても構わない——見分けるのは `id`。 */
  slot: string;
  src: string;
  /** 入ってきた向き。`none` は滑らせずにその場へ出す。帰る向きの既定にもなる。 */
  from: PortraitSide | 'none';
  /** 左右反転（GS-146）。右に置いた絵を左向きにするなど。 */
  flip: boolean;
  /**
   * 出ていく向き（GS-31）。入っていれば**出ていく途中**で、
   * **消すのは画面の外へ出切ってから**（`dropPortrait`）。
   * ぱっと消すと、会話が終わった瞬間に絵だけ瞬間移動したように見える。
   */
  out?: PortraitSide;
  /** 濃さ（0〜1）。1 がふつう。 */
  opacity: number;
  /** 揺れ幅（画素）。0 なら揺れない。かけ直すたびに数え直す。 */
  shake: number;
  /**
   * 大きさの倍率（GS-145）。1 がふつう。**効果（`imageFx` の `zoom`）でだけ変える**——
   * 素の大きさは画面側（`.portrait` の丈）が決めている。伸びる軸は足元なので、
   * 大きくしても立ち位置は動かない。
   */
  scale: number;
  /** 揺れを数え直すための通し番号。同じ揺れを続けて出すときに要る。 */
  shakeAt: number;
  /** いまの動きにかける時間（ミリ秒）。 */
  ms: number;
}

/** いま何の画面か（GS-27）。タイトルとゲームを行き来する。 */
export type Phase = 'title' | 'play';

/**
 * いま画面が何をしているか（GS-59）。旧作の `GameStateManager.currentState` に当たる。
 *
 * **別の変数では持たず、いまある旗から出す。** 2 つ持つと必ず片方だけ更新し忘れて、
 * 「メニューを閉じたのに歩けない」のような直しにくい詰まりになる。
 */
export type Scene = 'title' | 'field' | 'event' | 'menu' | 'battle';

/** 見ている旗から今の状態を出す。並び順が優先順位——上にあるものが勝つ。 */
export function sceneOf(state: Pick<UiState, 'phase' | 'busy' | 'menu' | 'settings' | 'battle'>): Scene {
  if (state.phase !== 'play') return 'title';
  // **戦闘はメニューより先に見る。** 戦闘中に開いた設定を閉じたとき、
  // まだ戦っているのに `field` に戻って歩き出さないように。
  if (state.battle) return 'battle';
  if (state.menu || state.settings) return 'menu';
  if (state.busy) return 'event';
  return 'field';
}

/**
 * そのとき人を動かせるか（GS-59）。**歩きを止める理由はここ 1 か所に集める。**
 * 以前は「メニューがキー入力を飲み込むから止まる」に頼っていたが、
 * 飲み込み方（capture の順番）に寄りかかった止め方は、
 * **入力の出どころが増えると崩れる**——ゲームパッドの合成イベント（GS-58）は
 * window へ直に送るので捕まえる段が無く、メニューを開いたまま歩けてしまった。
 */
export function canWalk(state: Pick<UiState, 'phase' | 'busy' | 'menu' | 'settings' | 'battle'>): boolean {
  return sceneOf(state) === 'field';
}

interface UiState {
  phase: Phase;
  /** セーブ画面を出しているか。 */
  menu: boolean;
  /** 設定画面を出しているか（GS-32）。タイトルからも遊んでいる最中からも開く。 */
  settings: boolean;
  talk: Talk | null;
  scroll: ScrollText | null;
  choices: string[] | null;
  /** 立ち絵。同じ `slot` は 1 枚だけ。 */
  portraits: Portrait[];
  /** 0 = そのまま、1 = 真っ黒。 */
  fade: number;
  /**
   * 黒くする／明けるのにかける時間（ミリ秒。GS-28）。
   * **黒を出すときは 0**（一瞬で覆う）。かけて出すと、その間だけ素の画面が見えてしまう。
   */
  fadeMs: number;
  /** イベント実行中か。歩く操作を止めるのに使う（構想 §5.2）。 */
  busy: boolean;
  /**
   * 戦闘中に出す敵（GS-60）。台帳の id を並べる。null なら戦っていない。
   * **面子の中身はここに置かない**——HP の増減を毎回 React に流すと描き直しになる
   * （プレイヤー座標をここに置かないのと同じ理由）。 */
  battle: string[] | null;
  /**
   * 開いている店（GS-66）。**イベントの最中にしか開かない**ので、
   * 歩きを止める旗（`busy`）はイベント側がすでに立てている。
   */
  shop: { items: string[]; sell: boolean } | null;
  setPhase(phase: Phase): void;
  setMenu(open: boolean): void;
  setSettings(open: boolean): void;
  setTalk(talk: Talk | null): void;
  setScroll(scroll: ScrollText | null): void;
  setChoices(choices: string[] | null): void;
  /** 1 枚出す（GS-143）。同じ `id` が出ていれば差し替える。 */
  showPortrait(entry: { id: string; slot: string; src: string; from?: PortraitSide | 'none'; flip?: boolean; ms?: number }): void;
  /** 出ている絵に効果をかける（GS-143）。知らない `id` なら何もしない。 */
  fxPortrait(id: string, fx: Partial<Pick<Portrait, 'out' | 'opacity' | 'shake' | 'scale' | 'ms'>>): void;
  /** その `id` を出ていかせる。`now` ならその場で消す。 */
  hidePortrait(id: string, to?: PortraitSide | 'none'): void;
  /** 出切ったものを消す（GS-31）。 */
  dropPortrait(id: string): void;
  /** 全部を出ていかせる。イベントの終わりに呼ぶ。 */
  clearPortraits(): void;
  setFade(value: number, ms?: number): void;
  setBusy(busy: boolean): void;
  setBattle(enemies: string[] | null): void;
  setShop(shop: { items: string[]; sell: boolean } | null): void;
}

export const useUi = create<UiState>((set) => ({
  phase: 'title',
  menu: false,
  settings: false,
  talk: null,
  scroll: null,
  choices: null,
  portraits: [],
  fade: 0,
  fadeMs: 400,
  busy: false,
  battle: null,
  shop: null,
  setPhase: (phase) => set({ phase }),
  setMenu: (menu) => set({ menu }),
  setSettings: (settings) => set({ settings }),
  setTalk: (talk) => set({ talk }),
  setScroll: (scroll) => set({ scroll }),
  setChoices: (choices) => set({ choices }),
  showPortrait: ({ id, slot, src, from = 'none', flip = false, ms = PORTRAIT_MS }) =>
    set((state) => {
      const made = { id, slot, src, from, flip, opacity: 1, shake: 0, shakeAt: 0, scale: 1, ms };
      // 同じ名前が出ていれば**その場で差し替える**（出ていく途中でも）。
      const at = state.portraits.findIndex((entry) => entry.id === id);
      if (at < 0) return { portraits: [...state.portraits, made] };
      // **並びは変えない。** 末尾へ積み直すと React が DOM を並べ替え、
      // 移された `<img>` は**入りのアニメがもう一度走る**。
      const portraits = [...state.portraits];
      portraits[at] = made;
      return { portraits };
    }),
  fxPortrait: (id, fx) =>
    set((state) => ({
      portraits: state.portraits.map((entry) =>
        entry.id === id
          ? // 通し番号を進めるのは**揺らすときだけ**。止めるとき（0）まで数えると
            // 偶奇が 1 往復で戻り、続けて揺らしても同じ名前のままになる。
            { ...entry, ...fx, shakeAt: fx.shake ? entry.shakeAt + 1 : entry.shakeAt }
          : entry,
      ),
    })),
  hidePortrait: (id, to) =>
    set((state) => {
      const found = state.portraits.find((entry) => entry.id === id);
      if (!found) return {};
      // 滑らせない指定なら、その場で外す。
      const side = to ?? (found.from === 'none' ? 'none' : found.from);
      if (side === 'none') return { portraits: state.portraits.filter((entry) => entry.id !== id) };
      // ふだんは「出ていけ」の印だけ。実際に外すのは `dropPortrait`（GS-31）。並びは変えない。
      return { portraits: state.portraits.map((entry) => (entry.id === id ? { ...entry, out: side } : entry)) };
    }),
  dropPortrait: (id) =>
    set((state) => ({ portraits: state.portraits.filter((entry) => entry.id !== id) })),
  clearPortraits: () =>
    set((state) => ({
      // 片付けは**いつも同じ速さ**（GS-143）。その絵に最後に与えた時間を使い回すと、
      // ゆっくり薄くした絵だけ長く残り、1 枚取り残されたように見える。
      portraits: state.portraits.map((entry) => ({
        ...entry,
        out: entry.from === 'none' ? 'left' : entry.from,
        ms: PORTRAIT_MS,
      })),
    })),
  setFade: (fade, ms = 400) => set({ fade, fadeMs: ms }),
  setBusy: (busy) => set({ busy }),
  setBattle: (battle) => set({ battle }),
  setShop: (shop) => set({ shop }),
}));
