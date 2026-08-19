/**
 * 전송 이음매 회귀 — **서버가 붙기 전에 전선의 계약을 고정한다.**
 *
 * `transport.ts`가 정한 것은 셋이고, 셋 다 서버가 생긴 뒤에 깨지면
 * **화면에는 아무 말도 안 나온다** — 「후반이 좀 버벅이네」 · 「가끔 어긋나네」로만
 * 보인다. 그래서 판정 주체가 아직 같은 프로세스에 있는 지금 못 박아 둔다.
 *
 * | | 무엇 | 깨지면 |
 * |---|---|---|
 * | ① | `이전 로그 ++ events === 다음 로그` | 뗀 로그를 되만들 수 없다 → 전적·처치 수가 조용히 틀린다 |
 * | ② | 스냅샷 크기가 **판 길이와 무관** | 전선에서 `O(턴²)` — `cloneState()`의 그 지뢰가 네트워크에 |
 * | ③ | 전송 층을 지나도 **판정이 같다** | 재생기가 판정에 끼어들었다 |
 *
 * 그리고 마감이 **「남은 ms」**로 오는 것(시계 어긋남)과, 배치 중 의도를 내도
 * 30초가 되살아나지 않는 것도 여기서 고정한다.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  DEPLOY_MS, SCOUT_MS, advanceTime, apply, createBattle, isOver, takeTurn,
} from '@samchess/rules';
import type { BattleEvent, BattleMode, BattleState, RosterEntry, Side } from '@samchess/rules';
import { makeAiOpponent } from '@samchess/meta';
import { LocalTransport, applyWire, toWire } from '../src/battle/transport.ts';
import type { BattleTransport, ServerMsg } from '../src/battle/transport.ts';
import { Playback } from '../src/battle/playback.ts';

// ═══════════════════════════════════════════════════════════════
// 표본과 도구
// ═══════════════════════════════════════════════════════════════

/** 실측 표본과 같은 방식으로 양쪽 부대를 만든다 (`makeAiOpponent`는 시드에 결정적이다) */
function rosters(mode: BattleMode, seed: number): Record<Side, RosterEntry[]> {
  const a = makeAiOpponent(mode, 800, seed);
  const b = makeAiOpponent(mode, 800, seed + 1000, a.entries.map((e) => e.officer));
  return { P1: a.entries, P2: b.entries };
}

const fresh = (mode: BattleMode, seed: number): BattleState =>
  createBattle({ matchId: `t-${seed}`, seed, mode, rosters: rosters(mode, seed) });

/**
 * 판정 주체 없이 룰 엔진을 직접 돌린다 — **비교 기준.**
 *
 * `LocalTransport`가 하는 것과 **정확히 같은 순서**여야 한다(양쪽 `ready` → 그 뒤로는
 * 제어면 `takeTurn`, 아니면 `advanceTime`). 순서가 다르면 난수 소비가 갈려
 * 비교 자체가 뜻이 없어진다.
 */
function direct(initial: BattleState): BattleState {
  let s = initial;
  for (const side of ['P1', 'P2'] as Side[]) {
    if (!s.ready[side]) s = apply(s, side, { t: 'ready' }).state;
  }
  for (let i = 0; i < 20_000 && !isOver(s); i++) {
    s = s.phase === 'control' ? takeTurn(s).state : advanceTime(s).state;
  }
  return s;
}

/** `LocalTransport` 혼자 돌린다 — 재생기 없이 전선에 실리는 통만 모은다 */
function collect(initial: BattleState, humanSide: Side | null): ServerMsg[] {
  const msgs: ServerMsg[] = [];
  const transport = new LocalTransport(initial, humanSide, { now: () => 0 });
  transport.open((m) => msgs.push(m));
  for (let i = 0; i < 20_000; i++) {
    const last = msgs[msgs.length - 1]!;
    if (last.state.phase === 'finished') break;
    const before = msgs.length;
    transport.ready();
    if (msgs.length === before) break;   // 더 만들 것이 없다 (사람 차례)
  }
  return msgs;
}

/** 한 프레임의 실시간. 정찰 30초를 60프레임에 지나므로 회귀가 빠르다 */
const STEP_MS = 500;

interface Driven {
  playback: Playback;
  /** 화면이 받은 이벤트를 순서대로 이어 놓은 것 */
  seen: BattleEvent[];
  frames: number;
}

/**
 * 재생기까지 태워 전투 한 판을 끝까지 돌린다.
 *
 * 시계는 하나뿐이다(`clock`) — 판정 주체와 재생기가 **같은 시계**를 봐야
 * 마감 계산이 시험대에 오른다.
 */
function drive(
  initial: BattleState, humanSide: Side | null, opts?: { holdMs?: number },
): Driven {
  const clock = { t: 1_000_000 };
  const now = (): number => clock.t;
  const transport = new LocalTransport(initial, humanSide, { now });
  const seen: BattleEvent[] = [];
  const playback: Playback = new Playback(transport, {
    onChange: (_state, events) => {
      seen.push(...events);
      if (opts?.holdMs && events.length > 0) playback.hold(opts.holdMs);
    },
    onTick: () => {},
  }, { now });

  playback.start();
  let frames = 0;
  for (; frames < 40_000 && playback.phase !== 'finished'; frames++) {
    clock.t += STEP_MS;
    playback.update(STEP_MS);
  }
  return { playback, seen, frames };
}

// ═══════════════════════════════════════════════════════════════
// ① 로그를 떼어 보내고 이어 붙인다
// ═══════════════════════════════════════════════════════════════

test('로그를 뗀 스냅샷 + 이벤트를 이어 붙이면 원본 로그와 정확히 같다', () => {
  for (const mode of ['3v3', '5v5'] as BattleMode[]) {
    const msgs = collect(fresh(mode, 7), null);
    assert.equal(msgs[msgs.length - 1]!.state.phase, 'finished', `${mode}: 끝까지 안 갔다`);

    // 받는 쪽 흉내 — 통마다 이어 붙인다 (`applyWire`가 하는 일 그대로)
    let rebuilt: BattleEvent[] = [];
    for (const msg of msgs) rebuilt = rebuilt.concat(msg.events);

    const truth = direct(fresh(mode, 7)).log;
    assert.equal(rebuilt.length, truth.length, `${mode}: 이벤트 수가 다르다`);
    assert.deepEqual(rebuilt, truth, `${mode}: 되만든 로그가 원본과 다르다`);
  }
});

test('스냅샷에는 로그가 실리지 않는다 — 뗀 자리가 하나여야 한다', () => {
  const msgs = collect(fresh('3v3', 11), null);
  for (const msg of msgs) {
    assert.ok(!('log' in msg.state), '스냅샷에 로그가 딸려 왔다');
  }
  // 되만드는 자리도 하나다 — `applyWire`가 이전 로그에 이어 붙인다
  const base = fresh('3v3', 11);
  const merged = applyWire(base, msgs[1]!);
  assert.deepEqual(merged.log, base.log.concat(msgs[1]!.events));
  assert.ok('log' in merged, '되만든 상태에 로그가 없다');
});

// ═══════════════════════════════════════════════════════════════
// ② 스냅샷 크기는 판 길이와 무관하다 — 전선의 O(턴²)
// ═══════════════════════════════════════════════════════════════

test('스냅샷 크기가 판 길이를 따라 커지지 않는다 (로그를 실으면 커진다)', () => {
  for (const mode of ['3v3', '5v5'] as BattleMode[]) {
    const msgs = collect(fresh(mode, 3), null);
    assert.ok(msgs.length > 40, `${mode}: 표본이 너무 짧다 (${msgs.length}통)`);

    const sizes = msgs.map((m) => JSON.stringify(m.state).length);
    const grew = Math.max(...sizes) / sizes[0]!;
    /*
     * **조금은 는다** — 상태이상·WT 보정이 유닛에 쌓이기 때문이다. 그러나 그것은
     * 판에 붙어 있는 양이지 지나온 턴 수가 아니라서 **곧 천장에 닿는다.**
     *
     * 임계값은 재고 정했다 (시드 40개 · 두 모드):
     *   스냅샷 최대/첫 = 3v3 **1.54배** · 5v5 1.33배 (최대 4,214 B)
     *   로그 포함      = **21~23배** — 이쪽이 판 길이를 따라간다
     * 사이가 열 배 넘게 벌어져 있어 2배로 그으면 어느 쪽도 아슬아슬하지 않다.
     */
    assert.ok(grew <= 2, `${mode}: 스냅샷이 판 길이를 따라 커진다 (${grew.toFixed(2)}배)`);
    assert.ok(Math.max(...sizes) < 8_000, `${mode}: 스냅샷 한 통이 너무 크다`);

    /*
     * **대조군** — 로그를 실으면 정말로 커지는가. 이게 없으면 위의 검사는
     * 「원래 안 크는 것을 안 큰다고 확인」하는 것일 수 있다(§5-51의 사촌).
     */
    let log: BattleEvent[] = [];
    const withLog = msgs.map((m) => {
      log = log.concat(m.events);
      return JSON.stringify({ ...m.state, log }).length;
    });
    const grewWithLog = withLog[withLog.length - 1]! / withLog[0]!;
    assert.ok(
      grewWithLog > 5,
      `${mode}: 대조군이 안 커졌다(${grewWithLog.toFixed(1)}배) — 표본이 이 회귀를 시험하지 못한다`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════
// ③ 전송 층을 지나도 판정이 같다
// ═══════════════════════════════════════════════════════════════

test('전송 층을 지난 전투가 엔진을 직접 돌린 것과 같은 결과다', () => {
  for (const mode of ['3v3', '5v5'] as BattleMode[]) {
    for (const seed of [1, 42, 777]) {
      const truth = direct(fresh(mode, seed));
      const { playback } = drive(fresh(mode, seed), null);
      const got = playback.state;
      assert.equal(got.phase, 'finished', `${mode}/${seed}: 끝까지 안 갔다`);
      assert.equal(got.winner, truth.winner, `${mode}/${seed}: 승자가 다르다`);
      assert.equal(got.outcome, truth.outcome, `${mode}/${seed}: 결말이 다르다`);
      assert.equal(got.time, truth.time, `${mode}/${seed}: 결착 시각이 다르다`);
      // **난수 소비 순서가 같아야 리플레이·분쟁 처리가 선다** (GDD §10)
      assert.equal(got.rngCursor, truth.rngCursor, `${mode}/${seed}: rngCursor가 다르다`);
      assert.deepEqual(got.log, truth.log, `${mode}/${seed}: 로그가 다르다`);
    }
  }
});

test('rngCursor는 통마다 뒤로 가지 않는다', () => {
  const msgs = collect(fresh('5v5', 5), null);
  let last = -1;
  for (const msg of msgs) {
    assert.ok(msg.state.rngCursor >= last, `rngCursor가 되감겼다 (${last} → ${msg.state.rngCursor})`);
    last = msg.state.rngCursor;
  }
  assert.ok(last > 0, '난수를 한 번도 안 썼다 — 표본이 이 회귀를 시험하지 못한다');
});

// ═══════════════════════════════════════════════════════════════
// 마감 — 「남은 ms」로 오고, 단계가 바뀔 때만 다시 잰다
// ═══════════════════════════════════════════════════════════════

test('마감은 절대시각이 아니라 「남은 ms」로 온다 — 시계가 어긋나도 같다', () => {
  const initial = fresh('3v3', 9);
  const early = new LocalTransport(initial, 'P1', { now: () => 0 });
  const late = new LocalTransport(initial, 'P1', { now: () => 9_999_999_999 });
  const a: ServerMsg[] = []; const b: ServerMsg[] = [];
  early.open((m) => a.push(m));
  late.open((m) => b.push(m));
  // 시계가 100억 ms 어긋나 있어도 실린 값은 같다
  assert.equal(a[0]!.deadlineInMs, DEPLOY_MS);
  assert.equal(b[0]!.deadlineInMs, DEPLOY_MS);
});

test('배치 중 의도를 내도 30초가 되살아나지 않는다', () => {
  const initial = fresh('3v3', 13);
  const clock = { t: 0 };
  const msgs: ServerMsg[] = [];
  const transport = new LocalTransport(initial, 'P1', { now: () => clock.t });
  transport.open((m) => msgs.push(m));
  assert.equal(msgs[0]!.deadlineInMs, DEPLOY_MS, '첫 통이 배치 마감을 안 줬다');

  // 12초 뒤에 배치를 낸다 — 남은 시간은 18초여야 한다
  // (`deploy`는 **내 유닛 전부**를 실어야 통과한다 — 한 칸만 옮겨도 판 전체가 온다)
  clock.t += 12_000;
  const placements = Object.values(msgs[0]!.state.units)
    .filter((u) => u.side === 'P1')
    .map((u) => ({ unit: u.id, pos: { ...u.pos } }));
  transport.send({ t: 'deploy', placements });
  const after = msgs[msgs.length - 1]!;
  assert.equal(
    after.deadlineInMs, DEPLOY_MS - 12_000,
    '배치 의도가 마감을 되살렸다 — 통마다 새로 재고 있다',
  );
});

test('정찰은 30초, 제어에는 마감이 없다 (오프라인)', () => {
  const clock = { t: 0 };
  const msgs: ServerMsg[] = [];
  const transport = new LocalTransport(fresh('3v3', 21), null, { now: () => clock.t });
  transport.open((m) => msgs.push(m));
  // 양쪽이 준비를 마쳐 정찰로 넘어가 있다
  const scout = msgs[msgs.length - 1]!;
  assert.equal(scout.state.phase, 'scout');
  assert.equal(scout.deadlineInMs, SCOUT_MS);

  transport.ready();      // 정찰을 지나 첫 제어권까지
  const control = msgs[msgs.length - 1]!;
  assert.equal(control.state.phase, 'control');
  assert.equal(
    control.deadlineInMs, null,
    '혼자 두는 판에 제어 20초가 걸렸다 — 지킬 상대가 없다',
  );
});

test('마감을 제 시계에 얹는 것은 재생기다', () => {
  const clock = { t: 5_000_000 };
  const now = (): number => clock.t;
  const transport = new LocalTransport(fresh('3v3', 31), 'P1', { now });
  const playback = new Playback(transport, { onChange: () => {}, onTick: () => {} }, { now });
  playback.start();
  assert.equal(playback.phase, 'deploying');
  assert.equal(playback.deadlineMs, clock.t + DEPLOY_MS);
  assert.equal(playback.remainingSec, DEPLOY_MS / 1000);
  clock.t += 25_000;
  assert.equal(playback.remainingSec, 5);
});

// ═══════════════════════════════════════════════════════════════
// 재생기 — 상대는 판정 주체가 두고, 연출 중에는 안 받는다
// ═══════════════════════════════════════════════════════════════

/**
 * **묻지도 않고 미는** 판정 주체 — 온라인의 모양이다 ★
 *
 * `LocalTransport`는 `ready()`를 받아야 다음 것을 만든다. 그래서 큐가 늘 비어 있고
 * **`pump()`의 「연출 중에는 안 꺼낸다」 잠금이 한 번도 시험되지 않는다** —
 * 실제로 그 줄을 지우고 돌려 봤더니 회귀가 **전부 통과했다.**
 * 「아직 안 붙은 갈래에 걸린 검사는 도는 적이 없다」(§5-52)가 그대로 재현된 자리다.
 *
 * 진짜 서버는 기다려 주지 않는다 — 한 판 분량이 통째로 밀려들 수 있고, 그때
 * 재생기는 **연출 속도로만** 소화해야 한다. 여기서 그 상태를 만든다.
 * (H2의 `OnlineTransport`가 이 모양이 된다 — 그때 이 이중 구현이 사라진다.)
 */
class ScriptedTransport implements BattleTransport {
  readonly initial: BattleState;
  readonly humanSide: Side | null;
  private readonly script: readonly ServerMsg[];
  private inbox: ((msg: ServerMsg) => void) | null = null;

  // 파라미터 프로퍼티(`constructor(readonly x: T)`)는 **타입 스트리핑이 못 받는다** —
  // 타입만 지워서는 안 되고 코드를 만들어 내야 하는 문법이라서다(데코레이터와 같은 부류).
  constructor(initial: BattleState, humanSide: Side | null, script: readonly ServerMsg[]) {
    this.initial = initial;
    this.humanSide = humanSide;
    this.script = script;
  }

  open(inbox: (msg: ServerMsg) => void): void {
    this.inbox = inbox;
    for (const msg of this.script) this.inbox(msg);   // 한 판이 통째로 밀려든다
  }
  send(): void { /* 서버는 이미 다 보냈다 */ }
  ready(): void { /* 기다려 주지 않는다 */ }
  close(): void { this.inbox = null; }
}

test('한 판이 통째로 밀려들어도 연출 속도로만 소화한다', () => {
  const initial = fresh('3v3', 91);
  const script = collect(fresh('3v3', 91), null);
  assert.ok(script.length > 40, '표본이 너무 짧다');

  let consumed = 0;
  const playback: Playback = new Playback(
    new ScriptedTransport(initial, null, script),
    { onChange: () => { consumed += 1; playback.hold(1_000); }, onTick: () => {} },
  );
  playback.start();

  // **여기가 요점** — 큐에는 한 판이 다 들어와 있지만 꺼낸 것은 한 통뿐이다
  assert.equal(consumed, 1, `연출 중에 ${consumed}통을 한꺼번에 꺼냈다`);
  assert.notEqual(playback.phase, 'finished', '연출을 무시하고 전투를 끝내 버렸다');

  // 연출을 하나씩 넘기면 한 통씩 나온다
  for (let i = 0; i < script.length * 2 && playback.phase !== 'finished'; i++) {
    playback.update(1_100);
  }
  assert.equal(consumed, script.length, '남은 통을 다 꺼내지 않았다');
  assert.equal(playback.phase, 'finished');
  assert.deepEqual(playback.state.log, direct(fresh('3v3', 91)).log, '밀려든 통을 소화한 결과가 다르다');
});

test('상대의 [준비완료]는 판정 주체가 낸다 — 재생기가 상대 대신 두지 않는다', () => {
  const msgs: ServerMsg[] = [];
  const transport = new LocalTransport(fresh('3v3', 17), 'P1', { now: () => 0 });
  transport.open((m) => msgs.push(m));
  const last = msgs[msgs.length - 1]!.state;
  assert.equal(last.ready['P2'], true, '상대가 준비를 안 마쳤다');
  assert.equal(last.ready['P1'], false, '사람 대신 준비를 마쳐 줬다');
  assert.equal(last.phase, 'deploy', '사람이 아직 배치 중인데 넘어갔다');
});

test('연출이 도는 동안에는 시간도 난수도 멈춘다', () => {
  const clock = { t: 0 };
  const now = (): number => clock.t;
  const transport = new LocalTransport(fresh('3v3', 23), null, { now });
  let held = false;
  const playback: Playback = new Playback(transport, {
    // 첫 통부터 아주 긴 연출을 건다 — 그 뒤로는 아무것도 진행되면 안 된다
    onChange: (_s, events) => { if (events.length > 0 && !held) { held = true; playback.hold(60_000); } },
    onTick: () => {},
  }, { now });
  playback.start();
  const frozen = playback.state.time;
  const frozenCursor = playback.state.rngCursor;

  for (let i = 0; i < 50; i++) { clock.t += 500; playback.update(500); }
  assert.ok(playback.busy, '연출이 30초 만에 풀렸다 — 60초를 걸었다');
  assert.equal(playback.state.time, frozen, '연출 중에 절대시간이 흘렀다');
  assert.equal(playback.state.rngCursor, frozenCursor, '연출 중에 난수를 소비했다');

  // 연출이 끝나면 쌓인 것부터 다시 돈다
  for (let i = 0; i < 4_000 && playback.phase !== 'finished'; i++) { clock.t += 500; playback.update(500); }
  assert.equal(playback.phase, 'finished', '연출이 끝났는데 다시 안 돌았다');
});

test('연출이 도는 동안 단계가 미리 넘어가지 않는다 — 화면이 거짓말하지 않게', () => {
  /*
   * 「때리는 연출이 도는 2.6초」 동안 단계가 벌써 `advancing`이면, 화면은
   * 아무것도 안 흐르는데 **「시간이 흐르는 중」이라고 말한다** — 실제로 WT 게이지가
   * 멈춘 채 그 이름을 달고 있었고 `smoke:ui`가 「151.0 → 151.0」으로 잡았다.
   * 브라우저를 띄워야만 보이던 것을 여기로 내린다.
   */
  const clock = { t: 0 };
  const now = (): number => clock.t;
  const transport = new LocalTransport(fresh('3v3', 101), null, { now });
  const phases: string[] = [];
  const playback: Playback = new Playback(transport, {
    onChange: (_s, events) => { if (events.length > 0) playback.hold(2_600); },
    onTick: () => {},
  }, { now });
  playback.start();

  for (let i = 0; i < 3_000 && playback.phase !== 'finished'; i++) {
    // **연출 중에는 단계가 굳어 있어야 한다** — 그 프레임의 단계를 적어 둔다
    if (playback.busy) phases.push(playback.phase);
    else phases.length = 0;
    if (phases.length >= 2) {
      assert.equal(
        phases[phases.length - 1], phases[0],
        '연출이 도는 중에 단계가 바뀌었다 — 화면이 「흐르는 중」이라고 거짓말한다',
      );
    }
    clock.t += 200;
    playback.update(200);
  }
  assert.equal(playback.phase, 'finished');
});

test('연출을 걸어도 판정은 같다 — 재생 속도가 결과를 바꾸지 않는다', () => {
  const truth = direct(fresh('3v3', 55));
  const { playback } = drive(fresh('3v3', 55), null, { holdMs: 400 });
  assert.equal(playback.state.winner, truth.winner);
  assert.equal(playback.state.rngCursor, truth.rngCursor);
  assert.deepEqual(playback.state.log, truth.log);
});

test('화면이 본 이벤트가 곧 로그다 — 빠뜨리거나 두 번 보내지 않는다', () => {
  const { playback, seen } = drive(fresh('5v5', 61), null);
  assert.deepEqual(seen, playback.state.log);
});

// ═══════════════════════════════════════════════════════════════
// 시간 상수의 단일 출처
// ═══════════════════════════════════════════════════════════════

test('전투 단계의 실시간 제한은 GDD §3.9 그대로다 (배치 30초 · 정찰 30초)', () => {
  assert.equal(DEPLOY_MS, 30_000);
  assert.equal(SCOUT_MS, 30_000);
});

test('로그를 떼는 자리와 되붙이는 자리가 서로의 역이다', () => {
  const s = direct(fresh('3v3', 71));
  const wire = toWire(s);
  const back = applyWire({ ...s, log: [] }, { t: 'sync', state: wire, events: s.log, deadlineInMs: null });
  assert.deepEqual(back, s);
});
