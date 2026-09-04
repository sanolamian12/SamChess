/**
 * 데이터 정합성 회귀 테스트.
 * `python tools/extract_data.py` 가 이미 같은 검증을 하지만, TS 쪽에서도 독립적으로 확인한다.
 *
 *   node --test --experimental-strip-types packages/rules/test/*.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFICERS, UNIQUE_SKILLS, PIECES, TACTICS, CITY_LEVELS, BUILDINGS, CITY_RULES, BUILD_REPORT,
  buildingById, officerById, skillById,
} from '@samchess/data';
import { threatRange } from '../src/pieces.ts';
import { FORMULA } from '../src/types.ts';

const SP_COST: Record<string, number> = { S: 6, A: 5, B: 4, E: 7 };

test('추출 빌드가 문제 없이 끝났다', () => {
  assert.equal(BUILD_REPORT.ok, true, JSON.stringify(BUILD_REPORT.problems, null, 2));
});

test('장수 260명, id 중복 없음', () => {
  assert.equal(OFFICERS.length, 260);
  assert.equal(officerById.size, 260);
  assert.equal(new Set(OFFICERS.map((o) => o.name)).size, 260);
});

test('등급 분포가 S30 / A40 / B55 / C90 / D44 / E1', () => {
  const dist: Record<string, number> = {};
  for (const o of OFFICERS) dist[o.grade] = (dist[o.grade] ?? 0) + 1;
  assert.deepEqual(dist, { S: 30, A: 40, B: 55, C: 90, D: 44, E: 1 });
});

test('S/A/B/E급만 고유기술을 가지며 전원 보유한다', () => {
  for (const o of OFFICERS) {
    const shouldHave = o.grade in SP_COST;
    assert.equal(!!o.uniqueSkill, shouldHave, `${o.name} (${o.grade}급)`);
    if (o.uniqueSkill) {
      const skill = skillById.get(o.uniqueSkill);
      if (!skill) throw new assert.AssertionError({ message: `${o.name}: 스킬 ${o.uniqueSkill} 미정의` });
      assert.equal(skill.tier, o.grade, `${o.name}: 티어 불일치`);
      assert.equal(skill.spCost, SP_COST[o.grade], `${o.name}: SP 코스트 불일치`);
      assert.ok(skill.holders.includes(o.id), `${o.name}: holders 역참조 누락`);
    }
  }
});

test('S급은 1인 1스킬, A/B급은 공유', () => {
  const byTier: Record<string, number> = {};
  for (const s of UNIQUE_SKILLS) byTier[s.tier] = (byTier[s.tier] ?? 0) + 1;
  assert.deepEqual(byTier, { S: 30, A: 4, B: 5, E: 1 });

  for (const s of UNIQUE_SKILLS) {
    if (s.tier === 'S' || s.tier === 'E') {
      assert.equal(s.holders.length, 1, `${s.name}: 전용 스킬인데 ${s.holders.length}명 보유`);
    } else {
      assert.ok(s.holders.length > 1, `${s.name}: 공유 스킬인데 1명뿐`);
    }
  }
  // A/B급 보유자 합계 = A 40 + B 55
  const total = UNIQUE_SKILLS.filter((s) => s.tier === 'A' || s.tier === 'B')
    .reduce((n, s) => n + s.holders.length, 0);
  assert.equal(total, 95);
});

test('능력치 범위와 WT 공식', () => {
  for (const o of OFFICERS) {
    for (const [label, v] of [['무력', o.might], ['지력', o.intellect], ['통솔', o.leadership]] as const) {
      assert.ok(v >= 0 && v <= 100, `${o.name} ${label} ${v} 범위 밖`);
    }
    assert.equal(o.wtBase, FORMULA.wtBase(o.leadership), `${o.name}: WT 불일치`);
  }
});

test('기물 위협 범위 — GDD §3.2 확정치', () => {
  const expected: Record<string, number> = {
    Rock: 41, Queen: 39, Bishop: 37, Pawn: 33, King: 25, Knight: 25,
  };
  for (const p of PIECES) {
    // 데이터에 기록된 값
    assert.equal(p.threatRange, expected[p.type], `${p.type}: 데이터 위협 범위`);
    // 마스크로부터 다시 계산한 값 (보드 경계 무시)
    assert.equal(threatRange(p.type).length, expected[p.type], `${p.type}: 재계산 위협 범위`);
  }
});

test('기물 마스크 칸 수', () => {
  const moves: Record<string, number> = { King: 8, Rock: 16, Bishop: 16, Knight: 8, Queen: 24, Pawn: 8 };
  const attacks: Record<string, number> = { King: 8, Rock: 4, Bishop: 4, Knight: 4, Queen: 2, Pawn: 8 };
  for (const p of PIECES) {
    assert.equal(p.moveMask.length, moves[p.type], `${p.type}: 이동 마스크`);
    assert.equal(p.attackMask.length, attacks[p.type], `${p.type}: 공격 마스크`);
  }
  assert.equal(PIECES.find((p) => p.type === 'Pawn')!.maxTargets, 2);
});

test('책략 16종 — 레벨 2~9, 지원/환술 각 8줄', () => {
  assert.equal(TACTICS.length, 16);
  for (let lv = 2; lv <= 9; lv++) {
    const support = TACTICS.filter((t) => t.level === lv && t.school === 'support');
    const illusion = TACTICS.filter((t) => t.level === lv && t.school === 'illusion');
    // 2026-09-03부터 **레벨마다 하나씩**이다 — Lv6·7이 생성/제거 쌍으로 둘씩
    // 들어오던 것을 접었다(수계·매립 삭제, 진화가 Lv6 → Lv7).
    assert.equal(support.length, 1, `Lv${lv} 지원은 1건이어야 함`);
    assert.equal(illusion.length, 1, `Lv${lv} 환술은 1건이어야 함`);
  }
  assert.ok(TACTICS.every((t) => t.requiresResistCheck === (t.school === 'illusion')));
});

/**
 * 도시와 건물 (2026-09-04 개편 · GDD §5).
 *
 * **추출기가 이미 같은 것을 보지만 여기서 다시 본다** — 기물 마스크를 파이썬과
 * TS가 각각 다시 계산해 대조하는 것과 같은 결이다. 아래 둘은 **설계 의도 자체**라
 * 숫자가 흔들리면 사양이 흔들린 것이다.
 */
test('도시 10레벨 — 마지막은 황궁 전용이고 증축 자재만 정한다', () => {
  assert.equal(CITY_LEVELS.length, CITY_RULES.emperorCityLevel);
  assert.equal(CITY_LEVELS[0]!.materialsToUpgrade, null, 'Lv1은 시작 레벨이라 값이 없다');
  assert.ok(CITY_LEVELS.slice(1).every((c) => c.materialsToUpgrade !== null));
  assert.equal(CITY_LEVELS.filter((c) => c.requiresEmperor).length, 1, '황궁 전용은 마지막 하나뿐');
  assert.ok(CITY_LEVELS.at(-1)!.requiresEmperor);
});

test('건물 7종 — 궁궐 만렙 풀 = 전체 장수 수 · 황제 없는 상한에서 다섯이 남는다 ★', () => {
  assert.equal(BUILDINGS.length, 7);

  // 「최종 목표는 전 장수 수집」(GDD §5.4) — 궁궐 Lv5에 닿아야 260명을 담는다
  assert.equal(buildingById.get('palace')!.effect!.values.at(-1), OFFICERS.length);

  /*
   * ★ **「황제 없이 갈 수 있는 끝에서 다섯이 남는다」는 기회 수에서 나온다** (GDD §5.2).
   *
   *   총 칸 = 기본 3종 × 4(Lv2~5) + 추가 4종 × 5(Lv1~5) = 32
   *   Lv10까지 받는 기회 = 3 × 9(증축 횟수)                = 27
   *
   * pptx 57쪽의 격자는 **조건표가 아니라** 이 5를 보이려고 순서대로 놓아 본
   * 시뮬레이션이었다(2026-09-04에 바로잡음). 세 상수 중 하나만 바뀌어도 이 수가
   * 흔들리는데 화면에는 「끝까지 못 지었네」로만 보인다.
   *
   * **시작 기회가 없어지고 황궁이 Lv11로 올라갔다**(2026-09-04 두 번째 지정) —
   * 받는 총량은 27 그대로다. 황제 없는 상한은 `emperorCityLevel − 1`(=10)이고
   * 거기까지 올리는 증축은 한 번 적은 9회다.
   */
  const slots = BUILDINGS.reduce((n, b) => n + b.maxLevel - (b.kind === 'basic' ? 1 : 0), 0);
  const granted = CITY_RULES.buildActionsPerUpgrade * (CITY_RULES.emperorCityLevel - 2);
  assert.equal(slots, 32);
  assert.equal(granted, 27);
  assert.equal(slots - granted, 5);
  // 황궁은 표의 마지막 한 칸이고 **거기만** 황제를 요구한다
  assert.equal(CITY_LEVELS.length, CITY_RULES.emperorCityLevel);
  assert.equal(CITY_LEVELS.filter((c) => c.requiresEmperor).length, 1);
  assert.equal(CITY_LEVELS.at(-1)!.requiresEmperor, true);

  // 건물을 짓는 문은 상수 하나다 — 레벨별 표가 아니다
  assert.equal(CITY_RULES.buildCityLevel, 2);

  for (const b of BUILDINGS) {
    if (!b.effect) continue;
    assert.equal(b.effect.values.length, b.maxLevel, `${b.name} 효과 표 길이`);
    for (let i = 1; i < b.effect.values.length; i++) {
      assert.ok(b.effect.values[i]! > b.effect.values[i - 1]!, `${b.name} 효과는 단조 증가`);
    }
  }
  // 농지만 「없을 때의 값」이 0이 아니다 — 아예 안 차면 대전을 못 한다 (GDD §5.4)
  assert.equal(buildingById.get('farm')!.effect!.absent, 1);
});

test('계산식 — 크리티컬 / 환술 / 지원 / 데미지', () => {
  // 관우(무98) vs 조식(무15) → 20 + 83 = 103 → 100 clamp
  assert.equal(FORMULA.criticalRate(98, 15), 100);
  // 반대 방향 → 20 − 83 = −63 → 0 clamp
  assert.equal(FORMULA.criticalRate(15, 98), 0);
  assert.equal(FORMULA.criticalRate(60, 60), 20);
  assert.equal(FORMULA.illusionRate(60, 60), 20);

  // 지원책은 「시전자 − 대상」이 아니라 둘의 합 (2026-08-31, 이전엔 100% 확정)
  assert.equal(FORMULA.supportRate(60, 60), 100);   // 120 → clamp
  assert.equal(FORMULA.supportRate(10, 10), 20);    // 자가시전 = 2×본인 지력
  assert.equal(FORMULA.supportRate(0, 0), 0);

  assert.equal(FORMULA.damage(5, false, false, false), 5);
  assert.equal(FORMULA.damage(5, true, false, false), 10);   // 크리 ×2
  assert.equal(FORMULA.damage(5, true, true, false), 5);     // ×2 후 반감
  assert.equal(FORMULA.damage(5, false, true, true), 1);     // 5 × .5 × .5 = 1.25 → 1
});

test('보드는 20행 × 25열 고정', () => {
  assert.equal(FORMULA.board.cols, 25);
  assert.equal(FORMULA.board.rows, 20);
});
