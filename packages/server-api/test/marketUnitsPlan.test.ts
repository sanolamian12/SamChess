/**
 * 시장 아이템 낱개 추적표의 계획(`planUnits`) — 산 것 · 쓴 것 · 낸 금화를 낱개로 맞춘다 (2026-11-12).
 *
 * 고정하는 것: 구매는 금화를 차례로 빼며 적고 값이 안 맞으면 `gold`, 구매 · 지급이 아닌 길로 늘면 `noSource`,
 * 판에 나간 것은 **그 장수가 들던 낱개**, 판이 무르면 보유로 되돌아오고 끝나면 사용으로 굳는다, 가진 것 없이 나가면 `phantom`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marketItemById } from '@samchess/data';
import type { PlayerProfile } from '@samchess/meta';
import { planUnits } from '../src/marketUnitsPlan.ts';
import type { LiveUnit, Plan, PlanContext } from '../src/marketUnitsPlan.ts';

const TANG = 'tang-yak';
const PRICE = marketItemById.get(TANG)!.gold;
const prof = (m: object): PlayerProfile => m as PlayerProfile;
const ctx = (source: string, goldBefore = 1000, goldAfter = goldBefore): PlanContext => ({ source, goldBefore, goldAfter });

/** 계획을 살아 있는 낱개에 적용한다 — DB가 하는 일의 흉내 */
function applyPlan(live: LiveUnit[], plan: Plan): LiveUnit[] {
  const out = live.map((u) => ({ ...u }));
  for (const c of plan.creates) out.push({ unit: c.unit, item: c.item, seq: c.seq, status: c.status, holder: c.holder, usedBy: c.usedBy, usedBattle: c.usedBattle });
  for (const ch of plan.changes) {
    const u = out.find((x) => x.unit === ch.unit)!;
    if (ch.kind === 'hand') u.holder = ch.holder;
    else if (ch.kind === 'play') Object.assign(u, { status: 'inPlay', usedBy: ch.usedBy, usedBattle: ch.usedBattle });
    else if (ch.kind === 'back') Object.assign(u, { status: 'held', usedBy: null, usedBattle: null, holder: null });
    else out.splice(out.indexOf(u), 1);
  }
  return out;
}

describe('추적표 계획 — 구매와 금화', () => {
  it('장바구니 둘 — 새 낱개 둘, 금화를 차례로 뺀다', () => {
    const plan = planUnits([], prof({ marketOwned: { [TANG]: 2 } }), new Map(), ctx('POST /market/items', 1000, 1000 - 2 * PRICE));
    assert.deepEqual(plan.creates.map((c) => [c.unit, c.origin, c.goldBefore, c.goldAfter, c.price]), [
      [`${TANG}#1`, 'buy', 1000, 1000 - PRICE, PRICE],
      [`${TANG}#2`, 'buy', 1000 - PRICE, 1000 - 2 * PRICE, PRICE],
    ]);
    assert.deepEqual(plan.flags, []);
  });

  it('★ 금화가 값만큼 안 줄었다 — gold', () => {
    const plan = planUnits([], prof({ marketOwned: { [TANG]: 1 } }), new Map(), ctx('POST /market/item', 1000, 1000));
    assert.equal(plan.creates[0]!.flag, 'gold');
    assert.equal(plan.flags[0]?.flag, 'gold');
  });

  it('★ 구매 · 지급이 아닌 길로 늘었다 — noSource, 관리자 지급 · 우편은 아니다', () => {
    const odd = planUnits([], prof({ marketOwned: { [TANG]: 1 } }), new Map(), ctx('PUT /profile'));
    assert.equal(odd.flags[0]?.flag, 'noSource');
    assert.equal(odd.creates[0]!.origin, 'other');
    for (const r of ['POST /admin/users/:uid/adjust', 'POST /mail/:id/claim']) {
      assert.deepEqual(planUnits([], prof({ marketOwned: { [TANG]: 1 } }), new Map(), ctx(r)).flags, [], r);
    }
  });

  it('번호는 끝난 낱개 뒤로 이어 간다 — 다시 안 쓴다', () => {
    const plan = planUnits([], prof({ marketOwned: { [TANG]: 1 } }), new Map([[TANG, 7]]), ctx('POST /market/item', 100, 100 - PRICE));
    assert.equal(plan.creates[0]!.unit, `${TANG}#7`);
  });

  it('처음 본 것(baseline)은 계정의 구매 시각을 오래된 것부터 붙이고 징후가 아니다', () => {
    const plan = planUnits([], prof({ marketOwned: { [TANG]: 2 }, marketBoughtAt: { [TANG]: [20, 10] } }), new Map(), ctx('baseline'));
    assert.deepEqual(plan.creates.map((c) => c.boughtAt), [10, 20]);
    assert.deepEqual(plan.flags, []);
  });
});

describe('추적표 계획 — 양도 · 사용 · 환불', () => {
  const start = (): LiveUnit[] => applyPlan([], planUnits([], prof({ marketOwned: { [TANG]: 2 } }), new Map(), ctx('POST /market/items', 1000, 1000 - 2 * PRICE)));

  it('들려 보내면 아무도 안 든 오래된 낱개에 보유자 · 양도일, 내려놓으면 보유자가 빈다', () => {
    let live = start();
    const plan = planUnits(live, prof({ marketOwned: { [TANG]: 2 }, marketCarry: { 'gwan-u': TANG } as PlayerProfile['marketCarry'] }), new Map(), ctx('PUT /profile'));
    assert.deepEqual(plan.changes, [{ unit: `${TANG}#1`, kind: 'hand', holder: 'gwan-u' }]);
    live = applyPlan(live, plan);
    const off = planUnits(live, prof({ marketOwned: { [TANG]: 2 } }), new Map(), ctx('PUT /profile'));
    assert.deepEqual(off.changes, [{ unit: `${TANG}#1`, kind: 'hand', holder: null }]);
  });

  it('★ 판에 나간 것은 그 장수가 들던 낱개다 — 끝나면 사용으로 굳고, 무르면 돌아온다', () => {
    let live = start();
    // 장비가 #2를 든다(관우가 #1)
    live = applyPlan(live, planUnits(live, prof({ marketOwned: { [TANG]: 2 }, marketCarry: { 'gwan-u': TANG, 'jang-bi': TANG } as PlayerProfile['marketCarry'] }), new Map(), ctx('PUT /profile')));
    const jangBi = live.find((u) => u.holder === 'jang-bi')!.unit;
    // 장비만 판에 나간다 — 계정: 보유 1 · 판에 1 · 관우만 든다
    const playing = prof({ marketOwned: { [TANG]: 1 }, marketCarry: { 'gwan-u': TANG } as PlayerProfile['marketCarry'], marketInPlay: [{ officer: 'jang-bi', item: TANG, battle: 'ai' }] as PlayerProfile['marketInPlay'] });
    const play = planUnits(live, playing, new Map(), ctx('POST /battle/ai-start'));
    assert.deepEqual(play.changes, [{ unit: jangBi, kind: 'play', usedBy: 'jang-bi', usedBattle: 'ai' }]);
    live = applyPlan(live, play);
    // 끝났다 — 판 목록이 비고 보유는 그대로
    const done = planUnits(live, prof({ marketOwned: { [TANG]: 1 }, marketCarry: { 'gwan-u': TANG } as PlayerProfile['marketCarry'] }), new Map(), ctx('POST /battle/ai-result'));
    assert.deepEqual(done.changes, [{ unit: jangBi, kind: 'used' }]);
    // 대신 무르면 — 보유가 2로 돌아온다
    const back = planUnits(live, prof({ marketOwned: { [TANG]: 2 }, marketCarry: { 'gwan-u': TANG } as PlayerProfile['marketCarry'] }), new Map(), ctx('POST /internal/grain'));
    assert.deepEqual(back.changes, [{ unit: jangBi, kind: 'back' }]);
    assert.deepEqual(back.creates, [], '돌아온 것은 새 낱개가 아니다');
    assert.deepEqual(back.flags, []);
  });

  it('★ 가진 것 없이 판에 나갔다 — 낱개 없이 사용(phantom)', () => {
    const plan = planUnits([], prof({ marketInPlay: [{ officer: 'gwan-u', item: TANG, battle: 'online' }] as PlayerProfile['marketInPlay'] }), new Map(), ctx('POST /internal/grain'));
    assert.equal(plan.creates[0]!.origin, 'none');
    assert.equal(plan.creates[0]!.status, 'inPlay');
    assert.equal(plan.flags[0]?.flag, 'phantom');
  });

  it('줄면(컬렉션 등록 · 회수) 아무도 안 든 오래된 것부터 빠진다', () => {
    let live = start();
    live = applyPlan(live, planUnits(live, prof({ marketOwned: { [TANG]: 2 }, marketCarry: { 'gwan-u': TANG } as PlayerProfile['marketCarry'] }), new Map(), ctx('PUT /profile')));
    const plan = planUnits(live, prof({ marketOwned: { [TANG]: 1 }, marketCarry: { 'gwan-u': TANG } as PlayerProfile['marketCarry'] }), new Map(), ctx('POST /collection/register'));
    assert.deepEqual(plan.changes, [{ unit: `${TANG}#2`, kind: 'removed' }], '관우가 든 #1은 남는다');
  });
});
