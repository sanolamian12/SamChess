/**
 * 액션 칸 연출 타임라인 — 기획자가 준 시간표를 그대로 못 박는다.
 *
 * 눈으로는 0.2초와 0.3초를 구분할 수 없다. 여기서 숫자를 고정해 두면
 * `poses.ts`의 상수를 건드렸을 때 **의도한 변경인지 사고인지**가 먼저 드러난다.
 *
 * 이 파일은 Phaser를 부르지 않는다 — `PoseDirector`는 이벤트와 시간만 다루고
 * 그리는 일은 `BattleScene`이 한다. 그 경계 덕에 헤드리스로 잴 수 있다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { BattleEvent, BattleState, UnitId } from '@samchess/rules';
import { POSE, PoseDirector } from '../src/battle/poses.ts';

/** 연출은 `state`에서 진영과 activeUnit만 본다. 나머지는 채우지 않는다. */
function fakeState(active?: UnitId): BattleState {
  const unit = (id: string, side: 'P1' | 'P2'): unknown => ({ id, side });
  return {
    units: {
      'P1-King': unit('P1-King', 'P1'),
      'P1-Rock': unit('P1-Rock', 'P1'),
      'P2-King': unit('P2-King', 'P2'),
    },
    activeUnit: active ?? null,
  } as unknown as BattleState;
}

function run(events: BattleEvent[], active?: UnitId): { dir: PoseDirector; total: number } {
  const dir = new PoseDirector();
  const total = dir.plan(events, fakeState(active));
  return { dir, total };
}

/** 0에서 시작해 주어진 시각들로 건너뛰며 칸 번호를 모은다 */
function sample(dir: PoseDirector, unit: UnitId, times: number[]): number[] {
  let now = 0;
  return times.map((t) => {
    dir.update(t - now);
    now = t;
    return dir.frameOf(unit);
  });
}

test('이동 — 경로의 칸마다 0.2초씩, 그 동안 이동 칸을 보여준다', () => {
  const { dir, total } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 6, y: 5 } },
  ]);
  assert.equal(total, 4 * 200, '4칸 이동은 0.8초');

  assert.deepEqual(sample(dir, 'P1-Rock', [0, 199, 200, 799, 800]),
    [POSE.move, POSE.move, POSE.move, POSE.move, POSE.idle],
    '끝나면 평상으로 돌아온다');
});

test('이동 — 한 칸에 0.2초씩 머물며 좌표가 따라간다', () => {
  const { dir } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 5, y: 5 } },
  ]);
  const at = (t: number): string => {
    dir.update(t);
    const c = dir.cellOf('P1-Rock');
    return c ? `${c.x},${c.y}` : '—';
  };
  // 부드럽게 미끄러지지 않는다 — 칸을 뛴다
  assert.equal(at(0), '3,5');
  assert.equal(at(200), '4,5');
  assert.equal(at(200), '5,5');
  assert.equal(at(200), '—', '도착하면 권위 좌표를 쓴다');
});

test('이동 — Knight는 도약형이라 중간 칸이 없다', () => {
  const { total } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 3, y: 7 } },
  ]);
  assert.equal(total, 200, '축이 어긋나면 한 번에 건너뛴다');
});

test('공격 — 0.2초 점멸 · 0.2초 평상 · 2초 공격', () => {
  const { dir, total } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: true },
  ]);
  assert.equal(total, 2400);

  assert.deepEqual(sample(dir, 'P1-King', [0, 199, 200, 399, 400, 2399, 2400]),
    [POSE.attack, POSE.attack, POSE.idle, POSE.idle, POSE.attack, POSE.attack, POSE.idle]);
});

test('공격 — 대상은 두 번째 공격 그림이 뜨는 동안만 피격을 띄운다', () => {
  const { dir } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: false },
  ]);
  // 그 2초 동안 대화창의 「누가 공격했다 · 크리티컬」을 읽게 된다
  assert.deepEqual(sample(dir, 'P2-King', [0, 399, 400, 2399, 2400]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle]);
});

test('책략 — 적에게 걸어 성공하면 1초 + 1초, 대상은 뒤 1초만 피격', () => {
  const { dir, total } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'attackHalf' },
  ]);
  assert.equal(total, 2000);
  assert.deepEqual(sample(dir, 'P1-King', [0, 999, 1000, 1999, 2000]),
    [POSE.cast, POSE.cast, POSE.cast, POSE.cast, POSE.idle], '시전자는 2초 내내 책략 칸');
  assert.deepEqual(sample(new PoseDirector(), 'P2-King', [0]), [POSE.idle]);

  const { dir: d2 } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'attackHalf' },
  ]);
  assert.deepEqual(sample(d2, 'P2-King', [0, 999, 1000, 1999, 2000]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle]);
});

test('책략 — 실패하면 1초로 끝난다', () => {
  const { dir, total } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: true },
  ]);
  assert.equal(total, 1000);
  assert.deepEqual(sample(dir, 'P1-King', [0, 999, 1000]), [POSE.cast, POSE.cast, POSE.idle]);
});

test('책략 — 아군에게 건 버프는 1초. 피격을 띄우지 않는다', () => {
  const { dir, total } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'jeung-pok', resisted: false },
    { e: 'statusApplied', unit: 'P1-Rock', status: 'criticalSure' },
  ]);
  assert.equal(total, 1000, '같은 편에게 건 것은 두 번째 1초가 붙지 않는다');
  assert.deepEqual(sample(dir, 'P1-Rock', [0, 999]), [POSE.idle, POSE.idle]);
});

test('명상 — 책략과 같은 칸을 1초', () => {
  const { dir, total } = run(
    [{ e: 'mpChanged', unit: 'P1-King', delta: 1, reason: 'meditate' }],
    'P1-King',
  );
  assert.equal(total, 1000);
  assert.deepEqual(sample(dir, 'P1-King', [0, 999, 1000]), [POSE.cast, POSE.cast, POSE.idle]);
});

test('퇴각 — 피격 칸을 0.4초 간격으로 3번 점멸한 뒤 사라진다', () => {
  const { dir, total } = run([{ e: 'unitDied', unit: 'P2-King' }]);
  assert.equal(total, 1200);

  const alpha = (t: number): number => { dir.update(t); return dir.alphaOf('P2-King'); };
  assert.equal(alpha(0), 1);
  assert.equal(alpha(400), 0.15);
  assert.equal(alpha(400), 1);
  assert.equal(alpha(400), 0, '끝나면 사라진다');
  assert.equal(dir.isFading('P2-King'), false, '이제 화면에서 치워도 된다');
});

test('퇴각 — 점멸이 끝나기 전에는 화면에 남는다', () => {
  const { dir } = run([{ e: 'unitDied', unit: 'P2-King' }]);
  dir.update(600);
  assert.equal(dir.isFading('P2-King'), true);
  assert.equal(dir.frameOf('P2-King'), POSE.hurt);
});

test('이동 뒤 공격은 이어 붙는다 — 겹쳐 재생하지 않는다', () => {
  const { dir, total } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 4, y: 5 } },
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-King', damage: 3, critical: false },
  ]);
  assert.equal(total, 400 + 2400, '이동 0.4초가 끝난 뒤 공격 2.4초');
  // 공격 타임라인이 통째로 400ms 밀린다 — 점멸과 사이의 평상도 같이 밀린다
  assert.deepEqual(sample(dir, 'P1-Rock', [0, 399, 400, 599, 600, 799, 800, 2799, 2800]),
    [POSE.move, POSE.move, POSE.attack, POSE.attack, POSE.idle, POSE.idle,
      POSE.attack, POSE.attack, POSE.idle]);
});

test('이동 뒤 공격 — **맞는 쪽도 같이 밀린다**', () => {
  // 실측으로 잡은 버그: 유닛별로 0에서 시작하면 때리는 쪽이 아직 걸어오는 동안
  // 대상이 먼저 아파했다. 공용 커서를 쓰지 않으면 여기서 걸린다.
  const { dir } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 5, y: 5 } },
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-King', damage: 3, critical: false },
  ]);
  assert.deepEqual(sample(dir, 'P2-King', [0, 599, 600, 999, 1000, 2999, 3000]),
    [POSE.idle, POSE.idle, POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle],
    '이동 0.6초 + 점멸·간격 0.4초가 지나야 피격이 뜬다');
});

test('퇴각 — 죽인 공격이 끝난 뒤에 점멸한다', () => {
  const { dir, total } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 99, critical: false },
    { e: 'unitDied', unit: 'P2-King' },
  ]);
  assert.equal(total, 2400 + 1200);
  // `isFading`은 「아직 화면에 그려야 하는가」다. 엔진은 이미 죽었다고 하지만
  // 공격 연출이 도는 동안에도 대상은 남아 있어야 한다.
  assert.equal(dir.isFading('P2-King'), true, '공격 연출 중에도 화면에 남는다');
  assert.equal(dir.alphaOf('P2-King'), 1, '아직 점멸하지 않는다');
  dir.update(2399);
  assert.equal(dir.alphaOf('P2-King'), 1);
  dir.update(1);
  assert.equal(dir.alphaOf('P2-King'), 1, '점멸은 공격이 끝나고서 시작한다');
  dir.update(400);
  assert.equal(dir.alphaOf('P2-King'), 0.15);
  dir.update(800);
  assert.equal(dir.isFading('P2-King'), false, '이제 치워도 된다');
});

test('그 외 이벤트는 평상 — 연출이 걸리지 않는다', () => {
  const { total } = run([
    { e: 'timeAdvanced', to: 190 },
    { e: 'controlGranted', unit: 'P1-King' },
    { e: 'spChanged', side: 'P1', to: 3 },
  ]);
  assert.equal(total, 0, '기다릴 것이 없으면 판을 멈추지 않는다');
});
