/**
 * 관리자의 「멈춘 상태 지금 정리」 회귀 (2026-10-20, `src/admin.ts`의 `applyResolution`).
 *
 * 여기서 고정하는 것.
 *  - **게임에 이미 있는 처리를 그대로 부른다** — AI 대전은 60분 정산과 같은 함수, 도적떼는 항복, 아이템은 `settleCarried`
 *  - **시각은 「지금」까지만 옮긴다** — 이미 시작한 판이 보는 과거 시각에서는 그대로다(연구 · 부상)
 *  - **태학은 `startedAt`을 안 옮기고 `doneAt`만 지금** · **부상은 필드를 안 지운다** · 치료 중이면 방도 함께
 *  - 판 도중 빠진 아이템은 **고른 판의 줄만** — 기본 소모, `refund`면 구매 시각까지 돌아온다
 *  - 정리할 것이 없으면 이유를 말하고 안 바꾼다 · 본문 검사
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Intent, OfficerId, PieceType } from '@samchess/rules';
import {
  AI_ABANDON_MS, BASIC_TUTORIALS, HEAL_MS, INJURY_RECOVER_MS, ROOM_CYCLE_MS, aiAbandonAt, academyTopics, appendAiIntents, applyResolution,
  applyStartResearch, createProfile, forfeitAiBattle, freeRooms, hospitalWards, initialBuildings, injuryHealsAt,
  isInjured, matchAiBattle, newInstance, parseResolution, raidAutoSurrenderAt, researchedUpgrades, setGuards, startAiBattle, startRaid,
  syncAiBattle, syncRaid,
} from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 15, 3, 0, 0);
const MIN = 60_000;
const O = (id: string): OfficerId => id as OfficerId;
const P = (piece: PieceType, officer: string): RosterPick => ({ piece, officer: O(officer) });
const PICKS = [P('King', 'yu-bi'), P('Rock', 'gwan-u'), P('Pawn', 'jang-bi')];

function city(over: Partial<PlayerProfile> = {}): PlayerProfile {
  const base = createProfile('정리성', 7);
  const roster = { ...base.roster };
  for (const id of ['yu-bi', 'gwan-u', 'jang-bi']) roster[O(id)] = newInstance(O(id));
  return withGarrisons({ ...base, roster, grain: 40, grainAt: T0, gold: 100, tutorial: { done: [...BASIC_TUTORIALS] }, buildings: { ...initialBuildings(), barracks: 5, farm: 3, academy: 1, hospital: 1 }, ...over });
}

function fightingAi(): PlayerProfile {
  const m = matchAiBattle(city(), '3v3', PICKS, null, 4242);
  assert.ok(m.ok);
  const s = startAiBattle(m.ok ? m.profile : city(), T0);
  assert.ok(s.ok, s.ok ? '' : s.reason);
  return s.ok ? s.profile : city();
}

describe('AI 대전 — 60분 정산과 같은 함수를 지금 시각으로', () => {
  it('syncAiBattle(시작 + 60분)은 forfeitAiBattle(시작 + 60분)과 같다 — 함수를 뺐을 뿐 값은 그대로', () => {
    const p = fightingAi();
    assert.deepEqual(syncAiBattle(p, T0 + AI_ABANDON_MS), forfeitAiBattle(p, T0 + AI_ABANDON_MS));
    assert.equal(syncAiBattle(p, T0 + AI_ABANDON_MS - 1), p, '60분 전에는 그대로');
  });

  it('정리는 지금 패배로 정산 — 덧붙인 수까지 재생하고 정산 시각은 지금', () => {
    const p = fightingAi();
    const intents: Intent[] = [{ t: 'ready' }];
    const withIntents = appendAiIntents(p, 0, intents);
    assert.ok(withIntents.ok);
    const before = withIntents.ok ? withIntents.profile : p;
    const now = T0 + 5 * MIN;
    const after = applyResolution(before, { kind: 'aiBattle' }, now);
    assert.deepEqual(after, forfeitAiBattle(before, now));
    assert.equal(after.aiBattle?.status, 'abandoned');
    assert.equal(after.aiBattle?.settledAt, now);
    assert.equal(after.matches.length, before.matches.length + 1, '패배 한 판이 전적에 남는다');
    assert.equal(after.matches.at(-1)?.result, 'lose');
  });

  it('싸우는 중이 아니면 거절', () => {
    assert.throws(() => applyResolution(city(), { kind: 'aiBattle' }, T0), /AI 대전이 없다/);
  });
});

describe('도적떼 — 지금 항복', () => {
  const spawned = (): PlayerProfile =>
    setGuards(syncRaid(city(), T0, { spawn: true }), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]);

  it('대기 중 · 전투 중 모두 항복으로 끝나고 약탈된다', () => {
    const pending = spawned();
    assert.equal(pending.raid?.status, 'pending');
    const a = applyResolution(pending, { kind: 'raid' }, T0 + MIN);
    assert.equal(a.raid?.status, 'surrendered');
    assert.equal(a.raid?.settledAt, T0 + MIN);
    assert.equal(a.grain, pending.grain - (a.raid?.loot ?? 0));

    const fighting = startRaid(pending, T0 + MIN, 4242);
    const b = applyResolution(fighting, { kind: 'raid' }, T0 + 2 * MIN);
    assert.equal(b.raid?.status, 'surrendered');
  });

  it('끝난 도적떼는 거절', () => {
    const done = applyResolution(spawned(), { kind: 'raid' }, T0 + MIN);
    assert.throws(() => applyResolution(done, { kind: 'raid' }, T0 + 2 * MIN), /도적떼가 없다/);
  });
});

// 관리자 화면의 정리 경고 「그냥 두면 ○시에 같은 처리가 된다」는 이 두 시각을 그대로 띄운다(`UserDetail.autoResolveAt`, 2026-10-22).
// 화면이 「60분 · 10분」을 다시 적지 않게 옮긴 것이라, 시각이 정산과 **1ms도** 어긋나면 안 된다.
describe('저절로 정산되는 시각 — 정산 함수가 실제로 그 시각에 정산한다', () => {
  it('AI 대전: aiAbandonAt = 시작 + 60분, 그 1ms 전까지는 그대로', () => {
    const p = fightingAi();
    const at = aiAbandonAt(p);
    assert.equal(at, T0 + AI_ABANDON_MS);
    assert.equal(syncAiBattle(p, at! - 1), p);
    assert.equal(syncAiBattle(p, at!).aiBattle?.settledAt, at);
    assert.equal(aiAbandonAt(city()), null, '싸우는 중이 아니면 없다');
  });

  it('도적떼: 대기면 응전 마감, 싸우는 중이면 시작 + 60분 — 둘 다 그 시각에 항복으로', () => {
    const pending = setGuards(syncRaid(city(), T0, { spawn: true }), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]);
    const fighting = startRaid(pending, T0 + MIN, 4242);
    for (const p of [pending, fighting]) {
      const at = raidAutoSurrenderAt(p);
      assert.ok(at !== null && at > T0);
      assert.equal(syncRaid(p, at - 1, { spawn: false }), p);
      const done = syncRaid(p, at, { spawn: false });
      assert.equal(done.raid?.status, 'surrendered');
      assert.equal(done.raid?.settledAt, at);
      assert.equal(raidAutoSurrenderAt(done), null, '끝난 판은 없다');
    }
    assert.notEqual(raidAutoSurrenderAt(pending), raidAutoSurrenderAt(fighting), '대기 · 전투의 마감은 다르다');
  });
});

describe('태학 — doneAt은 지금, startedAt은 안 옮긴다', () => {
  it('진행 중인 연구가 지금 끝난다 — 지금 전에 시작한 판에는 없고, 지금부터 있다', () => {
    const tactic = academyTopics(1)[0]!.id;
    const p = applyStartResearch(city(), tactic, T0);
    assert.ok(p.academy?.research);
    const now = T0 + 10 * MIN;
    const after = applyResolution(p, { kind: 'academy' }, now);
    assert.equal(after.academy?.research, undefined);
    assert.deepEqual(after.academy?.done.at(-1), { level: 1, tactic, doneAt: now });
    assert.ok(after.academy?.notice?.includes(tactic as never), '축하 팝업도 뜬다');
    assert.equal(researchedUpgrades(after, now - 1).has(tactic), false, '지금 전에 시작한 판은 개량 없이 재생된다');
    assert.equal(researchedUpgrades(after, now).has(tactic), true);
  });

  it('연구가 없으면 거절', () => {
    assert.throws(() => applyResolution(city(), { kind: 'academy' }, T0), /연구가 없다/);
  });
});

describe('부상 — 낫는 시각을 지금으로 당긴다(필드는 남긴다)', () => {
  it('자연 회복 중 — 지금 낫고, 지금 전에는 여전히 부상', () => {
    const p = city();
    const injured = { ...p, roster: { ...p.roster, [O('gwan-u')]: { ...p.roster[O('gwan-u')]!, injuredAt: T0 } } };
    const now = T0 + 10 * MIN;
    const after = applyResolution(injured, { kind: 'injury', officer: 'gwan-u' }, now);
    const inst = after.roster[O('gwan-u')]!;
    assert.equal(inst.injuredAt, now - INJURY_RECOVER_MS, '필드는 남고 시각만 옮긴다');
    assert.equal(injuryHealsAt(inst), now);
    assert.equal(isInjured(inst, now), false);
    assert.equal(isInjured(inst, now - 1), true, '지금 전에 시작한 판에서는 부상 그대로');
  });

  it('치료 중 — 방의 해제 시각도 같이 옮겨 짝이 유지된다(쿨타임은 남는다)', () => {
    const p = city();
    const healingAt = T0 + 30_000;
    const healing = {
      ...p,
      roster: { ...p.roster, [O('gwan-u')]: { ...p.roster[O('gwan-u')]!, injuredAt: T0, healingAt } },
      hospitalBusy: [healingAt + ROOM_CYCLE_MS],
    };
    assert.equal(hospitalWards(healing, healingAt + 1)[0]?.state, 'healing');
    const now = healingAt + 20_000;
    const after = applyResolution(healing, { kind: 'injury', officer: 'gwan-u' }, now);
    const inst = after.roster[O('gwan-u')]!;
    assert.equal(injuryHealsAt(inst), now);
    assert.deepEqual(after.hospitalBusy, [now + ROOM_CYCLE_MS - HEAL_MS], '방은 지금부터 쿨타임만 남는다');
    assert.equal(hospitalWards(after, now)[0]?.state, 'cooldown');
    assert.equal(freeRooms(after, now + ROOM_CYCLE_MS - HEAL_MS), freeRooms(after, now) + 1);
  });

  it('부상이 아니면 · 풀에 없으면 거절', () => {
    assert.throws(() => applyResolution(city(), { kind: 'injury', officer: 'gwan-u' }, T0), /부상이 아니다/);
    assert.throws(() => applyResolution(city(), { kind: 'injury', officer: 'jo-jo' }, T0), /풀에 없는/);
  });
});

describe('판 도중 빠진 아이템 — 고른 판의 줄만, 기본 소모, refund면 돌려준다', () => {
  // 도적떼에 든 탕약과 온라인에 든 탕약 — 두 판이 겹쳐 있다
  const inPlay = (): PlayerProfile => city({
    marketOwned: { 'tang-yak': 1 }, marketBoughtAt: { 'tang-yak': [T0 + 5] },
    marketInPlay: [
      { officer: O('gwan-u'), item: 'tang-yak', boughtAt: T0, battle: 'online' },
      { officer: O('jang-bi'), item: 'tang-yak', boughtAt: T0 + 1, battle: 'raid' },
    ],
  });

  it('소모 — 그 판의 기록만 비우고 보유는 그대로', () => {
    const after = applyResolution(inPlay(), { kind: 'inPlay', battle: 'online', refund: false }, T0);
    assert.deepEqual(after.marketInPlay, [{ officer: O('jang-bi'), item: 'tang-yak', boughtAt: T0 + 1, battle: 'raid' }],
      '도적떼의 줄은 그대로 — 그 판은 아직 돌고 있을 수 있다');
    assert.equal(after.marketOwned?.['tang-yak'], 1);
  });

  it('돌려주기 — 그 판의 것만 보유가 늘고 구매 시각도 되돌아온다', () => {
    const after = applyResolution(inPlay(), { kind: 'inPlay', battle: 'online', refund: true }, T0);
    assert.equal(after.marketInPlay?.length, 1);
    assert.equal(after.marketOwned?.['tang-yak'], 2, '도적떼에 든 것까지 돌려주면 복제다');
    assert.deepEqual(after.marketBoughtAt?.['tang-yak'], [T0, T0 + 5]);
  });

  it('마지막 판을 정리하면 키째로 없어진다', () => {
    const one = applyResolution(inPlay(), { kind: 'inPlay', battle: 'online', refund: false }, T0);
    const none = applyResolution(one, { kind: 'inPlay', battle: 'raid', refund: false }, T0);
    assert.equal(none.marketInPlay, undefined);
  });

  it('그 판에 없으면 거절', () => {
    assert.throws(() => applyResolution(city(), { kind: 'inPlay', battle: 'online', refund: false }, T0), /아이템이 없다/);
    assert.throws(() => applyResolution(inPlay(), { kind: 'inPlay', battle: 'ai', refund: false }, T0), /아이템이 없다/);
  });
});

describe('본문 검사', () => {
  it('kind마다 필요한 것을 본다', () => {
    assert.deepEqual(parseResolution({ kind: 'raid' }), { kind: 'raid' });
    assert.deepEqual(parseResolution({ kind: 'injury', officer: 'gwan-u' }), { kind: 'injury', officer: 'gwan-u' });
    assert.equal(parseResolution({ kind: 'injury', officer: 'nobody' }), '모르는 장수다');
    assert.deepEqual(parseResolution({ kind: 'inPlay', battle: 'raid', refund: true }), { kind: 'inPlay', battle: 'raid', refund: true });
    assert.match(String(parseResolution({ kind: 'inPlay', battle: 'raid' })), /refund/);
    assert.match(String(parseResolution({ kind: 'inPlay', refund: true })), /battle/, '판을 안 고르면 거절 — 모든 판을 한꺼번에 비우지 않는다');
    assert.match(String(parseResolution({ kind: 'inPlay', battle: 'forge', refund: true })), /battle/);
    assert.equal(parseResolution({ kind: 'forge' }), '모르는 kind다', '대장간은 정리 대상이 아니다');
    assert.equal(parseResolution(null), '본문이 없다');
  });
});
