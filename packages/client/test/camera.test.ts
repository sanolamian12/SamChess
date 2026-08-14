/**
 * 카메라 연출 — 판 전체(100%) / 포커스 (기획 pptx 28쪽)
 *
 * **눈으로는 검증할 수 없는 것을 잰다.** 「부드럽게」가 정말 부드러운지, 다중 피격에서
 * 포커스가 실제로 대상 사이를 옮겨 다니는지는 스크린샷 한 장으로 알 수 없다 —
 * 액션 자세 때 밟았던 지뢰와 같은 종류다(`poses.test.ts` 머리말 참조).
 *
 * `camera.ts`와 `poses.ts`는 Phaser를 부르지 않으므로 여기서 헤드리스로 돌아간다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { BattleEvent, BattleState, UnitId, Vec2 } from '@samchess/rules';
import { CameraRig, SCALE_FIT, SCALE_FOCUS, viewOf } from '../src/battle/camera.ts';
import { BOARD_H, BOARD_W, cellCenter } from '../src/battle/layout.ts';
import { PoseDirector } from '../src/battle/poses.ts';

// ── 큐 → 카메라 자리 ─────────────────────────────────────────

/** 정사각 캔버스 800px. 보드가 2400²이므로 100% 배율은 1/3이다. */
const VIEW = 800;
const FIT = VIEW / BOARD_W;

test('100% — 판 전체가 화면에 들어가고 한가운데에 온다', () => {
  const v = viewOf({ from: 0, scale: SCALE_FIT, cell: null }, FIT, VIEW, VIEW);
  assert.equal(v.zoom, FIT);
  assert.deepEqual({ x: v.x, y: v.y }, { x: BOARD_W / 2, y: BOARD_H / 2 });
});

test('포커스 — 배율이 정확히 SCALE_FOCUS배이고 지정한 칸을 겨눈다', () => {
  const cell = { x: 12, y: 10 };                       // 판 한복판이라 가둘 일이 없다
  const v = viewOf({ from: 0, scale: SCALE_FOCUS, cell }, FIT, VIEW, VIEW);
  // 배율은 기획자가 눈으로 보며 조정하는 값이라 숫자를 박지 않고 상수로 검증한다
  assert.equal(v.zoom, FIT * SCALE_FOCUS);
  assert.deepEqual({ x: v.x, y: v.y }, cellCenter(cell.x, cell.y));
});

test('포커스 — 가장자리를 비춰도 화면이 판 밖으로 나가지 않는다', () => {
  // 이걸 안 가두면 절반이 빈 공간이 되고 좌표 눈금(첫 행·첫 열)까지 밀려 나간다
  const span = VIEW / (FIT * SCALE_FOCUS);             // 보이는 월드 폭
  const corner = viewOf({ from: 0, scale: SCALE_FOCUS, cell: { x: 0, y: 0 } }, FIT, VIEW, VIEW);
  assert.deepEqual({ x: corner.x, y: corner.y }, { x: span / 2, y: span / 2 });

  const far = viewOf({ from: 0, scale: SCALE_FOCUS, cell: { x: 24, y: 19 } }, FIT, VIEW, VIEW);
  assert.deepEqual({ x: far.x, y: far.y }, { x: BOARD_W - span / 2, y: BOARD_H - span / 2 });
});

// ── 부드러운 전환 ────────────────────────────────────────────

test('전환 — 한 번에 튀지 않고 목표로 다가간다', () => {
  const rig = new CameraRig();
  rig.target({ zoom: 1, x: 0, y: 0 });
  assert.deepEqual(rig.update(16), { zoom: 1, x: 0, y: 0 }, '첫 목표는 그 자리에서 시작한다');

  rig.target({ zoom: 2, x: 1000, y: 0 });
  const mid = rig.update(100)!;
  assert.ok(mid.x > 0 && mid.x < 1000, `한 프레임에 도착해 버렸다: ${mid.x}`);
  assert.ok(mid.zoom > 1 && mid.zoom < 2, `배율이 한 번에 뛰었다: ${mid.zoom}`);
});

test('전환 — 프레임률이 달라도 같은 시간에 같은 곳에 있다', () => {
  // 지수 감쇠라 나눠 밟든 한 번에 밟든 결과가 같다. `deltaMs`를 그냥 곱하는 식으로
  // 바꾸면 여기서 갈린다 — 60fps와 30fps에서 연출 속도가 달라지는 버그다.
  const step = (times: number, ms: number): number => {
    const rig = new CameraRig();
    rig.target({ zoom: 1, x: 0, y: 0 });
    rig.target({ zoom: 1, x: 1000, y: 0 });
    for (let i = 0; i < times; i++) rig.update(ms);
    return rig.current!.x;
  };
  assert.ok(Math.abs(step(10, 100) - step(1, 1000)) < 1e-6);
});

test('전환 — 끝내 목표에 붙고 settled가 선다', () => {
  const rig = new CameraRig();
  rig.target({ zoom: 1, x: 0, y: 0 });
  rig.target({ zoom: 2, x: 1000, y: 500 });
  assert.equal(rig.settled, false);

  for (let i = 0; i < 60 && !rig.settled; i++) rig.update(100);
  assert.equal(rig.settled, true, '6초가 지나도 수렴하지 않는다');
  assert.deepEqual(rig.update(16), { zoom: 2, x: 1000, y: 500 });
});

test('snap — 트윈 없이 곧바로 놓는다 (창 크기 변경)', () => {
  const rig = new CameraRig();
  rig.target({ zoom: 1, x: 0, y: 0 });
  rig.snap({ zoom: 3, x: 700, y: 700 });
  assert.equal(rig.settled, true);
  assert.deepEqual(rig.current, { zoom: 3, x: 700, y: 700 });
});

// ── 연출 계획이 짜는 큐 (pptx 28쪽의 규칙 그대로) ─────────────

/** 카메라 큐는 좌표를 보므로 `pos`까지 채운다. 그 밖은 연출이 읽지 않는다. */
function fakeState(active?: UnitId): BattleState {
  const unit = (id: string, side: 'P1' | 'P2', pos: Vec2): unknown => ({ id, side, pos });
  return {
    units: {
      'P1-King': unit('P1-King', 'P1', { x: 2, y: 15 }),
      'P1-Rock': unit('P1-Rock', 'P1', { x: 6, y: 15 }),
      'P2-King': unit('P2-King', 'P2', { x: 2, y: 4 }),
      'P2-Rock': unit('P2-Rock', 'P2', { x: 9, y: 4 }),
    },
    activeUnit: active ?? null,
  } as unknown as BattleState;
}

function plan(events: BattleEvent[], active?: UnitId): PoseDirector {
  const dir = new PoseDirector();
  dir.plan(events, fakeState(active));
  return dir;
}

test('이동은 100% — 어디서 어디로 갔는지가 보여야 한다', () => {
  const dir = plan([{ e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 15 }, to: { x: 6, y: 15 } }]);
  assert.deepEqual(dir.camera.at(0), { from: 0, scale: SCALE_FIT, cell: null });
});

test('공격은 포커스 — **피격되는 쪽**을 비춘다', () => {
  const dir = plan([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: false },
  ]);
  const cue = dir.camera.at(0)!;
  assert.equal(cue.scale, SCALE_FOCUS);
  assert.deepEqual(cue.cell, { x: 2, y: 4 }, '때리는 쪽이 아니라 맞는 쪽이다');
  // 큐가 공격 **시작**에 걸려야 점멸·간격 0.4초가 이동 시간이 되어,
  // 실제로 맞는 순간(0.4초 뒤)에는 이미 도착해 있다
  assert.equal(cue.from, 0);
});

test('다중 피격 — 포커스가 대상 사이를 옮겨 다닌다 (장료지제)', () => {
  const dir = plan([
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-King', damage: 4, critical: false },
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-Rock', damage: 4, critical: false },
  ]);
  assert.equal(dir.camera.length, 2, '대상마다 큐가 하나씩 있어야 한다');
  assert.deepEqual(dir.camera.at(0)!.cell, { x: 2, y: 4 });
  assert.deepEqual(dir.camera.at(3499)!.cell, { x: 2, y: 4 }, '첫 공격이 끝나기 전');
  // 줌인 0.6 + 공격 2.9 = 3.5초 뒤에 둘째 대상으로 옮겨 간다
  assert.deepEqual(dir.camera.at(3500)!.cell, { x: 9, y: 4 }, '둘째 대상으로 옮겨 간다');
});

test('책략·명상·고유기술은 포커스로 **시전자**를 비춘다', () => {
  const tactic = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'attackHalf' },
  ]);
  assert.deepEqual(tactic.camera.at(0), { from: 0, scale: SCALE_FOCUS, cell: { x: 2, y: 15 } });

  const meditate = plan(
    [{ e: 'mpChanged', unit: 'P1-Rock', delta: 1, reason: 'meditate' }], 'P1-Rock');
  assert.deepEqual(meditate.camera.at(0), { from: 0, scale: SCALE_FOCUS, cell: { x: 6, y: 15 } });

  // 고유기술은 자세를 바꾸지 않지만(배너가 판을 덮으므로) 카메라는 붙여 둔다 —
  // 배너가 걷혔을 때 이미 그 자리를 보고 있어야 효과를 읽을 수 있다
  const unique = plan([
    { e: 'uniqueSkillCast', unit: 'P2-Rock', skill: 'baek-bo-cheon-yang' },
    { e: 'statusApplied', unit: 'P2-Rock', status: 'rangeIgnore' },
  ]);
  assert.deepEqual(unique.camera.at(0), { from: 0, scale: SCALE_FOCUS, cell: { x: 9, y: 4 } });
});

test('책략이 걸리면 두 번째 구간에 **맞는 쪽**으로 옮겨 간다', () => {
  // 시전 1.3초는 시전자, 효과가 붙는 1.3초는 대상 — 피격 자세가 뜨는 구간이라
  // 무엇이 어떻게 됐는지는 거기서 보인다 (2026-08-12 기획자 지정).
  const dir = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'attackHalf' },
  ]);
  // 줌인 0.6초 뒤에 시전 1.3초 → 1.9초에 대상으로 옮겨 간다
  assert.deepEqual(dir.camera.all.map((c) => c.from), [0, 1900]);
  assert.deepEqual(dir.camera.at(1899)!.cell, { x: 2, y: 15 }, '아직 시전자');
  assert.deepEqual(dir.camera.at(1900)!.cell, { x: 2, y: 4 }, '맞는 쪽으로');
});

test('저항당한 책략은 대상으로 옮겨 가지 않는다 — 아무 일도 없었다', () => {
  const dir = plan([{ e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: true }]);
  assert.equal(dir.camera.length, 1);
  assert.deepEqual(dir.camera.at(0)!.cell, { x: 2, y: 15 });
});

test('고유기술 뒤에 공격이 오면 **맞는 쪽**으로 옮겨 간다', () => {
  // `uniqueSkillCast`는 자세를 만들지 않지만 카메라 큐는 놓는다. 큐가 놓이면
  // 도착할 시간(0.6초)이 붙으므로, 공격 큐는 그 뒤에 따로 선다.
  // 배너가 판을 덮고 있는 동안에는 시전자를 보고, 걷히면 누가 맞았는지를 본다.
  const dir = plan([
    { e: 'uniqueSkillCast', unit: 'P2-Rock', skill: 'baek-bo-cheon-yang' },
    { e: 'attacked', unit: 'P2-Rock', target: 'P1-King', damage: 9, critical: false },
  ]);
  assert.deepEqual(dir.camera.all.map((c) => c.from), [0, 600]);
  assert.deepEqual(dir.camera.at(0)!.cell, { x: 9, y: 4 }, '먼저 시전자 P2-Rock');
  assert.deepEqual(dir.camera.at(600)!.cell, { x: 2, y: 15 }, '그다음 피격되는 P1-King');
});

test('이동 뒤 공격 — 카메라도 자세와 **같은 커서** 위에 놓인다', () => {
  // 카메라만 따로 0에서 세면 때리는 그림이 뜬 뒤에야 화면이 따라간다.
  // 줌아웃 큐(0) → 0.6초 뒤 걷기 0.9초 → 1.5초에 줌인 큐.
  const dir = plan([
    { e: 'moved', unit: 'P1-Rock', from: { x: 6, y: 15 }, to: { x: 6, y: 12 } },
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-Rock', damage: 3, critical: false },
  ]);
  assert.deepEqual(dir.camera.all.map((c) => c.from), [0, 1500]);
  assert.equal(dir.camera.at(1499)!.scale, SCALE_FIT, '아직 걷는 중 — 판 전체');
  assert.equal(dir.camera.at(1500)!.scale, SCALE_FOCUS, '도착하고서 대상으로 줌인');
});

test('부활 — 공격·피격은 **쓰러진 자리**를, 부활 큐만 새 자리를 비춘다', () => {
  // 기획자 지적 2026-08-13: 포커스가 이미 부활 자리에 가 있고 공격·피격은 화면
  // 바깥에서 벌어졌다. `state`는 적용이 끝난 상태라 `unit.pos`가 이미 새 자리라서다.
  const dir = plan([
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-Rock', damage: 99, critical: false },
    { e: 'unitDied', unit: 'P2-Rock' },
    { e: 'unitRevived', unit: 'P2-Rock', at: { x: 12, y: 1 }, from: { x: 9, y: 4 } },
  ]);
  assert.equal(dir.camera.length, 2);
  assert.deepEqual(dir.camera.at(0)!.cell, { x: 9, y: 4 }, '맞는 동안에는 쓰러진 자리');
  assert.deepEqual(dir.camera.at(3499)!.cell, { x: 9, y: 4 }, '점멸도 그 자리에서');
  // 줌인 0.6 + 공격 2.9 + 점멸 1.5가 지나야 새 자리로 옮겨 간다
  assert.equal(dir.camera.all[1]!.from, 600 + 2900 + 1500);
  assert.deepEqual(dir.camera.at(5000)!.cell, { x: 12, y: 1 }, '그제야 부활 자리');
});

test('연출이 없으면 큐도 없다 — 화면이 알아서 정한다', () => {
  const dir = plan([{ e: 'timeAdvanced', to: 190 }, { e: 'controlGranted', unit: 'P1-King' }]);
  assert.equal(dir.camera.length, 0);
  assert.equal(dir.camera.at(0), null);
});
