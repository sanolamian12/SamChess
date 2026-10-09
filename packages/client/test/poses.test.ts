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
import { POSE, PoseDirector, REVEAL_FLASH_MS } from '../src/battle/poses.ts';
import { SCALE_FOCUS } from '../src/battle/camera.ts';

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

/**
 * 행동 하나의 시간표를 잰다 — **「장수를 먼저 비추고 1초」(2026-10-09)는 끈다**(내가 낸 수와 같은 길). 그 머리는 아래
 * 「상대의 수」 테스트들이 따로 잰다 — 켜 두면 모든 숫자에 2초가 붙어 행동 자체의 시간표가 안 읽힌다.
 */
function run(events: BattleEvent[], active?: UnitId): { dir: PoseDirector; total: number } {
  const dir = new PoseDirector();
  const total = dir.plan(events, fakeState(active), { intro: false });
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

/*
 * 책략 · 아이템 (2026-10-09 다시 짰다) — 시전 자세 1.3초 → **대상에게 카메라가 가서 도착하고 1초**(2초) → 피격 1.3초 → 배지.
 * 카메라가 실제로 옮겨 가야 그 2초가 붙으므로 칸이 있는 판(`positionedState`)에서 잰다.
 */
const CAST = 1300;
const LEAD = 600;            // 행동 시작의 카메라 도착(`CAM_LEAD_MS`)
const FOCUS = 2000;          // 대상으로 옮겨 가 도착하고 1초(`FOCUS_ARRIVE_MS + FOCUS_BEAT_MS`)

function plan(events: BattleEvent[], opts: Parameters<PoseDirector['plan']>[2] = { intro: false }): { dir: PoseDirector; total: number } {
  const dir = new PoseDirector();
  const total = dir.plan(events, positionedState(), opts);
  return { dir, total };
}

test('책략 — 적에게 걸어 성공하면 시전 1.3초 → 대상으로 2초 → 피격 1.3초 → 배지', () => {
  const events: BattleEvent[] = [
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'outgoingDamageHalf' },
  ];
  const { dir, total } = plan(events);
  const hurtAt = LEAD + CAST + FOCUS;
  assert.equal(total, hurtAt + CAST + REVEAL_FLASH_MS, '배지가 번쩍이는 동안까지 판을 붙든다');
  assert.deepEqual(sample(dir, 'P1-King', [0, LEAD - 1, LEAD, LEAD + CAST - 1, LEAD + CAST]),
    [POSE.idle, POSE.idle, POSE.cast, POSE.cast, POSE.idle], '시전자는 1.3초만 — 카메라가 대상으로 떠나면 평상');
  const { dir: d2 } = plan(events);
  assert.deepEqual(sample(d2, 'P2-King', [0, hurtAt - 1, hurtAt, hurtAt + CAST - 1, hurtAt + CAST]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle], '카메라가 도착하고 1초 뒤에 아파한다');
});

test('책략 — 실패하면 1.3초로 끝난다', () => {
  const { dir, total } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: true },
  ]);
  assert.equal(total, LEAD + CAST);
  assert.deepEqual(sample(dir, 'P1-King', [0, LEAD, LEAD + CAST - 1, LEAD + CAST]),
    [POSE.idle, POSE.cast, POSE.cast, POSE.idle]);
});

test('책략 — 아군에게 건 버프는 대상으로 옮겨 가되 피격을 띄우지 않는다', () => {
  const { dir, total } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'jeung-pok', resisted: false },
    { e: 'statusApplied', unit: 'P1-Rock', status: 'critical100' },
  ]);
  const landAt = LEAD + CAST + FOCUS;
  assert.equal(total, landAt + REVEAL_FLASH_MS);
  assert.deepEqual(sample(dir, 'P1-Rock', [0, landAt, landAt + 599]), [POSE.idle, POSE.idle, POSE.idle]);
  assert.equal(dir.camera.at(LEAD + CAST)?.cell?.x, 1, '시전이 끝나면 카메라가 받는 쪽으로 간다');
});

/*
 * 시장 아이템 (2026-09-23) — **책략과 같은 시간표를 쓴다.** 같은 시간표라는 것도
 * 검사가 있어야 참이 된다: `itemUsed`를 `case`에 안 넣어도 화면은 아무 말 없이
 * 0초짜리로 지나간다(그러면 효과가 연출 없이 즉시 반영돼 「번쩍」한다).
 */
test('아이템 — 적에게 쓰면 책략과 같다: 시전 → 대상으로 2초 → 피격', () => {
  const events: BattleEvent[] = [
    { e: 'itemUsed', unit: 'P1-King', item: 'pok-yak' },
    { e: 'hpChanged', unit: 'P2-King', delta: -5, reason: 'item:pok-yak' },
  ];
  const { dir, total } = plan(events);
  const hurtAt = LEAD + CAST + FOCUS;
  assert.equal(total, hurtAt + CAST);
  assert.deepEqual(sample(dir, 'P1-King', [0, LEAD, LEAD + CAST - 1, LEAD + CAST]),
    [POSE.idle, POSE.cast, POSE.cast, POSE.idle]);
  const { dir: d2 } = plan(events);
  assert.deepEqual(sample(d2, 'P2-King', [0, hurtAt - 1, hurtAt, hurtAt + CAST - 1, hurtAt + CAST]),
    [POSE.idle, POSE.idle, POSE.hurt, POSE.hurt, POSE.idle]);
});

test('아이템 — 아군에게 쓰면 피격을 띄우지 않는다', () => {
  const { dir, total } = plan([
    { e: 'itemUsed', unit: 'P1-King', item: 'tang-yak' },
    { e: 'hpChanged', unit: 'P1-Rock', delta: 5, reason: 'item:tang-yak' },
  ]);
  assert.equal(total, LEAD + CAST + FOCUS + 600, '도착하고 1초 뒤 차오르고 0.6초 더 보여 준다');
  assert.deepEqual(sample(dir, 'P1-Rock', [0, LEAD + CAST + FOCUS]), [POSE.idle, POSE.idle]);
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
      'P1-Rock': unit('P1-Rock', 'P1', { x: 1, y: 0 }),
      'P2-King': unit('P2-King', 'P2', { x: 10, y: 10 }),
    },
    activeUnit: null,
  } as unknown as BattleState;
}

test('피격음은 피격 그림이 뜨는 순간에 튼다 — 이벤트 도착 즉시가 아니다', () => {
  const dir = new PoseDirector();
  dir.plan([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 7, critical: false },
  ], fakeState(), { intro: false });
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
  ], fakeState(), { intro: false });
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
  ], fakeState(), { intro: false });
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
  ], fakeState(), { intro: false });
  dir.update(599);
  assert.equal(dir.drainSounds().length, 0, '줌인이 끝나기 전에는 아직');
  dir.update(1);
  assert.deepEqual(dir.drainSounds().map((c) => c.k), ['castStart']);
});

test('책략 성공 — 카메라가 실제로 옮겨 가야 하면 대상 피격도 그만큼 늦게 뜬다', () => {
  const { dir, total } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'incomingDamageHalf' },
  ]);
  // 캐스터 줌인 0.6 + 시전 1.3 + 대상으로 옮겨 도착하고 1초 2.0 + 피격 1.3 + 배지 번쩍
  assert.equal(total, LEAD + CAST + FOCUS + CAST + REVEAL_FLASH_MS);
  const hurtAt = LEAD + CAST + FOCUS;
  assert.deepEqual(sample(dir, 'P2-King', [0, LEAD + CAST, hurtAt - 1, hurtAt]),
    [POSE.idle, POSE.idle, POSE.idle, POSE.hurt], '카메라가 대상에 도착하고 1초 뒤에야 피격 자세가 뜬다');
});

test('책략 성공 — 새로 걸린 디버프 띠는 피격 자세가 끝날 때까지 감춘다', () => {
  const { dir } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'incomingDamageHalf' },
  ]);
  // `incomingDamageHalf`의 링 그림 id — packages/data/generated/visualEffects.json
  const vfx = '1';
  const landAt = LEAD + CAST + FOCUS + CAST;
  assert.equal(dir.isHidden('P2-King', vfx), true, '판정은 끝났지만 아직 화면엔 안 보여야 한다');
  dir.update(landAt - 1);
  assert.equal(dir.isHidden('P2-King', vfx), true, '피격 자세가 도는 동안에도');
  dir.update(1);
  assert.equal(dir.isHidden('P2-King', vfx), false, '피격 자세가 끝나는 순간 — 배지와 같은 시각');
});

/*
 * 장수 카드의 배지 (기획자 지적 2026-10-09) — 서서가 「침묵」을 거는데 카메라가 서서에게 가기도 전에
 * 감녕의 카드에 배지가 이미 붙어 있었다. 배지는 연출이 정한 시각에 붙고, 그 순간부터 번쩍인다.
 */
test('배지 — 피격 자세가 끝날 때까지 감추고, 붙는 순간부터 번쩍인다', () => {
  const { dir } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'chim-muk', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'silence' },
  ]);
  const landAt = LEAD + CAST + FOCUS + CAST;
  const veil = (): string => {
    const v = dir.statusVeil('P2-King');
    return `${[...v.hidden].join()}|${[...v.flashing].join()}`;
  };
  assert.equal(veil(), 'silence|', '처음엔 감춘다');
  dir.update(landAt - 1);
  assert.equal(veil(), 'silence|', '피격 자세가 끝나기 직전까지');
  dir.update(1);
  assert.equal(veil(), '|silence', '붙는 순간 — 번쩍인다');
  dir.update(REVEAL_FLASH_MS);
  assert.equal(veil(), '|', '번쩍임이 끝나면 그냥 붙어 있다');
  assert.equal(dir.statusVeil('P1-King').hidden.size, 0, '시전자는 상관없다');
});

test('배지 — 조종은 `control`로 붙는다(카드의 엠블럼 이름과 같다)', () => {
  const { dir } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'yu-in', resisted: false },
    { e: 'controlChanged', unit: 'P2-King', by: 'P1-King', mode: 'moveOnly' },
  ]);
  assert.deepEqual([...dir.statusVeil('P2-King').hidden], ['control']);
});

test('배지 — 자세가 하나도 없는 계획에서는 감추지 않는다(시계가 안 흘러 영영 못 붙는다)', () => {
  const dir = new PoseDirector();
  dir.plan([{ e: 'statusApplied', unit: 'P2-King', status: 'silence' }], positionedState());
  assert.equal(dir.statusVeil('P2-King').hidden.size, 0);
  assert.equal(dir.statusVeil('P2-King').flashing.size, 0);
});

/*
 * 상대의 수 (2026-10-09) — **행동하는 장수에게 카메라가 먼저 가서 도착하고 1초**, 그다음 동작.
 * 카메라가 이미 거기를 보고 있으면 기다리지 않는다.
 */
test('상대의 수 — 장수를 먼저 비추고 2초 뒤에 시전한다', () => {
  const { dir, total } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'chim-muk', resisted: false },
    { e: 'statusApplied', unit: 'P2-King', status: 'silence' },
  ], {});
  const castAt = FOCUS;      // 비추고 도착 1초 + 1초 — 그다음 「시전자를 비춘다」는 이미 거기라 안 기다린다
  assert.equal(total, castAt + CAST + FOCUS + CAST + REVEAL_FLASH_MS);
  assert.deepEqual([dir.eventTiming.start[0], dir.eventTiming.effect[0]], [castAt, castAt + CAST + FOCUS + CAST],
    '대화창 첫 줄은 시전 자세와 함께, 「통했다」는 배지와 함께');
  assert.deepEqual(sample(dir, 'P1-King', [0, castAt - 1, castAt]), [POSE.idle, POSE.idle, POSE.cast]);
});

test('상대의 수 — 카메라가 이미 그 장수를 보고 있으면 기다리지 않는다', () => {
  const { dir, total } = plan([
    { e: 'tacticCast', unit: 'P1-King', tactic: 'gong-po', resisted: true },
  ], { camera: { from: 0, scale: SCALE_FOCUS, cell: { x: 0, y: 0 } } });
  assert.equal(total, CAST);
  assert.equal(dir.frameOf('P1-King'), POSE.cast, '곧바로 시전');
});

test('상대의 수 — 이동은 출발점의 장수를 비추고 2초 뒤에 판 전체로 물러나 걷는다', () => {
  const { dir } = plan([
    { e: 'moved', unit: 'P1-King', from: { x: 0, y: 0 }, to: { x: 0, y: 2 } },
  ], {});
  const first = dir.camera.at(0)!;
  assert.deepEqual([first.scale, first.cell], [SCALE_FOCUS, { x: 0, y: 0 }], '도착지가 아니라 출발점');
  assert.deepEqual(sample(dir, 'P1-King', [FOCUS + LEAD - 1, FOCUS + LEAD]), [POSE.idle, POSE.move]);
});

test('상대의 수 — 공격은 때리는 쪽을 먼저 비춘 뒤 맞는 쪽으로', () => {
  const { dir } = plan([
    { e: 'attacked', unit: 'P1-King', target: 'P2-King', damage: 3, critical: false },
  ], {});
  assert.deepEqual(dir.camera.all.map((c) => c.cell), [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  assert.equal(dir.camera.all[1]!.from, FOCUS);
});

test('상대의 수 — 이동하고 책략을 한 통에 보내도, 책략의 시각은 **시전 자세가 시작될 때**다(걷기 시작할 때가 아니다)', () => {
  // 기획자 지적 2026-10-09 — 오른쪽 판의 대상 카드가 AI가 걷기 시작할 때 이미 떠 있었다
  const { dir } = plan([
    { e: 'moved', unit: 'P1-King', from: { x: 0, y: 0 }, to: { x: 0, y: 2 } },
    { e: 'tacticCast', unit: 'P1-King', tactic: 'chim-muk', resisted: false, target: 'P2-King' },
    { e: 'statusApplied', unit: 'P2-King', status: 'silence' },
  ], {});
  const [walk, cast, status] = [0, 1, 2].map((i) => dir.eventTiming.start[i]!);
  assert.ok(walk < cast, `걷기(${walk})가 먼저, 시전(${cast})이 나중`);
  dir.update(cast - 1);
  assert.notEqual(dir.frameOf('P1-King'), POSE.cast, '그 직전까지는 시전 자세가 아니다');
  dir.update(1);
  assert.equal(dir.frameOf('P1-King'), POSE.cast, '시전 자세가 시작되는 바로 그 시각');
  assert.equal(status, dir.eventTiming.effect[1], '걸린 상태는 그 책략의 결과 시각(배지)에');
});

test('상대의 수 — 이동하고 명상을 한 통에 보내도 명상 자세가 걷기 뒤에 1.3초 돈다', () => {
  // 기획자 지적 2026-10-09 — 명상 자세가 통째로 빠져 카메라가 곧장 다음 차례로 넘어갔다
  // (예전엔 「이 장수에게 자세가 하나도 없을 때」만 명상을 붙였는데 걷기 자세가 있었다)
  const { dir, total } = plan([
    { e: 'moved', unit: 'P1-King', from: { x: 0, y: 0 }, to: { x: 0, y: 2 } },
    { e: 'mpChanged', unit: 'P1-King', delta: 1, reason: 'meditate' },
  ], {});
  const at = dir.eventTiming.start[1]!;
  assert.ok(at > dir.eventTiming.start[0]!, '걷기 뒤');
  assert.equal(total, at + CAST, '명상 자세가 끝날 때까지 판을 붙든다 — 그 뒤에 카메라가 옮겨 간다');
  assert.deepEqual(sample(dir, 'P1-King', [at - 1, at, at + CAST - 1, at + CAST]),
    [POSE.idle, POSE.cast, POSE.cast, POSE.idle]);
  assert.deepEqual(dir.camera.at(at)?.cell, { x: 0, y: 0 }, '명상하는 동안 카메라는 그 장수에게');
});
