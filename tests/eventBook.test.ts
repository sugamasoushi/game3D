// イベントの台帳（`data/events/*.json`）が他の台帳と食い違っていないか（GS-127）。
//
// **書き間違いは画面では静かに落ちる**——知らない話者は名前欄が空になるだけ、
// 知らない音は警告 1 行、知らない敵は「敵が居ない」で戦闘が即終わる。
// どれもイベントを最後まで再生しないと気づけないので、ここで先に当てる。

import { deepStrictEqual, ok } from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EventCommand, EventDef, EventFile } from '../src/event/types';
import type { MapDef } from '../src/mep3d/types';
import { readNpcs } from '../src/game/npcs';
import { readEventSpots } from '../src/game/eventSpots';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', path), 'utf8'));
const keys = (book: Record<string, unknown>) => new Set(Object.keys(book));

const characters = keys(read('characterdata.json'));
const enemies = keys(read('enemies.json').enemies);
const sounds = keys(read('sounds.json').sounds);
const cues = keys(read('cameraCues.json').cues);
const members = keys(read('party.json').members);
const maps = keys(read('maps.json').maps);
const items = keys(read('items.json').items ?? read('items.json'));

/** 命令の表（`interpreter.ts`）に在る型だけを使う。表は 1 か所（GS-13）。 */
const known = new Set(
  [...readFileSync(join(ROOT, 'src', 'event', 'interpreter.ts'), 'utf8').matchAll(/^ {2}(\w+): async \(ctx/gm)].map(
    (match) => match[1],
  ),
);

const books: Array<{ file: string; book: EventFile }> = readdirSync(join(ROOT, 'public', 'data', 'events'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ file: name, book: read(join('events', name)) as EventFile }));

/** 命令を 1 つずつ見る（枝の中も）。 */
function each(list: EventCommand[], visit: (command: EventCommand) => void): void {
  for (const command of list) {
    visit(command);
    if (command.type === 'choice') for (const branch of command.branches) each(branch, visit);
    if (command.type === 'if') {
      each(command.then, visit);
      for (const arm of command.elif ?? []) each(arm.then, visit);
      if (command.else) each(command.else, visit);
    }
    if (command.type === 'battle') for (const branch of [command.win, command.lose, command.escape]) if (branch) each(branch, visit);
  }
}

const everyCommand = (visit: (command: EventCommand, where: string) => void) => {
  for (const { file, book } of books) {
    for (const event of book.events) each(event.commands, (command) => visit(command, `${file} ${event.id}`));
  }
};

test('台帳が 1 枚もない、は取り違え', () => {
  ok(books.length >= 5, `イベントの台帳が ${books.length} 枚しかない`);
});

test('使っている命令は表（interpreter.ts）に在るものだけ', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (!known.has(command.type)) gone.push(`${where}: ${command.type}`);
  });
  deepStrictEqual(gone, []);
});

test('話者・立ち絵・敵・音・カメラ演出・仲間・マップ・持ち物は台帳に在る', () => {
  const gone: string[] = [];
  const want = (ok_: boolean, line: string) => {
    if (!ok_) gone.push(line);
  };
  everyCommand((command, where) => {
    if (command.type === 'message') {
      for (const talk of command.talk) if (talk.who) want(characters.has(talk.who), `${where}: 話者 ${talk.who}`);
    }
    if (command.type === 'portrait' && command.who) want(characters.has(command.who), `${where}: 立ち絵 ${command.who}`);
    if (command.type === 'battle') for (const one of command.enemies) want(enemies.has(one), `${where}: 敵 ${one}`);
    if (command.type === 'playSe' || command.type === 'playBgm') want(sounds.has(command.key), `${where}: 音 ${command.key}`);
    if (command.type === 'shot' && command.id) want(cues.has(command.id), `${where}: カメラ演出 ${command.id}`);
    if (command.type === 'party') want(members.has(command.who), `${where}: 仲間 ${command.who}`);
    if (command.type === 'transfer') want(maps.has(command.map), `${where}: マップ ${command.map}`);
    // `id` を空にすると**マップの `Item`**（GS-132）。その形は台帳では見ない。
    if ((command.type === 'getItem' || command.type === 'loseItem') && command.id)
      want(items.has(command.id), `${where}: 持ち物 ${command.id}`);
  });
  deepStrictEqual(gone, []);
});

test('条件に使うスイッチは、どこかのイベントが立てている（話がつながっているか）', () => {
  const written = new Set<string>();
  everyCommand((command) => {
    if (command.type === 'setSwitch') written.add(command.key);
  });
  const gone: string[] = [];
  for (const { file, book } of books) {
    for (const event of book.events) {
      for (const cond of event.when ?? []) {
        // セルフスイッチはそのイベントの中だけの覚えなので見ない。
        if (cond.self !== undefined || !cond.switch) continue;
        if (!written.has(cond.switch)) gone.push(`${file} ${event.id}: 誰も立てない ${cond.switch}`);
      }
    }
  }
  deepStrictEqual(gone, []);
});

// フラグの向きは**旧作と同じ**（GS-147）——**true＝まだ動ける／false＝もう動かない**。
// 書いていないフラグは true（＝動ける）。だから 1 回きりのイベントは
// 「`when` は `is: true`、終わりに自分を `false`」で書く。
//
// 終わりに `true` を書いてしまうと**永久に終わらない**——踏むたびに何度でも動き、
// そのフラグを見ている `ShowIf` のキャラも消えない。画面では「話が終わったのにまた始まる」
// としか見えないので、ここで当てる（実際に 0102 の見送りで起きた）。
test('終わりの旗は **false で寝かせる**。自分の条件を true のままにし直さない', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    for (const event of book.events as EventDef[]) {
      // 「立っているときだけ動く」旗＝そのイベントが動いてよいかの印。
      const guards = (event.when ?? [])
        .filter((cond) => cond.self === undefined && cond.switch && (cond.is ?? true) === true)
        .map((cond) => cond.switch as string);
      if (!guards.length) continue;
      each(event.commands, (command) => {
        if (command.type !== 'setSwitch' || command.value !== true) return;
        if (guards.includes(command.key)) gone.push(`${file} ${event.id}: ${command.key} を true にしている`);
      });
    }
  }
  deepStrictEqual(gone, []);
});

// 「どちらかを通ったら両方とも済み」にしたいときは、**相手の旗も同じ向きで**寝かせる。
// 片方だけだと、通っていないほうが後から動いて話が二重になる（0102 の見送りと立ち話）。
test('相手の旗も一緒に寝かせるイベントは、**同じ false** で揃っている', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    const ids = new Set(book.events.map((event) => event.id));
    for (const event of book.events as EventDef[]) {
      each(event.commands, (command) => {
        if (command.type !== 'setSwitch') return;
        // 同じマップの**別のイベント**の id を触っている＝「あちらも済みにする」書き方。
        if (command.key === event.id || !ids.has(command.key)) return;
        if (command.value !== false) gone.push(`${file} ${event.id}: ${command.key} = ${command.value}`);
      });
    }
  }
  deepStrictEqual(gone, []);
});

// 1 回きりのイベントは、**自分のフラグを必ず寝かせて終わる**（GS-147）。
// 書き忘れると、条件が `is: true` のまま＝何度でも動く。
test('`is: true` で守られたイベントは、自分の旗を必ず寝かせる', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    for (const event of book.events as EventDef[]) {
      const self = (event.when ?? []).some(
        (cond) => cond.switch === event.id && (cond.is ?? true) === true,
      );
      if (!self) continue;
      let sleeps = false;
      each(event.commands, (command) => {
        if (command.type === 'setSwitch' && command.key === event.id && command.value === false) sleeps = true;
      });
      if (!sleeps) gone.push(`${file} ${event.id}: 終わりに ${event.id} = false が無い`);
    }
  }
  deepStrictEqual(gone, []);
});

test('自分から動くイベント（auto）は必ず条件を持つ。**無いと入るたびに動き続ける**', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    for (const event of book.events as EventDef[]) {
      if (event.trigger !== 'auto' && event.trigger !== 'parallel') continue;
      if (!event.when?.length) gone.push(`${file} ${event.id}`);
    }
  }
  deepStrictEqual(gone, []);
});

// 話しかけ先（`npc`）は**イベント側から NPC に結び付ける**（GS-22）。結び付けは
// 「NPC の名前 → イベント」の 1 対 1 で、**後から読んだほうが勝つ**。同じ相手を 2 本が指すと、
// 片方は**二度と出ない**のに、指されなかった NPC は黙って無反応になる。
// 画面では「別の人の台詞が出る」「話しかけても何も起きない」としか見えない（実際に 0103 で起きた）。
test('同じ話しかけ先（npc）を 2 本のイベントが指していない', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    const seen = new Map<string, string>();
    for (const event of book.events as EventDef[]) {
      if (!event.npc) continue;
      const first = seen.get(event.npc);
      if (first) gone.push(`${file}: ${event.npc} を ${first} と ${event.id} が指している`);
      else seen.set(event.npc, event.id);
    }
  }
  deepStrictEqual(gone, []);
});

// 行き先は**マスの整数**か **`"player"`**（プレイヤーと同じ。GS-154）だけ。
// 書き損じ（`"Player"`、範囲つきの古い書き方など）は、画面では「変な所に立つ」
// 「動かない」にしか見えないので、ここで止める。
test('「置き直す」「移動」の行き先は、マスの整数か「player」', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'place' && command.type !== 'move') return;
    const at = command.type === 'place' ? command.at : command.to;
    // 「移動（方向指定）」は行き先を持たない（GS-158）。向きと歩数は下のテストで見る。
    if (!at) return;
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = (at as unknown as Record<string, unknown>)[axis];
      if (value === 'player') continue;
      if (typeof value === 'number' && Number.isFinite(value)) continue;
      gone.push(`${where}: at.${axis} = ${JSON.stringify(value)}`);
    }
  });
  deepStrictEqual(gone, []);
});

// 出入りはイベントが決める（GS-157）。**宛先を書き損じても画面は静か**——
// 「消す」が空振りしても見た目は何も起きず、`place` は警告 1 行で終わる。
// マップの `HideIf` をやめて命令に移した以上、宛先の綴りはここで当てる。
test('「消す」「置き直す」の宛先は、そのマップに実在する NPC', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    const path = join(ROOT, 'public', 'mapdata', file);
    let ids: Set<string>;
    try {
      ids = new Set(readNpcs(JSON.parse(readFileSync(path, 'utf8')) as MapDef).map((npc) => npc.id));
    } catch {
      continue; // マップが無い台帳（共通イベントなど）は見ない。
    }
    for (const event of book.events) {
      each(event.commands, (command) => {
        if (command.type !== 'hide' && command.type !== 'place') return;
        if (!command.target.startsWith('npc:')) return; // `this` / `player` はここでは見ない。
        const id = command.target.slice('npc:'.length);
        if (!ids.has(id)) gone.push(`${file} ${event.id}: ${command.type} の宛先 ${id} がマップに居ない`);
      });
    }
  }
  deepStrictEqual(gone, []);
});

// 向きと歩数で書く「移動（方向指定）」（GS-158）。**綴りを間違えると 1 歩も動かない**
// （知らない向きは道順が空になるだけ）。歩数 0 や負の数も画面では「動かない」にしか見えない。
test('「移動（方向指定）」の向きは上下左右、マス数は 1 以上の整数', () => {
  const dirs = ['up', 'down', 'left', 'right'];
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'move' || !command.dir) return;
    if (!dirs.includes(command.dir)) gone.push(`${where}: dir = ${JSON.stringify(command.dir)}`);
    const cells = command.cells;
    if (cells === undefined) return;
    if (!Number.isInteger(cells) || cells < 1) gone.push(`${where}: cells = ${JSON.stringify(cells)}`);
  });
  deepStrictEqual(gone, []);
});

// イベントイラスト（GS-161）。**名前は拡張子まで**（置き場に jpg と png が混ざっている）。
// 書き損じても画面では「絵が出ない」だけなので、置き場と突き合わせる。
test('イベントイラスト（slot: scene）の絵は assets/img/Event に在る', () => {
  const dir = join(ROOT, 'public', 'assets', 'img', 'Event');
  let files: Set<string>;
  try {
    files = new Set(readdirSync(dir));
  } catch {
    files = new Set(); // 置き場ごと無いなら、使っていないはず（下で落ちる）。
  }
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'portrait' || command.slot !== 'scene') return;
    if (command.hide === true) return; // 引っ込めるときは絵を書かない。
    if (!command.image) gone.push(`${where}: 絵の名前が空`);
    else if (!files.has(command.image)) gone.push(`${where}: ${command.image} が assets/img/Event に無い`);
  });
  deepStrictEqual(gone, []);
});

// テロップ（GS-171）。**中身が空だと真っ黒な画面が出て、押すまで何も分からない。**
// 画面では「固まった」ようにしか見えないので、空とずれた黒さをここで落とす。
test('テロップは中身が在る。黒さは 0〜1、消える時間は正の数', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'telop') return;
    const lines = command.lines ?? [];
    if (!lines.length || !lines.some((line) => line.trim())) gone.push(`${where}: 中身が空`);
    if (command.dim !== undefined && !(command.dim >= 0 && command.dim <= 1)) gone.push(`${where}: dim = ${command.dim}`);
    if (command.ms !== undefined && !(command.ms > 0)) gone.push(`${where}: ms = ${command.ms}`);
    // 字の大きさ（GS-172）。小さすぎ・大きすぎは画面で読めない／はみ出す。
    if (command.size !== undefined && !(command.size >= 12 && command.size <= 200)) gone.push(`${where}: size = ${command.size}`);
    if (command.hold !== undefined && !(command.hold >= 0)) gone.push(`${where}: hold = ${command.hold}`);
  });
  deepStrictEqual(gone, []);
});

// 押さずに送る会話（GS-172）。**負の数や文字が入ると、その行で止まったままになる。**
test('会話の「時間で消す」は 0 以上の数', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'message' || command.hold === undefined) return;
    if (typeof command.hold !== 'number' || !(command.hold >= 0)) gone.push(`${where}: hold = ${JSON.stringify(command.hold)}`);
  });
  deepStrictEqual(gone, []);
});

// 立ち絵のずれ（GS-170）。**画面の外へ出した絵は「出ていない」ようにしか見えない。**
// 割合（％）なので、桁を間違える（120 と書く）と黙って画面の外に立つ。
test('立ち絵のずれは画面の内（±60%）。場面絵には書かない', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'portrait') return;
    for (const key of ['x', 'y'] as const) {
      const value = command[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || Number.isNaN(value)) gone.push(`${where}: ${key} = ${JSON.stringify(value)}`);
      else if (Math.abs(value) > 60) gone.push(`${where}: ${key} = ${value}%（画面の外）`);
      // 場面絵は画面いっぱいなので効かない。書いてあれば書き間違い。
      else if (command.slot === 'scene') gone.push(`${where}: 場面絵に ${key} を書いている`);
    }
  });
  deepStrictEqual(gone, []);
});

// 動かす相手は**主人公か名指し**だけ（GS-162）。`this`（話しかけた相手）はやめた——
// 踏む・入ったら動くイベントでは誰も指さず、**黙って動かない**だけだったので、
// 画面では「命令を書いたのに何も起きない」としか見えなかった。書き残しはここで落とす。
// 隊列の仲間（`party:<id>`。GS-184）は**受ける命令だけ**（置き直す・向く・ジャンプ）、相手は `party.json` の `members`。
test('動かす相手は player か npc:<名前> だけ（this は使わない。party: は受ける命令だけ）', () => {
  const gone: string[] = [];
  const members = Object.keys((read('party.json') as { members?: Record<string, unknown> }).members ?? {});
  const partyCommands = new Set(['place', 'turn', 'jump']);
  everyCommand((command, where) => {
    const target = (command as { target?: unknown }).target;
    if (target === undefined) return;
    if (target === 'player') return;
    if (typeof target === 'string' && target.startsWith('npc:') && target.length > 'npc:'.length) return;
    if (
      typeof target === 'string' &&
      target.startsWith('party:') &&
      partyCommands.has(command.type) &&
      members.includes(target.slice('party:'.length))
    ) {
      return;
    }
    gone.push(`${where}: ${command.type} の相手が ${JSON.stringify(target)}`);
  });
  deepStrictEqual(gone, []);
});

test('イベント id はマップの中で重ならない', () => {
  for (const { file, book } of books) {
    const ids = book.events.map((event) => event.id);
    deepStrictEqual(ids.length, new Set(ids).size, `${file} に同じ id がある`);
  }
});

// 宝箱の見た目は**記録から導く**（GS-135）。開けた覚え（セルフスイッチ）が入った瞬間に
// コマが変わるので、**メッセージより先に入れないと**「読み終わってから開く」ように見える。
// 順番は台帳の書き方しだいで、画面を見ないと気づけない。だからここで留める（GS-136）。
test('宝箱は「開けた」を**メッセージより先**に立てる（読む前に開いて見える）', () => {
  const gone: string[] = [];
  for (const { file, book } of books) {
    for (const event of book.events) {
      // 枝ごとに見る。同じ枝の中での前後だけが目に見える順番になる。
      const walk = (list: EventCommand[]) => {
        let said = '';
        for (const command of list) {
          if (command.type === 'message') said ||= (command.talk ?? [])[0]?.lines?.[0] ?? '（せりふ）';
          if (command.type === 'setSelfSwitch' && command.key === '開けた' && command.value && said) {
            gone.push(`${file} ${event.id}: 「${said}」のあとに「開けた」を立てている`);
          }
          if (command.type === 'if') {
            walk(command.then);
            for (const arm of command.elif ?? []) walk(arm.then);
            if (command.else) walk(command.else);
          }
          if (command.type === 'choice') for (const branch of command.branches) walk(branch);
        }
      };
      walk(event.commands);
    }
  }
  deepStrictEqual(gone, []);
});

// 「移動」の書き方は 2 通り（GS-158）。**座標なら 3 軸そろっている**、方向指定なら向きが在る。
// 1 マスずつの道順（`route`）は無くなったので、書き残しが在れば落とす——
// **ゲームは黙って無視する**ので、その場から動かないまま次へ進んでしまう。
test('「移動」は行き先（to）か向き（dir）のどちらかを持つ。道順（route）は残っていない', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'move') return;
    if ('route' in command) gone.push(`${where}: 道順（route）が残っている`);
    // 向きと歩数で書く形（GS-158）。向きの中身は下のテストが見る。
    if (command.dir !== undefined) {
      if (command.to !== undefined) gone.push(`${where}: 行き先と向きの両方が書いてある`);
      return;
    }
    // 行き先の中身は次のテストが見る（マスの整数 / "player"。GS-154）。
    // ここは**3 軸そろっているか**だけ。
    const to = (command as unknown as { to?: Record<string, unknown> }).to;
    if (!to || to.x === undefined || to.y === undefined || to.z === undefined) {
      gone.push(`${where}: 行き先（x/y/z）も向き（dir）も無い`);
    }
    const first = (command as { first?: unknown }).first;
    if (first !== undefined && first !== 'leftRight' && first !== 'upDown') {
      gone.push(`${where}: 先に動く向きが不正: ${String(first)}`);
    }
  });
  deepStrictEqual(gone, []);
});

// スイッチの名前はイベントの id（GS-140）。名前でどの話か分かるようにした代わりに、
// **打ち間違いが目で見つけにくい**（`EVENT010201` と `EVENT010210`）。ここで当てる。
test('イベント id の形をしたスイッチは、本当にそのイベントがある', () => {
  const ids = new Set(books.flatMap(({ book }) => book.events.map((event) => event.id)));
  const gone: string[] = [];
  const check = (key: string, where: string) => {
    if (!/^EVENT\d+$/.test(key)) return; // 状態の覚え（ゲーム_クリア など）は対象外
    if (!ids.has(key)) gone.push(`${where}: そんなイベントは無い（${key}）`);
  };
  for (const { file, book } of books) {
    for (const event of book.events) {
      for (const one of event.when ?? []) if (one.switch) check(one.switch, `${file} ${event.id} の条件`);
      each(event.commands, (command) => {
        if (command.type === 'setSwitch') check(command.key, `${file} ${event.id}`);
        if (command.type === 'if') {
          // 条件は並び（`&&`。GS-197）でも書ける。`elif` の枝も見る（GS-196）。
          for (const when of [command.when, ...(command.elif ?? []).map((arm) => arm.when)]) {
            for (const one of Array.isArray(when) ? when : [when]) {
              if ('switch' in one) check(one.switch, `${file} ${event.id} の分岐`);
            }
          }
        }
      });
    }
  }
  deepStrictEqual(gone, []);
});

// **イベント id はゲーム全体で重ならないこと**（GS-140）。
// マップの中だけの決まりだったが、スイッチ名に使うようになったので全体で効く——
// 別のマップに同じ id があると、関係の無い 2 つの話が同じ覚えを取り合う。
test('イベント id はマップをまたいでも重ならない（スイッチ名に使うため）', () => {
  const seen = new Map<string, string>();
  const gone: string[] = [];
  for (const { file, book } of books) {
    for (const event of book.events) {
      const before = seen.get(event.id);
      if (before) gone.push(`${event.id}: ${before} と ${file} にある`);
      seen.set(event.id, file);
    }
  }
  deepStrictEqual(gone, []);
});

// マップに置いたキャラの出し入れ（GS-130 / GS-136）。
//
// `ShowIf` / `HideIf` に書くのは**フラグの名前**で、そのフラグが入った瞬間に
// キャラが現れる・消える。名前が誰も立てないものだと**一生消えない**——
// 倒したはずのボスがその場に残り、続けて触れてもう一度戦える。
// フラグ名をイベント id に揃えた（GS-140）ときに実際に取り残されたので、ここで当てる。
test('マップの ShowIf / HideIf は、どこかのイベントが立てるフラグを指している', () => {
  const maps = join(ROOT, 'public', 'mapdata');
  const flags = new Set<string>();
  const selfFlags = new Set<string>();
  everyCommand((command) => {
    if (command.type === 'setSwitch') flags.add(command.key);
    if (command.type === 'setSelfSwitch') selfFlags.add(command.key);
  });
  const gone: string[] = [];
  for (const file of readdirSync(maps).filter((name) => name.endsWith('.json'))) {
    const map = JSON.parse(readFileSync(join(maps, file), 'utf8')) as {
      layers?: { kind?: string; objects?: { name?: string; properties?: { name?: string; value?: unknown }[] }[] }[];
    };
    for (const layer of map.layers ?? []) {
      if (layer.kind !== 'object') continue;
      for (const object of layer.objects ?? []) {
        for (const property of object.properties ?? []) {
          if (property.name !== 'ShowIf' && property.name !== 'HideIf') continue;
          const key = String(property.value ?? '').trim();
          if (!key) continue;
          // `self:` はその物自身の覚え（GS-134）。別の入れ物なので分けて照らす。
          const known = key.startsWith('self:') ? selfFlags.has(key.slice('self:'.length)) : flags.has(key);
          if (!known) gone.push(`${file.replace(/\.json$/i, '')} の「${object.name}」: ${property.name}=${key}`);
        }
      }
    }
  }
  deepStrictEqual(gone, []);
});

// マップ移動（GS-211）。行き先の候補はマップの `MapMove`、条件・立ち位置・向きはイベント JSON の `mapMoves`。
// 片方だけ直すと黙って `default` に立つ（候補が増えた・物が消えた）ので、ここで突き合わせる。
test('マップ移動の決まり（mapMoves）は、MAPMOVE レイヤーの入口と行き先に合っている', () => {
  const problems: string[] = [];
  const steps = new Set(['up', 'down', 'left', 'right']);
  for (const { file, book } of books) {
    const mapFile = join(ROOT, 'public', 'mapdata', file);
    let entrances = new Map<string, string[]>();
    try {
      const map = JSON.parse(readFileSync(mapFile, 'utf8')) as MapDef;
      entrances = new Map(
        readEventSpots(map)
          .filter((spot) => spot.mapMoves.length)
          .map((spot) => [spot.moveObject, spot.mapMoves]),
      );
    } catch {
      if (book.mapMoves?.length) problems.push(`${file}: マップが読めない`);
      continue;
    }
    const seen = new Set<string>();
    for (const def of book.mapMoves ?? []) {
      const where = `${file} の ${def.object}`;
      if (seen.has(def.object)) problems.push(`${where}: 2 回書いてある`);
      seen.add(def.object);
      const destinations = entrances.get(def.object);
      if (!destinations) {
        problems.push(`${where}: MAPMOVE レイヤーに入口が無い`);
        continue;
      }
      for (const to of def.to) {
        // MapMove から外した行き先の決まりは問わない（ゲームは引かない。イベントエディタが開いたときに落とす）。
        if (!destinations.includes(to.map)) continue;
        if (!maps.has(to.map)) problems.push(`${where}: ${to.map} は台帳（maps.json）に無い`);
        if (to.at && to.marker) problems.push(`${where} → ${to.map}: 立ち位置がマスと目印の両方`);
        if (to.at && ![to.at.x, to.at.y, to.at.z].every(Number.isInteger)) problems.push(`${where} → ${to.map}: マスが整数でない`);
        if (to.face && !steps.has(to.face)) problems.push(`${where} → ${to.map}: 向き ${to.face}`);
      }
    }
    for (const [object, destinations] of entrances) {
      for (const map of destinations) if (!maps.has(map)) problems.push(`${file} の ${object}: MapMove の ${map} は台帳に無い`);
    }
  }
  deepStrictEqual(problems, []);
});

// GS-211 で行き先の決まりをイベント側へ移した。マップに残っていると、効いているつもりで効かない。
test('マップに旧形式の MoveTo / MoveToPx が残っていない。MapMove は MAPMOVE レイヤーの中だけ', () => {
  const maps = join(ROOT, 'public', 'mapdata');
  const left: string[] = [];
  for (const file of readdirSync(maps).filter((name) => name.endsWith('.json'))) {
    const map = JSON.parse(readFileSync(join(maps, file), 'utf8')) as MapDef;
    const entrances = new Set(readEventSpots(map).filter((spot) => spot.mapMoves.length).map((spot) => spot.objectId));
    for (const [index, layer] of map.layers.entries()) {
      for (const object of layer.objects ?? []) {
        for (const property of object.properties ?? []) {
          if (property.name === 'MoveTo' || property.name === 'MoveToPx') left.push(`${file} の「${object.name}」: ${property.name}`);
          if (property.name === 'Direction' && object.kind !== 'point') left.push(`${file} の「${object.name}」: Direction（点の目印だけ）`);
          if (property.name === 'MapMove' && !entrances.has(`${index}/${object.id}`))
            left.push(`${file} の「${object.name}」: MapMove が MAPMOVE レイヤーの外`);
        }
      }
    }
  }
  deepStrictEqual(left, []);
});
