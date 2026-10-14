/**
 * 컬렉션 — 칸 판정 · 등록 · 정렬 · 요약 (2026-10-13, `Design/컬렉션_기획.md`).
 *
 * 여기서 고정하는 것.
 *  - **여분만 낸다** — 풀의 장수는 `cards` 그대로, 보관함의 장수는 본체 한 장을 뺀다
 *  - **병기는 미지급 자루만** — 낸 자루가 빠지면 대장간 종류당 상한이 다시 열린다
 *  - **아이템은 들려 보낼 예약을 뺀 수량만**
 *  - **마지막 칸에서만 완성** — 점수는 완성한 것만 센다
 *  - **달성조건순** — 완성은 맨 뒤, 못 채우는 칸이 적은 것부터
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COLLECTIONS, collectionById } from '@samchess/data';
import { createBattle } from '@samchess/rules';
import type { OfficerId, UnitId } from '@samchess/rules';
import {
  applyRegisterSlot, canRegisterSlot, collectionRankRows, collectionRows, collectionStatus, collectionSummary, createProfile,
  battlePower, forgeCopiesOwned, forgeItemKey, migrateProfile, searchCollections, slotState, sortCollections, spareCards,
  toRosterEntries,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const T = Date.UTC(2026, 9, 13, 3, 0, 0);
const DOWON = collectionById.get('do-won-gyeol-ui')!;          // 유비 · 관우 · 장비
const LUBU = COLLECTIONS.find((c) => c.title === '인중여포 마중적토')!;   // 카드 3 · 방천화극 · 적토마

function base(over: Partial<PlayerProfile> = {}): PlayerProfile {
  const p = createProfile('수집성', 7);
  return { ...p, roster: {}, cards: {}, forgeOwned: {}, marketOwned: {}, ...over };
}
const inst = (id: string) => ({ [id]: { officer: id as OfficerId, level: 1, growth: [] } }) as unknown as PlayerProfile['roster'];

describe('데이터 — 추출기가 지킨 규칙이 실제로 실렸다', () => {
  it('117개 · 칸은 5개까지 · 카드 → 병기 → 아이템 순 · 같은 장수 칸은 하나', () => {
    assert.equal(COLLECTIONS.length, 117);
    for (const c of COLLECTIONS) {
      assert.ok(c.slots.length <= 5, `${c.title} — 칸 ${c.slots.length}`);
      const order = c.slots.map((s) => ['card', 'weapon', 'item'].indexOf(s.kind));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), c.title);
      const cards = c.slots.filter((s) => s.kind === 'card').map((s) => s.id);
      assert.equal(new Set(cards).size, cards.length, c.title);
    }
  });
});

describe('칸 판정 — 여분만 낸다', () => {
  it('풀의 장수는 카드 1장이면 낼 수 있다', () => {
    const p = base({ roster: inst('yu-bi'), cards: { ['yu-bi' as OfficerId]: 1 } });
    assert.equal(spareCards(p, 'yu-bi'), 1);
    assert.equal(slotState(p, DOWON, 0).state, 'ready');
  });
  it('풀의 장수라도 여분이 없으면 막힌다 — 이유는 「여분 없음」', () => {
    const p = base({ roster: inst('yu-bi') });
    assert.deepEqual(slotState(p, DOWON, 0), { state: 'blocked', reason: 'noSpare', have: 0 });
  });
  it('보관함의 장수는 본체 한 장을 뺀다 — 1장뿐이면 못 낸다', () => {
    const one = base({ cards: { ['yu-bi' as OfficerId]: 1 } });
    assert.equal(spareCards(one, 'yu-bi'), 0);
    assert.equal(slotState(one, DOWON, 0).reason, 'noSpare');
    const two = base({ cards: { ['yu-bi' as OfficerId]: 2 } });
    assert.equal(spareCards(two, 'yu-bi'), 1);
    // 내고 나도 보관함에 한 장 남는다 — 장수가 사라지지 않는다
    const after = applyRegisterSlot(two, DOWON.id, 0, T);
    assert.equal(after.cards['yu-bi' as OfficerId], 1);
  });
  it('없는 장수는 「미보유」', () => {
    assert.equal(slotState(base(), DOWON, 1).reason, 'notOwned');
  });
});

describe('병기 — 미지급 자루만 · 상한이 다시 열린다', () => {
  const W = 'bang-cheon-hwa-geuk';
  const wIdx = LUBU.slots.findIndex((s) => s.kind === 'weapon');
  it('지급된 자루뿐이면 「지급 중」으로 막힌다', () => {
    const p = base({ forgeOwned: { [forgeItemKey(W, 1)]: 'yeo-po' as OfficerId } });
    assert.deepEqual(slotState(p, LUBU, wIdx), { state: 'blocked', reason: 'equipped', have: 0 });
  });
  it('낸 자루는 보유에서 빠지고 제작일도 함께 지워진다', () => {
    const key = forgeItemKey(W, 1);
    const p = base({ forgeOwned: { [key]: null }, forgeMadeAt: { [key]: T - 1000 } });
    const next = applyRegisterSlot(p, LUBU.id, wIdx, T);
    assert.equal(forgeCopiesOwned(next, W), 0);
    assert.ok(!(key in (next.forgeMadeAt ?? {})));
  });
});

describe('아이템 — 들려 보낼 예약을 뺀다', () => {
  const I = 'jeok-to-ma';
  const iIdx = LUBU.slots.findIndex((s) => s.kind === 'item');
  it('하나뿐인데 들려 보낼 예정이면 막힌다', () => {
    const p = base({ marketOwned: { [I]: 1 }, marketCarry: { ['yeo-po' as OfficerId]: I } });
    assert.equal(slotState(p, LUBU, iIdx).reason, 'carried');
  });
  it('가장 오래 산 것부터 빠진다', () => {
    const p = base({ marketOwned: { [I]: 2 }, marketBoughtAt: { [I]: [1, 2] } });
    const next = applyRegisterSlot(p, LUBU.id, iIdx, T);
    assert.equal(next.marketOwned?.[I], 1);
    assert.deepEqual(next.marketBoughtAt?.[I], [2]);
  });
});

describe('등록 — 부분 등록 · 완성 · 되돌릴 수 없다', () => {
  const full = (): PlayerProfile => base({
    roster: { ...inst('yu-bi'), ...inst('gwan-u'), ...inst('jang-bi') },
    cards: { ['yu-bi' as OfficerId]: 1, ['gwan-u' as OfficerId]: 1, ['jang-bi' as OfficerId]: 1 },
  });
  it('한 칸이면 등록 중, 마지막 칸에서만 완성 시각이 찍힌다', () => {
    let p = applyRegisterSlot(full(), DOWON.id, 0, T);
    assert.equal(collectionStatus(p, DOWON), 'partial');
    assert.equal(collectionSummary(p).points, 0);
    p = applyRegisterSlot(p, DOWON.id, 2, T + 1);
    p = applyRegisterSlot(p, DOWON.id, 1, T + 2);
    assert.equal(collectionStatus(p, DOWON), 'done');
    assert.equal(p.collection?.completedAt[DOWON.id], T + 2);
    assert.deepEqual(p.collection?.slots[DOWON.id], [0, 1, 2]);
    assert.equal(collectionSummary(p).points, DOWON.points);
    assert.equal(collectionSummary(p).invested.cards.S, 3);
  });
  it('같은 칸은 두 번 못 채운다 · 없는 칸 · 모르는 컬렉션은 거부', () => {
    const p = applyRegisterSlot(full(), DOWON.id, 0, T);
    assert.equal(canRegisterSlot(p, DOWON.id, 0).ok, false);
    assert.equal(canRegisterSlot(p, DOWON.id, 9).ok, false);
    assert.equal(canRegisterSlot(p, 'nope', 0).ok, false);
    assert.throws(() => applyRegisterSlot(p, DOWON.id, 0, T));
  });
});

describe('정렬 · 검색', () => {
  it('시대순은 번호 순, 점수순은 점수 큰 것부터(같으면 시대순)', () => {
    const rows = collectionRows(base());
    assert.deepEqual(sortCollections(rows, 'era').map((r) => r.collection.no).slice(0, 3), [1, 2, 3]);
    const byPts = sortCollections(rows, 'points').map((r) => r.collection);
    for (let i = 1; i < byPts.length; i++) {
      const [a, b] = [byPts[i - 1]!, byPts[i]!];
      assert.ok(a.points > b.points || (a.points === b.points && a.no < b.no), `${a.title} → ${b.title}`);
    }
  });
  it('달성조건순 — 지금 바로 완성할 수 있는 것이 맨 앞, 완성한 것은 맨 뒤', () => {
    const p = base({
      roster: { ...inst('yu-bi'), ...inst('gwan-u'), ...inst('jang-bi') },
      cards: { ['yu-bi' as OfficerId]: 2, ['gwan-u' as OfficerId]: 2, ['jang-bi' as OfficerId]: 2 },
    });
    const first = sortCollections(collectionRows(p), 'reach')[0]!;
    assert.equal(first.missing, 0);
    assert.equal(first.collection.id, DOWON.id);
    let done = p;
    for (let i = 0; i < 3; i++) done = applyRegisterSlot(done, DOWON.id, i, T);
    const sorted = sortCollections(collectionRows(done), 'reach');
    assert.equal(sorted[sorted.length - 1]!.collection.id, DOWON.id);
  });
  it('검색은 요건의 장수 이름으로도 찾는다', () => {
    const hits = searchCollections(collectionRows(base()), '양수');
    assert.ok(hits.some((r) => r.collection.title === '계륵'));
    assert.ok(hits.every((r) => r.collection.slots.some((s) => s.id === 'yang-su') || r.collection.desc.includes('양수')
      || r.collection.title.includes('양수')));
  });
});

describe('저장 — 되접기가 컬렉션을 버리지 않는다', () => {
  it('migrateProfile을 지나도 채운 칸 · 완성 시각이 남는다 (화면 확인이 잡은 것)', () => {
    const p = base({ collection: { slots: { [DOWON.id]: [2, 0, 0, -1] }, completedAt: { [DOWON.id]: T } } });
    const back = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.deepEqual(back.collection, { slots: { [DOWON.id]: [0, 2] }, completedAt: { [DOWON.id]: T } });
    assert.equal(migrateProfile(JSON.parse(JSON.stringify(base())))!.collection, undefined);
  });
});

describe('서버 순위 — 점수 → 완성 수 → 먼저 닿은 쪽 → 도시 이름', () => {
  // 완성 시각만 다르게 심는다 — 칸까지 채울 필요는 없다(점수 · 완성 수는 `completedAt`에서 낸다)
  const done = (city: string, at: Record<string, number>): PlayerProfile =>
    base({ cityName: city, collection: { slots: {}, completedAt: at } });
  const [a, b, c] = COLLECTIONS.filter((x) => x.points === 100);
  const big = COLLECTIONS.find((x) => x.points === 200)!;

  it('점수가 크면 앞 · 같으면 완성 수 · 같으면 마지막 완성이 이른 쪽', () => {
    const rows = collectionRankRows([
      done('늦은성', { [a!.id]: T + 9, [b!.id]: T + 9 }),   // 200점 · 2개 · 늦게
      done('큰성', { [big.id]: T }),                         // 200점 · 1개
      done('이른성', { [a!.id]: T, [c!.id]: T + 1 }),        // 200점 · 2개 · 일찍
      done('작은성', { [a!.id]: T }),                        // 100점
    ]);
    assert.deepEqual(rows.map((r) => [r.rank, r.cityName, r.points, r.done]), [
      [1, '이른성', 200, 2], [2, '늦은성', 200, 2], [3, '큰성', 200, 1], [4, '작은성', 100, 1],
    ]);
  });

  it('점수 0은 줄에 안 선다', () => {
    const rows = collectionRankRows([done('빈성', {}), done('작은성', { [a!.id]: T })]);
    assert.deepEqual(rows.map((r) => r.cityName), ['작은성']);
  });
});

describe('전투 효과 — `toRosterEntries()`가 판 시작 시각 이전에 완성된 것만 싣는다 (기획 §3.3)', () => {
  const SAMGO = COLLECTIONS.find((c) => c.effect.kind === 'skillSp' && c.effect.who.includes('yu-bi'))!;
  const OHO = COLLECTIONS.find((c) => c.effect.kind === 'teamSp' && c.effect.min === 3 && c.effect.with?.includes('gwan-u'))!;
  const picks = [
    { piece: 'King' as const, officer: 'yu-bi' as OfficerId },
    { piece: 'Rock' as const, officer: 'gwan-u' as OfficerId },
    { piece: 'Pawn' as const, officer: 'jang-bi' as OfficerId },
  ];
  const p = base({
    roster: { ...inst('yu-bi'), ...inst('gwan-u'), ...inst('jang-bi') },
    collection: { slots: {}, completedAt: { [DOWON.id]: T, [SAMGO.id]: T + 1000, [OHO.id]: T } },
  });
  const sources = (at?: number) => toRosterEntries(p, picks, at).map((e) => (e.bonuses ?? []).map((b) => b.source));

  it('완성 시각과 같으면 싣고 1ms 앞이면 안 싣는다', () => {
    assert.deepEqual(sources(T - 1), [[], [], []]);
    assert.deepEqual(sources(T), [[DOWON.id], [DOWON.id, OHO.id], [DOWON.id, OHO.id]]);
    assert.deepEqual(sources(T + 1000)[0], [DOWON.id, SAMGO.id], '삼고초려는 1초 뒤에 완성됐다');
  });

  it('시각을 안 주면(전투력을 잴 때) 아무것도 안 싣는다 — 전투력이 그대로다', () => {
    assert.deepEqual(sources(), [[], [], []]);
    const { collection: _, ...bare } = p;
    const mode = '3v3' as const;
    assert.equal(battlePower(mode, toRosterEntries(p, picks)), battlePower(mode, toRosterEntries(bare, picks)));
    assert.equal(battlePower(mode, toRosterEntries(p, picks, T + 1000)), battlePower(mode, toRosterEntries(bare, picks, T + 1000)),
      '`battlePower`는 `bonuses`를 안 읽는다');
  });

  it('도시 효과는 판에 안 간다', () => {
    const city = COLLECTIONS.find((c) => c.effect.kind === 'city')!;
    const q = { ...p, collection: { slots: {}, completedAt: { [city.id]: T } } };
    assert.deepEqual(toRosterEntries(q, picks, T).map((e) => e.bonuses), [undefined, undefined, undefined]);
  });

  it('판에 서면 — 도원결의 HP+2 · 삼고초려 SP −1, 오호대장군은 둘뿐이라 안 켜진다', () => {
    const foe = [
      { officer: 'jo-jo' as OfficerId, piece: 'King' as const, level: 1, statPicks: [], tactics: [] },
      { officer: 'jang-hap' as OfficerId, piece: 'Bishop' as const, level: 1, statPicks: [], tactics: [] },
      { officer: 'heon-je' as OfficerId, piece: 'Queen' as const, level: 1, statPicks: [], tactics: [] },
    ];
    const make = (at: number) => createBattle({
      matchId: 't', seed: 1, mode: '3v3', rosters: { P1: toRosterEntries(p, picks, at), P2: foe },
    });
    const before = make(T - 1);
    const after = make(T + 1000);
    const king = (s: typeof after) => s.units['P1-King' as UnitId]!;
    assert.equal(king(after).maxHp - king(before).maxHp, 2);
    assert.deepEqual(king(after).bonuses?.map((b) => b.source), [DOWON.id, SAMGO.id]);
    assert.deepEqual(after.units['P1-Rock' as UnitId]!.bonuses?.map((b) => b.source), [DOWON.id], '오호대장군(3명 이상)은 꺼졌다');
    assert.equal(after.sp.P1, 0);
  });
});
