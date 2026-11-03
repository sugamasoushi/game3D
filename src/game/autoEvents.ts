// マップに入ったら動くイベント（`auto`）の出番（2026-11-02）。
//
// 入口をくぐると、暗転のあいだ画面は「手がふさがっている」（`busy`）。マップを読み直す所（`adopt`）で
// そのまま `play` を呼ぶと、`play` は手がふさがっているときは黙って何もしないので、**入口から入ったマップの
// auto は一度も動かなかった**（リッカ村の `commotion_entering_village` が起きず、本筋が `ending` で止まった）。
// イベントの `transfer` で移ったときも、動いているイベントで手がふさがっているので同じだった。
//
// そこで「入った」という札だけを立て、手が空いたところで 1 回だけ見る。

/** 入ったときに立てる札。`take` が true を返したら、その時に auto を見る（1 回だけ）。 */
export interface AutoEventGate {
  /** マップに入った。 */
  arm(): void;
  /** 手が空いていて札が立っていれば、札を下ろして true。空いていなければ札は立てたまま。 */
  take(free: boolean): boolean;
  /** マップを離れる・はじめから などで札を捨てる。 */
  clear(): void;
}

export function createAutoEventGate(): AutoEventGate {
  let armed = false;
  return {
    arm: () => {
      armed = true;
    },
    take: (free) => {
      if (!armed || !free) return false;
      armed = false;
      return true;
    },
    clear: () => {
      armed = false;
    },
  };
}
