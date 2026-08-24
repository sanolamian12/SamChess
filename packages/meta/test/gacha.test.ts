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
import { describe, it } from 'node:test';
import { ECONOMY, OFFICERS } from '@samchess/data';
import {
  createProfile, drawGacha, gachaDeckBase, gachaSlotsPerOfficer, shuffledGachaDeck,
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
