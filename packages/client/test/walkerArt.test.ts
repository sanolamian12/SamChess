/**
 * 장수 레벨업 카드 실루엣 회귀 — 표(`screens/market/walkerArt.ts`)는 꼬마 그림을 눈으로 보고 적은 것이라
 * 「누가 무슨 무기인가」는 여기서 못 지킨다. 지키는 것은 **표가 실제 장수를 가리키는가 · 한 장수가 두 묶음에 들지 않았는가**다 —
 * 철자가 틀린 id는 오류 없이 「그 밖」(3)으로 떨어져 「그 장수만 실루엣이 안 맞는다」로만 보인다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { combatantById } from '@samchess/data';

import { WALKER_BY_WEAPON, walkerArtOf } from '../src/screens/market/walkerArt.ts';
import { artKey } from '../src/ui/art.ts';

test('표의 열쇠는 전부 실제 그림 열쇠다', () => {
  const keys = new Set([...combatantById.values()].map((o) => artKey(o.id)));
  for (const k of WALKER_BY_WEAPON.keys()) assert.ok(keys.has(k), `없는 그림 열쇠: ${k}`);
});

test('기획자가 짚은 꼴 — 부채 2 · 칼 4 · 활 5 · 창 1 · 그 밖 3', () => {
  assert.equal(walkerArtOf('je-gal-ryang'), 2);   // 부채
  assert.equal(walkerArtOf('jo-jo'), 4);          // 칼
  assert.equal(walkerArtOf('ha-hu-yeon'), 5);     // 활
  assert.equal(walkerArtOf('gwan-u'), 1);         // 언월도(긴 자루)
  assert.equal(walkerArtOf('beop-jeong'), 3);     // 두루마리
  assert.equal(walkerArtOf('gam-nyeong'), 3);     // 유성추
});
