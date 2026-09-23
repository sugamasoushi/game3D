import test from 'node:test';
import assert from 'node:assert/strict';
import { createCuePlayer, sampleCue, type CameraCue } from '../src/game/cameraCues';

const cue: CameraCue = { name: 'test', duration: 1000, hold: false,
  frames: [{ at: 0, distance: 1, tilt: false }, { at: 1000, yaw: 40, distance: .5, pitch: -30 }],
  effects: [{ at: 400, kind: 'veil', ms: 400, power: 1, hold: true }] };
test('カメラ数値を補間し、効果は開始時刻以後に再生する', () => {
  const frame = sampleCue(cue, 500, -20);
  assert.equal(frame.yaw, 20);
  assert.equal(frame.pitch, -25);
  assert.equal(frame.distance, .75);
  assert.equal(frame.tilt, false);
  assert.equal(sampleCue(cue, 300, -20).shot.veilAlpha, 0);
  assert.equal(frame.shot.veilAlpha, .25);
});
test('シークは逆方向にも決定的で、停止すると上書きを解除する', () => {
  const player = createCuePlayer(); player.play(cue); player.seek(800);
  assert.equal(player.update(5, -20)?.yaw, 32);
  player.seek(200); assert.equal(player.update(0, -20)?.yaw, 8);
  player.stop(); assert.equal(player.update(0, -20), null);
});
test('通常終了と保持終了、再開、種類が同じ効果の置き換え', () => {
  const player = createCuePlayer(); player.play(cue);
  assert.equal(player.update(1.1, -20), null);
  player.play({ ...cue, hold: true }); assert.equal(player.update(2, -20)?.yaw, 40);
  player.stop();
  player.play(cue); player.seek(500); player.pause(false);
  assert.equal(player.update(.1, -20)?.yaw, 24);
  const replace: CameraCue = { ...cue, effects: [{ at: 0, kind: 'veil', ms: 1000, power: 1, hold: true }, { at: 500, kind: 'veil', ms: 500, power: .5, hold: true }] };
  assert.equal(sampleCue(replace, 750, -20).shot.veilAlpha, .25);
});
test('次の演出は直前の演出状態を継承し、終了後にその状態へ戻る', () => {
  const player = createCuePlayer();
  const previous: CameraCue = { name: 'previous', duration: 500, hold: true,
    frames: [{ at: 0, yaw: 30, pitch: -25, distance: .8, x: 2, tilt: false }], effects: [] };
  const temporary: CameraCue = { name: 'temporary', duration: 500, hold: false,
    frames: [{ at: 0, yaw: -10 }], effects: [] };
  player.play(previous);
  assert.equal(player.update(1, -20)?.yaw, 30);
  player.play(temporary);
  const started = player.update(0, -20);
  assert.equal(started?.yaw, -10);
  assert.equal(started?.pitch, -25);
  assert.equal(started?.distance, .8);
  assert.equal(started?.x, 2);
  const restored = player.update(1, -20);
  assert.equal(restored?.yaw, 30);
  assert.equal(restored?.pitch, -25);
  assert.equal(restored?.distance, .8);
  assert.equal(restored?.x, 2);
  assert.deepEqual(player.state(), { yaw: 30, pitch: -25, distance: .8, x: 2, y: 0, z: 0, tilt: false });
});
test('イラストは画面外から入り、シーク時刻から位置と透明度を決め直す', () => {
  const illustrated: CameraCue = { name: 'cutin', duration: 1000, frames: [{ at: 0 }], effects: [{
    at: 0, kind: 'illustration', ms: 1000, asset: 'meina', x: 25, y: 100, height: 90, opacity: .8,
    enter: 'left', enterMs: 200, exit: 'fade', exitMs: 200, easing: 'linear',
  }] };
  assert.equal(sampleCue(illustrated, 0, -20).illustrations[0]?.offsetX, -120);
  assert.equal(sampleCue(illustrated, 200, -20).illustrations[0]?.offsetX, 0);
  assert.equal(sampleCue(illustrated, 900, -20).illustrations[0]?.opacity, .4);
  assert.deepEqual(sampleCue(illustrated, 1000, -20).illustrations, []);
});
// フィールドオブジェクトトラック・注視対象・選択中の味方（subject）の試験は、機能ごと削除した（GS-115。カメラ演出はイベント用）。
