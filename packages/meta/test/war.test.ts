/**
 * 선전포고 (2026-10-28, `war.ts` · GDD §8.8 단계 4). 시계는 가짜 시계다.
 *
 * 여기서 고정하는 것.
 *  - **만료는 읽을 때 난다** — 걸음마다 제 시각에서 제 한도를 잰다(전달은 접속 판정 · 응답은 화면에 뜬 순간부터)
 *  - **걸 수 있는가의 순서** — 낮은 도시 → 미접속 → 전투 중 → 내가 건 것 → 상대가 받은 것 → 쿨다운 → 출전 조건
 *  - **보여 주는 부대와 싸우는 부대가 같다** — 계정의 부대 id에서 내고, 다른 모드 · 성립 안 하는 부대는 `null`
 *  - 값들의 관계(`WAR_INVARIANTS`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BASIC_TUTORIALS, WAR_ACCEPT_MS, WAR_COOLDOWN_MS, WAR_DELIVER_MS, WAR_INVARIANTS, WAR_JOIN_MS, WAR_REPLY_MS,
  createProfile, declareGate, garrisonOf, isWarOpen, viewWar, warEndedAt, warEnlist, warReadyGate, warRemainingMs,
  warSquadView, warStatusAt,
} from '../src/index.ts';
import type { DeclareFacts, PlayerProfile, WarRecord } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const T0 = Date.UTC(2026, 9, 28, 3, 0, 0);

function city(level = 2, grain = 40): PlayerProfile {
  return withGarrisons({ ...createProfile('야전성', 9), cityLevel: level, grain, grainAt: T0, tutorial: { done: [...BASIC_TUTORIALS] } });
}

function record(over: Partial<WarRecord> = {}): WarRecord {
  const sq = { squadId: 's1', squadName: '수비3', power: 500, entries: [] };
  return {
    id: 'w1', mode: '3v3',
    attacker: { uid: 'A', cityName: '가', cityLevel: 2 }, defender: { uid: 'D', cityName: '나', cityLevel: 2 },
    attackerSquad: sq, defenderSquad: null, status: 'sent',
    createdAt: T0, deliveredAt: null, repliedAt: null, acceptedAt: null, endedAt: null, ...over,
  };
}

describe('걸음과 만료', () => {
  it('전달은 접속 판정 안에서만 기다린다', () => {
    const w = record();
    assert.equal(warStatusAt(w, T0 + WAR_DELIVER_MS - 1), 'sent');
    assert.equal(warStatusAt(w, T0 + WAR_DELIVER_MS), 'expired');
    assert.equal(warEndedAt(w, T0 + WAR_DELIVER_MS + 9_000), T0 + WAR_DELIVER_MS);
  });

  it('응답 30초는 화면에 뜬 순간부터 센다 — 건 시각이 아니다', () => {
    const shown = T0 + 25_000;
    const w = record({ status: 'delivered', deliveredAt: shown });
    assert.equal(warStatusAt(w, T0 + WAR_REPLY_MS + 1_000), 'delivered', '건 뒤 31초여도 뜬 뒤로는 6초다');
    assert.equal(warRemainingMs(w, shown + 10_000), WAR_REPLY_MS - 10_000);
    assert.equal(warStatusAt(w, shown + WAR_REPLY_MS), 'expired');
  });

  it('수락 · 입장도 각자 제 시각에서 잰다', () => {
    const r = record({ status: 'replied', deliveredAt: T0, repliedAt: T0 + 10_000 });
    assert.equal(warStatusAt(r, T0 + 10_000 + WAR_ACCEPT_MS - 1), 'replied');
    assert.equal(warStatusAt(r, T0 + 10_000 + WAR_ACCEPT_MS), 'expired');
    const a = record({ status: 'accepted', acceptedAt: T0 + 20_000 });
    assert.equal(warStatusAt(a, T0 + 20_000 + WAR_JOIN_MS), 'expired');
  });

  it('끝난 걸음은 시간이 지나도 그대로 · 열린 걸음은 넷', () => {
    for (const s of ['started', 'declined', 'cancelled'] as const) {
      assert.equal(warStatusAt(record({ status: s, endedAt: T0 }), T0 + 10 * WAR_COOLDOWN_MS), s);
      assert.equal(warRemainingMs(record({ status: s, endedAt: T0 }), T0), null);
    }
    assert.deepEqual(['sent', 'delivered', 'replied', 'accepted', 'started', 'declined', 'cancelled', 'expired'].filter((s) => isWarOpen(s as never)),
      ['sent', 'delivered', 'replied', 'accepted']);
  });

  it('보는 사람에 따라 역할만 다르다', () => {
    const w = record({ status: 'delivered', deliveredAt: T0 });
    assert.equal(viewWar(w, 'A', T0).role, 'attacker');
    assert.equal(viewWar(w, 'D', T0).role, 'defender');
    assert.equal(viewWar(w, 'D', T0 + WAR_REPLY_MS).status, 'expired');
  });

  it('값들의 관계', () => {
    for (const [what, ok] of WAR_INVARIANTS) assert.ok(ok, what);
  });
});

describe('걸 수 있는가', () => {
  const facts = (over: Partial<DeclareFacts> = {}): DeclareFacts => ({
    attacker: city(), defenderCityLevel: 2, mode: '3v3', defenderOnline: true, defenderBusy: false,
    attackerOpen: false, defenderOpen: false, lastRefusedAt: null, nowMs: T0, ...over,
  });
  const code = (f: DeclareFacts): string | undefined => { const r = declareGate(f); return r.ok ? undefined : r.code; };

  it('다 갖추면 건다', () => assert.equal(declareGate(facts()).ok, true));

  it('막는 것마다 제 코드 — 앞의 것이 먼저다', () => {
    assert.equal(code(facts({ defenderCityLevel: 1, defenderOnline: false })), 'siege.lowerCity');
    assert.equal(code(facts({ defenderOnline: false, defenderBusy: true })), 'war.offline');
    assert.equal(code(facts({ defenderBusy: true, attackerOpen: true })), 'war.busy');
    assert.equal(code(facts({ attackerOpen: true, defenderOpen: true })), 'war.pending');
    assert.equal(code(facts({ defenderOpen: true })), 'war.engaged');
    assert.equal(code(facts({ attacker: city(2, 1) })), 'war.noGrain');
  });

  it('같은 상대에게는 5분 쿨다운 — 남은 초를 싣는다', () => {
    const r = declareGate(facts({ lastRefusedAt: T0 - 60_000 }));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'war.cooldown');
    assert.equal(!r.ok && r.params?.['sec'], 240);
    assert.equal(declareGate(facts({ lastRefusedAt: T0 - WAR_COOLDOWN_MS })).ok, true);
  });

  it('튜토리얼을 안 끝냈으면 출전 조건의 코드', () => {
    const p = { ...city(), tutorial: { done: [] } };
    assert.equal(code(facts({ attacker: p })), 'tutorial.required');
    assert.equal(warReadyGate(p, '3v3').ok, false);
  });
});

describe('부대', () => {
  it('보여 주는 부대와 판에 서는 명단이 같은 부대에서 나온다', () => {
    const p = city();
    const squad = garrisonOf(p, '3v3')!;
    const view = warSquadView(p, squad.id, '3v3')!;
    assert.equal(view.squadName, squad.name);
    assert.equal(view.entries.length, 3);
    const enlist = warEnlist(p, squad.id, '3v3', 'P2', T0)!;
    assert.deepEqual(enlist.entries.map((e) => e.officer), view.entries.map((e) => e.officer));
    assert.equal(enlist.power, view.power);
  });

  it('다른 모드 · 없는 부대는 null', () => {
    const p = city();
    const five = garrisonOf(p, '5v5')!;
    assert.equal(warSquadView(p, five.id, '3v3'), null);
    assert.equal(warEnlist(p, 'nope', '3v3', 'P1', T0), null);
  });
});
