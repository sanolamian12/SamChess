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

test('이동 — 경로의 칸마다 0.3초씩, 그 동안 이동 칸을 보여준다', () => {
  const { dir, total } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 6, y: 5 } },
  ]);
  assert.equal(total, 600 + 4 * 300, '줌아웃 0.6초 + 4칸 이동 1.2초');

  // 앞 0.6초는 카메라가 판 전체로 물러나는 시간이다 — 그동안은 아직 평상
  assert.deepEqual(sample(dir, 'P1-Rock', [0, 599, 600, 899, 1799, 1800]),
    [POSE.idle, POSE.idle, POSE.move, POSE.move, POSE.move, POSE.idle],
    '줌아웃이 끝나고서 걷기 시작하고, 다 걸으면 평상으로 돌아온다');
});

test('이동 — 한 칸에 0.3초씩 머물며 좌표가 따라간다', () => {
  const { dir } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 5, y: 5 } },
  ]);
  const at = (t: number): string => {
    dir.update(t);
    const c = dir.cellOf('P1-Rock');
    return c ? `${c.x},${c.y}` : '—';
  };
  // 부드럽게 미끄러지지 않는다 — 칸을 뛴다.
  // **줌아웃 0.6초 동안은 출발점에 붙들려 있다** (기획자 지적 2026-08-13):
  // 권위 좌표를 쓰면 도착지에 한 번 떴다가 걷기가 시작되며 출발점으로 되돌아간다.
  assert.equal(at(0), '2,5', '아직 줌아웃 중 — 출발점 그대로');
  assert.equal(at(599), '2,5');
  assert.equal(at(1), '3,5', '줌아웃이 끝나야 첫 칸을 밟는다');
  assert.equal(at(300), '4,5');
  assert.equal(at(300), '5,5');
  assert.equal(at(300), '—', '도착하면 권위 좌표를 쓴다');
});

test('이동 — Knight는 「긴 축 두 칸 → 짧은 축 한 칸」으로 걷는다', () => {
  // 규칙상으로는 도약이지만(경로가 막혀도 간다), 한 번에 순간이동하면 어디로
  // 갔는지 눈이 못 따라간다 (2026-08-13 기획자 지정).
  const { dir, total } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 3, y: 7 } },
  ]);
  assert.equal(total, 600 + 3 * 300, '줌아웃 0.6초 + 세 칸');

  const at = (t: number): string => {
    dir.update(t);
    const c = dir.cellOf('P1-Rock');
    return c ? `${c.x},${c.y}` : '—';
  };
  assert.equal(at(0), '2,5', '줌아웃 중에는 출발점');
  // dx=1, dy=2 → 긴 축은 y. (2,6) → (2,7) → (3,7)
  assert.equal(at(600), '2,6');
  assert.equal(at(300), '2,7');
  assert.equal(at(300), '3,7', '마지막 칸은 반드시 목적지다');
});

test('공격 — 0.3초 점멸 · 0.3초 평상 · 2.3초 공격', () => {
  const { dir, total } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: true },
  ]);
  assert.equal(total, 600 + 2900, '줌인 0.6초 + 공격 2.9초');

  // 줌인이 끝나고서 때리기 시작한다 (2026-08-13) — 그전에는 평상
  assert.deepEqual(sample(dir, 'P1-King', [0, 599, 600, 899, 900, 1199, 1200, 3499, 3500]),
    [POSE.idle, POSE.idle, POSE.attack, POSE.attack, POSE.idle, POSE.idle,
      POSE.attack, POSE.attack, POSE.idle]);
});

test('공격 — 대상은 두 번째 공격 그림이 뜨는 동안만 피격을 띄운다', () => {
  const { dir } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: false },
  ]);
  // 그 2초 동안 대화창의 「누가 공격했다 · 크리티컬」을 읽게 된다
  assert.deepEqual(sample(dir, 'P2-King', [0, 1199, 1200, 3499, 3500]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle]);
});

test('책략 — 적에게 걸어 성공하면 1.3초 + 1.3초, 대상은 뒤 1.3초만 피격', () => {
  const { dir, total } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'attackHalf' },
  ]);
  assert.equal(total, 600 + 2600, '줌인 0.6초 + 시전 2.6초');
  assert.deepEqual(sample(dir, 'P1-King', [0, 599, 600, 1899, 3199, 3200]),
    [POSE.idle, POSE.idle, POSE.cast, POSE.cast, POSE.cast, POSE.idle],
    '줌인 뒤 2.6초 내내 책략 칸');
  assert.deepEqual(sample(new PoseDirector(), 'P2-King', [0]), [POSE.idle]);

  const { dir: d2 } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'attackHalf' },
  ]);
  assert.deepEqual(sample(d2, 'P2-King', [0, 1899, 1900, 3199, 3200]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle]);
});

test('책략 — 실패하면 1.3초로 끝난다', () => {
  const { dir, total } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: true },
  ]);
  assert.equal(total, 600 + 1300);
  assert.deepEqual(sample(dir, 'P1-King', [0, 600, 1899, 1900]),
    [POSE.idle, POSE.cast, POSE.cast, POSE.idle]);
});

test('책략 — 아군에게 건 버프는 1.3초. 피격을 띄우지 않는다', () => {
  const { dir, total } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'jeung-pok', resisted: false },
    { e: 'statusApplied', unit: 'P1-Rock', status: 'criticalSure' },
  ]);
  assert.equal(total, 600 + 1300, '같은 편에게 건 것은 두 번째 구간이 붙지 않는다');
  assert.deepEqual(sample(dir, 'P1-Rock', [0, 1299]), [POSE.idle, POSE.idle]);
});

test('명상 — 책략과 같은 칸을 1.3초', () => {
  const { dir, total } = run(
    [{ e: 'mpChanged', unit: 'P1-King', delta: 1, reason: 'meditate' }],
    'P1-King',
  );
  assert.equal(total, 600 + 1300);
  assert.deepEqual(sample(dir, 'P1-King', [0, 600, 1899, 1900]),
    [POSE.idle, POSE.cast, POSE.cast, POSE.idle]);
});

test('퇴각 — 피격 칸을 0.5초 간격으로 3번 점멸한 뒤 사라진다', () => {
  const { dir, total } = run([{ e: 'unitDied', unit: 'P2-King' }]);
  assert.equal(total, 1500);

  const alpha = (t: number): number => { dir.update(t); return dir.alphaOf('P2-King'); };
  assert.equal(alpha(0), 1);
  assert.equal(alpha(500), 0.15);
  assert.equal(alpha(500), 1);
  assert.equal(alpha(500), 0, '끝나면 사라진다');
  assert.equal(dir.isFading('P2-King'), false, '이제 화면에서 치워도 된다');
});

test('퇴각 — 점멸이 끝나기 전에는 화면에 남는다', () => {
  const { dir } = run([{ e: 'unitDied', unit: 'P2-King' }]);
  dir.update(700);
  assert.equal(dir.isFading('P2-King'), true);
  assert.equal(dir.frameOf('P2-King'), POSE.hurt);
});

test('이동 뒤 공격은 이어 붙는다 — 겹쳐 재생하지 않는다', () => {
  const { dir, total } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 4, y: 5 } },
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-King', damage: 3, critical: false },
  ]);
  // 줌아웃 0.6 + 이동 0.6 + 줌인 0.6 + 공격 2.9
  assert.equal(total, 600 + 600 + 600 + 2900);
  assert.deepEqual(sample(dir, 'P1-Rock', [0, 600, 1199, 1200, 1799, 1800, 2099, 2100, 4699, 4700]),
    [POSE.idle, POSE.move, POSE.move, POSE.idle, POSE.idle, POSE.attack, POSE.attack,
      POSE.idle, POSE.attack, POSE.idle]);
});

test('이동 뒤 공격 — **맞는 쪽도 같이 밀린다**', () => {
  // 실측으로 잡은 버그: 유닛별로 0에서 시작하면 때리는 쪽이 아직 걸어오는 동안
  // 대상이 먼저 아파했다. 공용 커서를 쓰지 않으면 여기서 걸린다.
  const { dir } = run([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 5, y: 5 } },
    { e: 'attacked', unit: 'P1-Rock', target: 'P2-King', damage: 3, critical: false },
  ]);
  // 줌아웃 0.6 + 이동 0.9 + 줌인 0.6 + 점멸·간격 0.6 = 2.7초 뒤에 피격
  assert.deepEqual(sample(dir, 'P2-King', [0, 2699, 2700, 4999, 5000]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle]);
});

test('퇴각 — 죽인 공격이 끝난 뒤에 점멸한다', () => {
  const { dir, total } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 99, critical: false },
    { e: 'unitDied', unit: 'P2-King' },
  ]);
  assert.equal(total, 600 + 2900 + 1500);
  // `isFading`은 「아직 화면에 그려야 하는가」다. 엔진은 이미 죽었다고 하지만
  // 공격 연출이 도는 동안에도 대상은 남아 있어야 한다.
  assert.equal(dir.isFading('P2-King'), true, '공격 연출 중에도 화면에 남는다');
  assert.equal(dir.alphaOf('P2-King'), 1, '아직 점멸하지 않는다');
  dir.update(3499);
  assert.equal(dir.alphaOf('P2-King'), 1);
  dir.update(1);
  assert.equal(dir.alphaOf('P2-King'), 1, '점멸은 공격이 끝나고서 시작한다');
  dir.update(500);
  assert.equal(dir.alphaOf('P2-King'), 0.15);
  dir.update(1000);
  assert.equal(dir.isFading('P2-King'), false, '이제 치워도 된다');
});

test('HP 게이지는 **피격 그림과 함께** 줄어든다 — 먼저 줄지 않는다', () => {
  // 기획자 지적 2026-08-13: 게이지가 가장 먼저 줄고, 때리는 그림과 피격이 나중에 떴다.
  // 엔진은 판정을 이미 끝냈으므로 `unit.hp`가 맞은 뒤 값이라, 그대로 그리면 그렇게 된다.
  const { dir } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: false },
    { e: 'hpChanged', unit: 'P2-King', delta: -7, reason: 'attack' },
  ]);
  const victim = { id: 'P2-King' as UnitId, hp: 13, maxHp: 20 };   // 이미 맞은 뒤 값

  assert.equal(dir.shownHp(victim), 20, '아직 안 맞았다 — 20으로 그린다');
  dir.update(1199);
  assert.equal(dir.shownHp(victim), 20, '줌인 0.6초 + 점멸·간격 0.6초 동안에도 그대로');
  dir.update(1);
  assert.equal(dir.shownHp(victim), 13, '피격 그림이 뜨는 순간 줄어든다');
});

test('회복도 같은 규칙 — 책략이 통한 뒤에 차오른다', () => {
  const { dir } = run([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'hoe-bok', resisted: false },
    { e: 'hpChanged', unit: 'P1-Rock', delta: 4, reason: 'tactic:hoe-bok' },
  ]);
  const ally = { id: 'P1-Rock' as UnitId, hp: 14, maxHp: 20 };
  assert.equal(dir.shownHp(ally), 10, '줌인·시전 중에는 아직 10');
  dir.update(600 + 1300);
  assert.equal(dir.shownHp(ally), 14);
});

test('HP 큐만 있어도 연출로 친다 — 게이지가 제때 움직여야 한다', () => {
  // 도트 정산은 자세가 없다. `busy`가 false면 판이 곧바로 다음으로 넘어가 버린다.
  const { dir, total } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 2, critical: false },
    { e: 'hpChanged', unit: 'P2-King', delta: -2, reason: 'attack' },
  ]);
  assert.equal(total, 600 + 2900);
  assert.equal(dir.busy, true);
});

test('부활 — 점멸이 **다 끝난 뒤에** 새 자리로 옮긴다 (조조 「화용도」)', () => {
  // 기획자 지적 2026-08-13: 맞는 순간 부활 자리로 순간이동해 **거기서** 피격 점멸을
  // 했다. 엔진이 `unit.pos`를 곧바로 갈아 끼우는데 화면이 권위 좌표만 봤기 때문이다.
  const { dir, total } = run([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 99, critical: false },
    { e: 'unitDied', unit: 'P2-King' },
    { e: 'unitRevived', unit: 'P2-King', at: { x: 12, y: 1 }, from: { x: 9, y: 4 } },
  ]);
  // 줌인 0.6 + 공격 2.9 + 점멸 1.5 + (부활 자리로 카메라) 0.6 + 부활 0.9
  assert.equal(total, 600 + 2900 + 1500 + 600 + 900, '공격 → 점멸 → 포커스 이동 → 부활');

  const at = (): string => {
    const c = dir.cellOf('P2-King');
    return c ? `${c.x},${c.y}` : '—';
  };
  // 공격 2.9초 + 점멸 1.5초 동안은 **쓰러진 자리**에 붙들려 있다
  assert.equal(at(), '9,4', '맞은 자리');
  dir.update(3500);
  assert.equal(at(), '9,4', '점멸이 시작돼도 그 자리');
  assert.equal(dir.alphaOf('P2-King'), 1);
  dir.update(500);
  assert.equal(at(), '9,4');
  assert.equal(dir.alphaOf('P2-King'), 0.15, '점멸 중');
  dir.update(999);
  assert.equal(at(), '9,4', '점멸이 끝나기 직전까지도 쓰러진 자리');

  dir.update(1);
  assert.equal(at(), '—', '이제 권위 좌표(부활 자리)를 쓴다');
  assert.equal(dir.alphaOf('P2-King'), 1, '되살아났으니 또렷하다 — 점멸의 끝(0)에 갇히지 않는다');
});

test('부활 — 카메라는 **부활 자리**를 비춘다', () => {
  // `look()`은 권위 좌표를 읽으므로 커서를 민 **뒤에** 걸어야 한다.
  // 앞에 걸면 점멸이 도는 내내 아무도 없는 부활 자리를 비추고 있게 된다.
  const { dir } = run([
    { e: 'unitDied', unit: 'P2-King' },
    { e: 'unitRevived', unit: 'P2-King', at: { x: 12, y: 1 }, from: { x: 9, y: 4 } },
  ]);
  assert.equal(dir.camera.length, 1);
  assert.equal(dir.camera.all[0]!.from, 1500, '점멸 1.5초가 끝나고서 옮겨 간다');
});

test('그 외 이벤트는 평상 — 연출이 걸리지 않는다', () => {
  const { total } = run([
    { e: 'timeAdvanced', to: 190 },
    { e: 'controlGranted', unit: 'P1-King' },
    { e: 'spChanged', side: 'P1', to: 3 },
  ]);
  assert.equal(total, 0, '기다릴 것이 없으면 판을 멈추지 않는다');
});

/**
 * 소리·디버프 띠 타이밍 (기획자 지적 2026-08-26) — 예전에는 `BattleScene`이
 * 이벤트가 도착한 즉시(t=0) 소리를 틀었다. 그런데 실제 타격·피격 자세는 카메라가
 * 도착한 뒤(`CAM_LEAD_MS`)에야 뜬다 — 그래서 소리가 그림보다 먼저 들렸다. 상대
 * 턴에서만 도드라졌던 이유는, 내 턴은 카메라가 대개 이미 그 자리를 보고 있어
 * `look()`이 `CAM_LEAD_MS`를 안 붙였기 때문이다(위 테스트들의 `fakeState()`가
 * `pos`를 안 채워 늘 그 경로를 타는 것과 같은 사정이다). 여기서는 실제 위치를 채워
 * 카메라가 **진짜로 이동해야 하는** 경우를 재현한다.
 */
function positionedState(): BattleState {
  const unit = (id: string, side: 'P1' | 'P2', pos: { x: number; y: number }): unknown =>
    ({ id, side, pos });
  return {
    units: {
      'P1-King': unit('P1-King', 'P1', { x: 0, y: 0 }),
      'P2-King': unit('P2-King', 'P2', { x: 10, y: 10 }),
    },
    activeUnit: null,
  } as unknown as BattleState;
}

test('피격음은 피격 그림이 뜨는 순간에 튼다 — 이벤트 도착 즉시가 아니다', () => {
  const dir = new PoseDirector();
  dir.plan([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: false },
  ], fakeState());
  dir.update(1199);
  assert.equal(dir.drainSounds().length, 0, '줌인 0.6초 + 점멸·간격 0.6초 동안에는 아직');
  dir.update(1);
  const due = dir.drainSounds();
  assert.deepEqual(due.map((c) => c.k), ['attackHit'], '피격 그림이 뜨는 바로 그 프레임');
});

test('이동음은 줌아웃이 끝나 실제로 걷기 시작하는 순간에 튼다', () => {
  const dir = new PoseDirector();
  dir.plan([
    { e: 'moved', unit: 'P1-Rock', from: { x: 2, y: 5 }, to: { x: 6, y: 5 } },
  ], fakeState());
  dir.update(599);
  assert.equal(dir.drainSounds().length, 0);
  dir.update(1);
  assert.deepEqual(dir.drainSounds().map((c) => c.k), ['moveStart']);
});

test('사망음은 점멸이 시작되는 순간에 튼다 — 죽인 공격이 끝난 뒤다', () => {
  const dir = new PoseDirector();
  dir.plan([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 99, critical: false },
    { e: 'unitDied', unit: 'P2-King' },
  ], fakeState());
  dir.update(1200);
  assert.deepEqual(dir.drainSounds().map((c) => c.k), ['attackHit'], '피격음이 먼저다');
  dir.update(3499 - 1200);
  assert.equal(dir.drainSounds().length, 0, '아직 공격 연출이 도는 중 — 점멸 전');
  dir.update(1);
  assert.deepEqual(dir.drainSounds().map((c) => c.k), ['dieBlink'], '점멸이 시작되는 그 프레임');
});

test('책략 소리는 통하든 안 통하든 시전을 시작하는 순간에 튼다', () => {
  const dir = new PoseDirector();
  dir.plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: true },
  ], fakeState());
  dir.update(599);
  assert.equal(dir.drainSounds().length, 0, '줌인이 끝나기 전에는 아직');
  dir.update(1);
  assert.deepEqual(dir.drainSounds().map((c) => c.k), ['castStart']);
});

test('책략 성공 — 카메라가 실제로 옮겨 가야 하면 대상 피격도 그만큼 늦게 뜬다', () => {
  const dir = new PoseDirector();
  const total = dir.plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'incomingDamageHalf' },
  ], positionedState());

  // 캐스터 줌인 0.6 + 시전 1.3 + 대상으로 옮기는 둘째 줌인 0.6 + 피격 1.3
  assert.equal(total, 600 + 1300 + 600 + 1300,
    '예전에는 둘째 줌인 0.6초가 총 길이에 안 잡혔다 — 피격 자세가 카메라를 안 기다렸기 때문');

  // 예전 코드는 1900ms(=줌인 0.6+시전 1.3)에 곧바로 피격을 띄웠다 — 카메라가
  // 아직 캐스터 쪽에 있는데 대상이 먼저 아파한 것으로 보이는 지점이다.
  assert.deepEqual(sample(dir, 'P2-King', [0, 1899, 1900, 2499, 2500, 3799, 3800]),
    [POSE.idle, POSE.idle, POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle],
    '카메라가 대상에 도착하는 2500ms에야 피격 자세가 뜬다');
});

test('책략 성공 — 새로 걸린 디버프 띠는 카메라가 도착할 때까지 감춘다', () => {
  const dir = new PoseDirector();
  dir.plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'incomingDamageHalf' },
  ], positionedState());

  // `incomingDamageHalf`의 링 그림 id — packages/data/generated/visualEffects.json
  const vfx = '1';
  assert.equal(dir.isHidden('P2-King', vfx), true, '판정은 끝났지만 아직 화면엔 안 보여야 한다');
  dir.update(2499);
  assert.equal(dir.isHidden('P2-King', vfx), true, '카메라가 도착하기 직전까지');
  dir.update(1);
  assert.equal(dir.isHidden('P2-King', vfx), false, '카메라가 도착하는 순간 — 피격 자세와 같은 시각');
});
