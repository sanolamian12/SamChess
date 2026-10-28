/**
 * 공성전 (2026-10-27, `aiBattle.ts`의 `matchSiege` · `siege.ts` · GDD §8.8 단계 2). 시계는 가짜 시계다.
 *
 * 여기서 고정하는 것 다섯.
 *  - **상대는 다른 도시의 수비군 스냅샷**이고, 그 뒤는 AI 대전과 한 길(시작 · 재생 정산 · 60분 방치)이다
 *  - **수비군의 북군 배치가 판에 깔린다** — 첫 판(`aiBattleState`)과 서버 재생이 같은 자리에 둔다
 *  - **이력 · 전적에서 공성전은 「대인전」**(`online`)이고 상대 계정 · 부대 이름이 남는다
 *  - **낮은 도시는 못 친다** — 목록에도 없고 `matchSiege`도 거절한다
 *  - **방어자 정보는 되접기를 지나도 남는다**(안 남으면 평범한 AI 대전으로 정산된다)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Intent, OfficerId, PieceType, RosterEntry } from '@samchess/rules';
import {
  AI_ABANDON_MS, BASIC_TUTORIALS, PRESENCE_INVARIANTS, PRESENCE_ONLINE_MS, PRESENCE_PING_MS, SIEGE_LIST_LIMIT, aiBattleState, aiOpponentOf, createProfile, defaultSquadCells, garrisonOf,
  garrisonSnapshot, inSiegeTab, isPresent, matchSiege, migrateProfile, newInstance, pickSiegeRows, settleAiBattleIntents, startAiBattle,
  syncAiBattle, withDeployment,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick, SiegeListRow, SiegeTarget } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const T0 = Date.UTC(2026, 9, 27, 3, 0, 0);
const O = (id: string): OfficerId => id as OfficerId;
const P = (piece: PieceType, officer: string): RosterPick => ({ piece, officer: O(officer) });
const PICKS = [P('King', 'yu-bi'), P('Rock', 'gwan-u'), P('Pawn', 'jang-bi')];
const SURRENDER: Intent[] = [{ t: 'ready' }, { t: 'surrender' }];

function attacker(level = 2): PlayerProfile {
  const base = createProfile('공격성', 7);
  const roster = { ...base.roster };
  for (const id of ['yu-bi', 'gwan-u', 'jang-bi']) roster[O(id)] = newInstance(O(id));
  return withGarrisons({ ...base, roster, cityLevel: level, grain: 40, grainAt: T0, tutorial: { done: [...BASIC_TUTORIALS] } });
}

/** 지키는 도시 — 3v3 수비군의 북군 배치를 **기본과 다르게**(첫 두 장수의 자리를 맞바꿔) 깔아 둔다 */
function defenderCity(level = 2): PlayerProfile {
  const base = withGarrisons({ ...createProfile('수비성', 21), cityLevel: level, tutorial: { done: [...BASIC_TUTORIALS] } });
  const squad = garrisonOf(base, '3v3')!;
  const cells = defaultSquadCells('3v3', 'P2', squad.picks);
  const swapped = cells.map((c, i) => (i === 0 ? { ...c, x: cells[1]!.x, y: cells[1]!.y } : i === 1 ? { ...c, x: cells[0]!.x, y: cells[0]!.y } : c));
  return { ...base, squads: base.squads.map((s) => (s.id === squad.id ? withDeployment(s, 'P2', swapped) : s)) };
}

function target(d: PlayerProfile = defenderCity()): SiegeTarget {
  const snap = garrisonSnapshot(d, '3v3')!;
  return {
    uid: 'defender-uid', cityName: d.cityName, cityLevel: Math.floor(d.cityLevel), squadName: snap.squadName,
    deploy: snap.deploy, mode: '3v3', power: snap.power, entries: snap.entries,
  };
}

function fighting(t: SiegeTarget = target()): PlayerProfile {
  const m = matchSiege(attacker(), t, PICKS, null, 99);
  assert.ok(m.ok, m.ok ? '' : m.reason);
  const s = startAiBattle(m.ok ? m.profile : attacker(), T0);
  assert.ok(s.ok, s.ok ? '' : s.reason);
  return s.ok ? s.profile : attacker();
}

describe('상대 — 다른 도시의 수비군', () => {
  it('수비군 스냅샷이 그대로 상대가 되고, 화면에는 그 도시의 부대로 뜬다', () => {
    const t = target();
    const p = fighting(t);
    assert.deepEqual(p.aiBattle!.foe, { entries: t.entries, power: t.power });
    assert.equal(p.aiBattle!.defender!.uid, 'defender-uid');
    const opp = aiOpponentOf(p.aiBattle!);
    assert.deepEqual([opp.kind, opp.id, opp.squadName], ['online', 'defender-uid', t.squadName]);
  });

  it('수비군의 북군 배치가 첫 판에 깔린다 — 기본 배치가 아니다', () => {
    const t = target();
    const placed = new Map(t.deploy!.map((d) => [d.unit, d.pos]));
    const plain = target({ ...defenderCity(), squads: defenderCity().squads.map((s) => withDeployment(s, 'P2', null)) });
    assert.equal(plain.deploy, null);
    const r = aiBattleState(fighting(t).aiBattle!);
    const base = aiBattleState(fighting(plain).aiBattle!);
    assert.ok(r.ok && base.ok);
    if (!r.ok || !base.ok) return;
    let moved = 0;
    for (const [unit, pos] of placed) {
      assert.deepEqual(r.state.units[unit]!.pos, pos, `${unit}이 수비군 배치에 없다`);
      if (JSON.stringify(base.state.units[unit]!.pos) !== JSON.stringify(pos)) moved++;
    }
    assert.ok(moved >= 2, '프리셋이 기본 배치와 같으면 이 검사는 아무것도 안 본다');
  });

  it('도시 레벨이 낮은 도시는 못 친다 · 같거나 높으면 된다', () => {
    const low = matchSiege(attacker(3), target(defenderCity(2)), PICKS, null, 1);
    assert.equal(low.ok ? 'ok' : low.code, 'siege.lowerCity');
    assert.ok(matchSiege(attacker(3), target(defenderCity(3)), PICKS, null, 1).ok);
    assert.ok(matchSiege(attacker(3), target(defenderCity(5)), PICKS, null, 1).ok);
  });

  it('인원이 다른 모드의 부대로는 못 친다', () => {
    const five = [...PICKS, P('Knight', 'heon-je'), P('Queen', 'yu-bi')];
    const r = matchSiege(attacker(), target(), five, null, 1);
    assert.equal(r.ok ? 'ok' : r.code, 'ai.badPicks');
  });
});

describe('정산 — AI 대전과 한 길, 이력은 대인전', () => {
  it('재생해 정산하고 상대 계정 · 부대 이름이 이력에 남는다 · 방어 기록에 쓸 판이 돌아온다', () => {
    const t = target();
    const r = settleAiBattleIntents(fighting(t), SURRENDER, T0 + 60_000);
    assert.ok(r.ok, r.ok ? '' : r.reason);
    if (!r.ok) return;
    assert.equal(r.profile.aiBattle, undefined, '한 번만 — 정산하면 지운다');
    const row = r.profile.matches.at(-1)!;
    assert.deepEqual([row.opponent, row.opponentId, row.theirSquad, row.result], ['online', 'defender-uid', t.squadName, 'lose']);
    assert.equal(r.settled.ai.defender!.uid, 'defender-uid');
    assert.deepEqual(r.settled.intents, SURRENDER);
    assert.equal(r.settled.result, 'lose');
  });

  it('60분 방치는 패배 — 방어자 정보는 남은 기록에 그대로', () => {
    const p = syncAiBattle(fighting(), T0 + AI_ABANDON_MS);
    assert.equal(p.aiBattle!.status, 'abandoned');
    assert.equal(p.aiBattle!.defender!.uid, 'defender-uid');
    assert.equal(p.matches.at(-1)!.opponent, 'online');
  });

  it('방어자 정보는 되접기를 지나도 남는다', () => {
    const p = fighting();
    const back = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.deepEqual(back.aiBattle!.defender, p.aiBattle!.defender);
  });
});

describe('도시 목록 — 추천은 같은 레벨, 상위 도전은 높은 레벨', () => {
  const row = (cityName: string, cityLevel: number, power: number, online = false): SiegeListRow => ({
    defenderId: cityName, cityName, cityLevel, mode: '3v3', squadName: '수비', power, entries: [] as RosterEntry[], score: 0, online, busy: false,
  });
  const rows = [row('가', 3, 500), row('나', 3, 900), row('다', 2, 2000), row('라', 5, 100), row('마', 4, 300), row('바', 4, 800)];

  it('추천 — 같은 레벨만, 전투력 높은 순', () => {
    assert.deepEqual(pickSiegeRows(rows, 'recommended', 3).map((r) => r.cityName), ['나', '가']);
  });

  it('상위 도전 — 높은 레벨만, 가까운 레벨부터 · 그 안에서 전투력 높은 순 · 낮은 도시는 어디에도 없다', () => {
    assert.deepEqual(pickSiegeRows(rows, 'upper', 3).map((r) => r.cityName), ['바', '마', '라']);
    assert.ok(!inSiegeTab('recommended', 3, 2) && !inSiegeTab('upper', 3, 2));
  });

  it('도시 레벨은 내림으로 본다 · 넘치면 자른다', () => {
    assert.ok(inSiegeTab('recommended', 3.4, 3));
    const many = Array.from({ length: SIEGE_LIST_LIMIT + 5 }, (_, i) => row(`도시${i}`, 3, i));
    assert.equal(pickSiegeRows(many, 'recommended', 3).length, SIEGE_LIST_LIMIT);
  });
});

describe('접속 표시 — 같은 레벨 안에서 접속 중인 도시가 위 (단계 3)', () => {
  const row = (cityName: string, cityLevel: number, power: number, online = false): SiegeListRow => ({
    defenderId: cityName, cityName, cityLevel, mode: '3v3', squadName: '수비', power, entries: [] as RosterEntry[], score: 0, online, busy: false,
  });

  it('추천 — 접속 중인 도시가 전투력이 낮아도 먼저, 그 안에서는 전투력 순', () => {
    const rows = [row('가', 3, 900), row('나', 3, 100, true), row('다', 3, 500), row('라', 3, 300, true)];
    assert.deepEqual(pickSiegeRows(rows, 'recommended', 3).map((r) => r.cityName), ['라', '나', '가', '다']);
  });

  it('상위 도전 — 레벨 묶음이 먼저다. 접속 중이라도 더 높은 레벨이 가까운 레벨을 앞지르지 않는다', () => {
    const rows = [row('가', 4, 900), row('나', 4, 100, true), row('다', 5, 999, true), row('라', 5, 50)];
    assert.deepEqual(pickSiegeRows(rows, 'upper', 3).map((r) => r.cityName), ['나', '가', '다', '라']);
  });

  it('마지막 핑이 판정 시간 안이면 접속 중 — 경계에서 끝나고, 핑이 없으면 미접속', () => {
    assert.ok(isPresent(T0, T0));
    assert.ok(isPresent(T0, T0 + PRESENCE_ONLINE_MS - 1));
    assert.ok(!isPresent(T0, T0 + PRESENCE_ONLINE_MS));
    assert.ok(!isPresent(null, T0));
  });

  it('핑 간격과 판정 시간의 관계', () => {
    assert.ok(PRESENCE_PING_MS < PRESENCE_ONLINE_MS);
    for (const [name, holds] of PRESENCE_INVARIANTS) assert.ok(holds, name);
  });
});
