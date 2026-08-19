/**
 * 대전 방의 회귀 — **브라우저 둘을 띄워야만 보이는 것들을 가짜 시계로 잡는다.**
 *
 * 여기서 고정하는 것은 전부 「기다려야 일어나는」 종류다. 사람 손으로 확인하려면
 * 탭 둘을 띄우고 30초·60초·2분을 세야 하고, 그러면 **아무도 다시 안 본다.**
 * `step(room, ev, nowMs)`가 시각을 인자로 받는 이유가 여기 하나에 다 들어 있다.
 *
 * | | 무엇 | 깨지면 |
 * |---|---|---|
 * | ① | 배치 마감의 자동 준비가 **끊긴 쪽에는 안 걸린다** | 이탈 표 첫 줄이 영원히 안 돈다 (§5-69) |
 * | ② | 이탈 표 네 줄 | 끊는 것이 거절보다 싸진다 (§5-65) |
 * | ③ | 제어 20초를 **서버가 잰다** | 넘기기 3번이 「빨리 세 번 누르기」가 된다 |
 * | ④ | 유휴 2분은 **사람의 의도만** 센다 | 아무도 안 두는 판이 영원히 안 접힌다 |
 * | ⑤ | 마감은 진영마다 다르고 **단계가 바뀔 때만** 다시 잰다 | 배치 30초가 되살아난다 |
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  CONTROL_MS, DEPLOY_MS, RECONNECT_GRACE_MS, ROOM_IDLE_MS, SCOUT_MS,
  SKIP_TO_WIN, TIMING_INVARIANTS, WAITING_MS, applyWire, defaultDeployPos,
} from '@samchess/rules';
import type { BattleMode, Intent, RosterEntry, ServerMsg, Side, UnitId } from '@samchess/rules';
import { makeAiOpponent } from '@samchess/meta';
import { openRoom, step } from '../src/room-logic.ts';
import type { RoomState } from '../src/room-logic.ts';
import type { Enlist } from '../src/protocol.ts';

// ═══════════════════════════════════════════════════════════════
// 표본
// ═══════════════════════════════════════════════════════════════

function enlist(entries: RosterEntry[], id: string, deploy: Enlist['deploy'] = null): Enlist {
  return { playerId: id, entries, squadName: `${id}의 부대`, power: 800, deploy };
}

/** 두 사람이 방금 모인 방. 시각은 0에서 시작한다 */
function room(mode: BattleMode = '3v3', seed = 7, deploy?: Record<Side, Enlist['deploy']>): RoomState {
  const a = makeAiOpponent(mode, 800, seed);
  const b = makeAiOpponent(mode, 800, seed + 1000, a.entries.map((e) => e.officer));
  return openRoom(`t-${seed}`, seed, mode, {
    P1: enlist(a.entries, 'alice', deploy?.P1 ?? null),
    P2: enlist(b.entries, 'bob', deploy?.P2 ?? null),
  }, 0);
}

const tick = (r: RoomState, at: number): ReturnType<typeof step> => step(r, { t: 'tick' }, at);
const intent = (r: RoomState, side: Side, i: Intent, at: number): ReturnType<typeof step> =>
  step(r, { t: 'intent', side, intent: i }, at);

/** 그 진영에게 간 마지막 통 */
const lastFor = (out: { to: Side; msg: ServerMsg }[], side: Side): ServerMsg | undefined =>
  out.filter((o) => o.to === side).at(-1)?.msg;

/** 배치를 마치고 제어 단계까지 간다 — **사람 둘이 정상으로 시작한 판** */
function toControl(r: RoomState, at = 0): number {
  intent(r, 'P1', { t: 'ready' }, at);
  intent(r, 'P2', { t: 'ready' }, at);
  assert.equal(r.battle.phase, 'scout', '둘 다 준비했는데 정찰로 안 넘어갔다');
  const t = at + SCOUT_MS;
  tick(r, t);
  assert.equal(r.battle.phase, 'control', '정찰 마감이 지났는데 제어로 안 갔다');
  return t;
}

// ═══════════════════════════════════════════════════════════════
// 1. 시간 셋의 관계 — 규칙 그 자체다
// ═══════════════════════════════════════════════════════════════

test('맞물린 시간 셋 — 하나만 고치면 화면은 아무 말도 안 한다', () => {
  for (const [why, ok] of TIMING_INVARIANTS) assert.ok(ok, why);
  // 근거를 값으로도 남긴다 — 관계식만 두면 「왜 60초인가」가 사라진다
  assert.equal(RECONNECT_GRACE_MS, CONTROL_MS * SKIP_TO_WIN, '유예는 3번 규칙의 하한이다');
  assert.equal(WAITING_MS, RECONNECT_GRACE_MS, '같은 기다림을 잰다');
});

// ═══════════════════════════════════════════════════════════════
// 2. 배치 마감과 `waiting`
// ═══════════════════════════════════════════════════════════════

test('배치 30초가 지나면 서버가 대신 준비를 마친다', () => {
  const r = room();
  assert.equal(tick(r, DEPLOY_MS - 1).room.battle.phase, 'deploy', '아직 30초 전인데 넘어갔다');
  tick(r, DEPLOY_MS);
  assert.equal(r.battle.phase, 'scout');
});

test('끊긴 사람에게는 자동 [준비완료]를 걸지 않는다 — 이탈 표 첫 줄이 사는 자리', () => {
  const r = room();
  step(r, { t: 'gone', side: 'P2' }, 1_000);
  tick(r, DEPLOY_MS);
  assert.equal(r.battle.ready['P1'], true, '자리에 있는 쪽은 대신 준비해 준다');
  assert.equal(r.battle.ready['P2'], false, '끊긴 쪽에 자동 준비를 걸었다');
  assert.equal(r.battle.phase, 'deploy', '배치 단계를 벗어나면 이탈이 항복으로 판정된다');
});

test('전선의 phase는 받는 사람의 걸음이다 — 준비를 마친 쪽만 waiting', () => {
  const r = room();
  const out = intent(r, 'P1', { t: 'ready' }, 1_000).out;
  assert.equal(r.battle.phase, 'deploy', '권위 상태는 배치 그대로여야 한다');
  assert.equal(lastFor(out, 'P1')!.state.phase, 'waiting', '준비를 마쳤는데 아직 배치라고 한다');
  assert.equal(lastFor(out, 'P2')!.state.phase, 'deploy', '아직 배치 중인 쪽을 기다리게 만들었다');
});

test('마감은 진영마다 다르다 — 배치 잔여 대 매칭 대기 잔여', () => {
  const r = room();
  const out = intent(r, 'P1', { t: 'ready' }, 5_000).out;
  assert.equal(lastFor(out, 'P1')!.deadlineInMs, WAITING_MS, '준비한 순간부터 상대를 기다린다');
  assert.equal(lastFor(out, 'P2')!.deadlineInMs, DEPLOY_MS - 5_000, '배치 마감이 흔들렸다');
});

test('배치 중 의도를 내도 30초가 되살아나지 않는다', () => {
  const r = room();
  const units = Object.values(r.battle.units).filter((u) => u.side === 'P1');
  const placements = units.map((u) => ({ unit: u.id as UnitId, pos: { ...u.pos } }));
  const out = intent(r, 'P1', { t: 'deploy', placements }, 10_000).out;
  assert.equal(lastFor(out, 'P1')!.deadlineInMs, DEPLOY_MS - 10_000, '마감을 통마다 다시 쟀다');
});

// ═══════════════════════════════════════════════════════════════
// 3. 이탈 표 네 줄 (GDD §3.9)
// ═══════════════════════════════════════════════════════════════

test('배치 중 한쪽 이탈 — 남은 쪽만 환불하고 전적도 보상도 없다', () => {
  const r = room();
  step(r, { t: 'gone', side: 'P2' }, 0);
  assert.equal(tick(r, RECONNECT_GRACE_MS - 1).closed, null, '유예 안인데 접었다');
  const closed = tick(r, RECONNECT_GRACE_MS).closed;
  assert.deepEqual(closed, { reason: 'left', refund: ['P1'] });
  assert.equal(r.battle.winner, null, '성립한 적 없는 전투에 승자가 생겼다');
  assert.notEqual(r.battle.phase, 'finished', '엔진이 결말을 냈다 — 전적이 남는다');
});

test('사라진 쪽에게는 환불하지 않는다 — 끊는 것이 거절보다 싸지면 안 된다', () => {
  const r = room();
  step(r, { t: 'gone', side: 'P2' }, 0);
  const closed = tick(r, RECONNECT_GRACE_MS).closed!;
  assert.ok(!closed.refund.includes('P2'), '끊어서 참가비를 돌려받으면 거절 −1이 무력해진다');
});

test('정찰 이후 한쪽 이탈 — 항복과 같다. 정산 지시가 아니라 평범한 결말이다', () => {
  const r = room();
  const t = toControl(r);
  step(r, { t: 'gone', side: 'P2' }, t);
  const res = tick(r, t + RECONNECT_GRACE_MS);
  assert.equal(res.closed, null, '성립한 판에 정산 지시를 실었다');
  assert.equal(r.battle.phase, 'finished');
  assert.equal(r.battle.winner, 'P1');
  assert.equal(r.battle.outcome, 'surrender', '엔진에 새 결말이 늘었다');
});

test('양쪽 다 사라지면 단계와 무관하게 양쪽 환불', () => {
  const r = room();
  const t = toControl(r);
  step(r, { t: 'gone', side: 'P1' }, t);
  step(r, { t: 'gone', side: 'P2' }, t + 1_000);
  assert.deepEqual(tick(r, t + 1_000 + RECONNECT_GRACE_MS).closed,
    { reason: 'left', refund: ['P1', 'P2'] });
});

test('먼저 끊긴 쪽의 유예가 끝날 때 상대도 끊겨 있으면 재촉할 사람이 없다', () => {
  const r = room();
  const t = toControl(r);
  step(r, { t: 'gone', side: 'P1' }, t);
  step(r, { t: 'gone', side: 'P2' }, t + 30_000);
  // P1의 유예는 끝났지만 P2는 아직 유예 안이다 — 기다린 사람이 없으므로 둔다
  assert.equal(tick(r, t + RECONNECT_GRACE_MS).closed, null, '지킬 사람이 없는데 한쪽-이탈로 끝냈다');
  assert.equal(r.battle.phase, 'control', '아무도 없는데 항복시켰다');
  assert.deepEqual(tick(r, t + 30_000 + RECONNECT_GRACE_MS).closed,
    { reason: 'left', refund: ['P1', 'P2'] });
});

test('끊겼다가 유예 안에 돌아오면 아무 일도 없다 — 스냅샷 한 통을 받는다', () => {
  const r = room();
  const t = toControl(r);
  step(r, { t: 'gone', side: 'P2' }, t);
  const back = step(r, { t: 'joined', side: 'P2' }, t + RECONNECT_GRACE_MS - 1);
  assert.equal(back.out.filter((o) => o.to === 'P2').length, 1, '돌아온 사람에게 통 하나면 된다');
  assert.equal(tick(r, t + RECONNECT_GRACE_MS + 1).closed, null, '돌아왔는데 이탈로 판정했다');
  assert.equal(r.battle.phase, 'control');
});

// ═══════════════════════════════════════════════════════════════
// 4. 유휴 상한 (§5-68)
// ═══════════════════════════════════════════════════════════════

test('양쪽 다 손을 놓으면 유휴 2분에 방을 접고 양쪽 환불한다', () => {
  const r = room();
  toControl(r);
  assert.equal(tick(r, ROOM_IDLE_MS - 1).closed, null);
  assert.deepEqual(tick(r, ROOM_IDLE_MS).closed, { reason: 'idle', refund: ['P1', 'P2'] });
  assert.equal(r.battle.winner, null, '유휴에 무승부나 승자를 주면 안 된다');
});

test('유휴는 사람의 의도만 센다 — 서버가 스스로 민 것은 안 센다', () => {
  const r = room();
  // 아무도 아무것도 안 한다: 배치 마감이 지나 서버가 대신 준비하고 정찰도 자동으로 끝난다
  tick(r, DEPLOY_MS);
  tick(r, DEPLOY_MS + SCOUT_MS);
  assert.equal(r.battle.phase, 'control', '서버가 스스로 밀어 제어까지 가야 한다');
  assert.deepEqual(tick(r, ROOM_IDLE_MS).closed, { reason: 'idle', refund: ['P1', 'P2'] },
    '자동 준비·자동 정찰을 「의도」로 세면 아무도 안 두는 판이 영원히 안 접힌다');
});

test('한 쪽이라도 두고 있으면 방은 유휴가 아니다 — 3번 규칙과 겹치지 않는다', () => {
  const r = room();
  const t = toControl(r);
  intent(r, r.battle.units[r.battle.activeUnit!]!.side, { t: 'endTurn' }, t + ROOM_IDLE_MS - 1_000);
  assert.equal(tick(r, t + ROOM_IDLE_MS).closed, null, '방금 둔 판을 유휴로 접었다');
});

// ═══════════════════════════════════════════════════════════════
// 5. 제어 20초와 `[차례 넘기기]` 3번 (§5-67)
// ═══════════════════════════════════════════════════════════════

/** 지금 제어권을 쥔 쪽과 그 상대 */
function control(r: RoomState): { turn: Side; foe: Side } {
  const unit = r.battle.units[r.battle.activeUnit!]!;
  const turn = unit.control ? r.battle.units[unit.control.by]!.side : unit.side;
  return { turn, foe: turn === 'P1' ? 'P2' : 'P1' };
}

test('제어 20초는 서버가 잰다 — 그 전의 [차례 넘기기]는 안 먹는다', () => {
  const r = room();
  const t = toControl(r);
  const { foe } = control(r);
  intent(r, foe, { t: 'forceSkipTurn' }, t + CONTROL_MS - 1);
  assert.equal(r.battle.skips[foe], 0, '20초 전인데 넘기기가 먹었다 — 빨리 세 번 누르기가 된다');
});

test('제어 마감을 통에 싣는다 — 화면이 20초를 다시 재지 않게', () => {
  const r = room();
  const t = toControl(r);
  // 한 수 두면 다음 제어권이 서고, 그 통에 제어 마감이 실려 온다
  const after = intent(r, control(r).turn, { t: 'endTurn' }, t + 5_000).out;
  assert.equal(r.battle.phase, 'control');
  assert.equal(lastFor(after, 'P1')!.deadlineInMs, CONTROL_MS,
    '제어 단계에 마감이 안 실렸다 — 화면이 제 시계로 20초를 다시 재게 된다');
  assert.equal(r.battle.controlStartedAtMs, t + 5_000, '제어 시작 시각을 서버가 안 넣었다');
});

test('먼저 3번 누른 쪽이 이긴다 — 결말은 항복과 같이 적는다', () => {
  const r = room();
  let t = toControl(r);
  /*
   * **한쪽만 손을 놓은 판을 흉내 낸다.** `idle`은 제 차례에 아무것도 안 하고,
   * `presser`는 제 차례에는 정상으로 두고 상대 차례에는 20초를 기다렸다 누른다 —
   * 「3번은 최소 60초의 무응답」이 성립하는 것이 이 모양이다.
   */
  const presser: Side = control(r).foe;
  for (let guard = 0; guard < 30 && r.battle.phase === 'control'; guard++) {
    if (control(r).turn === presser) { t += 1; intent(r, presser, { t: 'endTurn' }, t); continue; }
    t += CONTROL_MS;
    const before = r.battle.skips[presser];
    const res = intent(r, presser, { t: 'forceSkipTurn' }, t);
    const ev = res.out.flatMap((o) => (o.to === presser ? o.msg.events : []))
      .find((e) => e.e === 'turnSkipped');
    assert.ok(ev && ev.e === 'turnSkipped' && ev.count === before + 1, `누적이 ${before + 1}이 아니다`);
  }
  assert.equal(r.battle.skips[presser], SKIP_TO_WIN, '3번을 못 채웠다');
  assert.equal(r.battle.phase, 'finished', '3번을 눌렀는데 안 끝났다');
  assert.equal(r.battle.outcome, 'surrender', '엔진에 새 결말이 늘었다');
  assert.equal(r.battle.winner, presser, '누른 쪽이 못 이겼다');
});

test('넘기기 횟수는 누적이다 — 되돌리지 않는다', () => {
  const r = room();
  let t = toControl(r);
  const { foe } = control(r);
  t += CONTROL_MS;
  intent(r, foe, { t: 'forceSkipTurn' }, t);
  assert.equal(r.battle.skips[foe], 1);
  // 그 사이에 정상적인 수가 오가도 횟수는 그대로다
  for (let i = 0; i < 3 && r.battle.phase === 'control'; i++) {
    intent(r, control(r).turn, { t: 'endTurn' }, t + i + 1);
  }
  assert.equal(r.battle.skips[foe], 1, '중간에 상대가 정신을 차렸다고 되돌렸다');
});

// ═══════════════════════════════════════════════════════════════
// 6. 배치 프리셋 — 서버가 깐다 (북군이 처음 도는 자리)
// ═══════════════════════════════════════════════════════════════

test('저장된 배치를 서버가 깐다 — 남군도 북군도', () => {
  const plain = room();
  const moved: Record<Side, Enlist['deploy']> = { P1: [], P2: [] };
  for (const side of ['P1', 'P2'] as Side[]) {
    moved[side] = Object.values(plain.battle.units)
      .filter((u) => u.side === side)
      .map((u) => ({ unit: u.id as UnitId, pos: { x: u.pos.x, y: side === 'P1' ? u.pos.y - 1 : u.pos.y + 1 } }));
  }
  const r = room('3v3', 7, moved);
  for (const side of ['P1', 'P2'] as Side[]) {
    for (const p of moved[side]!) {
      assert.deepEqual(r.battle.units[p.unit]!.pos, p.pos, `${side} 프리셋이 안 깔렸다`);
    }
  }
  // **기본값과 같은 값을 확인하면 아무것도 확인하지 않는 것이다** — 옮겨 놓고 본다
  assert.notDeepEqual(r.battle.units[moved.P1![0]!.unit]!.pos, plain.battle.units[moved.P1![0]!.unit]!.pos);
});

test('어긋난 프리셋은 아무 말 없이 안 깐다 — 막으면 전투에 못 들어간다', () => {
  const plain = room();
  const bad: Record<Side, Enlist['deploy']> = {
    // 구역 밖 좌표. `validate`가 거른다
    P1: Object.values(plain.battle.units).filter((u) => u.side === 'P1')
      .map((u) => ({ unit: u.id as UnitId, pos: { x: 0, y: 0 } })),
    P2: null,
  };
  const r = room('3v3', 7, bad);
  const first = bad.P1![0]!.unit;
  assert.deepEqual(r.battle.units[first]!.pos, plain.battle.units[first]!.pos, '어긋난 프리셋이 깔렸다');
  assert.equal(r.battle.phase, 'deploy', '어긋난 프리셋에 전투가 막혔다');
});

// ═══════════════════════════════════════════════════════════════
// 7. 전선 계약 — 서버 통에서도 그대로다
// ═══════════════════════════════════════════════════════════════

test('서버가 보낸 통도 「이전 로그 ++ events === 다음 로그」다', () => {
  const r = room();
  let mine = { ...r.battle, log: [] as typeof r.battle.log };
  const feed = (out: { to: Side; msg: ServerMsg }[]): void => {
    for (const o of out) if (o.to === 'P1') mine = applyWire(mine, o.msg);
  };
  feed(intent(r, 'P1', { t: 'ready' }, 0).out);
  feed(intent(r, 'P2', { t: 'ready' }, 0).out);
  feed(tick(r, SCOUT_MS).out);
  for (let i = 0; i < 40 && r.battle.phase === 'control'; i++) {
    feed(intent(r, control(r).turn, { t: 'endTurn' }, SCOUT_MS + i).out);
  }
  assert.deepEqual(mine.log, r.battle.log, '이어 붙인 로그가 서버의 것과 다르다');
});

test('스냅샷에는 로그가 없다', () => {
  const r = room();
  const out = intent(r, 'P1', { t: 'ready' }, 0).out;
  assert.ok(!('log' in lastFor(out, 'P1')!.state), '전선에 로그가 실렸다 — O(턴²)다');
});

test('기본 배치는 엔진의 것을 쓴다 — 서버가 좌표를 다시 적지 않는다', () => {
  const r = room();
  for (const u of Object.values(r.battle.units)) {
    assert.ok(defaultDeployPos, '엔진의 기본 배치가 사라졌다');
    assert.ok(u.pos.x >= 0 && u.pos.y >= 0);
  }
});
