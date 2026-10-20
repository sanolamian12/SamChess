/**
 * 판 도중 빠진 아이템은 **판마다 따로 센다** (2026-10-21, `market.ts`의 `marketInPlay[].battle`).
 *
 * AI 대전 · 도적떼 · 온라인은 겹칠 수 있다 — 도는 판 도중에 도적떼가 나타나 싸우고, 대기열은 AI 대전을 안 본다.
 * 계정에 한 통이던 때 깨지던 셋을 고정한다.
 *  - 한 판의 정산이 **다른 판의 줄을 안 지운다**(그 판의 청낭서 보호가 남는다)
 *  - 성립하지 않은 온라인 판의 환불이 **도적떼에 든 것까지 돌려주지 않는다**(복제)
 *  - 청낭서는 **든 판만** 지킨다
 * 그리고 판 표시가 없는 옛 줄의 되접기(도는 판으로 짐작 — 기획자 확정)와, 새 필드가 되접기를 지나 남는가.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId, PieceType } from '@samchess/rules';
import {
  applyBattleResult, carryItem, consumeCarried, createProfile, fallenAfterShield, initialBuildings, isInjured,
  marketHeldCount, matchAiBattle, migrateProfile, newInstance, RAID_ABANDON_MS, setGuards, settleAiBattleIntents, settleCarried,
  startAiBattle, startRaid, surrenderRaid, syncRaid,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 21, 3, 0, 0);
const MIN = 60_000;
const TANG = 'tang-yak';
const NANG = 'cheong-nang-seo';
const O = (id: string): OfficerId => id as OfficerId;
const P = (piece: PieceType, officer: string): RosterPick => ({ piece, officer: O(officer) });
const PICKS = [P('King', 'yu-bi'), P('Rock', 'gwan-u'), P('Pawn', 'jang-bi')];

function city(over: Partial<PlayerProfile> = {}): PlayerProfile {
  const base = createProfile('판별성', 7);
  const roster = { ...base.roster };
  for (const id of ['yu-bi', 'gwan-u', 'jang-bi', 'jo-un']) roster[O(id)] = newInstance(O(id));
  return {
    ...base, roster, grain: 40, grainAt: T0, gold: 100,
    buildings: { ...initialBuildings(), barracks: 5, farm: 3, market: 3 }, ...over,
  };
}

/** 도적떼에 조운이 탕약을, 온라인에 관우가 탕약을 들고 나갔다 */
function both(): PlayerProfile {
  let p = city({ marketOwned: { [TANG]: 3 } });
  p = consumeCarried(carryItem(p, O('jo-un'), TANG), [O('jo-un')], 'raid');
  p = consumeCarried(carryItem(p, O('gwan-u'), TANG), [O('gwan-u')], 'online');
  return p;
}

describe('판이 겹쳐도 서로의 줄을 안 건드린다', () => {
  it('★ 성립하지 않은 온라인 판은 온라인에 든 것만 돌려준다 — 도적떼의 것까지 돌려주면 복제다', () => {
    const p = both();
    assert.equal(marketHeldCount(p, TANG), 1);
    const back = settleCarried(p, false, 'online');
    assert.equal(marketHeldCount(back, TANG), 2, '하나만 돌아온다');
    assert.deepEqual(back.marketInPlay?.map((x) => [x.officer, x.battle]), [[O('jo-un'), 'raid']]);
  });

  it('★ 한 판을 정산해도 다른 판의 줄은 남는다', () => {
    const done = settleCarried(both(), true, 'raid');
    assert.deepEqual(done.marketInPlay?.map((x) => [x.officer, x.battle]), [[O('gwan-u'), 'online']]);
    assert.equal(settleCarried(done, true, 'online').marketInPlay, undefined, '마지막 판이면 키째로 없어진다');
  });

  it('그 판의 줄이 없으면 아무것도 안 바꾼다', () => {
    const p = both();
    assert.equal(settleCarried(p, false, 'ai'), p);
  });

  it('★ 같은 장수가 두 판에 서도 각자 적힌다', () => {
    let p = city({ marketOwned: { [TANG]: 2 } });
    p = consumeCarried(carryItem(p, O('gwan-u'), TANG), [O('gwan-u')], 'raid');
    p = consumeCarried(carryItem(p, O('gwan-u'), TANG), [O('gwan-u')], 'online');
    assert.deepEqual(p.marketInPlay?.map((x) => x.battle), ['raid', 'online']);
    assert.equal(marketHeldCount(settleCarried(p, false, 'online'), TANG), 1, '온라인 것 하나만 돌아온다');
  });
});

describe('청낭서는 든 판만 지킨다', () => {
  const shielded = (): PlayerProfile => {
    const p = city({ marketOwned: { [NANG]: 1 } });
    return consumeCarried(carryItem(p, O('gwan-u'), NANG), [O('gwan-u')], 'raid');
  };

  it('★ 도적떼에 든 청낭서는 온라인 판의 부상을 막지 않는다', () => {
    const p = shielded();
    assert.deepEqual(fallenAfterShield(p, 'raid', [O('gwan-u')]), [], '든 판은 지킨다');
    assert.deepEqual(fallenAfterShield(p, 'online', [O('gwan-u')]), [O('gwan-u')], '다른 판은 안 지킨다');
  });

  it('★ 다른 판의 정산 뒤에도 보호가 남는다 — 예전에는 기록 전체가 비워져 사라졌다', () => {
    let p = shielded();
    p = consumeCarried(carryItem({ ...p, marketOwned: { [TANG]: 1 } }, O('jang-bi'), TANG), [O('jang-bi')], 'online');
    const after = applyBattleResult(p, {
      result: 'lose', mode: '3v3', opponent: 'online', picks: PICKS,
      kills: {}, fallen: [O('jang-bi')], power: { mine: 1, theirs: 1 }, at: T0,
      opponentId: null, mySquad: null, theirSquad: null,
    }, 1).profile;
    const settled = settleCarried(after, true, 'online');
    assert.equal(isInjured(settled.roster[O('jang-bi')]!, T0), true, '온라인에서 쓰러진 장비는 다친다');
    assert.deepEqual(fallenAfterShield(settled, 'raid', [O('gwan-u')]), [], '도적떼의 청낭서는 그대로 남아 있다');
  });

  it('정산이 `outcome.opponent`로 제 판의 보호를 본다', () => {
    const p = shielded();
    const lose = (opponent: 'ai' | 'online') => applyBattleResult(p, {
      result: 'lose', mode: '3v3', opponent, picks: PICKS,
      kills: {}, fallen: [O('gwan-u')], power: { mine: 1, theirs: 1 }, at: T0,
      opponentId: null, mySquad: null, theirSquad: null,
    }, 1).profile;
    assert.equal(isInjured(lose('online').roster[O('gwan-u')]!, T0), true, '도적떼에 든 청낭서로는 온라인에서 안 지켜진다');
  });
});

describe('AI 대전의 정산은 AI의 줄만 가져간다', () => {
  it('★ AI 승패 정산 뒤에도 도적떼의 줄이 남는다', () => {
    let p = city({ marketOwned: { [TANG]: 2 } });
    p = consumeCarried(carryItem(p, O('jo-un'), TANG), [O('jo-un')], 'raid');
    p = carryItem(p, O('gwan-u'), TANG);
    const m = matchAiBattle(p, '3v3', PICKS, null, 4242);
    assert.ok(m.ok);
    const s = startAiBattle(m.ok ? m.profile : p, T0);
    assert.ok(s.ok, s.ok ? '' : s.reason);
    const started = s.ok ? s.profile : p;
    assert.deepEqual(started.marketInPlay?.map((x) => [x.officer, x.battle]), [[O('jo-un'), 'raid'], [O('gwan-u'), 'ai']]);

    const r = settleAiBattleIntents(started, [{ t: 'ready' }, { t: 'surrender' }], T0 + MIN);
    assert.ok(r.ok && !('draw' in r), r.ok ? '' : r.reason);
    const after = r.ok && !('draw' in r) ? r.profile : started;
    assert.deepEqual(after.marketInPlay?.map((x) => [x.officer, x.battle]), [[O('jo-un'), 'raid']]);
  });
});

describe('도적떼 항복은 셋 다 도적떼의 줄을 내려놓는다', () => {
  // 파수꾼 관우가 청낭서를, 온라인에 장비가 탕약을 들고 나갔다
  const fighting = (): PlayerProfile => {
    let p = city({ marketOwned: { [NANG]: 1, [TANG]: 1 } });
    p = setGuards(syncRaid(p, T0, { spawn: true }), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]);
    p = consumeCarried(carryItem(p, O('jang-bi'), TANG), [O('jang-bi')], 'online');
    return consumeCarried(carryItem(startRaid(p, T0 + MIN, 4242), O('gwan-u'), NANG), [O('gwan-u')], 'raid');
  };

  it('★ 60분에 버려진 판 — 자동 항복이 도적떼의 줄을 지운다(남으면 그 청낭서가 다음 도적떼 판을 지킨다)', () => {
    const p = fighting();
    const after = syncRaid(p, T0 + MIN + RAID_ABANDON_MS, { spawn: false });
    assert.equal(after.raid?.status, 'surrendered');
    assert.deepEqual(after.marketInPlay?.map((x) => x.battle), ['online'], '온라인의 줄은 남는다');
    assert.deepEqual(fallenAfterShield(after, 'raid', [O('gwan-u')]), [O('gwan-u')]);
    assert.equal(marketHeldCount(after, NANG), 0, '돌아오지 않는다 — 성립한 판은 소모');
  });

  it('본인 항복도 같다', () => {
    const after = surrenderRaid(fighting(), T0 + 2 * MIN);
    assert.deepEqual(after.marketInPlay?.map((x) => x.battle), ['online']);
  });
});

describe('되접기 — 판 표시', () => {
  it('★ 판 표시가 JSON 왕복 · 되접기를 지나도 남는다', () => {
    const p = both();
    const back = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.deepEqual(back.marketInPlay, p.marketInPlay);
  });

  it('모르는 판 표시는 옛 줄처럼 짐작한다', () => {
    const raw = { ...city(), marketInPlay: [{ officer: 'gwan-u', item: TANG, battle: 'forge' }] };
    assert.equal(migrateProfile(raw)!.marketInPlay?.[0]?.battle, 'online');
  });

  it('★ 옛 줄 — AI 대전이 싸우는 중이면 ai', () => {
    const m = matchAiBattle(city(), '3v3', PICKS, null, 4242);
    assert.ok(m.ok);
    const s = startAiBattle(m.ok ? m.profile : city(), T0);
    assert.ok(s.ok);
    const raw = { ...(s.ok ? s.profile : city()), marketInPlay: [{ officer: 'gwan-u', item: TANG }] };
    assert.equal(migrateProfile(JSON.parse(JSON.stringify(raw)))!.marketInPlay?.[0]?.battle, 'ai');
  });

  it('★ 옛 줄 — 도적떼가 싸우는 중이면 raid, 대기 중이면 아니다', () => {
    const pending = setGuards(syncRaid(city(), T0, { spawn: true }), [P('King', 'yu-bi'), P('Rock', 'gwan-u')]);
    const old = [{ officer: 'gwan-u', item: TANG }];
    assert.equal(migrateProfile(JSON.parse(JSON.stringify({ ...pending, marketInPlay: old })))!.marketInPlay?.[0]?.battle, 'online');
    const fighting = startRaid(pending, T0 + MIN, 4242);
    assert.equal(migrateProfile(JSON.parse(JSON.stringify({ ...fighting, marketInPlay: old })))!.marketInPlay?.[0]?.battle, 'raid');
  });
});
