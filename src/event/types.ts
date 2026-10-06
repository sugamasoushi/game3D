// イベントの形（JSON の型）。**ここに無いものは動かない**——それが安全と編集しやすさの元。
//
// JSON にはコードを書かない。書くのは「どの命令を、どんな引数で」だけ。
// 命令の中身（実際に動く関数）は `commands.ts` の表に持つ。
// だからイベントエディタは**この型どおりの入力欄を出すだけ**で済む。

/**
 * 動かす相手。主人公か、マップに置いた物の名前（`npc:<id>`）。
 *
 * **`this`（話しかけた相手）はやめた**（GS-162）。踏む・入ったら動くイベントでは
 * 誰も指さず、**黙って動かない**だけだった——画面では「命令を書いたのに何も起きない」
 * としか見えない。名指しなら取り違えようがない。
 */
export type ActorRef = 'player' | `npc:${string}` | `party:${string}`;
/*
 * **`party:<id>` は隊列の仲間**（GS-184）。主人公の後ろを付いて歩いている人（`party.json` の `members`）。
 * 受けるのは「置き直す」「向く」「ジャンプ」だけ。置いた仲間は**イベントが終わるまでその場に留まり**、
 * 終わると隊列へ戻る。先頭（＝主人公）を指したときは `player` と同じ。
 */

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

/** 条件命令（`if`）の条件 1 つ。フラグ／セルフフラグ／変数／持ち物／所持金のどれか。 */
export type IfCondition =
  // フラグは**実行可能かどうか**（GS-147）。`is` を省くと「立っている（まだ動ける）とき」。
  // 済んだかどうかで分けたいときは `is: false` と書く。
  | { switch: string; is?: boolean }
  | { self: string; is?: boolean }
  | { variable: string; op: '==' | '!=' | '>=' | '<=' | '>' | '<'; value: number }
  /** 持ち物（GS-46）。`count` 個**以上**持っているか。省略は 1。 */
  | { item: string; count?: number }
  /** 所持金（GS-65）。その額**以上**持っているか。 */
  | { gold: number };

/** 条件命令の 1 つの枝の条件（GS-197）。1 つか、並び（**全部満たしたら当たり**＝`&&`）。 */
export type IfWhen = IfCondition | IfCondition[];

export type EventCommand =
  /**
   * 会話。`face` は表情キー（`characterdata` の `normal` / `smile` …）。
   *
   * **`hold` を書くと、押さなくても時間で送る**（GS-172。ミリ秒）。旧作の
   * 「ラミィが仲間になった！！」のような**お知らせの窓**——読ませるだけで、
   * 選ばせも待たせもしないものに使う。数えるのは**文字が出そろってから**なので、
   * 長い文でも途中で消えない。押せばそれより早く送れる。
   */
  | { type: 'message'; talk: TalkLine[]; face?: string; style?: TalkStyle; hold?: number }
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
  /**
   * **書き方は 2 通り**（GS-158）。どちらも歩き方（速さ・滑らせる・待つ）は同じ。
   *
   *   1. **行き先（座標）**: `to` にマス。上に書いたとおり、道順はゲームが組む
   *   2. **向きと歩数**: `dir` に向き、`cells` にマス数。曲がらずまっすぐ歩く
   *
   * 2 の `relative` を入れると、`dir` は**向いている方から見た前後左右**になる
   * （`up` が前、`down` が後ろ、`left` / `right` はその人から見た左右）。
   * **向きは動き出す前に 1 度だけ解く**——ふつうの歩きは進む方を向くので、
   * 1 歩ごとに解き直すと「後ろへ 3 マス」が 1 歩目で折り返してしまう。
   */
  | ({
      type: 'move';
      /** 向きも足も動かさずに運ぶ（GS-155）。殴られて後ろへ飛ぶ、氷で滑る。 */
      slide?: boolean;
      target: ActorRef;
      speed?: number;
      wait?: boolean;
    } & (
      | { to: PlaceAt; first?: 'leftRight' | 'upDown'; dir?: undefined; cells?: undefined; relative?: undefined }
      | { dir: Step; cells?: number; relative?: boolean; to?: undefined; first?: undefined }
    ))
  /** 向きだけ変える。 */
  | { type: 'turn'; target: ActorRef; to: Step }
  /**
   * その場で足踏み（GS-168）。**進まずに足だけ動かす。**
   * もがく・慌てる・走り出す前の溜め・その場で駆ける、といった絵に使う。
   *
   * `dir` を書くとその向きを向いて踏む（省くと今の向きのまま）。
   * `steps` は**足を踏み替える回数**（省くと 4）。かかる時間はその絵の台帳しだい
   * （`actors.json` の `walk.ms`。既定 160ms／歩、走ると速い）。
   * `wait` を false にすると踏み終わるのを待たない。
   *
   * **`always` で「止めるまでずっと」**（GS-169）。数を数えないので**待たない**——
   * そのまま次の命令へ進み、`stop` を書いた所（かイベントの終わり）で止まる。
   * `stop` は**そのキャラの足踏みを止める**。マップの `StepInPlace`（常時の足踏み）も
   * これで止まる（次にマップを読み直すまで）。
   */
  | {
      type: 'stepInPlace';
      target: ActorRef;
      dir?: Step;
      steps?: number;
      run?: boolean;
      wait?: boolean;
      always?: boolean;
      stop?: boolean;
    }
  /**
   * その場に置き直す（GS-137）。**歩かず一瞬で移る。** `at` はマス（整数）。
   * 「画面の外から歩いて来る」を作るためのもの——出番の前に道の奥へ置き、そこから `move` で歩かせる。
   * マップに置いた場所は**書き換えない**ので、入り直せば元の場所に戻る。
   *
   * **プレイヤーも置ける**（GS-163）。カメラの追い先も一緒に移るので、置いた先から滑ってこない。
   * 別のマップへ移すのは `transfer`。
   *
   * 画面を動かしたくないときは、手前で **`cameraFollow`**（カメラ追従）を切る（GS-166）。
   *
   * 軸ごとに **`"player"`** と書くと**主人公と同じ座標**に合わせる（GS-154）。
   * 旧作の `setPosition(player.x, 902)`（横は主人公に合わせ、奥行きは決め打ち）がこれに当たる。
   *
   * **現れ方と不透明度**（GS-207。NPC だけ）。`appear` を書くと透明から現れる——
   * `glow` は**白く光ってから色が戻る**（幽霊・魔法）、`fade` はふわっと浮かぶ。`ms` はその長さ（既定 1200）。
   * `opacity` は**不透明度（%）**。幽霊のような半透明の人は `70` など。書かなければ 100（`appear` だけなら不透明で現れる）。
   * `wait: false` で現れ終わるのを待たない。不透明度はその場かぎり——マップを読み直すとマップの `Opacity` に戻る。
   */
  | {
      type: 'place';
      target: ActorRef;
      at: PlaceAt;
      face?: Step;
      px?: PixelOffset;
      appear?: 'glow' | 'fade';
      opacity?: number;
      ms?: number;
      wait?: boolean;
    }
  /**
   * その場でジャンプ（GS-184）。**進まない**——絵だけ跳ねて着地する。怒る・喜ぶ・驚く。
   * `times` 回（省くと 3）、1 回 `ms`（省くと 200）、高さ `height` マス（省くと 0.5）。
   * `wait` を false にすると跳ね終わるのを待たない（旧作の tween と同じく、話と重ねられる）。
   */
  | { type: 'jump'; target: ActorRef; times?: number; height?: number; ms?: number; wait?: boolean }
  /**
   * 漫画のようにめくるイベントイラスト（GS-188。旧作 EVENT020301）。絵は `assets/img/Event/`（拡張子まで）。
   * 1 枚ずつ左から滑り込んで前の絵に重なり、最後の先へ進むと全部が右へ抜ける。
   *
   * - `read`（既定）…… **遊ぶ人がめくる**。→ / 決定 / 右の矢印で次、← / 取り消し / 左の矢印で戻る。
   *   最後までめくると閉じる。`images` を省くと、`open` で出してある絵の続きから読ませる
   * - `open` …… 絵を出して 1 枚目を滑り込ませる（イベントがめくる）
   * - `next` / `prev` …… 1 枚めくる／戻す。最後の先の `next` は閉じる
   * - `close` …… 全部を右へ抜いて片付ける
   *
   * どれも**めくり終わりを待つ**（`read` は読み終わるまで）。`wait: false` で待たずに次へ。
   * `ms` は 1 枚が滑る時間（省くと 500）、`se` はめくる音（省くと `cardTurnOver`、空で鳴らさない）。
   * 出したままイベントが終わると、片付けで消える。
   */
  | {
      type: 'comic';
      op?: 'read' | 'open' | 'next' | 'prev' | 'close';
      images?: string[];
      ms?: number;
      se?: string;
      wait?: boolean;
    }
  /**
   * カメラ追従（GS-166）。**主人公を追うかどうかを切り替える。** 既定は追う。
   *
   * 切ると画面はその場に止まり、`on: true` で戻すとその場で主人公へ寄る。
   * **戻し忘れても、イベントの終わりとマップの読み直しで既定へ戻る。**
   *
   * 移動の欄ではなく**別の命令**にしてあるのは、`置き直す` を 2 つ並べたときに
   * 2 つ目の「追う」で画面が跳ね返ってしまうため（GS-165 の作りの取り消し）。
   * 止めたいところで切り、動かしたいところで戻す——**書いた所だけが効く**。
   */
  | { type: 'cameraFollow'; on: boolean }
  /**
   * 消す（GS-157）。**その場ですぐ居なくなる。** 見送った鶏、倒したイベント敵、去っていく人。
   *
   * 消えたことは**そのキャラ自身の覚え**（`self:消えた`）に残るので、
   * **マップを読み直しても戻ってこない**。逆に出すのは「置き直す」（`place`）で、
   * こちらは `self:出た` を残す。**マップに `HideIf` とイベント名を書く必要はない。**
   *
   * `remember` を切ると覚えない——その場だけ消し、マップに入り直せば元どおり立っている。
   *
   * **`vanish: 'fade'` でフェードアウトして消える**（GS-208）。いまの濃さ（半透明の人ならその濃さ）から
   * 透明へ薄くなってから居なくなる。`ms` はその長さ（既定 1000）、`wait: false` で消え終わるのを待たない。
   */
  | { type: 'hide'; target: ActorRef; remember?: boolean; vanish?: 'fade'; ms?: number; wait?: boolean }
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
   *
   * `x` / `y` は置き場所からのずれ（GS-170）。**画面の幅・高さに対する割合（％）**で、
   * `x` は右が＋、`y` は上が＋。3 枚並べて重ねるときの寄せに使う
   * （旧作の「じいちゃんは主人公の少し左」= 中央から少し右へ寄せる）。
   * 場面絵（`scene`）は画面いっぱいなので効かない。
   */
  | {
      type: 'portrait';
      /**
       * 置き場所。`scene` だけ別物で、**イベントイラスト**（GS-161）——
       * `assets/img/Event/` の一枚絵を**画面いっぱい**に出す（立ち絵の後ろ）。
       * こちらは `image` に**拡張子まで**書く（`20250603.jpg`）。
       */
      slot: 'left' | 'center' | 'right' | 'scene';
      id?: string;
      who?: string;
      face?: string;
      image?: string;
      from?: 'left' | 'right' | 'top' | 'bottom' | 'none';
      flip?: boolean;
      ms?: number;
      hide?: boolean;
      instant?: boolean;
      /** 横のずれ（画面の幅に対する％。右が＋。GS-170）。 */
      x?: number;
      /** 高さのずれ（画面の高さに対する％。上が＋。GS-170）。 */
      y?: number;
      /**
       * 入りのアニメ（滑り込み・場面絵の現れ）が終わるまで待つか（GS-198）。既定は待つ。
       * 絵は読み込みが済んでから出す。同じ名前の差し替え（表情替え）は動かないので待たない。
       */
      wait?: boolean;
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
  /**
   * 条件分岐。プログラムの `if` / `else if` / `else` と同じ（GS-196）。
   * `when` → `then` を見て、外れたら `elif` を上から順に、どれにも当たらなければ `else`。
   * `when` は条件 1 つか、**並び（全部満たしたら当たり＝`&&`。GS-197）**。
   */
  | {
      type: 'if';
      when: IfWhen;
      then: EventCommand[];
      /** 2 つ目以降の条件（GS-196。`else if`）。上から順に見て、最初に当たった枝だけ動く。 */
      elif?: Array<{ when: IfWhen; then: EventCommand[] }>;
      /** どれにも当たらなかったとき（上記以外）。 */
      else?: EventCommand[];
    }
  /** マップ移動。`at` はマス（整数）。そのマスの中央に立つ。 */
  | {
      type: 'transfer';
      map: string;
      at: { x: number; y: number; z: number };
      face?: Step;
      fade?: boolean;
      /** マス内のずれ（ピクセル。GS-191）。そのマスの真ん中から。`x` は右（東）、`z` は下（南）が＋。 */
      px?: PixelOffset;
    }
  /**
   * 流れる文字（GS-23）。画面を暗くして、下から上へ流す。旧作のオープニングと同じ。
   * 決定キーかクリックで飛ばせる。
   *
   * `speed` は**総時間ではなく 1 行ぶんが流れる時間**（ミリ秒。GS-144）——
   * 総時間で決めると、行数の少ない読み物ほど速く流れて読めない。
   */
  | {
      type: 'scroll';
      lines: string[];
      speed?: number;
      dim?: number;
      /**
       * **頭の何行を「前置き」にするか**（GS-186。旧作のエンディング）。前置きは画面の真ん中に
       * フェードインで出て、`hold` ミリ秒止まってから、残りの行（画面の下から入る）と一緒に上へ流れる。
       * 省くか 0 なら今までどおり、全部が下から流れる。
       */
      lead?: number;
      /** 前置きを止めておく時間（ミリ秒。GS-186）。省くと 3000。フェードインのぶんは含まない。 */
      hold?: number;
    }
  /**
   * テロップ（GS-171）。**画面を黒で覆って、真ん中に一言だけ**出す。
   * 旧作の「━ 翌朝 ━」——時間や場所が飛んだことを知らせるためのもの。
   *
   * **会話ウィンドウは使わない。** 窓に入れると「地の文を喋る人」が居るように見える。
   * 黒は一瞬で置き、**クリック（か決定キー）で薄れて消える**。消え切ってから次の命令へ進むので、
   * 前後に `fade` を書く必要はない——この命令ひとつで暗転から明けまで済む。
   *
   * `ms` は消えるのにかける時間（省くと 800。旧作と同じ）。`dim` は黒さ（省くと 1＝真っ黒）。
   * `size` は字の大きさ（画素。省くと 56。旧作と同じ）。
   *
   * **消し方は 2 通り**（GS-172）。`click` を `false` にすると**押しても消えず**、
   * `hold`（ミリ秒）で勝手に消える——旧作の「1 秒置いて薄める」がこちら。
   * `click` を切って `hold` も書かなければ 1000 とみなす（**押せない・消えない**を作らないため）。
   * 両方在れば**早いほうが勝つ**（待ちきれない人は押して飛ばせる）。
   */
  | { type: 'telop'; lines: string[]; ms?: number; dim?: number; size?: number; click?: boolean; hold?: number }
  /** 音。 */
  | { type: 'playSe'; key: string; volume?: number }
  | { type: 'playBgm'; key: string; volume?: number }
  | { type: 'stopBgm'; fade?: number }
  /**
   * マスの絵を差し替える（GS-53）。宝箱の開閉、壊れる橋のような**ブロックの絵だけの切り替え**。
   * `chip` は全部の面を同じ番号に。`faces` は面ごと（`top` / `bottom` / `front` / `back` / `left` / `right`）。
   * `layer` を書けばそのレイヤーだけ。省略すると一番上のレイヤー。
   *
   * 差し替えられるのは**チップ番号と引き延ばし**だけ——形も絵柄（タイルセット）も変わらないので、
   * 当たりも影もそのまま。開けたら通れる宝箱のような物は、当たりのほうを別に用意する。
   *
   * `stretch` は面ごとの引き延ばし（1/32 刻み・**32 でマスいっぱい**。DEC-415）。
   * 数値 1 つは横縦とも、`[横, 縦]` で別々。**ブロック（箱）だけ**効く。
   * 開いた宝箱のように「絵の高さが違う」差し替えで使う。書かない面はそのまま。
   */
  | {
      type: 'block';
      at: { x: number; y: number; z: number };
      chip?: number;
      faces?: Partial<Record<BlockFace, number>>;
      stretch?: Partial<Record<BlockFace, number | [number, number]>>;
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
   * 枝は**書いたものだけ**動く。`lose` が未指定または空なら負け＝ゲームオーバー（タイトルへ）。
   * 「負けても話が続く」のは `lose` に命令があるときだけ。
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
  | { type: 'script'; id: string; args?: Record<string, unknown> }
  /** イベントを終了し、セーブせずタイトルへ戻る。 */
  | { type: 'returnToTitle' };

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
/**
 * マス内のずれ（ピクセル。GS-191）。**そのマスの真ん中から**数える。`x` は右（東）、`z` は下（南）が＋。
 * 1 ピクセルは 1/タイルの大きさ マス（32px のチップなら 1/32）。書かなければ今までどおりマスの真ん中。
 *
 * `y`（GS-192）は**立つ床を探す高さ**のずれ。＋にすると、そのぶん高い所にある床（段差・台の上）にも
 * 立てる。床の上に浮かせる物ではない（立つのは探した高さ以下で一番高い床）。
 */
export interface PixelOffset {
  x: number;
  y?: number;
  z: number;
}

export interface PlaceAt {
  x: PlaceAxis;
  y: PlaceAxis;
  z: PlaceAxis;
}

/**
 * マップ移動の行き先 1 つの決まり（GS-211）。行き先は `MapMove` のどれか。
 * 立ち位置は `at`（マス）か `marker`（行き先マップの点の名前）。どちらも無ければ `default`。
 */
export interface MapMoveTo {
  map: string;
  /** この行き先へ行く条件。`MapMove` の最後の行き先では見ない（上記以外）。 */
  when?: IfWhen;
  at?: { x: number; y: number; z: number };
  marker?: string;
  /** マス内のずれ（ピクセル。GS-191）。 */
  px?: PixelOffset;
  face?: Step;
}

/** 入口 1 つ（MAPMOVE レイヤーの物）の行き先の決まり（GS-211）。 */
export interface MapMoveDef {
  /** MAPMOVE レイヤーの中の物の id（`obj_4` など）。 */
  object: string;
  to: MapMoveTo[];
}

/** マップ 1 枚ぶんのイベント（`data/events/<マップ名>.json`）。 */
export interface EventFile {
  map: string;
  events: EventDef[];
  /** マップ移動の行き先の決まり（GS-211）。 */
  mapMoves?: MapMoveDef[];
}
