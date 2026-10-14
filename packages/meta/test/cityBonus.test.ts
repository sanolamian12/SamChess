/**
 * 컬렉션 도시 효과 (2026-10-15, `Design/컬렉션_기획.md` §3).
 *
 * 여기서 고정하는 것.
 *  - 키 일곱이 각자 제 계산 함수에 들어간다 — 완성 전에는 아무 일도 없다
 *  - **판정 시각은 「시작한 때」** — 제조 · 연구 · 치료 · 도적떼는 시작 뒤에 완성한 컬렉션이 끝 시각을 안 바꾼다
 *  - **군량 요율은 완성 순간에 먼저 정산한다** — 지난 구간에 새 요율이 소급되지 않는다
 *  - 화면 글(「10% → 9%」)과 계산이 같은 값(`RAID.lootPctPerBandit`)을 읽는다
 *  - `healCut`이 되접기(`migrateProfile`)를 지나도 남는다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COLLECTIONS, EQUIPMENT, RAID } from '@samchess/data';
import type { CollectionCityKey, CollectionData } from '@samchess/data';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  HEAL_MS, MS_PER_HOUR, ROOM_CYCLE_MS, applyHeal, applyInjuries, applyRegisterSlot, cityBonus, cityBonusSources,
  collectResearch, createProfile, craftDurationMs, forgeOrderRemainingMs, grainCap, grainPerHour, grainStepMs,
  healMsFor, hospitalWards, injuryHealsAt, isInjured, migrateProfile, raidDeadline, raidLoot, raidLootPct,
  researchRemainingMs, ACADEMY_RESEARCH_MS, RAID_RESPONSE_MS, syncCity, syncGrain, syncRaid,
} from '../src/index.ts';
import type { PlayerProfile, RaidState } from '../src/index.ts';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const cityOf = (key: CollectionCityKey): CollectionData[] =>
  COLLECTIONS.filter((c) => c.effect.kind === 'city' && c.effect.key === key);
const valueOf = (c: CollectionData): number => (c.effect.kind === 'city' ? c.effect.value : 0);
const one = (key: CollectionCityKey): CollectionData => cityOf(key)[0]!;

function base(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return { ...createProfile('도시효과성', 7), grainAt: T0, ...over };
}
/** 컬렉션을 `at`에 완성한 것으로 심는다 — 칸까지 채울 필요는 없다(효과는 `completedAt`에서 낸다) */
function done(p: PlayerProfile, cs: readonly CollectionData[], at = T0): PlayerProfile {
  const completedAt = { ...p.collection?.completedAt };
  for (const c of cs) completedAt[c.id] = at;
  return { ...p, collection: { slots: p.collection?.slots ?? {}, completedAt } };
}

describe('데이터 — 도시 효과 일곱 키', () => {
  it('키마다 한 개 이상 있고, 117개를 다 모으면 합이 기획 §3.2의 천장이다', () => {
    const sum = (k: CollectionCityKey) => cityOf(k).reduce((s, c) => s + valueOf(c), 0);
    assert.deepEqual(
      { grainRate: sum('grainRate'), grainCap: sum('grainCap'), forge: sum('forge'), heal: sum('heal'),
        research: sum('research'), raidLoot: sum('raidLoot'), raidResp: sum('raidResp') },
      { grainRate: 15, grainCap: 6, forge: 10, heal: 50, research: 5, raidLoot: 3, raidResp: 1 },
    );
  });

  it('판정은 completedAt 기준 — 같은 시각은 포함, 1ms 앞은 제외 · 완성 전에는 0', () => {
    const c = one('grainCap');
    const p = done(base(), [c], T0);
    assert.equal(cityBonus(base(), 'grainCap'), 0);
    assert.equal(cityBonus(p, 'grainCap', T0), valueOf(c));
    assert.equal(cityBonus(p, 'grainCap', T0 - 1), 0);
    assert.deepEqual(cityBonusSources(p, 'grainCap').map((x) => x.id), [c.id]);
    assert.equal(cityBonus(p, 'forge'), 0, '다른 키에는 안 들어간다');
  });
});

describe('군량 — 상한 · 충전 요율', () => {
  it('최대 군량 += 합', () => {
    const p = done(base(), cityOf('grainCap'));
    assert.equal(grainCap(p), grainCap(base()) + 6);
  });

  it('충전 요율은 농지 값 × (100 + n)% · 한 톨 시간은 정수 ms', () => {
    const farm = base({ grain: 0, buildings: { ...base().buildings, farm: 1, barracks: 5 } });
    const p = done(farm, cityOf('grainRate'));          // +15%
    assert.equal(grainPerHour(p), 2.3);
    assert.equal(grainStepMs(p), Math.round(MS_PER_HOUR / 2.3));
    assert.ok(Number.isInteger(grainStepMs(done(farm, [one('grainRate')]))), '2.1이어도 정수');
    const after = syncGrain(p, T0 + 10 * MS_PER_HOUR);
    assert.equal(after.grain, 23);
    assert.ok(Number.isInteger(after.grainAt), '정산 시각이 소수가 되지 않는다');
  });

  it('★ 완성 순간 먼저 정산한다 — 완성 전 구간은 옛 요율, 뒤는 새 요율', () => {
    // 둔전제(카드만 있는 칸)를 마지막 한 칸 남겨 두고, 그 칸을 1시간 50분 뒤에 채운다
    const c = one('grainRate');
    assert.ok(c.slots.every((s) => s.kind === 'card'), `${c.title}는 카드 칸만`);
    const last = c.slots.length - 1;
    const card = c.slots[last]!.id as OfficerId;
    let p = base({ grain: 0, buildings: { ...base().buildings, farm: 1, barracks: 5 } });   // 시간당 2
    // 풀에 없는 장수면 본체 한 장이 보관함이라 두 장을 심는다(여분 1)
    p = { ...p, cards: { ...p.cards, [card]: 2 },
      collection: { slots: { [c.id]: c.slots.slice(0, last).map((_, i) => i) }, completedAt: {} } };
    // 화면이 정산을 안 부른 채 1시간 50분이 흘렀다
    const T1 = T0 + 110 * MIN;
    const completed = applyRegisterSlot(p, c.id, last, T1);
    assert.equal(completed.collection!.completedAt[c.id], T1);
    // 옛 요율(시간당 2 = 30분에 하나)로 110분 → 3톨, 자투리 20분
    assert.equal(completed.grain, 3);
    assert.equal(completed.grainAt, T0 + 90 * MIN);
    // 정산을 늦게 불러도 같다 — 완성 뒤는 시간당 2.1
    const late = syncCity(completed, T0 + 10 * MS_PER_HOUR);
    const step = Math.round(MS_PER_HOUR / 2.1);
    assert.equal(late.grain, 3 + Math.floor((T0 + 10 * MS_PER_HOUR - (T0 + 90 * MIN)) / step));
  });
});

describe('대장간 · 태학 — 시작한 때 판정', () => {
  const LV4 = EQUIPMENT.find((e) => e.unlockLevel === 4)!;

  it('제조 −10% — 주문 뒤에 완성한 컬렉션은 그 주문을 안 줄인다', () => {
    const order = { equipmentId: LV4.id, startedAt: T0 };
    const full = craftDurationMs(4);
    assert.equal(forgeOrderRemainingMs(base({ forgeOrder: order }), T0), full);
    const before = done(base({ forgeOrder: order }), [one('forge')], T0 - 1);
    assert.equal(forgeOrderRemainingMs(before, T0), full * 0.9);
    const after = done(base({ forgeOrder: order }), [one('forge')], T0 + 1);
    assert.equal(forgeOrderRemainingMs(after, T0 + 1), full - 1, '주문 뒤 완성은 안 걸린다');
  });

  it('연구 −5% — 남은 시간 · 거두기 · doneAt이 같은 끝 시각을 본다', () => {
    const tactic = 'x' as TacticId;
    const p = done(base({ academy: { done: [], research: { level: 1, tactic, startedAt: T0 } } }), [one('research')], T0);
    const ms = ACADEMY_RESEARCH_MS * 0.95;
    assert.equal(researchRemainingMs(p, T0), ms);
    assert.equal(collectResearch(p, T0 + ms - 1), p, '아직');
    const got = collectResearch(p, T0 + ms);
    assert.deepEqual(got.academy!.done, [{ level: 1, tactic, doneAt: T0 + ms }]);
    const later = done(base({ academy: { done: [], research: { level: 1, tactic, startedAt: T0 } } }), [one('research')], T0 + 1);
    assert.equal(researchRemainingMs(later, T0), ACADEMY_RESEARCH_MS, '시작 뒤 완성은 안 걸린다');
  });
});

describe('병원 — 치료 시간 −50%', () => {
  function injured(p: PlayerProfile): [PlayerProfile, OfficerId] {
    const who = Object.keys(p.roster)[0] as OfficerId;
    const q = { ...p, buildings: { ...p.buildings, hospital: 1 } };
    return [applyInjuries(q, [who], T0), who];
  }

  it('치료 30초 · 쿨타임 5분은 그대로 · 방 · 줄 · 판정이 같은 끝을 본다', () => {
    const cut = valueOf(one('heal'));
    const [p0, who] = injured(done(base(), [one('heal')], T0));
    const heal = HEAL_MS * (100 - cut) / 100;
    assert.equal(healMsFor(p0, T0), heal);
    const p = applyHeal(p0, who, T0);
    assert.equal(p.roster[who]!.healCut, cut);
    assert.equal(injuryHealsAt(p.roster[who]!), T0 + heal);
    assert.equal(isInjured(p.roster[who]!, T0 + heal - 1), true);
    assert.equal(isInjured(p.roster[who]!, T0 + heal), false);
    const cycle = heal + ROOM_CYCLE_MS - HEAL_MS;
    assert.deepEqual(p.hospitalBusy, [T0 + cycle]);
    assert.deepEqual(hospitalWards(p, T0), [{ state: 'healing', officer: who, healedAt: T0 + heal, freeAt: T0 + cycle }]);
  });

  it('치료 중에 완성해도 그 치료는 1분 그대로 · 컬렉션이 없으면 healCut을 안 적는다', () => {
    const [p0, who] = injured(base());
    const p = done(applyHeal(p0, who, T0), [one('heal')], T0 + 1);
    assert.equal(p.roster[who]!.healCut, undefined);
    assert.equal(injuryHealsAt(p.roster[who]!), T0 + HEAL_MS);
  });

  it('healCut은 되접기를 지나도 남는다 — 낫고 나면 정리에서 함께 지워진다', () => {
    const [p0, who] = injured(done(base(), [one('heal')], T0));
    const p = applyHeal(p0, who, T0);
    const back = migrateProfile(JSON.parse(JSON.stringify(p)));
    assert.equal(back!.roster[who]!.healCut, valueOf(one('heal')));
    const cleaned = syncCity(p, T0 + HEAL_MS);
    assert.equal(cleaned.roster[who]!.healCut, undefined);
  });
});

describe('도적떼 — 출몰한 때 판정', () => {
  const raid: RaidState = { day: '2026-10-15', bandits: 5, spawnedAt: T0, grainAtSpawn: 100, status: 'pending' };

  it('응전 +1분 — 출몰 뒤에 완성하면 그 판의 마감은 그대로', () => {
    assert.equal(raidDeadline(base({ raid }), raid), T0 + RAID_RESPONSE_MS);
    assert.equal(raidDeadline(done(base({ raid }), cityOf('raidResp'), T0), raid), T0 + RAID_RESPONSE_MS + MIN);
    assert.equal(raidDeadline(done(base({ raid }), cityOf('raidResp'), T0 + 1), raid), T0 + RAID_RESPONSE_MS);
  });

  it('약탈률 = RAID.lootPctPerBandit − 합 — 화면 글과 같은 값에서 나온다', () => {
    const p = done(base({ raid }), cityOf('raidLoot'));
    assert.equal(raidLootPct(base({ raid }), raid), RAID.lootPctPerBandit);
    assert.equal(raidLootPct(p, raid), RAID.lootPctPerBandit - 3);
    assert.equal(raidLoot(p, raid, 1000, 5), Math.floor(100 * 5 * (RAID.lootPctPerBandit - 3) / 100));
  });

  it('자동 항복도 같은 마감 · 같은 약탈률로 정산된다', () => {
    const p = done(base({ raid, grain: 100 }), [...cityOf('raidResp'), ...cityOf('raidLoot')]);
    assert.equal(syncRaid(p, T0 + RAID_RESPONSE_MS, { spawn: false }).raid!.status, 'pending', '1분 더 기다린다');
    const s = syncRaid(p, T0 + RAID_RESPONSE_MS + MIN, { spawn: false });
    assert.equal(s.raid!.settledAt, T0 + RAID_RESPONSE_MS + MIN);
    assert.equal(s.raid!.loot, Math.floor(100 * 5 * (RAID.lootPctPerBandit - 3) / 100));
  });
});
