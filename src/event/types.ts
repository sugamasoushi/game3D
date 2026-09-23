// イベントの形（JSON の型）。**ここに無いものは動かない**——それが安全と編集しやすさの元。
//
// JSON にはコードを書かない。書くのは「どの命令を、どんな引数で」だけ。
// 命令の中身（実際に動く関数）は `commands.ts` の表に持つ。
// だからイベントエディタは**この型どおりの入力欄を出すだけ**で済む。

/** 動かす相手。`this` は起動したイベント自身、`npc:<id>` はマップ上の名前。 */
export type ActorRef = 'player' | 'this' | `npc:${string}`;

/**
 * ブロックの面（GS-53）。**描画側の型は引かない**——イベントの型は
 * 何にも寄りかからないでおきたい（エディタもここだけ読めば入力欄を作れる）。
 * 名前は `mep3d` の `FaceName` と揃えてある。
 */
export type BlockFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** 歩く向き。マス単位で 1 歩ずつ進む。 */
export type Step = 'up' | 'down' | 'left' | 'right';

/** 会話の 1 かたまり。話者キーは `characterdata.json` を引く。 */
export interface TalkLine {
  /** 話者キー（`meina` など）。省略すると名前欄なし（地の文）。 */
  who?: string;
  /** 行。旧作と同じく 1 メッセージ内の改行は配列で分ける。 */
  lines: string[];
}

/**
 * 会話の見せ方（GS-23）。
 * `window` は下の会話ウィンドウ（イベント向け。立ち絵と一緒に使う）。
 * `bubble` は喋っている人の頭の上に出る吹き出し（フィールドの立ち話向け）。
 */
export type TalkStyle = 'window' | 'bubble';

export type EventCommand =
  /** 会話。`face` は表情キー（`characterdata` の `normal` / `smile` …）。 */
  | { type: 'message'; talk: TalkLine[]; face?: string; style?: TalkStyle }
  /**
   * 選択肢。`choices` の並びが答えの番号になり、`branches` の同じ番号を実行する。
   * `cancel` はキャンセルで選ばれる番号（省略なら不可）。
   */
  | { type: 'choice'; prompt?: TalkLine; choices: string[]; branches: EventCommand[][]; cancel?: number }
  /** 待つ。ミリ秒。 */
  | { type: 'wait'; ms: number }
  /** 暗転・明転。 */
  | { type: 'fade'; to: 'out' | 'in'; ms?: number }
  /**
   * 歩かせる（GS-138 / GS-139）。**行き先のマス**まで歩く。
   * 道順はゲームが組む——歩く向きはカメラの方位で回るので、
   * 「x が 3 増える」がどの向きの何歩かはイベントからは決められない。
   *
   * `first` は**どちらの向きから先に詰めるか**。`leftRight`（既定）は画面の横を先に、
   * `upDown` は縦を先に歩いてから曲がる。行き止まりを避けたいときに使い分ける。
   *
   * `y` は見ない（高さは床が決める）。**壁は避けない**ので、進めないマスは
   * 1 歩あたり 0.3 秒で諦めて次へ行く。`wait` を false にすると歩き終わるのを待たない。
   *
   * 行き先は `place` と同じ書き方（GS-154）。軸に `"player"` と書けば**プレイヤーと同じ座標**
   * ——自分を動かすときは「その軸は動かさない」の意味になる（殴られて**真後ろへ**飛ぶ、など）。
   */
  | {
      type: 'move';
      /** 向きも足も動かさずに運ぶ（GS-155）。殴られて後ろへ飛ぶ、氷で滑る。 */
      slide?: boolean;
      target: ActorRef;
      to: PlaceAt;
      first?: 'leftRight' | 'upDown';
      speed?: number;
      wait?: boolean;
    }
  /** 向きだけ変える。 */
  | { type: 'turn'; target: ActorRef; to: Step }
  /**
   * その場に置き直す（GS-137）。**歩かず一瞬で移る。** `at` はマス（整数）。
   * 「画面の外から歩いて来る」を作るためのもの——出番の前に道の奥へ置き、そこから `move` で歩かせる。
   * マップに置いた場所は**書き換えない**ので、入り直せば元の場所に戻る。
   *
   * 軸ごとに **`"player"`** と書くと**主人公と同じ座標**に合わせる（GS-154）。
   * 旧作の `setPosition(player.x, 902)`（横は主人公に合わせ、奥行きは決め打ち）がこれに当たる。
   */
  | { type: 'place'; target: ActorRef; at: PlaceAt; face?: Step }
  /**
   * キャライラスト。`slot` は左・中・右。`who` を空にする（`hide`）とその絵を引っ込める。
   *
   * `image` は**フリーイラスト**（GS-142）——`characterdata.json` を引かず、
   * `assets/img/CharaStand` の絵を**名前で直に**出す。人に結び付かない一枚絵
   * （回想・看板・ロゴなど）のためのもので、**書いてあれば `who` より優先**する。
   *
   * `id` は**このイベントの中だけの名前**（GS-143）。付けなければ `slot` が名前になるので、
   * 今までどおり「左の絵」「右の絵」として扱える。付ければ同じ場所に何枚も重ねられ、
   * `imageFx` で 1 枚ずつ動かせる。
   *
   * `from` は入ってくる向き（`none` で滑らせない）。省くと置いた側から滑り込む。
   *
   * `flip` は**左右反転**（GS-146）。右に置いた絵を左向きにしたいときに使う。
   */
  | {
      type: 'portrait';
      slot: 'left' | 'center' | 'right';
      id?: string;
      who?: string;
      face?: string;
      image?: string;
      from?: 'left' | 'right' | 'top' | 'bottom' | 'none';
      flip?: boolean;
      ms?: number;
      hide?: boolean;
      instant?: boolean;
    }
  /**
   * 出ているキャライラストに効果をかける（GS-143）。**`id` で 1 枚を指す**。
   *
   * - `out` …… `to` の向きへ流して消す。省くと入ってきた側へ帰る
   * - `shake` …… `power`（画素）ぶん揺らす。終わると元の位置へ戻る
   * - `fade` …… `opacity`（0〜1）まで濃さを変える。0 で見えなくなる（絵は残る）
   * - `zoom` …… `scale` 倍まで大きさを変える（1 がふつう。2 で 2 倍。GS-145）。
   *   伸びる軸は**足元**なので、大きくしても立ち位置は動かない
   *
   * `fade` と `zoom` は**かけたままになる**（元に戻すなら戻す値でもう一度かける）。
   * `shake` だけは終わったらこちらで止める。
   *
   * 既定では動き終わるまで待つ。`wait: false` で待たない。
   */
  | {
      type: 'imageFx';
      id: string;
      kind: 'out' | 'shake' | 'fade' | 'zoom';
      to?: 'left' | 'right' | 'top' | 'bottom';
      opacity?: number;
      power?: number;
      scale?: number;
      ms?: number;
      wait?: boolean;
    }
  /** スイッチ（真偽）。名前は文字列キー。 */
  | { type: 'setSwitch'; key: string; value: boolean }
  /** 変数（数値）。`op` 省略は代入。 */
  | { type: 'setVariable'; key: string; value: number; op?: 'set' | 'add' | 'sub' }
  /**
   * セルフスイッチ（GS-27）。**そのイベントだけの覚え**。
   * 「この宝箱は開けた」をマップごとの通しスイッチにすると、置くたびに名前を考えることになる。
   */
  | { type: 'setSelfSwitch'; key: string; value: boolean }
  /** 条件分岐。`switch` か `variable` のどちらかを見る。 */
  | {
      type: 'if';
      when:
        // フラグは**実行可能かどうか**（GS-147）。`is` を省くと「立っている（まだ動ける）とき」。
        // 済んだかどうかで分けたいときは `is: false` と書く。
        | { switch: string; is?: boolean }
        | { self: string; is?: boolean }
        | { variable: string; op: '==' | '!=' | '>=' | '<=' | '>' | '<'; value: number }
        /** 持ち物（GS-46）。`count` 個**以上**持っているか。省略は 1。 */
        | { item: string; count?: number }
        /** 所持金（GS-65）。その額**以上**持っているか。 */
        | { gold: number };
      then: EventCommand[];
      else?: EventCommand[];
    }
  /** マップ移動。`at` はマス（整数）。そのマスの中央に立つ。 */
  | { type: 'transfer'; map: string; at: { x: number; y: number; z: number }; face?: Step; fade?: boolean }
  /**
   * 流れる文字（GS-23）。画面を暗くして、下から上へ流す。旧作のオープニングと同じ。
   * 決定キーかクリックで飛ばせる。
   *
   * `speed` は**総時間ではなく 1 行ぶんが流れる時間**（ミリ秒。GS-144）——
   * 総時間で決めると、行数の少ない読み物ほど速く流れて読めない。
   */
  | { type: 'scroll'; lines: string[]; speed?: number; dim?: number }
  /** 音。 */
  | { type: 'playSe'; key: string; volume?: number }
  | { type: 'playBgm'; key: string; volume?: number }
  | { type: 'stopBgm'; fade?: number }
  /**
   * マスの絵を差し替える（GS-53）。宝箱の開閉、壊れる橋のような**ブロックの絵だけの切り替え**。
   * `chip` は全部の面を同じ番号に。`faces` は面ごと（`top` / `bottom` / `front` / `back` / `left` / `right`）。
   * `layer` を書けばそのレイヤーだけ。省略すると一番上のレイヤー。
   *
   * 差し替えられるのは**チップ番号だけ**——形も絵柄（タイルセット）も変わらないので、
   * 当たりも影もそのまま。開けたら通れる宝箱のような物は、当たりのほうを別に用意する。
   */
  | {
      type: 'block';
      at: { x: number; y: number; z: number };
      chip?: number;
      faces?: Partial<Record<BlockFace, number>>;
      layer?: string;
    }
  /**
   * 静止コマを指名する（GS-47）。宝箱の開閉のような**絵だけの切り替え**。
   * `name` は台帳（`actors.json`）の `poses` のキー。`null` で歩きの絵に戻る。
   */
  | { type: 'pose'; target: ActorRef; name: string | null }
  /**
   * 持ち物（GS-46）。`id` は `data/items.json` のキー。`count` は省略で 1。
   * **減らすほうは別の命令**にしてある——負の数で渡す形にすると、書き間違いが静かに増える。
   *
   * **`id` を空にすると、そのイベントを起こしたオブジェクトの `Item` を使う**（GS-132）。
   * `count` を省くと同じく `Num`（それも無ければ 1）。宝箱のように「中身はマップが決める」物を、
   * **1 本の共通イベントで**開けられるようにするためのもの。
   */
  | { type: 'getItem'; id?: string; count?: number }
  | { type: 'loseItem'; id?: string; count?: number }
  /**
   * 仲間の出入り（GS-70）。`who` は `data/party.json` の人。
   * **最後の 1 人は外せない**（誰も居ない隊列は次の戦いで即座に負ける）。
   */
  | { type: 'party'; op: 'join' | 'leave'; who: string }
  /**
   * カメラ演出（GS-73）。光る・揺れる・寄る・暗くする。
   * **値はここに書く**（マップには持たせない。GS-75）ので、どのマップでも同じように使える。
   *
   * `kind` は `flash` / `shake` / `zoom` / `veil`。`ms`・`power`・`color`・`hold` は
   * 省略すると種類ごとの既定。**既定では終わるまで待つ**——`wait: false` で待たない。
   * `release` を立てると、残している演出（`hold` の暗転・寄り）を戻す。
   */
  | {
      type: 'shot';
      id?: string;
      kind?: string;
      ms?: number;
      power?: number;
      color?: string;
      hold?: boolean;
      wait?: boolean;
      release?: boolean;
    }
  /**
   * 店（GS-66）。`items` は並べる物（`items.json` のキー）。**値段は台帳**が持つ。
   * `sell` を false にすると買い取らない店になる。閉じるまで次の命令へ進まない。
   */
  | { type: 'shop'; items: string[]; sell?: boolean }
  /**
   * 所持金（GS-65）。`op` 省略は足す——**店や宿は「減らす」より「渡す」ほうが多い**。
   * 減らすときは `sub`。持っている以上は減らない（0 で止まる）。
   */
  | { type: 'gold'; value: number; op?: 'add' | 'sub' | 'set' }
  /**
   * 回復（GS-64）。宿・泉・話の区切りで使う。`hp` / `mp` は戻す量で、
   * `"full"` なら満タンまで。`who` を書かなければ**隊列ぜんぶ**。
   */
  | {
      type: 'heal';
      hp?: number | 'full';
      mp?: number | 'full';
      /** 消す状態異常（GS-71）。`"all"` で全部——宿はこれ。 */
      cure?: string[] | 'all';
      who?: string;
    }
  /** 共通イベントを呼ぶ。 */
  | { type: 'callCommon'; id: string }
  /**
   * 戦闘（GS-60）。`enemies` は `data/enemies.json` のキーを並べる
   * （同じ id を 2 つ書けば 2 体出る）。終わるまで次の命令へ進まない。
   *
   * 枝は**書いたものだけ**動く。`lose` を書かなければ負け＝ゲームオーバー（タイトルへ）——
   * 「負けても話が続く」戦いは、書いた人が `lose` を書いたときだけにする。
   */
  | {
      type: 'battle';
      enemies: string[];
      /** `battleFormations.json` のID。指定時はマップのランダム候補より優先。 */
      formation?: string;
      win?: EventCommand[];
      lose?: EventCommand[];
      escape?: EventCommand[];
    }
  /**
   * 逃げ道（構想 §4.1）。**JSON にコードは書かない**——ここに書くのは
   * TS 側に登録した関数の**名前**。オープニングのスクロールのような
   * 一度きりの演出を、コマンド表を増やさずに置ける。
   */
  | { type: 'script'; id: string; args?: Record<string, unknown> };

/** イベント 1 本。 */
export interface EventDef {
  /**
   * 話しかける相手（GS-22）。この NPC に話しかけたときに動く。
   * マップ側に `Event` を書く代わりに**イベント側から結び付ける**ためのもので、
   * どちらで書いてもよい（両方あればイベント側が勝つ）。
   */
  npc?: string;
  id: string;
  /**
   * 種類（EE-4）。**ゲームは読まない**——イベントエディタが並べ方と入力欄を決めるためだけの印。
   * `scenario`（踏む・入ったら動く話）/ `click`（調べ物）/ `talk`（話しかけ）/ `object`（宝箱などの物）。
   */
  kind?: string;
  /** 起動の仕方。`action` は決定キー、`touch` は踏む、`auto` はマップに入ったら。 */
  trigger: 'action' | 'touch' | 'auto' | 'parallel';
  /** 動かす条件（全部満たしたときだけ動く）。省略は無条件。 */
  when?: Array<{ switch?: string; self?: string; is?: boolean }>;
  commands: EventCommand[];
}

/**
 * 行き先の 1 軸（GS-154）。**数はマス、`"player"` はプレイヤーと同じ座標。**
 *
 * 自分（プレイヤー）を動かすときの `"player"` は「**その軸は動かさない**」の意味になる——
 * 殴られて真後ろへ飛ぶ、など。
 *
 * 範囲で挟む書き方（`{ of: 'player', min, max }`）も作ったが**やめた**（2026-09-23）。
 * エディタに欄が無い設定は、台帳にだけ残って誰にも見えなくなる。
 */
export type PlaceAxis = number | 'player';

/**
 * 置き直す先（GS-154）。数はマス、**`"player"` は主人公と同じ**。
 * 「主人公の目の前」は `{ x: 'player', y: 'player', z: 7 }` のように軸ごとに混ぜて書く。
 */
export interface PlaceAt {
  x: PlaceAxis;
  y: PlaceAxis;
  z: PlaceAxis;
}

/** マップ 1 枚ぶんのイベント（`data/events/<マップ名>.json`）。 */
export interface EventFile {
  map: string;
  events: EventDef[];
}
