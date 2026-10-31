/**
 * 수성전 연습 판 (`?demo=1&siege=1`, 2026-10-31) — 명단이 시드로 정해지고, 전투력이 맞고, 수성전 판에 기본 방침이 실리는가.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MATCH_BAND, battlePower } from '@samchess/meta';
import { autoBattle, supplyDepotOf } from '@samchess/rules';
import { createSiegeDemo, siegeDemoRosters } from '../src/battle/siegeDemo.ts';

const CASES = [['3v3', 1], ['5v5', 1], ['3v3', 2], ['5v5', 2]] as const;

test('수성전 연습 — 같은 시드면 같은 명단, 다른 시드면 다른 명단', () => {
  for (const [mode, level] of CASES) {
    assert.deepEqual(siegeDemoRosters(7, mode, level), siegeDemoRosters(7, mode, level));
    assert.notDeepEqual(siegeDemoRosters(7, mode, level), siegeDemoRosters(8, mode, level));
  }
});

test('수성전 연습 — 양쪽 전투력이 매칭 구간 안이고, 한 장수가 두 진영에 서지 않는다', () => {
  for (const [mode, level] of CASES) {
    for (let seed = 1; seed <= 60; seed++) {
      const r = siegeDemoRosters(seed, mode, level);
      const gap = Math.abs(battlePower(mode, r.P1) - battlePower(mode, r.P2));
      assert.ok(gap <= MATCH_BAND, `${mode} Lv${level} seed ${seed}: 차 ${gap} > ${MATCH_BAND}`);
      const P1 = new Set(r.P1.map((e) => e.officer));
      assert.ok(r.P2.every((e) => !P1.has(e.officer)));
      assert.equal(r.P1[0]!.piece, 'King');
      assert.equal(r.P2[0]!.piece, 'King');
    }
  }
});

test('수성전 연습 — Lv2는 능력 하나 · Lv2 책략 하나, 그래서 책략 방침 줄이 선다', () => {
  for (const mode of ['3v3', '5v5'] as const) {
    const lv1 = createSiegeDemo(3, mode, 1);
    const lv2 = createSiegeDemo(3, mode, 2);
    assert.ok(siegeDemoRosters(3, mode, 1).P1.every((e) => e.level === 1 && e.tactics.length === 0 && e.statPicks.length === 0));
    assert.ok(siegeDemoRosters(3, mode, 2).P2.every((e) => e.level === 2 && e.tactics.length === 1 && e.statPicks.length === 1));
    assert.equal(lv1.policy.tactics.length, 0, 'Lv1은 책략이 없다');
    assert.ok(lv2.policy.tactics.length > 0, 'Lv2는 증폭 · 공포 줄이 선다');
  }
});

test('수성전 연습 — 수성전 판(성채 · 북군 군량고 없음)에 기본 방침이 실리고, 배치부터 시작해 끝까지 간다', () => {
  for (const [mode, level] of CASES) {
    const demo = createSiegeDemo(5, mode, level);
    assert.equal(demo.state.scenario, 'siege');
    assert.equal(demo.state.phase, 'deploy');
    assert.deepEqual(demo.state.policy?.P2, demo.policy);
    assert.equal(demo.policy.stances.King, 'hold');
    assert.equal(supplyDepotOf(demo.state, 'P2'), null);
    assert.ok(autoBattle(demo.state).state.phase === 'finished');
  }
});
