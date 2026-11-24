/**
 * 잉여 카드 (2026-11-24 기획자) — 들어오는 길 셋(Lv9 장수의 카드 · 레벨업의 남은 몫 · 되접기)과 등급 확정 모집.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROWTH, OFFICERS, officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  addCard, applyLevelUp, canExchangeSurplus, cardsToLevelUp, createProfile, exchangeSurplus, foldSurplus,
  cardCandidates, claimMail, grantRewards, guardServerOwned, isSurplusOfficer, mailClaimed, ownedOfficers,
  poolSeatsFree, poolUsed, tacticChoices, migrateProfile, newInstance, surplusCost, surplusOf, surplusTargets,
} from '../src/index.ts';
import type { Mail, MetaResult, PlayerProfile } from '../src/index.ts';
const codeOf = (r: MetaResult): string | undefined => (r.ok ? undefined : r.code);

const gradeOf = (id: OfficerId) => officerById.get(id)!.grade;
const EMPEROR = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;

/** 장수를 Lv`level`로 풀에 앉힌다 — 성장 스택은 레벨에 맞게 */
function seat(p: PlayerProfile, id: OfficerId, level: number): PlayerProfile {
  const inst = newInstance(id);
  for (let lv = 2; lv <= level; lv++) inst.growth.push({ stat: 'hp', tactics: tacticChoices(lv).support });
  inst.level = level;
  return { ...p, roster: { ...p.roster, [id]: inst } };
}

const base = (): PlayerProfile => ({ ...createProfile('잉여성', 7), cityLevel: 9 });
const starterOf = (p: PlayerProfile, grade: string): OfficerId =>
  (Object.keys(p.roster) as OfficerId[]).find((id) => gradeOf(id) === grade)!;

describe('잉여 카드가 들어오는 길', () => {
  it('Lv9 장수에게 들어온 카드는 잉여 카드가 된다 — 도시 상한에 막힌 장수는 아니다', () => {
    let p = base();
    const a = starterOf(p, 'A');
    const b = starterOf(p, 'B');
    p = seat(p, a, GROWTH.maxLevel);
    p = { ...p, cityLevel: 2 };
    p = seat(p, b, 2);   // 도시 Lv2라 더 못 오르지만 잉여가 아니다
    assert.equal(isSurplusOfficer(p, a), true);
    assert.equal(isSurplusOfficer(p, b), false);
    p = addCard(addCard(p, a, 3), b, 2);
    assert.equal(surplusOf(p), 3);
    assert.equal(p.cards[a], undefined);
    assert.equal(p.cards[b], 2);
  });

  it('레벨업으로 Lv9가 되면 남은 카드가 잉여 카드로 옮겨진다', () => {
    let p = base();
    const s = starterOf(p, 'S');
    p = seat(p, s, GROWTH.maxLevel - 1);
    const need = cardsToLevelUp(GROWTH.maxLevel - 1)!;
    p = { ...p, cards: { ...p.cards, [s]: need + 4 } };
    p = applyLevelUp(p, s, 'hp', 'support');
    assert.equal(p.roster[s]!.level, GROWTH.maxLevel);
    assert.equal(p.cards[s], undefined);
    assert.equal(surplusOf(p), 4);
  });

  it('되접기는 Lv9 장수의 옛 카드를 옮기고, 두 번 지나도 그대로다(멱등) — 잉여 카드는 JSON 왕복에 남는다', () => {
    let p = base();
    const a = starterOf(p, 'A');
    p = seat(p, a, GROWTH.maxLevel);
    p = { ...p, cards: { ...p.cards, [a]: 7 }, surplusCards: 2 };
    const once = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.equal(surplusOf(once), 9);
    assert.equal(once.cards[a], undefined);
    const twice = migrateProfile(JSON.parse(JSON.stringify(once)))!;
    assert.equal(surplusOf(twice), 9);
    assert.equal(foldSurplus(twice), twice, '옮길 것이 없으면 같은 객체');
  });

  it('잉여 카드는 서버 소유다 — PUT이 올린 값을 버린다', () => {
    const server = { ...base(), surplusCards: 3 };
    const incoming = { ...server, surplusCards: 999 };
    assert.equal(guardServerOwned(incoming, server).surplusCards, 3);
  });
});

describe('잉여 카드로 모집', () => {
  it('값은 A 10 · S 20 · E 30장이다 (기획자 지정)', () => {
    assert.equal(surplusCost('A'), 10);
    assert.equal(surplusCost('S'), 20);
    assert.equal(surplusCost('E'), 30);
  });

  it('보유한 그 등급 장수 중 하나의 카드 1장 — 잉여 카드가 쌓이는 장수(Lv9)는 받지 않는다', () => {
    let p: PlayerProfile = { ...base(), surplusCards: 25 };
    const a = starterOf(p, 'A');
    const other = OFFICERS.find((o) => o.grade === 'A' && o.id !== a)!.id as OfficerId;
    p = addCard(p, other);   // 둘째 A급
    p = seat(p, a, GROWTH.maxLevel);
    assert.deepEqual(surplusTargets(p, 'A'), [other]);
    const r = exchangeSurplus(p, 'A', 12345);
    assert.equal(r.officer, other);
    assert.equal(surplusOf(r.profile), 15);
    assert.equal(r.profile.cards[other], (p.cards[other] ?? 0) + 1);
  });

  it('받을 장수가 없거나 잉여 카드가 모자라면 막는다', () => {
    let p: PlayerProfile = { ...base(), surplusCards: 5 };
    assert.equal(codeOf(canExchangeSurplus(p, 'A')), 'market.surplus.notEnough');
    p = { ...p, surplusCards: 100 };
    p = seat(p, starterOf(p, 'S'), GROWTH.maxLevel);   // S급이 하나뿐인데 Lv9
    assert.equal(codeOf(canExchangeSurplus(p, 'S')), 'market.surplus.noTarget');
    assert.throws(() => exchangeSurplus(p, 'S', 1));
  });

  it('E급은 헌제를 거느릴 때만 — 받는 장수는 헌제다', () => {
    let p: PlayerProfile = { ...base(), surplusCards: 30 };
    assert.equal(codeOf(canExchangeSurplus(p, 'E')), 'market.surplus.noEmperor');
    p = addCard(p, EMPEROR);
    const r = exchangeSurplus(p, 'E', 9);
    assert.equal(r.officer, EMPEROR);
    assert.equal(surplusOf(r.profile), 0);
  });

  it('같은 시드는 같은 장수를 준다 — 서버가 시드를 넣는다', () => {
    let p: PlayerProfile = { ...base(), surplusCards: 100 };
    for (const o of OFFICERS.filter((x) => x.grade === 'A').slice(0, 4)) p = addCard(p, o.id as OfficerId);
    assert.equal(exchangeSurplus(p, 'A', 77).officer, exchangeSurplus(p, 'A', 77).officer);
  });
});

// ── 궁궐이 가득 차면 새 장수를 받지 않는다 (2026-11-24 기획자) ──

describe('궁궐이 가득 차면 — 전투 보상은 보유한 장수에서 다시 뽑고, 우편은 못 받는다', () => {
  /** 빈자리를 0으로 — 보유하지 않은 C · D급으로 채운다 */
  const full = (): PlayerProfile => {
    let p = base();
    for (const o of OFFICERS.filter((x) => x.grade === 'C' || x.grade === 'D')) {
      if (poolSeatsFree(p) === 0) break;
      p = addCard(p, o.id as OfficerId);
    }
    assert.equal(poolSeatsFree(p), 0);
    return p;
  };

  it('전투 보상 후보에 새 장수가 없다 — 새 등급 칸도 보유한 장수로 받는다', () => {
    const p = full();
    const owned = new Set<string>(ownedOfficers(p));
    const cands = cardCandidates(p, [], ['B', 'C', 'D']);
    assert.ok(cands.length > 0, '보유한 B · C · D가 후보로 남는다');
    assert.ok(cands.every((c) => owned.has(c.officer)), '후보는 전부 보유한 장수');
    // 자리가 있으면 새 장수도 후보다 — 검사가 살아 있다
    const roomy = base();
    assert.ok(cardCandidates(roomy, [], ['C']).some((c) => !ownedOfficers(roomy).includes(c.officer)));
  });

  it('보상을 다 받아도 풀이 상한을 넘지 않고 보관함이 생기지 않는다', () => {
    const p = full();
    let q = p;
    for (let seed = 1; seed <= 20; seed++) q = grantRewards(q, { cards: [{ owned: [], fresh: ['B', 'C', 'D'] }], materials: 0, grain: 0 }, seed).profile;
    assert.equal(poolUsed(q), poolUsed(p));
    assert.ok(Object.keys(q.cards).every((id) => q.roster[id as OfficerId]), '카드는 풀에 있는 장수의 것뿐 — 보관함은 없다');
  });

  it('새 장수 카드가 든 우편은 자리가 모자라면 못 받고 우편이 남는다 — 보유한 장수의 카드는 받는다', () => {
    const p = full();
    const stranger = OFFICERS.find((o) => !ownedOfficers(p).includes(o.id as OfficerId))!.id;
    const mine = (Object.keys(p.roster) as OfficerId[])[0]!;
    const mk = (officer: string): Mail => ({
      id: 9, sentAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, targetUid: null, title: { ko: '선물' }, body: { ko: '' },
      rewards: [{ kind: 'cards', officer, delta: 1 }], revokedAt: null,
    });
    const r = claimMail(p, mk(stranger), 1);
    assert.equal(r.ok ? undefined : r.code, 'mail.noSeat');
    assert.equal(mailClaimed(p, 9), false);
    assert.equal(claimMail(p, mk(mine), 1).ok, true);
  });
});
