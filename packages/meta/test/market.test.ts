/**
 * 시장 아이템 — 보유·하루 매물·지참·소모 (2026-09-23, GDD §6.5).
 *
 * 여기서 고정하는 것.
 *  - **하루 매물 = 시장 Lv − 해금 Lv + 1** — 다 나가면 오늘은 못 사고 **날이 바뀌면 찬다**
 *  - **보유 총량 = (시장 Lv − 1) × 20** — Lv1 시장은 아이템을 아예 안 판다
 *  - **병기와 같은 칸** — 아이템을 들면 병기 대신 아이템이 실리고, **지급은 안 지운다**
 *  - **소모는 판이 열릴 때** — 끝난 뒤에 빼면 같은 것을 여러 판에 쓴다
 *  - **성립하지 않은 판과 안 쓴 액티브만 돌아온다** — 패시브는 참전만으로 소모된다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { marketItemById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  GRAIN_PACK, applyBattleResult, applyBuyGrain, applyBuyMarketItem, canBuyGrain,
  canBuyMarketItem, canCarryItem, carryItem, consumeCarried, createProfile, equipOfficer,
  fallenAfterShield, forgeItemKey, grainCap, grainPackCost, heldFor, isInjured, marketCapacity,
  marketDailyStock, marketHeldCount, marketOwnedCount, marketStockLeft, migrateProfile,
  refundItems, refundableItems, settleCarried, syncGrain, toRosterEntries, uncarryItem,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 23, 3, 0, 0);   // KST 정오 언저리 — 날 경계에서 멀다

/** 시장 Lv5 · 금화 넉넉 */
function shop(over: Partial<PlayerProfile> = {}): PlayerProfile {
  const p = createProfile('장터성', 5);
  return { ...p, gold: 1000, buildings: { ...p.buildings, market: 5, forge: 5 }, ...over };
}
const someone = (p: PlayerProfile): OfficerId => Object.keys(p.roster)[0] as OfficerId;

// 탕약 Lv2(하루 4개 @Lv5) · 영기 Lv5(하루 1개) · 적토마 Lv5 패시브
const TANG = 'tang-yak', YEONG = 'yeong-gi', TO = 'jeok-to-ma', NANG = 'cheong-nang-seo';

describe('하루 매물 — 시장 Lv − 해금 Lv + 1', () => {
  it('해금 레벨이 낮을수록 많이 풀리고, 해금 전이면 0이다', () => {
    assert.equal(marketDailyStock(5, 2), 4);
    assert.equal(marketDailyStock(5, 5), 1);
    assert.equal(marketDailyStock(2, 2), 1);
    assert.equal(marketDailyStock(2, 5), 0, '아직 해금 전');
  });

  it('산 만큼 줄고, 다 나가면 오늘은 못 산다', () => {
    let p = shop();
    assert.equal(marketStockLeft(p, YEONG, T0), 1);
    p = applyBuyMarketItem(p, YEONG, T0);
    assert.equal(marketStockLeft(p, YEONG, T0), 0);
    const no = canBuyMarketItem(p, YEONG, T0);
    assert.equal(no.ok, false);
    assert.equal(no.ok === false && no.code, 'market.soldOut');
  });

  it('★ 날이 바뀌면 다시 찬다 — 아무도 안 들른 계정도 그래야 한다', () => {
    let p = shop();
    p = applyBuyMarketItem(p, YEONG, T0);
    assert.equal(marketStockLeft(p, YEONG, T0), 0);
    // 계정을 **한 번도 안 만지고** 하루 뒤에 읽는다
    assert.equal(marketStockLeft(p, YEONG, T0 + DAY), 1);
    assert.equal(canBuyMarketItem(p, YEONG, T0 + DAY).ok, true);
  });

  it('다른 품목의 매물은 안 줄어든다', () => {
    const p = applyBuyMarketItem(shop(), YEONG, T0);
    assert.equal(marketStockLeft(p, TANG, T0), 4);
  });
});

describe('사기 — 금화 · 매물 · 보유 총량 셋', () => {
  it('보유 총량은 (시장 Lv − 1) × 20이고 Lv1은 아예 안 판다', () => {
    assert.equal(marketCapacity(shop()), 80);
    const lv2 = shop({ buildings: { ...shop().buildings, market: 2 } });
    assert.equal(marketCapacity(lv2), 20);

    const lv1 = shop({ buildings: { ...shop().buildings, market: 1 } });
    const no = canBuyMarketItem(lv1, TANG, T0);
    assert.equal(no.ok === false && no.code, 'market.notBuilt');
  });

  it('아직 안 열린 품목은 거부한다', () => {
    const lv2 = shop({ buildings: { ...shop().buildings, market: 2 } });
    const no = canBuyMarketItem(lv2, YEONG, T0);
    assert.equal(no.ok === false && no.code, 'market.locked');
  });

  it('금화가 모자라면 거부한다', () => {
    const broke = shop({ gold: 1 });
    const no = canBuyMarketItem(broke, TANG, T0);
    assert.equal(no.ok === false && no.code, 'market.notEnoughGold');
  });

  it('둘 곳이 없으면 거부한다', () => {
    const full = shop({ marketOwned: { [TANG]: marketCapacity(shop()) } });
    assert.equal(marketOwnedCount(full), 80);
    const no = canBuyMarketItem(full, TANG, T0);
    assert.equal(no.ok === false && no.code, 'market.full');
  });

  it('사면 금화가 나가고 보유와 「오늘 산 수」가 함께 는다', () => {
    const p = applyBuyMarketItem(shop(), TANG, T0);
    assert.equal(p.gold, 1000 - marketItemById.get(TANG)!.gold);
    assert.equal(marketHeldCount(p, TANG), 1);
    assert.equal(p.marketTaken?.day, '2026-09-23');
  });
});

describe('들려 보내기 — 병기와 같은 칸', () => {
  it('가진 만큼만 들려 보낸다', () => {
    const p = shop({ marketOwned: { [TANG]: 1 } });
    const [a, b] = Object.keys(p.roster) as OfficerId[];
    const one = carryItem(p, a!, TANG);
    assert.equal(canCarryItem(one, a!, TANG).ok, true, '같은 장수를 다시 골라도 된다');
    const no = canCarryItem(one, b!, TANG);
    assert.equal(no.ok === false && no.code, 'market.noneLeft');
  });

  it('★ 아이템을 들면 병기 대신 아이템이 실리고, **지급은 안 지운다**', () => {
    const p0 = shop();
    const who = someone(p0);
    const key = forgeItemKey('dae-gam-do', 1);
    const armed = equipOfficer({ ...p0, forgeOwned: { [key]: null } }, key, who);
    assert.equal(heldFor(armed, who), 'dae-gam-do');

    const carried = carryItem({ ...armed, marketOwned: { [TO]: 1 } }, who, TO);
    assert.equal(heldFor(carried, who), TO, '아이템이 이긴다');
    assert.equal(carried.forgeOwned[key], who, '지급은 그대로 남는다');

    // 내려놓으면 병기가 **저절로** 돌아온다
    assert.equal(heldFor(uncarryItem(carried, who), who), 'dae-gam-do');
  });

  it('전투 로스터에 그대로 실린다', () => {
    const p = carryItem(shop({ marketOwned: { [TO]: 1 } }), someone(shop()), TO);
    const entries = toRosterEntries(p, [{ piece: 'King', officer: someone(p) }]);
    assert.equal(entries[0]!.held, TO);
  });
});

describe('소모와 환불', () => {
  const carried = (): { p: PlayerProfile; who: OfficerId } => {
    const base = shop({ marketOwned: { [TANG]: 2, [TO]: 1 } });
    const who = someone(base);
    return { p: carryItem(base, who, TANG), who };
  };

  it('★ 판이 열리면 그 자리에서 빠지고 들려 보낸 것도 내려놓는다', () => {
    const { p, who } = carried();
    const after = consumeCarried(p, [who]);
    assert.equal(marketHeldCount(after, TANG), 1, '한 개 빠진다');
    assert.equal(after.marketCarry?.[who], undefined, '다음 판에 또 실리면 안 된다');
  });

  it('출전하지 않은 장수의 것은 안 빠진다', () => {
    const { p, who } = carried();
    const other = (Object.keys(p.roster) as OfficerId[]).find((o) => o !== who)!;
    const after = consumeCarried(p, [other]);
    assert.equal(marketHeldCount(after, TANG), 2, '그대로다');
  });

  it('마지막 한 개를 쓰면 키째로 사라진다 — 0을 남기면 「가졌는데 없다」가 뜬다', () => {
    const base = shop({ marketOwned: { [TANG]: 1 } });
    const who = someone(base);
    const after = consumeCarried(carryItem(base, who, TANG), [who]);
    assert.equal(after.marketOwned?.[TANG], undefined);
  });

  it('★ 성립하지 않은 판은 전부 돌아오고, 성립한 판은 **안 쓴 액티브만** 돌아온다', () => {
    const who = 'a' as OfficerId, other = 'b' as OfficerId;
    const list = { [who]: TANG, [other]: TO };   // 탕약=액티브 · 적토마=패시브

    assert.deepEqual(refundableItems(list, [], false).sort(), [TANG, TO].sort(),
      '성립하지 않은 판은 패시브도 돌려준다');
    assert.deepEqual(refundableItems(list, [], true), [TANG],
      '성립한 판에서 패시브는 참전만으로 소모된다');
    assert.deepEqual(refundableItems(list, [who], true), [],
      '쓴 액티브는 안 돌아온다 — 지겠다 싶으면 다 쓰고 항복이 공짜가 되면 안 된다');
  });

  it('★ 소모한 것을 서버가 기억한다 — 안 기억하면 환불을 할 수 없다', () => {
    const { p, who } = carried();
    const after = consumeCarried(p, [who]);
    assert.deepEqual(after.marketInPlay, [{ officer: who, item: TANG }]);
    assert.equal(after.marketCarry?.[who], undefined, '들려 보낸 자리는 비었다');
  });

  it('성립하지 않은 판은 그대로 돌아오고 기억이 비워진다', () => {
    const { p, who } = carried();
    const back = settleCarried(consumeCarried(p, [who]), [], false);
    assert.equal(marketHeldCount(back, TANG), 2, '빠지기 전으로 돌아온다');
    assert.equal(back.marketInPlay, undefined, '기억은 비운다 — 다음 판에 섞이면 안 된다');
  });

  it('성립한 판에서 패시브는 안 돌아오고 안 쓴 액티브는 돌아온다', () => {
    const base = shop({ marketOwned: { [TANG]: 1, [TO]: 1 } });
    const [a, b] = Object.keys(base.roster) as OfficerId[];
    const out = consumeCarried(carryItem(carryItem(base, a!, TANG), b!, TO), [a!, b!]);
    assert.equal(marketHeldCount(out, TANG), 0);
    assert.equal(marketHeldCount(out, TO), 0);

    const done = settleCarried(out, [], true);
    assert.equal(marketHeldCount(done, TANG), 1, '안 쓴 액티브는 돌아온다');
    assert.equal(marketHeldCount(done, TO), 0, '패시브는 참전만으로 소모된다');
    assert.equal(done.marketInPlay, undefined);
  });

  it('쓴 액티브는 안 돌아온다 — 다 쓰고 항복이 공짜가 되면 안 된다', () => {
    const { p, who } = carried();
    const done = settleCarried(consumeCarried(p, [who]), [who], true);
    assert.equal(marketHeldCount(done, TANG), 1, '2개 중 1개가 빠진 채로 끝난다');
  });

  it('★ 실린 것이 없어도 판마다 기억을 비운다', () => {
    const stale = { ...shop(), marketInPlay: [{ officer: 'x' as OfficerId, item: TANG }] };
    assert.equal(settleCarried(stale, [], true).marketInPlay, undefined);
  });

  it('환불은 보유를 되돌린다', () => {
    const p = refundItems(shop({ marketOwned: { [TANG]: 1 } }), [TANG, TO]);
    assert.equal(marketHeldCount(p, TANG), 2);
    assert.equal(marketHeldCount(p, TO), 1);
  });
});

describe('되접기', () => {
  it('모르는 아이템·0 이하·빠진 장수는 버린다', () => {
    const base = shop();
    const who = someone(base);
    const p = migrateProfile({
      ...base,
      marketOwned: { [TANG]: 2, '없는물건': 5, [TO]: 0 },
      marketCarry: { [who]: TANG, 'eobs-neun-jangsu': TANG, [someone(base)]: TANG },
    })!;
    assert.deepEqual(p.marketOwned, { [TANG]: 2 });
    assert.deepEqual(p.marketCarry, { [who]: TANG });
  });

  it('판이 도는 중인 기록도 모르는 아이템·빠진 장수를 버린다', () => {
    const base = shop();
    const who = someone(base);
    const p = migrateProfile({
      ...base,
      marketInPlay: [
        { officer: who, item: TANG },
        { officer: who, item: '없는물건' },
        { officer: 'eobs-neun-jangsu', item: TANG },
        '쓰레기',
      ],
    })!;
    assert.deepEqual(p.marketInPlay, [{ officer: who, item: TANG }]);
  });

  it('날짜 꼴이 아니면 「오늘 산 수」를 통째로 버린다', () => {
    const p = migrateProfile({ ...shop(), marketTaken: { day: '어제', counts: { [TANG]: 3 } } })!;
    assert.equal(p.marketTaken, undefined);
  });

  it('없는 계정은 키째로 없다 — 빈 표를 지어내지 않는다', () => {
    const p = migrateProfile({ ...createProfile('빈성', 3) })!;
    assert.equal(p.marketOwned, undefined);
    assert.equal(p.marketCarry, undefined);
    assert.equal(p.marketTaken, undefined);
  });
});

describe('청낭서 — 부상 면제 (2026-09-23)', () => {
  it('★ 들고 나간 장수만 빠진다 — 출처는 `marketInPlay`다', () => {
    const base = shop({ marketOwned: { [NANG]: 1 } });
    const [a, b] = Object.keys(base.roster) as OfficerId[];
    const out = consumeCarried(carryItem(base, a!, NANG), [a!, b!]);

    assert.deepEqual(fallenAfterShield(out, [a!, b!]), [b!], '청낭서를 든 쪽만 빠진다');
    assert.deepEqual(fallenAfterShield(base, [a!, b!]), [a!, b!], '안 들었으면 아무도 안 빠진다');
  });

  it('`marketCarry`를 보지 않는다 — 소모할 때 이미 비워졌다', () => {
    const base = shop({ marketOwned: { [NANG]: 1 } });
    const who = someone(base);
    const carried = carryItem(base, who, NANG);
    assert.deepEqual(fallenAfterShield(carried, [who]), [who],
      '아직 판이 안 열렸으면 면제가 아니다');
  });

  it('전투 정산이 실제로 부상을 안 매긴다', () => {
    const base = shop({ marketOwned: { [NANG]: 1 } });
    const who = someone(base);
    const out = consumeCarried(carryItem(base, who, NANG), [who]);
    const after = applyBattleResult(out, {
      result: 'lose', mode: '3v3', opponent: 'ai', picks: [{ piece: 'King', officer: who }],
      kills: {}, fallen: [who], power: { mine: 1, theirs: 1 }, at: T0,
      opponentId: null, mySquad: null, theirSquad: null,
    }, 1).profile;
    assert.equal(isInjured(after.roster[who]!, T0), false, '청낭서를 들었으면 안 다친다');

    const bare = applyBattleResult(shop(), {
      result: 'lose', mode: '3v3', opponent: 'ai', picks: [{ piece: 'King', officer: who }],
      kills: {}, fallen: [who], power: { mine: 1, theirs: 1 }, at: T0,
      opponentId: null, mySquad: null, theirSquad: null,
    }, 1).profile;
    assert.equal(isInjured(bare.roster[who]!, T0), true, '안 들었으면 다친다');
  });
});

describe('군량 구매 (2026-09-23, GDD §6.2)', () => {
  const thirsty = (over: Partial<PlayerProfile> = {}): PlayerProfile =>
    ({ ...shop(), grain: 0, grainAt: T0, ...over });

  it('금화를 내고 군량을 받는다', () => {
    const p = applyBuyGrain(thirsty(), T0);
    assert.equal(p.gold, 1000 - grainPackCost());
    assert.equal(p.grain, Math.min(grainCap(p), GRAIN_PACK));
  });

  it('★ 가득 찼을 때만 막고, 넘치는 분은 상한에서 잘린다', () => {
    const full = thirsty({ grain: grainCap(shop()) });
    const no = canBuyGrain(full, T0);
    assert.equal(no.ok === false && no.code, 'market.grainFull');

    // 한 칸 비었으면 살 수 있고, 상한을 안 넘는다
    const almost = thirsty({ grain: grainCap(shop()) - 1 });
    assert.equal(canBuyGrain(almost, T0).ok, true);
    assert.equal(applyBuyGrain(almost, T0).grain, grainCap(almost));
  });

  it('금화가 모자라면 거부한다', () => {
    const no = canBuyGrain(thirsty({ gold: 0 }), T0);
    assert.equal(no.ok === false && no.code, 'market.notEnoughGold');
  });

  it('★ 먼저 정산한다 — 시간 몫이 사라지지 않는다', () => {
    // ★ **창고를 키워야 이 검사가 무언가를 본다.** 병영 Lv1의 상한(20)은 묶음
    // 크기와 같아서, 정산을 통째로 빼도 `min(상한, …)`이 같은 값으로 잘라 내
    // **정산을 안 해도 통과했다**(변이로 확인). 상한이 묶음보다 넉넉해야
    // 「시간 몫이 더해졌나」가 드러난다.
    const later = T0 + 60 * 60 * 1000;
    const p = thirsty({ buildings: { ...shop().buildings, barracks: 5, farm: 5 } });
    assert.ok(grainCap(p) > GRAIN_PACK * 2, `상한 ${grainCap(p)}이 묶음보다 넉넉해야 한다`);
    const timed = syncGrain(p, later).grain;
    assert.ok(timed > 0, '한 시간이면 시간 몫이 들어온다');
    assert.equal(applyBuyGrain(p, later).grain, Math.min(grainCap(p), timed + GRAIN_PACK));
  });
});
