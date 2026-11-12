/**
 * 260명 달성 — 판정 · 기록 · 서버 소유 · 되접기 · 내관 안내 (`milestone.ts`, 2026-11-12)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OFFICERS } from '@samchess/data';
import {
  FAN_OFFICER_SEATS, FOUNDING_OFFICERS, SERVER_OWNED_FIELDS, allOfficersMilestone, createProfile, fanOfficerEligible,
  guardServerOwned, markGuideSeen, migrateProfile, ownsAllOfficers, pendingGuide, poolCap, recordAllOfficers,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

// 260명에는 헌제가 든다 — 황제 안내는 먼저 본 것으로 둔다
const fresh = (): PlayerProfile => markGuideSeen(markGuideSeen(createProfile('천하성', 7), 'main.intro'), 'emperor');

/** 풀에 없는 장수를 전부 카드 한 장씩(보관함)으로 채운다 — 보유 = 풀 + 보관함 */
const ownAll = (p: PlayerProfile): PlayerProfile => {
  const cards = { ...p.cards };
  for (const id of FOUNDING_OFFICERS) if (!p.roster[id]) cards[id] = Math.max(1, cards[id] ?? 0);
  return { ...p, cards };
};
const main = (p: PlayerProfile) => pendingGuide(p, 'main', { view: 'core', extended: false });

describe('판정', () => {
  it('기준은 장수 260명이다 — 팬 장수는 데이터에 안 들어오고 헌제를 바꾼다', () => {
    assert.equal(FOUNDING_OFFICERS.length, 260);
    assert.equal(FOUNDING_OFFICERS.length, OFFICERS.length);
  });

  it('풀 + 보관함으로 260명을 모두 가져야 참 — 한 명이 빠지면 거짓', () => {
    const all = ownAll(fresh());
    assert.equal(ownsAllOfficers(fresh()), false);
    assert.equal(ownsAllOfficers(all), true);
    const missing = FOUNDING_OFFICERS.find((id) => !all.roster[id])!;
    const { [missing]: _gone, ...cards } = all.cards;
    assert.equal(ownsAllOfficers({ ...all, cards }), false);
  });
});

describe('기록 · 보상', () => {
  it('순번을 적고, 한 번 적은 기록은 덮지 않는다 — 보유 상한은 그대로다', () => {
    const p = fresh();
    const a = recordAllOfficers(p, 1000, 3);
    assert.equal(poolCap(a), poolCap(p));
    assert.deepEqual(allOfficersMilestone(a), { at: 1000, seat: 3 });
    assert.equal(recordAllOfficers(a, 2000, 9), a);
  });

  it('앞선 100명까지만 신청 자격', () => {
    assert.equal(fanOfficerEligible(recordAllOfficers(fresh(), 1, FAN_OFFICER_SEATS)), true);
    assert.equal(fanOfficerEligible(recordAllOfficers(fresh(), 1, FAN_OFFICER_SEATS + 1)), false);
    assert.equal(fanOfficerEligible(fresh()), false);
  });

  it('카드를 정리해 260명이 깨져도 기록은 남는다', () => {
    const done = recordAllOfficers(ownAll(fresh()), 1, 1);
    const broken = { ...done, cards: {} as PlayerProfile['cards'] };
    assert.equal(ownsAllOfficers(broken), false);
    assert.equal(fanOfficerEligible(broken), true);
  });
});

describe('서버 소유 · 되접기', () => {
  it('클라이언트가 올린 기록은 버려진다', () => {
    assert.ok((SERVER_OWNED_FIELDS as readonly string[]).includes('milestones'));
    const forged = recordAllOfficers(fresh(), 1, 1);
    assert.equal(guardServerOwned(forged, fresh()).milestones, undefined);
  });

  it('JSON 왕복 · `migrateProfile`을 지나도 남는다', () => {
    const p = recordAllOfficers(fresh(), 12345, 7);
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(p)))!.milestones, { allOfficers: { at: 12345, seat: 7 } });
  });

  it('모르는 꼴은 버린다', () => {
    const bad = { ...fresh(), milestones: { allOfficers: { at: 'x', seat: 1 } } };
    assert.equal(migrateProfile(JSON.parse(JSON.stringify(bad)))!.milestones, undefined);
  });
});

describe('내관 안내', () => {
  it('260명을 가졌어도 서버가 순번을 적기 전에는 안 나온다', () => {
    assert.equal(main(ownAll(fresh())), null);
  });

  it('100번째까지는 신청 안내, 101번째부터는 축하만 — 둘 중 하나만 한 번', () => {
    const early = recordAllOfficers(fresh(), 1, FAN_OFFICER_SEATS);
    const late = recordAllOfficers(fresh(), 1, FAN_OFFICER_SEATS + 1);
    assert.equal(main(early), 'roster.all');
    assert.equal(main(late), 'roster.late');
    assert.equal(main(markGuideSeen(early, 'roster.all')), null);
  });

});
