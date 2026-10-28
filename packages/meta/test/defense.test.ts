/**
 * 방어 기록 읽기 (2026-10-28, `defense.ts` · GDD §8.8 단계 5) — 결말 · 막은 판 · 승률.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defenseHeld, defenseRate, defenseResultOf } from '../src/index.ts';

describe('방어 기록', () => {
  it('결말은 방어자(북군)에게서 본다 — 이탈은 따로 적되 막은 판이다', () => {
    assert.equal(defenseResultOf('P2', 'settled'), 'held');
    assert.equal(defenseResultOf('P1', 'settled'), 'fell');
    assert.equal(defenseResultOf(null, 'settled'), 'draw');
    assert.equal(defenseResultOf('P2', 'abandoned'), 'abandoned');
    assert.deepEqual((['held', 'fell', 'draw', 'abandoned'] as const).filter(defenseHeld), ['held', 'abandoned']);
  });

  it('승률 — 판이 없으면 null(「—」), 있으면 막은 판 / 전부', () => {
    assert.equal(defenseRate({ total: 0, held: 0 }), null);
    assert.equal(defenseRate({ total: 4, held: 3 }), 0.75);
  });
});
