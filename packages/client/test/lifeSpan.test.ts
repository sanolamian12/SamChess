/**
 * 장수의 생몰년(`lifeSpanText`) — 펼친 열전 판의 제목 옆 (2026-11-28 기획자)
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { OFFICERS } from '@samchess/data';
import { lifeSpanText } from '../src/screens/lifeSpan.ts';

test('생몰년 — 둘 다 · 한쪽만 · 모름', () => {
  assert.equal(lifeSpanText({ born: 155, died: 220 }, 'Unknown'), '(155 ~ 220 AD)');
  assert.equal(lifeSpanText({ born: null, died: 220 }, 'Unknown'), '(? ~ 220 AD)');
  assert.equal(lifeSpanText({ born: 181, died: null }, 'Unknown'), '(181 ~ ? AD)');
  assert.equal(lifeSpanText({ born: null, died: null }, '不詳'), '(不詳)');
  assert.equal(lifeSpanText(undefined, 'Unknown'), '(Unknown)');
});

test('생몰년 — 260명 모두 칸이 있고, 해는 후한 · 삼국 시대 안이며 태어난 해가 죽은 해보다 앞이다', () => {
  assert.equal(OFFICERS.length, 260);
  for (const o of OFFICERS) {
    assert.ok(o.life, `${o.id}: 생몰년 칸이 없다`);
    const { born, died } = o.life;
    for (const y of [born, died]) {
      if (y !== null) assert.ok(Number.isInteger(y) && y >= 100 && y <= 320, `${o.id}: ${y}`);
    }
    if (born !== null && died !== null) assert.ok(born < died, `${o.id}: ${born} ~ ${died}`);
  }
});
