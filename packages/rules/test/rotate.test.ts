/**
 * 판은 180° 대칭이다 (2026-11-18 기획자 — 사람은 언제나 남군 기준으로 둔다)
 *
 * 북군으로 앉은 사람의 화면은 판을 돌려 그리고, 공격대의 북군 배치는 남군 배치를 돌려 낸다(`rotate180`).
 * 그것이 「같은 게임 경험」이려면 **규칙 자체가 회전에 대칭**이어야 한다 — 앞뒤가 있는 기물이나 한쪽으로 치우친
 * 배치 구역 · 군량고를 들이면 북군만 다른 판을 두게 된다. 여기서 깨지면 그 전제를 다시 본다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PIECES } from '@samchess/data';
import { defaultDeployPos, deployZone, orientDeploy, rotate180, supplyDepotOf } from '../src/state.ts';
import { battle } from './fixtures.ts';
import type { UnitId } from '../src/types.ts';

test('기물 마스크는 180° 회전에 대칭이다', () => {
  for (const p of PIECES) {
    for (const mask of [p.moveMask, p.attackMask]) {
      const cells = new Set(mask.map((c) => `${c.x},${c.y}`));
      for (const c of mask) assert.ok(cells.has(`${-c.x},${-c.y}`), `${p.type} (${c.x},${c.y})의 맞은편이 없다`);
    }
  }
});

test('배치 구역 · 기본 배치 · 군량고는 남군과 북군이 180° 맞물린다', () => {
  for (const mode of ['3v3', '5v5'] as const) {
    const p1 = deployZone(mode, 'P1');
    const p2 = deployZone(mode, 'P2');
    const a = rotate180({ x: p1.x0, y: p1.y0 });
    const b = rotate180({ x: p1.x1, y: p1.y1 });
    assert.deepEqual({ x0: b.x, x1: a.x, y0: b.y, y1: a.y }, p2, mode);
    const n = mode === '3v3' ? 3 : 5;
    for (let i = 0; i < n; i += 1) {
      assert.deepEqual(rotate180(defaultDeployPos(mode, 'P1', i)), defaultDeployPos(mode, 'P2', n - 1 - i), `${mode} ${i}`);
    }
  }
  const s = battle();
  assert.deepEqual(rotate180(supplyDepotOf(s, 'P1')!), supplyDepotOf(s, 'P2'));
});

test('orientDeploy — 남군 배치를 북군으로 돌리고, 이미 그 진영 것이면 그대로', () => {
  const south = [{ unit: 'P1-King' as UnitId, pos: { x: 12, y: 17 } }, { unit: 'P1-Rock' as UnitId, pos: { x: 7, y: 18 } }];
  assert.deepEqual(orientDeploy(south, 'P2'), [
    { unit: 'P2-King', pos: { x: 12, y: 2 } }, { unit: 'P2-Rock', pos: { x: 17, y: 1 } },
  ]);
  assert.deepEqual(orientDeploy(south, 'P1'), south);
});
