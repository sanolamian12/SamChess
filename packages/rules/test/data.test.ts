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
  EQUIPMENT, buildingById, equipmentById, equipmentForForge, officerById, skillById,
} from '@samchess/data';
import type { EquipmentEffect } from '@samchess/data';
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

/*
 * **효과와 설명이 같은 이야기를 하는가** (2026-09-07).
 *
 * 부저추신을 −1에서 −4로 올렸을 때 **DSL만 바꾸고 서술 문장이 안 따라왔다** —
 * 엑셀과 `sam_skills.csv`가 읽기 전용이라 열 언어 전부 「1」로 남았고, 화면은
 * 「SP 값을 1 내린다」라고 말하면서 실제로는 4를 깎았다. UI 스모크가 잡았고
 * `extract_data.py`의 `SKILL_TEXT_FIXES`가 정정한다.
 *
 * 여기서는 **숫자가 문장에 실제로 들어 있는가**만 본다 — 서술을 파싱해 효과를
 * 재구성하려 들면 열 언어의 문장 구조를 다 알아야 해서 그게 더 쉽게 깨진다.
 */
test('SP를 깎는 고유기술은 그 숫자가 설명 문장에도 있다 — 열 언어 모두', () => {
  for (const skill of UNIQUE_SKILLS) {
    const sp = (skill.effects as { t?: string; delta?: number }[])
      .find((e) => e.t === 'modifySp');
    if (!sp?.delta) continue;
    const n = String(Math.abs(sp.delta));
    const texts = [skill.text, ...Object.values(skill.textI18n ?? {})];
    for (const text of texts) {
      assert.ok(text.includes(n),
        `${skill.name}: 효과는 SP ${sp.delta}인데 설명에 「${n}」이 없다 — "${text}"`);
    }
  }
});

// ── 대장간 장비 (2026-09-07) ───────────────────────────────────
//
// 추출기가 이미 같은 것을 보지만, 여기서 **다시 센다**. 엑셀 없이도 빌드가
// 되어야 해서 생성물이 커밋 대상이고, 그래서 생성물만 손으로 고쳐 놓고
// 추출을 안 돌리는 일이 실제로 가능하다.

test('대장간 장비 15종, id 중복 없음, 번호가 1부터 연속', () => {
  assert.equal(EQUIPMENT.length, 15);
  assert.equal(equipmentById.size, 15);
  assert.deepEqual(EQUIPMENT.map((e) => e.no), [...Array(15)].map((_, i) => i + 1));
});

test('장비의 해금 레벨은 대장간 Lv1~maxLevel 안이다', () => {
  const forge = buildingById.get('forge')!;
  for (const e of EQUIPMENT) {
    assert.ok(e.unlockLevel >= 1 && e.unlockLevel <= forge.maxLevel,
      `${e.name}: Lv${e.unlockLevel}은 대장간 Lv1~${forge.maxLevel} 밖이다`);
  }
  // 대장간을 안 지었으면(0) 아무것도 안 판다 — 화면이 건물 레벨을 그대로 넘긴다
  assert.equal(equipmentForForge(0).length, 0);
  // 누적이다. 만렙이면 전부 열린다
  assert.equal(equipmentForForge(forge.maxLevel).length, EQUIPMENT.length);
  for (let lv = 1; lv <= forge.maxLevel; lv += 1) {
    assert.ok(equipmentForForge(lv).length >= equipmentForForge(lv - 1).length);
  }
});

test('같은 (종류, 해금 레벨)이면 효과도 가격도 같다', () => {
  const seen = new Map<string, { effect: string; gold: number; name: string }>();
  for (const e of EQUIPMENT) {
    const key = `${e.kind}-${e.unlockLevel}`;
    const effect = JSON.stringify(e.effect);
    const first = seen.get(key);
    if (!first) { seen.set(key, { effect, gold: e.gold, name: e.name }); continue; }
    assert.equal(effect, first.effect, `${e.name} ≠ ${first.name}: 같은 티어인데 효과가 다르다`);
    assert.equal(e.gold, first.gold, `${e.name} ≠ ${first.name}: 같은 티어인데 가격이 다르다`);
  }
});

test('방어구는 베리어만, 무기는 베리어를 안 준다', () => {
  for (const e of EQUIPMENT) {
    const { barrier, ...offence } = e.effect;
    if (e.kind === 'armor') {
      assert.ok((barrier ?? 0) > 0, `${e.name}: 방어구인데 베리어가 없다`);
      assert.deepEqual(offence, {}, `${e.name}: 방어구인데 공격 효과가 있다`);
    } else {
      assert.equal(barrier, undefined, `${e.name}: 무기인데 베리어가 있다`);
      assert.ok(Object.values(offence).some((v) => v > 0), `${e.name}: 무기인데 효과가 없다`);
    }
  }
});

/*
 * **비싼 티어가 반드시 세다** (2026-09-07 밸런스 검토가 두 번 잡은 역전).
 *
 * 「크리티컬 데미지 +1」이 「크리티컬 확률 +10%p」보다 약한 구간이 있었고,
 * 「받는 데미지 −1」이 「최대 HP +50%」보다 약한 구간이 있었다 — 둘 다 상위
 * 티어가 하위 티어와 **다른 종류**의 효과라서 상성이 갈렸기 때문이다. 지금 안은
 * 상위가 하위를 포함하도록 짜여 있고, 그 포함 관계를 여기서 고정한다.
 *
 * ★ **키 하나씩 비교하면 안 된다.** Lv5(평타 +1)에는 Lv4의 `criticalDamage`가
 * 없는데, 크리티컬이 평타의 2배라 **평타 +1이 크리티컬 +2가 되어 그것을
 * 삼킨다.** 키로 재면 「Lv5가 Lv4보다 약하다」는 거짓 경보가 뜬다 — 실제로
 * 처음 이 검사를 그렇게 적었다가 걸렸다. 그래서 **기대 데미지로 잰다.**
 */
test('무기는 상위 티어가 어떤 AT·크리율에서도 더 세다', () => {
  const byLevel = new Map<number, EquipmentEffect>();
  for (const e of EQUIPMENT) if (e.kind === 'weapon') byLevel.set(e.unlockLevel, e.effect);

  /** 장비를 낀 1회 공격의 기대 데미지 */
  const expected = (at: number, rate: number, fx: EquipmentEffect): number => {
    const p = Math.min(100, rate + (fx.criticalRate ?? 0)) / 100;
    const normal = FORMULA.damage(at + (fx.attack ?? 0), false, false, false);
    const crit = FORMULA.damage(at + (fx.attack ?? 0), true, false, false) + (fx.criticalDamage ?? 0);
    return normal * (1 - p) + crit * p;
  };

  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const at of [2, 2.5, 3, 3.5, 4, 5, 6]) {
    for (const rate of [0, 20, 50, 80, 100]) {
      const bare = expected(at, rate, {});
      let prev = bare;
      for (const lv of levels) {
        const now = expected(at, rate, byLevel.get(lv)!);
        assert.ok(now >= prev,
          `AT ${at}·크리율 ${rate}%: 무기 Lv${lv}(${now.toFixed(2)})가 `
          + `Lv${lv - 1}(${prev.toFixed(2)})보다 약하다`);
        prev = now;
      }
      assert.ok(prev > bare, `AT ${at}·크리율 ${rate}%: 최상위 무기가 맨손과 같다`);
    }
  }
});

test('방어구는 베리어가 티어마다 늘고, 가격은 무기·방어구 각각 단조 증가', () => {
  for (const kind of ['weapon', 'armor'] as const) {
    const tiers = [...new Set(EQUIPMENT.filter((e) => e.kind === kind).map((e) => e.unlockLevel))]
      .sort((a, b) => a - b);
    const goldAt = (lv: number) => EQUIPMENT.find((e) => e.kind === kind && e.unlockLevel === lv)!.gold;
    for (let i = 1; i < tiers.length; i += 1) {
      assert.ok(goldAt(tiers[i]!) > goldAt(tiers[i - 1]!),
        `${kind} Lv${tiers[i]}의 가격이 Lv${tiers[i - 1]}보다 안 비싸다`);
    }
  }
  const barriers = EQUIPMENT.filter((e) => e.kind === 'armor')
    .sort((a, b) => a.unlockLevel - b.unlockLevel)
    .map((e) => e.effect.barrier ?? 0);
  assert.deepEqual(barriers, [3, 6, 9, 12]);
});

/*
 * **베리어는 데미지를 깎지 않는다** — 「받는 데미지 −N」안이 남긴 구멍의 회귀.
 *
 * AT 2(레벨 1의 기본값이고 지력형은 만렙에도 흔하다)의 평타가 2라, −2를 주면
 * 데미지가 **0**이 되어 영원히 못 죽인다. 베리어는 데미지를 건드리지 않는
 * **HP 풀**이라 그 경계가 아예 없다 — 그래서 「최소 데미지 1」 같은 하한도
 * 필요 없다. 여기서는 **어떤 장비도 데미지를 깎지 않는다**를 고정한다.
 *
 * (감쇠 둘이 겹치면 — 「반감」 걸린 대상을 「공포」 걸린 AT 2가 치면 — 평타는
 * 지금도 0이다. 그것은 장비와 무관한 엔진의 기존 성질이라 여기서 안 본다.)
 */
test('장비는 데미지를 깎지 않는다 — 감산 효과가 하나도 없다', () => {
  for (const e of EQUIPMENT) {
    for (const [key, value] of Object.entries(e.effect)) {
      assert.ok(value > 0, `${e.name}: ${key}가 ${value}다 — 장비 효과는 더하기만 한다`);
    }
  }
  // 장비를 껴도 평타 계산에 들어가는 것은 AT뿐이다 (감쇠가 없으면 언제나 1 이상)
  for (const at of [2, 2.5, 3, 4, 6]) {
    for (const e of EQUIPMENT) {
      const normal = FORMULA.damage(at + (e.effect.attack ?? 0), false, false, false);
      assert.ok(normal >= 1, `${e.name}: AT ${at}에서 평타가 ${normal}이다`);
    }
  }
});
