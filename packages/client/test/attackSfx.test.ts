/**
 * 평타 효과음 회귀 — 표(`audio/attackSfx.ts`)는 그림을 눈으로 보고 적은 것이라
 * 「누가 무슨 무기인가」는 여기서 못 지킨다. 지키는 것은 **표가 실제 장수를 가리키는가**다 —
 * 철자가 틀린 id는 오류 없이 `battle_attack`으로 떨어져 「그 장수만 소리가 안 바뀐다」로만 보인다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { combatantById } from '@samchess/data';

import { ATTACK_WEAPON, attackSfxFor } from '../src/audio/attackSfx.ts';
import { artKey } from '../src/ui/art.ts';

const COMBATANTS = [...combatantById.values()];

test('표의 열쇠는 전부 실제 그림 열쇠다', () => {
  const keys = new Set(COMBATANTS.map((o) => artKey(o.id)));
  for (const k of ATTACK_WEAPON.keys()) assert.ok(keys.has(k), `없는 그림 열쇠: ${k}`);
});

test('기획자가 이름으로 짚은 자리', () => {
  assert.equal(attackSfxFor('gam-nyeong'), 'attack_chain');
  assert.equal(attackSfxFor('ha-hu-yeon'), 'attack_arrow');
  assert.equal(attackSfxFor('gwan-u'), 'attack_sword');
  assert.equal(attackSfxFor('je-gal-ryang'), 'attack_fist'); // 부채
});

test('표에 없는 무기는 예전 소리 그대로', () => {
  assert.equal(attackSfxFor('chae-hun'), 'battle_attack'); // 채찍
  assert.equal(attackSfxFor('beop-jeong'), 'battle_attack'); // 두루마리
});

test('도적은 그림 한 벌(bandit)을 함께 써서 소리도 같다', () => {
  const bandits = COMBATANTS.filter((o) => artKey(o.id) === 'bandit');
  assert.ok(bandits.length > 0);
  for (const b of bandits) assert.equal(attackSfxFor(b.id), 'attack_sword');
});
