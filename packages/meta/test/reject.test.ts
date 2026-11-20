/**
 * 규칙의 거절이 **코드째로** 서버까지 가는가 (2026-11-20).
 *
 * `apply*`가 `throw new Error(check.reason)`으로 던지던 때는 코드가 사라져, 서버가 돌려준 거절이
 * 번역 문구가 있어도 열 언어 전부에서 한국어로 떴다. 던지는 쪽(`rejectWith`)과 받는 쪽(`rejection`)을 함께 본다.
 */
import { strict as assert } from 'node:assert';
import { it } from 'node:test';
import { officerByName } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { RuleRejected, applyLevelUp, applyRenameCity, rejection, starterProfile } from '../src/index.ts';

const GWAN = officerByName.get('관우')!.id as OfficerId;

it('apply*의 거절은 코드 · 값을 싣고, rejection()이 그대로 꺼낸다', () => {
  const p = starterProfile('검사성');
  let caught: unknown;
  try { applyLevelUp({ ...p, roster: {} }, GWAN, 'hp', 'support'); } catch (e) { caught = e; }
  assert.ok(caught instanceof RuleRejected);
  assert.deepEqual(rejection(caught), { reason: '거느리지 않으신 장수입니다', code: 'officer.notOwned' });

  // 앞에 한국어를 덧붙이던 자리(「도시 이름을 바꿀 수 없다: …」)도 이제 판정의 문장 · 코드 그대로다
  try { applyRenameCity({ ...p, gold: 0 }, '새이름성', 0); } catch (e) { caught = e; }
  const r = rejection(caught);
  assert.equal(r.code, 'market.notEnoughGold');
  assert.deepEqual(r.params, { have: 0, need: (r.params as { need: number }).need });
});

it('규칙의 거절이 아닌 오류는 문장만 — 코드를 지어내지 않는다', () => {
  assert.deepEqual(rejection(new Error('없는 장수입니다')), { reason: '없는 장수입니다' });
  assert.deepEqual(rejection('?', 'invalid action'), { reason: 'invalid action' });
});
