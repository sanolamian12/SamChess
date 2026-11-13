/**
 * 상점 가챠 회귀 — "계정별 유한 랜덤 어레이" (트랙 9,
 * `history/2026-08-21_트랙9_가격정책_초안.md` §4에서 확정한 숫자를 고정한다)
 *
 * 여기서 고정하는 것 다섯.
 *  - 등급별 슬롯 총합이 확정안 숫자(S 6,000 · A 8,000 · B 11,000 · E 200 = 25,200)와 같은가
 *  - 단일 뽑기 확률이 등급별 인원수 비율과 같은가(확정안 §4.2)
 *  - 같은 시드는 언제나 같은 순서(재현성), 다른 시드는 다른 순서
 *  - `gachaPool`은 **처음 한 번만** 만들어지고 그 뒤로는 유지된다(재접속마다 안 섞인다)
 *  - 소진 근처에서 예외를 던지지 않고 있는 만큼만 준다(§4.4 "상한이 아니라 안전장치")
 */

import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import { ECONOMY, OFFICERS } from '@samchess/data';
import {
  buyGacha, canAffordGacha, createProfile, drawGacha, gachaDeckBase, gachaPullCost,
  gachaSlotsPerOfficer, migrateProfile, shuffledGachaDeck,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const profile = (): PlayerProfile => createProfile('가챠성', 1);

describe('가챠 배열 구성', () => {
  it('등급별 슬롯 총합이 확정안 숫자와 같다', () => {
    const slots = gachaSlotsPerOfficer();
    assert.equal(slots, 200, '레벨9 누적 100장 × 배수 2 = 200');

    const deck = gachaDeckBase();
    assert.equal(deck.length, 25_200);

    const counts: Record<string, number> = {};
    for (const id of deck) {
      const o = OFFICERS.find((x) => x.id === id)!;
      counts[o.grade] = (counts[o.grade] ?? 0) + 1;
    }
    assert.deepEqual(counts, { S: 6_000, A: 8_000, B: 11_000, E: 200 });
  });

  it('가챠 풀에는 C·D 등급이 없다', () => {
    const deck = gachaDeckBase();
    for (const id of deck) {
      const grade = OFFICERS.find((o) => o.id === id)!.grade;
      assert.ok((ECONOMY.gachaGrades as readonly string[]).includes(grade));
    }
  });
});

describe('셔플 재현성', () => {
  it('같은 시드는 언제나 같은 순서다', () => {
    const a = shuffledGachaDeck(42);
    const b = shuffledGachaDeck(42);
    assert.deepEqual(a, b);
  });

  it('다른 시드는 다른 순서다', () => {
    const a = shuffledGachaDeck(1);
    const b = shuffledGachaDeck(2);
    assert.notDeepEqual(a, b);
  });

  it('셔플이 카드 구성 자체는 바꾸지 않는다', () => {
    const base = [...gachaDeckBase()].sort();
    const shuffled = [...shuffledGachaDeck(7)].sort();
    assert.deepEqual(shuffled, base);
  });
});

describe('단일 뽑기 확률 — 등급별 인원수 비율과 같다 (확정안 §4.2)', () => {
  it('표본 5000장에서 등급 비중이 오차범위 안이다', () => {
    const deck = shuffledGachaDeck(99);
    const sample = deck.slice(0, 5_000);
    const counts: Record<string, number> = { S: 0, A: 0, B: 0, E: 0 };
    for (const id of sample) counts[OFFICERS.find((o) => o.id === id)!.grade]! += 1;

    const rate = (g: string) => counts[g]! / sample.length * 100;
    // 확정안: S 23.81% · A 31.75% · B 43.65% · E 0.79%. 표본 오차 ±3%p면 넉넉하다
    assert.ok(Math.abs(rate('S') - 23.81) < 3, `S ${rate('S')}`);
    assert.ok(Math.abs(rate('A') - 31.75) < 3, `A ${rate('A')}`);
    assert.ok(Math.abs(rate('B') - 43.65) < 3, `B ${rate('B')}`);
    assert.ok(Math.abs(rate('E') - 0.79) < 1, `E ${rate('E')}`);
  });
});

describe('drawGacha', () => {
  it('처음 뽑으면 gachaPool이 새로 생기고 시드가 저장된다', () => {
    const { profile: next, drawn, exhausted } = drawGacha(profile(), 1, 123);
    assert.equal(drawn.length, 1);
    assert.equal(exhausted, false);
    assert.deepEqual(next.gachaPool, { seed: 123, drawn: 1 });
  });

  it('이미 gachaPool이 있으면 newSeed를 무시하고 이어서 뽑는다', () => {
    const p = { ...profile(), gachaPool: { seed: 7, drawn: 3 } };
    const { profile: next, drawn } = drawGacha(p, 2, 999);
    assert.deepEqual(next.gachaPool, { seed: 7, drawn: 5 });
    assert.deepEqual(drawn, shuffledGachaDeck(7).slice(3, 5));
  });

  it('재접속해도 같은 배열이 이어진다 — 다시 안 섞인다', () => {
    const first = drawGacha(profile(), 10, 55);
    const second = drawGacha(first.profile, 10, 55);
    assert.deepEqual(second.drawn, shuffledGachaDeck(55).slice(10, 20));
    assert.notDeepEqual(first.drawn, second.drawn);
  });

  it('남은 수보다 많이 요청하면 있는 만큼만 주고 예외를 던지지 않는다', () => {
    const total = gachaDeckBase().length;
    const nearEnd = { ...profile(), gachaPool: { seed: 3, drawn: total - 2 } };
    const { drawn, exhausted, profile: next } = drawGacha(nearEnd, 10, 0);
    assert.equal(drawn.length, 2);
    assert.equal(exhausted, true);
    assert.equal(next.gachaPool!.drawn, total);
  });

  it('완전히 소진된 뒤에는 0장을 준다', () => {
    const total = gachaDeckBase().length;
    const empty = { ...profile(), gachaPool: { seed: 3, drawn: total } };
    const { drawn, exhausted } = drawGacha(empty, 1, 0);
    assert.equal(drawn.length, 0);
    assert.equal(exhausted, true);
  });

  it('0장 이하를 요청하면 던진다', () => {
    assert.throws(() => drawGacha(profile(), 0, 1));
  });
});

describe('buyGacha — 골드 구매', () => {
  it('가격만큼 골드가 빠지고 뽑은 만큼 카드/보유 장수가 늘어난다', () => {
    const rich = { ...profile(), gold: 1_000 };
    const cost = gachaPullCost('single');
    const { profile: next, drawn } = buyGacha(rich, 'single', 1);
    assert.equal(drawn.length, 1);
    assert.equal(next.gold, 1_000 - cost.gold);
    const owned = next.roster[drawn[0]!] !== undefined || (next.cards[drawn[0]!] ?? 0) > 0;
    assert.ok(owned, '뽑은 장수가 보유 목록이나 카드에 들어가 있어야 한다');
  });

  it('8연은 8장 · 72냥이다 (2026-09-24, 10연 90냥에서 바뀌었다)', () => {
    const rich = { ...profile(), gold: 1_000 };
    const { profile: next, drawn } = buyGacha(rich, 'multi', 2);
    assert.deepEqual(gachaPullCost('multi'), { gold: 72, count: 8 }, '기획자 지정 — 할인율 10% 유지');
    assert.equal(drawn.length, 8);
    assert.equal(next.gold, 1_000 - gachaPullCost('multi').gold);
  });

  it('골드가 모자라면 canAffordGacha가 막고, buyGacha는 던진다', () => {
    const poor = { ...profile(), gold: 0 };
    assert.equal(canAffordGacha(poor, 'single').ok, false);
    assert.throws(() => buyGacha(poor, 'single', 1));
  });
});

// ── 되접기를 지나도 배열이 이어진다 (2026-11-13) ──
// 서버는 읽을 때마다 `migrateProfile`을 지난다. 거기서 `gachaPool`이 빠져 뽑을 때마다 새 시드로 다시 섞이고 있었다
// (「유한 배열」이 없었다) — 관리자 「가챠」 탭을 만들다 잡혔다.

test('gachaPool은 migrateProfile(JSON 왕복)을 지나도 남는다', () => {
  const p = buyGacha({ ...createProfile('가챠되접기', 1), gold: 99_999 }, 'single', 77).profile;
  const back = migrateProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(back?.gachaPool, { seed: 77, drawn: 1 });
});

test('서버처럼 뽑을 때마다 되접어도 한 배열의 다음 칸이 차례로 나온다', () => {
  let p: PlayerProfile = { ...createProfile('가챠이어짐', 2), gold: 99_999 };
  const got: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = buyGacha(migrateProfile(JSON.parse(JSON.stringify(p)))!, 'single', 1000 + i);
    got.push(...r.drawn);
    p = r.profile;
  }
  assert.deepEqual(got, shuffledGachaDeck(1000).slice(0, 5), '첫 가챠의 시드 배열을 차례로 따라가야 한다');
  assert.equal(p.gachaPool?.drawn, 5);
});

test('gachaPool이 망가졌으면 없는 것으로 — 다음 가챠가 새로 섞는다', () => {
  const base = createProfile('가챠망가짐', 3);
  for (const bad of [{ seed: 1.5, drawn: 0 }, { seed: 1, drawn: -1 }, { seed: '1', drawn: 0 }, 'x']) {
    assert.equal(migrateProfile(JSON.parse(JSON.stringify({ ...base, gachaPool: bad })))?.gachaPool, undefined, JSON.stringify(bad));
  }
});
