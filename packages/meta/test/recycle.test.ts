/**
 * 카드 정리(리사이클) 회귀 — GDD §6.3 (2026-09-14 기획자 확정)
 *
 * 여기서 고정하는 것.
 *  - **같은 등급 3장 → 보유한 장수 중 고른 1명의 카드 1장** — 값은 economy.json에서 온다
 *  - **보유한 장수만 받는다** — 없는 S·A를 받으면 증축의 S·A 조건(§5.1)이 가챠 없이 풀린다
 *  - **마지막 1장은 남긴다** — 보관함 장수는 카드 1장이 곧 보유다
 *  - **입력 프로필을 건드리지 않는다** (룰 엔진의 apply와 같은 규약)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ECONOMY, OFFICERS } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  RECYCLE_CARDS_IN, RECYCLE_CARDS_OUT, RECYCLE_MIN_HELD, applyRecycle, boxedOfficers, canRecycle,
  createProfile, newInstance, ownedOfficers, recyclableCards, recycleMaterials, recycleOutput,
  recycleTargets,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const ofGrade = (grade: string, n: number, skip = 0): OfficerId[] =>
  OFFICERS.filter((o) => o.grade === grade).slice(skip, skip + n).map((o) => o.id as OfficerId);

const [C0, C1, C2, C3] = ofGrade('C', 4);
const [D0] = ofGrade('D', 1);

/** C급 넷과 D급 하나를 풀에 두고 카드를 나눠 준 계정 */
function base(): PlayerProfile {
  const p = createProfile('정리성', 3);
  return {
    ...p,
    roster: {
      [C0!]: newInstance(C0!), [C1!]: newInstance(C1!), [C2!]: newInstance(C2!), [C3!]: newInstance(C3!),
      [D0!]: newInstance(D0!),
    },
    cards: { [C1!]: 3, [C2!]: 2, [C3!]: 1, [D0!]: 4 },
  };
}

const why = (r: { ok: boolean; reason?: string }): string => (r.ok ? '' : r.reason ?? '');

describe('카드 정리 — 같은 등급 3장 → 고른 장수 1장 (GDD §6.3)', () => {
  it('값은 economy.json이 정한다 — 3장 → 1장, 2장 이상일 때만 재료', () => {
    assert.equal(RECYCLE_CARDS_IN, ECONOMY.recycle.cardsIn);
    assert.equal(RECYCLE_CARDS_OUT, ECONOMY.recycle.cardsOut);
    assert.equal(RECYCLE_MIN_HELD, ECONOMY.recycle.minHeld);
    assert.deepEqual([RECYCLE_CARDS_IN, RECYCLE_CARDS_OUT, RECYCLE_MIN_HELD], [3, 1, 2], '2026-09-14 기획자 확정');
  });

  it('재료로 쓸 수 있는 수 — 2장 이상일 때만, 1장은 남는다', () => {
    const p = base();
    assert.equal(recyclableCards(p, C1!), 2, '3장이면 2장');
    assert.equal(recyclableCards(p, C2!), 1, '2장이면 1장');
    assert.equal(recyclableCards(p, C3!), 0, '1장이면 못 쓴다');
    assert.equal(recyclableCards(p, C0!), 0, '카드가 없으면 못 쓴다');
  });

  it('고른 장수가 카드를 받고 재료가 줄어든다 — 입력 프로필은 그대로다 ★', () => {
    const p = base();
    const before = JSON.stringify(p);
    const next = applyRecycle(p, C0!, { [C1!]: 2, [C2!]: 1 });
    assert.equal(next.cards[C0!], 1, '받은 장수에 한 장');
    assert.equal(next.cards[C1!], 1);
    assert.equal(next.cards[C2!], 1);
    assert.equal(next.cards[C3!], 1, '안 쓴 장수는 그대로');
    assert.equal(next.cards[D0!], 4, '다른 등급은 그대로');
    assert.equal(JSON.stringify(p), before, '입력을 건드리지 않는다');
  });

  it('여섯 장이면 두 장 — 단위의 배수만 받는다', () => {
    const p = { ...base(), cards: { [C1!]: 4, [C2!]: 4 } };
    assert.equal(recycleOutput({ [C1!]: 3, [C2!]: 3 }), 2);
    assert.equal(applyRecycle(p, C0!, { [C1!]: 3, [C2!]: 3 }).cards[C0!], 2);
    assert.match(why(canRecycle(p, C0!, { [C1!]: 2 })), /3장 단위/);
    assert.match(why(canRecycle(p, C0!, {})), /고르지 않았다/);
  });

  it('마지막 1장은 재료로 못 쓴다 — 그만큼만 고를 수 있다고 말한다', () => {
    assert.match(why(canRecycle(base(), C0!, { [C1!]: 3 })), /2장까지/);
  });

  it('다른 등급의 카드는 재료가 안 된다', () => {
    const p = base();
    assert.match(why(canRecycle(p, C0!, { [D0!]: 3 })), /C급 카드만/);
    assert.equal(recycleMaterials(p, 'C', C0!).some((m) => m.officer === D0), false);
  });

  it('보유하지 않은 장수는 받지 못한다 — S·A 조건을 가챠 없이 풀지 못하게 ★', () => {
    const p = base();
    const [notMine] = ofGrade('C', 1, 10);
    assert.equal(ownedOfficers(p).includes(notMine!), false);
    assert.match(why(canRecycle(p, notMine!, { [C1!]: 2, [C2!]: 1 })), /보유한 장수/);
    assert.equal(recycleTargets(p, 'C').includes(notMine!), false);
  });

  it('받을 장수의 카드는 재료로 못 쓴다 — 목록에서도 빠진다', () => {
    const p = base();
    assert.match(why(canRecycle(p, C1!, { [C1!]: 2, [C2!]: 1 })), /받을 장수/);
    assert.equal(recycleMaterials(p, 'C', C1!).some((m) => m.officer === C1), false);
  });

  it('최대 레벨 장수는 받지 않는다 — 카드가 쓸모없다', () => {
    const p = base();
    const maxed = { ...p, roster: { ...p.roster, [C0!]: { ...newInstance(C0!), level: 9 } } };
    assert.equal(recycleTargets(maxed, 'C').includes(C0!), false);
    assert.match(why(canRecycle(maxed, C0!, { [C1!]: 2, [C2!]: 1 })), /최대 레벨/);
  });

  it('보관함 장수도 받을 수 있고, 재료로 써도 보관함에 남는다 ★', () => {
    const [boxed] = ofGrade('C', 1, 20);
    const p = { ...base(), cards: { ...base().cards, [boxed!]: 3 } };
    assert.ok(boxedOfficers(p).includes(boxed!), '풀에 없고 카드만 있다');
    assert.ok(recycleTargets(p, 'C').includes(boxed!), '보유이므로 받을 수 있다');

    const used = applyRecycle(p, C0!, { [boxed!]: 2, [C2!]: 1 });
    assert.equal(used.cards[boxed!], 1, '한 장은 남는다');
    assert.ok(boxedOfficers(used).includes(boxed!), '장수가 계정에서 사라지지 않는다');
  });
});
