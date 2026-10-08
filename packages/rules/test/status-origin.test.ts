/**
 * 상태 · 조종의 출처 표시(`origin`) — 화면이 링 색을 「고유기술이 건 것인가」로 가른다 (2026-10-08).
 *
 * 같은 상태가 책략과 고유기술 양쪽에서 오므로(크리티컬 · 반감 · 지속 피해 · 조종) 상태 이름으로는 못 가른다.
 * 엔진이 거는 순간 이유(`skill:{id}` · `tactic:{id}` · `item:{id}`)를 보고 남긴다. 판정은 이 값을 읽지 않는다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyEffects } from '../src/effects.ts';
import type { BattleEvent, Effect } from '../src/types.ts';
import { U, battle } from './fixtures.ts';

const crit: Effect = { t: 'applyStatus', target: { kind: 'self' }, status: 'critical100', duration: 190 };
const control: Effect = { t: 'controlEnemy', target: { kind: 'enemyOne' }, mode: 'moveOnly', uses: 1 };

test('고유기술이 건 상태 · 조종에는 origin이 남고, 책략 · 아이템발은 비어 있다', () => {
  for (const [reason, want] of [['skill:x', 'skill'], ['tactic:x', undefined], ['item:x', undefined]] as const) {
    const s = battle(1);
    const caster = s.units[U('P1-King')]!;
    const enemy = s.units[U('P2-King')]!;
    const events: BattleEvent[] = [];
    applyEffects(s, { caster }, [crit], reason, events);
    applyEffects(s, { caster, targetUnit: enemy }, [control], reason, events);
    assert.equal(caster.statuses.find((x) => x.status === 'critical100')?.origin, want, `상태 — ${reason}`);
    assert.equal(enemy.control?.origin, want, `조종 — ${reason}`);
    // 비어 있을 때는 키조차 없다 — 전선 스냅샷을 늘리지 않는다
    if (want === undefined) assert.equal('origin' in caster.statuses[0]!, false);
  }
});
