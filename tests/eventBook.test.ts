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
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = (at as unknown as Record<string, unknown>)[axis];
      if (value === 'player') continue;
      if (typeof value === 'number' && Number.isFinite(value)) continue;
      gone.push(`${where}: at.${axis} = ${JSON.stringify(value)}`);
    }
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

// 「歩く」は行き先だけ（GS-139）。1 マスずつの道順は無くなったので、書き残しが在れば落とす。
// **ゲームは黙って無視する**——`route` が残ったイベントは、その場から動かないまま次へ進む。
test('「歩く」は行き先（to）を持つ。1 マスずつの道順（route）は残っていない', () => {
  const gone: string[] = [];
  everyCommand((command, where) => {
    if (command.type !== 'move') return;
    if ('route' in command) gone.push(`${where}: 道順（route）が残っている`);
    // 行き先の中身は次のテストが見る（マスの整数 / "player" / 範囲。GS-154 / GS-156）。
    // ここは**3 軸そろっているか**だけ。
    const to = (command as unknown as { to?: Record<string, unknown> }).to;
    if (!to || to.x === undefined || to.y === undefined || to.z === undefined) {
      gone.push(`${where}: 行き先（x/y/z）がそろっていない`);
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
        if (command.type === 'if' && 'switch' in command.when) check(command.when.switch, `${file} ${event.id} の分岐`);
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
