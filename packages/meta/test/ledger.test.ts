/**
 * 변화 장부 · 이상 징후 판정 회귀 (2026-11-12, `history/2026-11-12_이상징후_설계.md`).
 *
 * 여기서 고정하는 것.
 *  - 바뀐 만큼(`ledgerDelta`)이 칸마다 맞고, 안 바뀌면 `null`이다
 *  - 「늘릴 수 있는 길」 표(`ACTION_SOURCES`)가 **그 라우트가 부르는 meta 함수가 실제로 늘리는 것**과 맞는다 —
 *    대표 함수를 시험 계정에 돌려 본다. 표를 좁게 잡으면 운영에서 오탐으로, 넓게 잡으면 못 잡는 것으로만 보인다
 *  - 새 계정 판정 · 불변식은 **깨진 계정을 만들면 실제로 뜬다**(CLAUDE.md — 「검사를 넣었으면 실패하는 상태를 만든다」)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId } from '@samchess/rules';
import {
  ACTION_SOURCES, applyBattleResult, applyBuyGrain, applyLevelUp, buyGacha, cardsToLevelUp, createProfile,
  creationViolations, ledgerDelta, ledgerValues, profileInvariants, syncAllowed, unexpectedIncreases,
} from '../src/index.ts';
import type { BattleOutcome, PlayerProfile, RosterPick } from '../src/index.ts';

const T0 = 1_800_000_000_000;
const fresh = (): PlayerProfile => createProfile('장부성', 7);

/** 그 라우트의 표로 `before → after`를 보면 늘 수 없는 묶음 */
const surprises = (route: string, before: PlayerProfile, after: PlayerProfile) =>
  unexpectedIncreases(ledgerDelta(ledgerValues(before), ledgerValues(after)) ?? {}, ACTION_SOURCES[route] ?? []);

describe('바뀐 만큼', () => {
  it('칸마다 after − before, 0은 빠지고 안 바뀌면 null', () => {
    const a = fresh();
    const officer = Object.keys(a.roster)[0]!;
    const b: PlayerProfile = { ...a, gold: a.gold + 300, cards: { ...a.cards, [officer]: 2 }, grain: a.grain - 1 };
    assert.deepEqual(ledgerDelta(ledgerValues(a), ledgerValues(b)), { gold: 300, [`cards.${officer}`]: 2, grain: -1 });
    assert.equal(ledgerDelta(ledgerValues(a), ledgerValues(structuredClone(a))), null);
  });

  it('새 계정(before = null)은 가진 것 전부가 늘어난 것이다', () => {
    const d = ledgerDelta(null, ledgerValues(fresh()))!;
    assert.ok(d['grain']! > 0);
    assert.equal(Object.keys(d).filter((k) => k.startsWith('pool.')).length, 5);
  });
});

describe('늘릴 수 있는 길 — 표가 meta 함수와 맞는가', () => {
  it('금화를 늘리는 길은 우편 · 관리자 지급 · 개발용 지급뿐이다 — 전투는 금화를 안 준다', () => {
    const gold = Object.entries(ACTION_SOURCES).filter(([, g]) => g.includes('gold')).map(([r]) => r).sort();
    assert.deepEqual(gold, ['POST /admin/users/:uid/adjust', 'POST /dev/grant', 'POST /mail/:id/claim']);
  });

  it('가챠 — 금화를 내고 카드(· 풀)만 는다', () => {
    const a = { ...fresh(), gold: 100_000 };
    const b = buyGacha(a, 'multi', 11).profile;
    assert.ok(b.gold < a.gold, '금화를 냈다');
    assert.deepEqual(surprises('POST /market/gacha', a, b), []);
    // 표를 비우면 잡힌다 — 이 검사가 살아 있다
    // (뽑은 장수가 처음이면 풀로, 이미 있으면 카드로 간다 — 어느 쪽이든 잡혀야 한다)
    assert.ok(unexpectedIncreases(ledgerDelta(ledgerValues(a), ledgerValues(b))!, []).some((g) => g === 'cards' || g === 'pool'));
  });

  it('군량 구매 — 군량만 는다', () => {
    const a = { ...fresh(), gold: 100_000, grain: 0, grainAt: T0 };
    const b = applyBuyGrain(a, T0);
    assert.ok(b.grain > a.grain);
    assert.deepEqual(surprises('POST /market/grain', a, b), []);
  });

  it('레벨업 — 레벨만 는다(카드는 준다)', () => {
    const a = fresh();
    const officer = Object.keys(a.roster)[0]! as OfficerId;
    // 도시가 Lv1이면 장수도 Lv1까지다(`officerLevelCap`) — 한 단계 올린 도시에서 본다
    const ready: PlayerProfile = { ...a, cityLevel: 2, cards: { [officer]: cardsToLevelUp(1)! } };
    const b = applyLevelUp(ready, officer, 'hp', 'support');
    assert.equal(b.roster[officer]!.level, 2);
    assert.deepEqual(surprises('POST /officer/levelup', ready, b), []);
  });

  it('전투 정산 — 군량 · 재료 · 카드 · 풀만 는다, 금화는 아니다', () => {
    const a = fresh();
    const picks: RosterPick[] = Object.keys(a.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));
    const outcome: BattleOutcome = { result: 'win', mode: '3v3', opponent: 'siege', picks, power: { mine: 700, theirs: 900 }, at: T0 };
    const b = applyBattleResult(a, outcome, 3).profile;
    assert.equal(b.gold, a.gold);
    assert.deepEqual(surprises('POST /battle/ai-result', a, b), []);
    // 같은 변화가 「조회」로 들어왔다면 징후다
    assert.ok(surprises('GET /profile', a, b).length > 0);
  });

  it('읽는 순간의 정산 — 군량은 언제나, 카드는 판이 정산됐을 때만', () => {
    const a = fresh();
    const officer = Object.keys(a.roster)[0]!;
    const b: PlayerProfile = { ...a, grain: a.grain + 5, cards: { [officer]: 1 } };
    const d = ledgerDelta(ledgerValues(a), ledgerValues(b))!;
    assert.deepEqual(unexpectedIncreases(d, syncAllowed(a, b)), ['cards']);
    const fighting = { ...a, aiBattle: { status: 'fighting' } } as unknown as PlayerProfile;
    const abandoned = { ...b, aiBattle: { status: 'abandoned' } } as unknown as PlayerProfile;
    assert.deepEqual(unexpectedIncreases(d, syncAllowed(fighting, abandoned)), []);
  });
});

describe('새 계정 — 시작 꾸러미', () => {
  it('createProfile 그대로면 정상, 시드가 달라도 정상', () => {
    assert.deepEqual(creationViolations(createProfile('갑', 1)), []);
    assert.deepEqual(creationViolations(createProfile('을', 99)), []);
  });

  it('금화 · 카드 · 레벨을 얹어 온 새 계정은 잡힌다', () => {
    const p = fresh();
    const officer = Object.keys(p.roster)[0]!;
    assert.deepEqual(creationViolations({ ...p, gold: 999_999 }), ['gold']);
    assert.deepEqual(creationViolations({ ...p, cards: { [officer]: 50 } }), [`cards.${officer}`]);
    const leveled = structuredClone(p);
    leveled.roster[officer as OfficerId]!.level = 9;
    assert.deepEqual(creationViolations(leveled), ['pool']);
  });
});

describe('불변식', () => {
  it('새 계정은 깨진 것이 없다', () => {
    assert.deepEqual(profileInvariants(fresh()), []);
  });

  it('깨진 계정은 칸마다 잡힌다', () => {
    const p = structuredClone(fresh());
    const officer = Object.keys(p.roster)[0]! as OfficerId;
    p.gold = -5;
    p.roster[officer]!.level = 3; // 성장 스택은 비어 있다 — 짝이 안 맞는다. 도시 Lv1의 상한도 넘는다
    p.cards['nobody' as OfficerId] = 1;
    p.buildings.barracks = 99;
    p.marketOwned = { 'no-such-item': 1 };
    const codes = profileInvariants(p).map((b) => `${b.code}:${b.key}`).sort();
    assert.deepEqual(codes, [
      `growth:level.${officer}`, `levelCap:level.${officer}`, 'buildingLevel:buildings.barracks', 'negative:gold',
      'unknownId:cards.nobody', 'unknownId:market.no-such-item',
    ].sort());
  });
});
