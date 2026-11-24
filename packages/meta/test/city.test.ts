/**
 * 도시 회귀 — 군량 시간 충전과 증축 (pptx 41쪽 · GDD §5, C2 · 2026-08-18)
 *
 * 여기서 고정하는 것 다섯.
 *  - **충전이 상한을 넘지 않는다** — 상한은 「더 못 쌓는다」이지 「나중에 받는다」가 아니다
 *  - **시계가 뒤로 가도 줄지 않고, 앞뒤로 흔들어도 못 뽑는다** (`grainAt`을 당기지 않는다)
 *  - **자투리 시간이 다음 접속으로 이어진다** — 30분씩 접속해도 결국 받는다
 *  - **풀·상한·요율은 건물이 정한다** — 도시 증축이 아니라 궁궐·병영·농지다 (2026-09-04)
 *  - **부상은 낫고, 병원은 그것을 앞당긴다** — GDD §5.7의 완치 시간 표를 그대로 잰다
 *  - **도시(계정) 전적 합 ≠ 장수 전적 합** — 판수 대 인원수. C1이 칸을 따로 둔 이유다
 *
 * 시각은 전부 밖에서 넣는다 — meta는 `Date.now()`를 부르지 않는다(`city.ts` 참조).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUILDINGS, ECONOMY, OFFICERS } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import type { BuildingId } from '@samchess/data';
import {
  UPGRADE_PICKS, BUILD_CITY_LEVEL, INJURY_PENALTY, MATERIALS_PER_GOLD, MATERIAL_PACK,
  PROFILE_VERSION, applyBuyMaterials, canBuyMaterials, materialPackCost, battlePower,
  buildingRows, checkUpgradePicks, forcedUpgradePicks, PALACE_FORCED_LEVELS, hasEmperor, upgradePickCount, injuredStat, newInstance,
  nextRoomFreeAt, toRosterEntries,
  HEAL_MS, INJURY_RECOVER_MS, MAX_CITY_LEVEL, MS_PER_HOUR, ROOM_CYCLE_MS, accountTally,
  applyBattleResult, applyCityUpgrade, applyHeal, applyInjuries, buildingLevel,
  CITY_UPGRADE_REASONS, canHeal, canUpgradeCity, cityLevel, createProfile, freeRooms, grainCap,
  grainPerHour, grainStepMs, hospitalRooms, hospitalWards, isInjured, maxCityLevel, migrateProfile,
  poolCap, syncCity, syncGrain, upgradeCost,
  addCard, settleLegacyBox, battleWinsOf, ownedOfficers, poolUsed, upgradeOfficerNeeds, upgradeChecklist,
} from '../src/index.ts';
import type { BattleOutcome, PlayerProfile, RosterPick } from '../src/index.ts';

/** 2023-11-14 22:13:20 UTC — 아무 뜻 없는 고정 시각. 시계를 읽지 않는다는 것이 요점이다 */
const T0 = 1_700_000_000_000;

/** 이미 한 번 정산해 둔 계정 — 「첫 정산은 도장만」 규칙을 매번 지나지 않으려고 */
/** 누적 승리는 넉넉히 채워 둔다 — 다른 조건을 따로 재려고. 승리 조건은 아래 「누적 승리」에서 본다(2026-11-14) */
function city(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return { ...createProfile('도시성', 7), grainAt: T0, battleWins: 999, ...over };
}

const isTop = (id: string): boolean => {
  const g = OFFICERS.find((o) => o.id === id)?.grade;
  return g === 'S' || g === 'A';
};

/**
 * 보유 장수를 채운다 — 증축 조건(2026-09-14)을 지나려는 회귀용. S·A를 `top`명까지,
 * 나머지는 B~D로 `total`명까지. **보관함(카드)**에 넣는다 — 풀에 넣으면 궁궐 상한에
 * 막히고, 보관함도 보유로 센다는 것이 규칙이다. 헌제는 안 넣는다(황제는 따로 본다).
 */
function stocked(p: PlayerProfile, total = OFFICERS.length - 1, top = 70): PlayerProfile {
  // 보유 = 풀이다(장수 보관함은 2026-11-24에 없어졌다) — 궁궐 상한은 이 시험 도우미가 안 본다
  const owned = new Set<string>(ownedOfficers(p));
  const roster = { ...p.roster };
  let topHave = [...owned].filter(isTop).length;
  for (const o of OFFICERS) {
    if (topHave >= top || owned.size >= total) break;
    if (!owned.has(o.id) && isTop(o.id)) { roster[o.id as OfficerId] = newInstance(o.id as OfficerId); owned.add(o.id); topHave++; }
  }
  for (const o of OFFICERS) {
    if (owned.size >= total) break;
    if (!owned.has(o.id) && !isTop(o.id) && o.grade !== 'E') { roster[o.id as OfficerId] = newInstance(o.id as OfficerId); owned.add(o.id); }
  }
  return { ...p, roster };
}

/** 풀을 등급 `grades`의 장수로 `n`명까지 채운다 — 보관함이 생기는 상태를 만들려고 */
function fillPool(p: PlayerProfile, n: number, grades: readonly string[]): PlayerProfile {
  const roster = { ...p.roster };
  for (const o of OFFICERS) {
    if (Object.keys(roster).length >= n) break;
    if (!roster[o.id as OfficerId] && grades.includes(o.grade)) roster[o.id as OfficerId] = newInstance(o.id as OfficerId);
  }
  return { ...p, roster };
}

describe('군량 시간 충전 (GDD §5)', () => {
  it('Lv1은 한 시간에 하나 — 정확히 한 시간이 지나야 들어온다', () => {
    const p = city({ grain: 5 });
    assert.equal(grainPerHour(p), 1);
    assert.equal(grainStepMs(p), MS_PER_HOUR, '농지가 없으면 한 시간에 하나');

    assert.equal(syncGrain(p, T0 + MS_PER_HOUR - 1).grain, 5, '59분 59초에는 아직 없다');
    assert.equal(syncGrain(p, T0 + MS_PER_HOUR).grain, 6);
    assert.equal(syncGrain(p, T0 + 3 * MS_PER_HOUR).grain, 8);
  });

  it('자투리 시간이 다음 접속으로 이어진다 ★ 30분씩 들러도 결국 받는다', () => {
    // `grainAt = nowMs`로 찍는 구현이면 여기서 **영원히 0**이다 — 매번 30분이 잘린다
    const half = MS_PER_HOUR / 2;
    const a = syncGrain(city({ grain: 0 }), T0 + half);
    assert.equal(a.grain, 0, '30분에는 아직 없다');
    const b = syncGrain(a, T0 + 2 * half);
    assert.equal(b.grain, 1, '30분이 두 번이면 한 시간이다');
    assert.equal(b.grainAt, T0 + MS_PER_HOUR, '번 만큼만 앞으로 민다');
  });

  it('상한을 넘지 않는다 — 그리고 시간이 은행처럼 쌓이지 않는다 ★', () => {
    const p = city({ grain: 18 });
    const cap = grainCap(p);
    assert.equal(cap, 20);

    // 백 시간을 놀아도 상한까지만
    const full = syncGrain(p, T0 + 100 * MS_PER_HOUR);
    assert.equal(full.grain, cap);

    // 그 뒤 참가비를 내도 **그동안의 시간이 한꺼번에 돌아오지 않는다**
    const spent = { ...full, grain: full.grain - 3 };
    const after = syncGrain(spent, T0 + 100 * MS_PER_HOUR);
    assert.equal(after.grain, cap - 3, '상한에 붙어 있던 동안의 시간은 사라진다');
  });

  it('시계가 뒤로 가도 줄지 않고, 앞뒤로 흔들어도 못 뽑는다 ★', () => {
    const p = city({ grain: 7 });
    const back = syncGrain(p, T0 - 10 * MS_PER_HOUR);
    assert.equal(back.grain, 7, '군량이 줄면 안 된다');
    assert.equal(back.grainAt, T0, '`grainAt`을 과거로 당기지 않는다');
    assert.equal(back, p, '바뀐 것이 없으면 같은 객체다');

    // 앞으로 감아 받고 → 되돌리고 → 다시 감아도 **한 번 분만** 받는다
    const won = syncGrain(p, T0 + 2 * MS_PER_HOUR);
    assert.equal(won.grain, 9);
    const rewound = syncGrain(won, T0);
    assert.equal(rewound.grain, 9);
    assert.equal(syncGrain(rewound, T0 + 2 * MS_PER_HOUR).grain, 9, '같은 두 시간을 두 번 받지 않는다');
  });

  it('`grainAt === 0`은 도장만 찍는다 — 되접힌 옛 계정에 1970년치를 주지 않는다 ★', () => {
    const old = { ...createProfile('옛성', 3), grain: 4, grainAt: 0 };
    const first = syncGrain(old, T0);
    assert.equal(first.grain, 4, '접속하자마자 상한까지 차면 안 된다');
    assert.equal(first.grainAt, T0);
    assert.equal(syncGrain(first, T0 + MS_PER_HOUR).grain, 5, '도장을 찍은 뒤부터 센다');
  });

  it('바뀐 것이 없으면 같은 객체를 돌려준다 — 분마다 저장하지 않게', () => {
    const p = city({ grain: 3 });
    assert.equal(syncGrain(p, T0 + 1), p);
    assert.notEqual(syncGrain(p, T0 + MS_PER_HOUR), p);
    // 상한에 붙어 있어도 `grainAt`은 전진하므로 **새 객체**여야 한다
    const capped = city({ grain: grainCap(city()) });
    assert.notEqual(syncGrain(capped, T0 + MS_PER_HOUR), capped);
  });

  it('**농지**가 빨라지게 한다 — Lv5는 6분에 하나 (도시 레벨이 아니다 ★)', () => {
    const farm = city({ grain: 0, buildings: { ...city().buildings, farm: 5, barracks: 5 } });
    assert.equal(grainPerHour(farm), 10);
    assert.equal(grainStepMs(farm), MS_PER_HOUR / 10);
    assert.equal(syncGrain(farm, T0 + MS_PER_HOUR).grain, 10);
    assert.equal(syncGrain(farm, T0 + MS_PER_HOUR / 10).grain, 1);

    // **도시 레벨만 올려서는 한 톨도 안 빨라진다** — 2026-09-04에 갈린 자리다
    const cityOnly = city({ grain: 0, cityLevel: MAX_CITY_LEVEL });
    assert.equal(grainPerHour(cityOnly), 1);
  });
});

describe('건축 자재 구매 (장터 「거래」, 2026-09-04)', () => {
  it('값도 묶음도 데이터에서 나온다 — 화면·서버가 숫자를 새로 적지 않는다', () => {
    assert.equal(MATERIALS_PER_GOLD, ECONOMY.materialsPerGold);
    assert.equal(MATERIAL_PACK, upgradeCost(1), '묶음은 첫 증축 한 번치다');
    assert.equal(materialPackCost(), Math.ceil(MATERIAL_PACK / ECONOMY.materialsPerGold));
  });

  it('금화가 모자라면 왜인지 말하고 던진다', () => {
    const p = city({ gold: materialPackCost() - 1 });
    const check = canBuyMaterials(p);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /금화/);
    assert.throws(() => applyBuyMaterials(p, T0), /금화/);
  });

  it('낸 금화만큼 자재가 들어오고 나머지는 안 건드린다 ★', () => {
    const p = city({ gold: materialPackCost() + 3, materials: 4, grain: 5 });
    assert.equal(canBuyMaterials(p).ok, true);

    const next = applyBuyMaterials(p, T0);
    assert.equal(next.gold, 3, '금화를 정확히 그만큼 낸다');
    assert.equal(next.materials, 4 + MATERIAL_PACK);
    assert.equal(next.cityLevel, p.cityLevel, '증축은 따로 눌러야 한다');
    assert.deepEqual(next.buildings, p.buildings, '건물은 증축만 올린다');
  });

  it('사기 전에 먼저 정산한다 — 산 직후 화면이 낡은 군량을 보여 주지 않는다', () => {
    const p = city({ gold: materialPackCost(), grain: 0 });
    const next = applyBuyMaterials(p, T0 + 3 * MS_PER_HOUR);
    assert.equal(next.grain, 3, '세 시간치 군량이 함께 들어온다');
    assert.equal(next.grainAt, T0 + 3 * MS_PER_HOUR);
  });
});

/** 증축 때 고를 건물 — 최대가 아닌 것을 `BUILDINGS` 차례로 `upgradePickCount`개 (회귀가 고르기를 신경 쓰지 않을 때) */
function anyPicks(p: PlayerProfile): BuildingId[] {
  return BUILDINGS.filter((b) => buildingLevel(p, b.id) < b.maxLevel).slice(0, upgradePickCount(p)).map((b) => b.id);
}

describe('증축 (GDD §5)', () => {
  it('재료는 `city.json`이 정한다 — 표를 옮겨 적지 않는다', () => {
    assert.equal(upgradeCost(1), cityLevel(2).materialsToUpgrade);
    assert.equal(upgradeCost(MAX_CITY_LEVEL), null, '최대 레벨에는 다음이 없다');
  });

  it('재료가 모자라면 왜인지 말한다', () => {
    const p = stocked(city({ materials: 0 }));
    const check = canUpgradeCity(p);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /자재/);
    assert.throws(() => applyCityUpgrade(p, T0, anyPicks(p)), /자재/);
  });

  /**
   * **이유에는 번역할 코드가 붙는다** (2026-09-18). 화면은 `reason.{code}`로 번역하므로, 코드가
   * 빠지거나 목록 밖이면 한국어 원문이 열 언어에 샌다. 숫자(`params`)도 원문과 같아야 한다.
   */
  it('증축 이유마다 목록 안의 코드와 숫자가 붙는다', () => {
    const cases: [PlayerProfile, string][] = [
      [stocked(city({ materials: 0 })), 'city.materials'],
      [city({ materials: 999 }), 'city.officers'],
      [city({ cityLevel: MAX_CITY_LEVEL - 1, materials: 999 }), 'city.capNoEmperor'],
    ];
    for (const [p, want] of cases) {
      const check = canUpgradeCity(p);
      assert.equal(check.ok, false);
      if (check.ok) continue;
      assert.equal(check.code, want, check.reason);
      assert.ok((CITY_UPGRADE_REASONS as readonly string[]).includes(check.code!), `목록 밖 코드 ${check.code}`);
      for (const v of Object.values(check.params ?? {})) assert.ok(check.reason.includes(String(v)), `${v}가 원문에 없다 — ${check.reason}`);
    }
  });

  /**
   * **황궁이 레벨을 하나 더 연다** (GDD §5.5). 헌제가 없으면 그 앞에서 멈추고,
   * 있으면 마지막 레벨까지 간다. 한쪽만 보면 「기본값과 같은 값을 확인하는」 검사가 된다.
   */
  it('헌제가 없으면 마지막 한 레벨 앞에서 막힌다 ★', () => {
    const p = city({ cityLevel: MAX_CITY_LEVEL - 1, materials: 999 });
    assert.equal(hasEmperor(p), false);
    assert.equal(maxCityLevel(p), MAX_CITY_LEVEL - 1);
    const check = canUpgradeCity(p);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /황제/, '왜 막혔는지 말한다');
    assert.throws(() => applyCityUpgrade(p, T0, []), /황제/);
  });

  it('헌제를 옹립하면 마지막 레벨이 열리고 거기서 끝난다 — 그 증축은 모든 건물을 최대로 ★', () => {
    const emperor = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;
    const withHeon = (over: Partial<PlayerProfile>): PlayerProfile => {
      const p = city(over);
      return { ...p, roster: { ...p.roster, [emperor]: newInstance(emperor) } };
    };

    const ready = withHeon({ cityLevel: MAX_CITY_LEVEL - 1, materials: 999 });
    assert.equal(hasEmperor(ready), true);
    assert.equal(maxCityLevel(ready), MAX_CITY_LEVEL);
    assert.equal(canUpgradeCity(ready).ok, true);
    assert.equal(upgradePickCount(ready), 0, '황궁으로 오르는 증축은 고르지 않는다');
    assert.throws(() => applyCityUpgrade(ready, T0, ['farm']), /고르소서/, '골라 보내면 거절한다');
    const top = applyCityUpgrade(ready, T0, []);
    assert.equal(top.cityLevel, MAX_CITY_LEVEL);
    for (const b of BUILDINGS) assert.equal(buildingLevel(top, b.id), b.maxLevel, `${b.name}이 최대가 됐다`);

    const done = withHeon({ cityLevel: MAX_CITY_LEVEL, materials: 999 });
    assert.equal(canUpgradeCity(done).ok, false);
    assert.throws(() => applyCityUpgrade(done, T0, []), /최대 레벨/);
  });

  it('증축하면 고른 건물만 한 단계씩 오른다 — 자재를 정확히 그만큼 낸다 ★', () => {
    const cost = upgradeCost(1)!;
    const p = stocked(city({ materials: cost + 2, grain: 20 }));
    assert.equal(canUpgradeCity(p).ok, true);
    assert.equal(upgradePickCount(p), UPGRADE_PICKS);

    const next = applyCityUpgrade(p, T0, ['academy', 'hospital', 'forge']);
    assert.equal(next.cityLevel, 2);
    assert.equal(next.materials, 2, '재료를 정확히 그만큼 낸다');
    for (const b of BUILDINGS) {
      const up = ['academy', 'hospital', 'forge'].includes(b.id) ? 1 : 0;
      assert.equal(buildingLevel(next, b.id), buildingLevel(p, b.id) + up, b.name);
    }
    // 고르지 않은 건물이 정하는 값은 그대로다
    assert.equal(poolCap(next), poolCap(p), '캐릭터 풀은 궁궐이 정한다');
    assert.equal(grainCap(next), grainCap(p), '군량 상한은 병영이 정한다');
    assert.equal(grainPerHour(next), grainPerHour(p), '생산량은 농지가 정한다');
    assert.equal(next.grain, 20, '가진 군량은 그대로다');
  });

  it('고른 것이 틀리면 거절한다 — 수 · 겹침 · 최대 레벨 · 모르는 건물', () => {
    const p = stocked(city({ materials: 999 }));
    const code = (picks: string[]): string | undefined => { const c = checkUpgradePicks(p, picks); return c.ok ? 'ok' : c.code ?? 'none'; };
    assert.equal(code(['farm', 'academy', 'forge']), 'ok');
    assert.equal(code(['farm', 'academy']), 'city.picks', '모자라다');
    assert.equal(code(['farm', 'academy', 'forge', 'hospital']), 'city.picks', '넘친다');
    assert.equal(code(['farm', 'farm', 'forge']), 'city.picks', '같은 건물을 두 번 — 서로 다른 셋이다(2026-11-23 기획자)');
    assert.equal(code(['farm', 'academy', 'castle']), 'none', '모르는 건물');
    const maxed = { ...p, buildings: { ...p.buildings, farm: 5 } };
    const c = checkUpgradePicks(maxed, ['farm', 'academy', 'forge']);
    assert.equal(c.ok ? 'ok' : c.code, 'city.maxLevel', '최대 레벨은 못 고른다');
    assert.throws(() => applyCityUpgrade(p, T0, ['farm', 'farm', 'forge']), /서로 다른/);
  });

  it('홀수 레벨(3 · 5 · 7 · 9)로 오르는 증축은 궁궐을 반드시 고른다 — 도시 Lv9에 궁궐 Lv5(260석) (2026-11-24 기획자)', () => {
    assert.deepEqual(PALACE_FORCED_LEVELS, [3, 5, 7, 9]);
    for (let from = 1; from <= 10; from++) {
      const p = stocked(city({ cityLevel: from, materials: 999 }));
      const want = [3, 5, 7, 9].includes(from + 1) ? ['palace'] : [];
      assert.deepEqual(forcedUpgradePicks(p), want, `Lv${from} → ${from + 1}`);
    }
    const p = stocked(city({ cityLevel: 2, materials: 999 }));
    const code = (picks: string[]): string => { const c = checkUpgradePicks(p, picks); return c.ok ? 'ok' : c.code ?? 'none'; };
    assert.equal(code(['farm', 'academy', 'forge']), 'city.forcedPick', '궁궐을 빼면 막는다');
    assert.equal(code(['palace', 'academy', 'forge']), 'ok');
    // 궁궐이 이미 최대면 강제가 없다
    assert.deepEqual(forcedUpgradePicks({ ...p, buildings: { ...p.buildings, palace: 5 } }), []);
    // 네 번 다 궁궐을 고르면(나머지는 아무거나) 도시 Lv9에 궁궐 Lv5 — 장수 260명이 다 앉는다
    let q = stocked(city({ cityLevel: 1, materials: 9_999 }));
    for (let lv = 1; lv < 9; lv++) {
      const n = upgradePickCount(q);
      const picks = [...forcedUpgradePicks(q)];
      for (const b of BUILDINGS) if (picks.length < n && b.id !== 'palace' && (q.buildings[b.id as BuildingId] ?? 0) < b.maxLevel) picks.push(b.id as BuildingId);
      q = { ...q, cityLevel: lv, buildings: { ...q.buildings } };
      for (const id of picks) q.buildings[id] = (q.buildings[id] ?? 0) + 1;
      q = { ...q, cityLevel: lv + 1 };
    }
    assert.equal(q.cityLevel, 9);
    assert.equal(poolCap(q), OFFICERS.length, '도시 Lv9에 궁궐 260석 = 장수 전원');
  });

  it('최대가 아닌 건물이 셋보다 적으면 남은 만큼만 고른다', () => {
    const p = stocked(city({ cityLevel: 5, materials: 999 }));
    const almost = { ...p, buildings: Object.fromEntries(BUILDINGS.map((b, i) => [b.id, i < 2 ? b.maxLevel - 1 : b.maxLevel])) as PlayerProfile['buildings'] };
    assert.equal(upgradePickCount(almost), 2);
    const next = applyCityUpgrade(almost, T0, [BUILDINGS[0]!.id, BUILDINGS[1]!.id]);
    for (const b of BUILDINGS) assert.equal(buildingLevel(next, b.id), b.maxLevel);
  });

  it('**농지를 올리는 증축이** 옛 요율로 먼저 정산하고 넘어간다 ★', () => {
    // 정산을 안 하고 올리면 농지 없이 논 세 시간이 새 요율(2/h)로 계산된다
    const p = stocked(city({ grain: 0, materials: 999 }));
    const next = applyCityUpgrade(p, T0 + 3 * MS_PER_HOUR, ['farm', 'academy', 'hospital']);
    assert.equal(next.grain, 3, '농지 없던 세 시간은 3이다 (6이 아니다)');
    assert.equal(syncGrain(next, T0 + 4 * MS_PER_HOUR).grain, 5, '그 뒤 한 시간은 농지 Lv1 요율로 2다');
  });
});

describe('증축 조건 — 보유 장수 (2026-09-14) · 옛 보관함 정리 (2026-11-24)', () => {
  it('보유 장수는 **풀**을 센다 — 모자라면 몇 명인지 말한다', () => {
    const base = city({ materials: upgradeCost(1)! });           // 새 계정은 5명
    const need = upgradeOfficerNeeds(base)!;
    assert.deepEqual(need.total, { have: 5, need: cityLevel(2).officersToUpgrade! });

    const short = stocked(base, need.total.need - 1);
    const check = canUpgradeCity(short);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /보유 장수.*9\/10/);
    assert.equal(canUpgradeCity(stocked(base, need.total.need)).ok, true, '채우면 열린다');
  });

  it('무과금은 Lv3까지 — Lv3→4에서 처음 S·A를 요구한다', () => {
    const lv2 = stocked(city({ cityLevel: 2, materials: 999 }), 20, 2);
    assert.equal(canUpgradeCity(lv2).ok, true, 'Lv2→3은 시작 S·A 둘로 된다');
    const lv3 = stocked(city({ cityLevel: 3, materials: 999 }), 30, 2);
    const check = canUpgradeCity(lv3);
    assert.match(check.ok ? '' : check.reason, /S·A급.*2\/3/);
  });

  /*
   * 궁궐이 가득 차면 새 장수는 못 들어온다 — 장수 보관함은 없다(2026-11-24 기획자). `addCard`가 마지막 판정이라
   * 관리자 지급도 이 거절을 받는다. 「풀만 세면 멈춘다」는 홀수 레벨 증축의 궁궐 강제가 닫는다(아래 「건물」).
   */
  it('궁궐이 가득 차면 새 장수를 들이지 않는다 — 보유한 장수의 카드는 받는다', () => {
    const p = fillPool(city({ cityLevel: 3, materials: 999 }), 60, ['B', 'C', 'D']);
    assert.equal(poolUsed(p), poolCap(p), '궁궐 Lv1 풀이 가득 찼다');
    const s = OFFICERS.find((o) => o.grade === 'S' && !p.roster[o.id as OfficerId])!.id as OfficerId;
    assert.throws(() => addCard(p, s), (e: unknown) => (e as { code?: string }).code === 'officer.noSeat');
    const mine = (Object.keys(p.roster) as OfficerId[])[0]!;
    assert.equal(addCard(p, mine).cards[mine], (p.cards[mine] ?? 0) + 1);
  });

  /*
   * 도시 관리의 「증축 조건」 줄이 그리는 표 (2026-11-12). **단추의 잠금(`canUpgradeCity`)과 같은 표**라,
   * 칸이 전부 `ok`일 때만 열린다 — 한쪽만 고치면 「조건은 다 찼는데 잠겼다」가 된다.
   */
  it('증축 조건표 — 칸이 다 차야 열리고, 처음 걸린 칸이 이유다', () => {
    const lv3 = stocked(city({ cityLevel: 3, materials: 5 }), 30, 2);
    const list = upgradeChecklist(lv3)!;
    assert.deepEqual([list.from, list.to], [3, 4]);
    assert.deepEqual(list.checks.map((c) => [c.kind, c.have, c.need, c.ok]), [
      ['officers', 30, 30, true],
      ['topOfficers', 2, 3, false],
      ['wins', 999, 10, true],
      ['materials', 5, upgradeCost(3)!, false],
    ]);
    const check = canUpgradeCity(lv3);
    assert.equal(check.ok ? '' : check.code, 'city.topOfficers', '표의 첫 실패가 이유다');

    // 황제가 없는 상한 — 황제 칸이 맨 앞에 선다. 진짜 최대는 표가 없다
    assert.equal(upgradeChecklist(city({ cityLevel: MAX_CITY_LEVEL - 1, materials: 999 }))!.checks[0]!.kind, 'emperor');
    assert.equal(upgradeChecklist(city({ cityLevel: MAX_CITY_LEVEL })), null);

    // 다 채우면 칸이 전부 ok이고 단추도 열린다
    const ready = stocked(city({ cityLevel: 2, materials: 999 }), 20, 2);
    assert.ok(upgradeChecklist(ready)!.checks.every((c) => c.ok));
    assert.equal(canUpgradeCity(ready).ok, true);
  });

  it('옛 보관함은 되접기가 정리한다 — 자리만큼 귀한 등급부터 풀로(카드 한 장이 본체), 남은 카드는 잉여 카드', () => {
    let p = fillPool(city(), 59, ['C', 'D']);                     // 궁궐 Lv1(60)에 한 자리
    const emperor = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;
    const s = OFFICERS.find((o) => o.grade === 'S' && !p.roster[o.id as OfficerId])!.id as OfficerId;
    const d = OFFICERS.find((o) => o.grade === 'D' && !p.roster[o.id as OfficerId])!.id as OfficerId;
    p = { ...p, cards: { ...p.cards, [d]: 1, [s]: 3, [emperor]: 2 } };

    const once = settleLegacyBox(p);
    assert.ok(once.roster[emperor], '헌제가 먼저다');
    assert.equal(once.cards[emperor], 1, '두 장 중 한 장은 본체, 한 장은 카드');
    assert.equal(once.roster[s], undefined);
    assert.equal(once.cards[s], undefined);
    assert.equal(once.cards[d], undefined);
    assert.equal(once.surplusCards, 4, '자리가 없어 남은 S 3장 + D 1장은 잉여 카드');
    assert.equal(settleLegacyBox(once), once, '정리할 것이 없으면 같은 객체');
    // 서버는 읽을 때마다 되접는다 — JSON 왕복으로도 같은 결과
    const back = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.ok(back.roster[emperor]);
    assert.equal(back.surplusCards, 4);
  });
});

describe('건물 — 증축이 고른 셋을 함께 올린다 (GDD §5.2 · §5.3)', () => {
  it('도시 Lv1에서는 건물을 안 올린다 — 첫 증축(Lv2)부터 셋을 고른다', () => {
    const p = stocked(city({ cityLevel: 1 }));
    assert.equal(BUILD_CITY_LEVEL, 2);
    assert.equal(upgradePickCount(p), UPGRADE_PICKS, 'Lv1→2 증축이 처음 고르는 자리다');
  });

  /**
   * ★ **「황제 없는 상한에서 다섯이 남는다」를 실제로 올려 보고 확인한다** (GDD §5.2).
   * 데이터 회귀가 산수로도 재지만(`extract_data.py`), 여기서는 **규칙을 통해** 도시를 올리며 셋씩 고르고 남는 칸을 센다.
   * 서로 다른 셋이라 몰아 올리면 끝에서 고를 곳이 모자랄 수 있다 — 낮은 것부터 고르면 남김없이 쓴다.
   */
  it('낮은 건물부터 고르며 올리면 황제 없는 상한에서 다섯 칸이 남는다 ★', () => {
    let p = stocked(city({ materials: 9999 }));
    while (canUpgradeCity(p).ok) {
      // 홀수 레벨 증축의 궁궐(`forcedUpgradePicks`)을 먼저, 나머지는 낮은 것부터
      const must = forcedUpgradePicks(p);
      const picks = [...must, ...[...BUILDINGS].filter((b) => buildingLevel(p, b.id) < b.maxLevel && !must.includes(b.id))
        .sort((x, y) => buildingLevel(p, x.id) - buildingLevel(p, y.id)).map((b) => b.id)].slice(0, upgradePickCount(p));
      assert.equal(picks.length, UPGRADE_PICKS, `Lv${p.cityLevel}에서 셋을 다 골랐다`);
      p = applyCityUpgrade(p, T0, picks);
    }
    assert.equal(p.cityLevel, MAX_CITY_LEVEL - 1, '헌제가 없으면 황궁 앞이 상한이다');
    const left = BUILDINGS.reduce((n, b) => n + b.maxLevel - buildingLevel(p, b.id), 0);
    assert.equal(left, 5, 'pptx 57쪽이 보여 주려던 그 다섯이다 — 황궁이 연다');
  });

  /**
   * 화면이 「지금 60 → 다음 110」을 직접 계산하면 **만렙 경계에서 `undefined`가
   * 새고 그대로 화면에 뜬다.** 그래서 규칙이 낸다 — `growthPreview()`와 같은 자리.
   */
  it('건물 줄을 규칙이 낸다 — 지금 값과 다음 값', () => {
    const fresh = city();
    const rows = buildingRows(fresh);
    assert.equal(rows.length, BUILDINGS.length, '안 지은 줄도 빼지 않는다');

    const palace = rows.find((r) => r.id === 'palace')!;
    assert.equal(palace.level, 1, '기본 건물은 처음부터 Lv1');
    assert.equal(palace.effect!.now, 60);
    assert.equal(palace.effect!.next, 110);

    const farm = rows.find((r) => r.id === 'farm')!;
    assert.equal(farm.level, 0, '추가 건물은 지어야 생긴다');
    assert.equal(farm.effect!.now, 1, '농지가 없어도 시간당 1');
    assert.equal(farm.effect!.next, 2);

    /*
     * ★ **안 지었을 때는 증분이 아니라 소개를 적는다.** 「시간당 군량 1 → 2」는
     * 그 건물이 뭘 하는지 모르는 사람에게 아무 말도 안 한다.
     */
    assert.equal(farm.line, '시간당 군량 증가 1', '안 지었으면 소개');
    assert.equal(palace.line, '캐릭터 풀 60 → 110', '지었으면 지금 → 다음');
    assert.equal(rows.find((r) => r.id === 'market')!.line, null, '값이 없으면 화면이 채운다');
    assert.equal(rows.find((r) => r.id === 'market')!.effect, null);

    const maxed = buildingRows({ ...fresh, buildings: { ...fresh.buildings, farm: 5 } });
    assert.equal(maxed.find((r) => r.id === 'farm')!.effect!.next, null);
    assert.equal(maxed.find((r) => r.id === 'farm')!.line, '시간당 군량 10', '만렙엔 화살표가 없다');
  });

  it('되접기 — 옛 건설 기회는 버리고, 황궁 계정은 건물이 전부 최대다', () => {
    const saved = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    saved.version = 3;
    saved.cityLevel = 7;
    delete saved.buildings;
    saved.buildCredits = 6;
    const back = migrateProfile(saved)!;
    assert.equal('buildCredits' in back, false, '건설 기회는 없어졌다(2026-11-23)');
    for (const b of BUILDINGS) assert.equal(buildingLevel(back, b.id), b.kind === 'basic' ? 1 : 0, b.name);

    const palace = JSON.parse(JSON.stringify(createProfile('황궁성', 5))) as Record<string, unknown>;
    palace.cityLevel = MAX_CITY_LEVEL;
    const top = migrateProfile(palace)!;
    for (const b of BUILDINGS) assert.equal(buildingLevel(top, b.id), b.maxLevel, b.name);
  });
});

describe('부상과 치료 (GDD §5.7)', () => {
  const anyone = (p: PlayerProfile, n = 5): OfficerId[] =>
    Object.keys(p.roster).slice(0, n) as OfficerId[];

  /** 병원을 그 레벨로 세운 계정 */
  const withHospital = (level: number, over: Partial<PlayerProfile> = {}): PlayerProfile => {
    const p = city(over);
    return { ...p, buildings: { ...p.buildings, hospital: level } };
  };

  it('HP 0으로 퇴각하면 무·지·통이 각 −10 — 한 시간 뒤에 낫는다', () => {
    let p = city();
    const [a] = anyone(p, 1);
    p = applyInjuries(p, [a!], T0);

    assert.equal(isInjured(p.roster[a!]!, T0), true);
    assert.equal(injuredStat(72), 72 - INJURY_PENALTY);
    assert.equal(injuredStat(3), 1, '하한 1 — 지금 데이터로는 닿지 않는 방어다');

    assert.equal(isInjured(p.roster[a!]!, T0 + INJURY_RECOVER_MS - 1), true);
    assert.equal(isInjured(p.roster[a!]!, T0 + INJURY_RECOVER_MS), false, '한 시간 뒤에 낫는다');
  });

  it('헌제는 부상하지 않는다 — 깎을 것이 없다', () => {
    const emperor = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;
    const p0 = city();
    const p = applyInjuries(
      { ...p0, roster: { ...p0.roster, [emperor]: newInstance(emperor) } }, [emperor], T0,
    );
    assert.equal(p.roster[emperor]!.injuredAt, undefined);
  });

  it('중첩되지 않는다 — 타이머만 다시 선다', () => {
    let p = city();
    const [a] = anyone(p, 1);
    p = applyInjuries(p, [a!], T0);
    const later = T0 + 30 * 60_000;
    p = applyInjuries(p, [a!], later);
    assert.equal(p.roster[a!]!.injuredAt, later, '시각이 새로 찍힌다');
    assert.equal(isInjured(p.roster[a!]!, T0 + INJURY_RECOVER_MS), true, '처음 한 시간에는 아직 안 낫는다');
  });

  it('병원이 없으면 치료할 수 없고 **왜인지 말한다**', () => {
    let p = city();
    const [a] = anyone(p, 1);
    p = applyInjuries(p, [a!], T0);
    assert.equal(hospitalRooms(p), 0);
    const check = canHeal(p, a!, T0);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /병원/);
  });

  it('치료는 1분 걸리고 room은 그 뒤 5분 더 바쁘다 — 즉시가 아니다 ★', () => {
    let p = withHospital(1);
    const [a, b] = anyone(p, 2);
    p = applyInjuries(p, [a!, b!], T0);

    p = applyHeal(p, a!, T0);
    assert.equal(isInjured(p.roster[a!]!, T0 + HEAL_MS - 1), true, '아직 치료 중이다');
    assert.equal(isInjured(p.roster[a!]!, T0 + HEAL_MS), false, '1분 뒤에 낫는다');

    // room은 치료가 끝난 뒤에도 쿨타임이 남는다
    assert.equal(freeRooms(p, T0 + HEAL_MS), 0, '나았어도 room은 아직 바쁘다');
    assert.equal(canHeal(p, b!, T0 + HEAL_MS).ok, false);
    assert.equal(freeRooms(p, T0 + ROOM_CYCLE_MS), 1, '재사용 주기는 치료 1분 + 쿨 5분');
    assert.equal(canHeal(p, b!, T0 + ROOM_CYCLE_MS).ok, true);
  });

  /**
   * ★ **GDD §5.7의 완치 시간 표를 그대로 잰다.**
   *
   * Lv3에서 3v3이, Lv5에서 5v5가 **정확히 1분**이 되는 것이 이 수치의 설계
   * 의도다. 처음 안(즉시 완치 + 쿨 5분)이면 Lv3이 0분이 되어 「치료하러 간다」가
   * 화면에서 사라졌다 — 그 차이를 여기서 붙잡는다.
   *
   * **경계 두 점을 함께 본다** — Lv1(가장 느림)과 Lv5(가장 빠름)만 맞고 가운데가
   * 어긋난 적이 실제로 있었다(「가운데만 재는 회귀는 끝이 어긋난 것을 놓친다」의 짝).
   */
  it('부대 전멸 → 완치까지 걸리는 시간 (병원 Lv1~5 × 3v3·5v5) ★', () => {
    /** 빈 room이 나는 대로 밀어 넣었을 때 **마지막 한 명이 낫는** 시각까지 */
    function healAll(profile: PlayerProfile, ids: OfficerId[]): number {
      let p = profile;
      let now = T0;
      const waiting = [...ids];
      let done = T0;
      while (waiting.length > 0) {
        while (waiting.length > 0 && freeRooms(p, now) > 0) {
          const id = waiting.shift()!;
          p = applyHeal(p, id, now);
          done = Math.max(done, now + HEAL_MS);
        }
        if (waiting.length === 0) break;
        const next = nextRoomFreeAt(p, now);
        assert.ok(next !== null, '빈 room도 없고 비는 시각도 없다 — 영원히 안 낫는다');
        now = next!;
        p = syncCity(p, now);
      }
      return (done - T0) / 60_000;
    }

    const table: [level: number, three: number, five: number][] = [
      [1, 13, 25],
      [2, 7, 13],
      [3, 1, 7],
      [4, 1, 7],
      [5, 1, 1],
    ];
    for (const [level, three, five] of table) {
      for (const [n, want] of [[3, three], [5, five]] as const) {
        let p = withHospital(level);
        const ids = anyone(p, n);
        assert.equal(ids.length, n, '표본이 모자라면 검사가 헐거워진다');
        p = applyInjuries(p, ids, T0);
        assert.equal(healAll(p, ids), want, `병원 Lv${level} · ${n}명`);
      }
    }
  });

  it('병원이 없으면 60분 — 각자 병렬로 돌아 인원수와 무관하다', () => {
    let p = city();
    const ids = anyone(p, 5);
    p = applyInjuries(p, ids, T0);
    for (const id of ids) {
      assert.equal(isInjured(p.roster[id]!, T0 + INJURY_RECOVER_MS - 1), true);
      assert.equal(isInjured(p.roster[id]!, T0 + INJURY_RECOVER_MS), false);
    }
  });

  /**
   * ★ **이 설계의 요점** — 부상은 전투에 실리지만 전투력에는 안 실린다.
   *
   * 반영하면 **일부러 부상 상태로 나가 약한 상대를 고르는** 길이 열린다(매칭이
   * 전투력으로 상대를 고른다, GDD §7.1). 반영하지 않으면 부상 출전은 순수한
   * 손해로만 남는다. **양쪽을 다 봐야** 한쪽만 고쳤을 때 잡힌다.
   */
  it('전투에는 실리고 전투력에는 안 실린다 ★', () => {
    let p = city();
    const picks: RosterPick[] = Object.keys(p.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));
    p = applyInjuries(p, picks.map((k) => k.officer), T0);

    // 시각을 넣으면 실린다
    const forBattle = toRosterEntries(p, picks, T0);
    assert.ok(forBattle.every((e) => e.injured === true), '전투에는 부상이 실린다');

    // 안 넣으면 안 실린다 — 전투력이 보는 것이 이쪽이다
    const forPower = toRosterEntries(p, picks);
    assert.ok(forPower.every((e) => e.injured === undefined), '전투력은 온전한 값을 본다');
    assert.equal(battlePower('3v3', forBattle), battlePower('3v3', forPower),
      '부상으로 전투력이 흔들리면 매칭 상대가 흔들린다');

    // 나은 뒤에는 시각을 넣어도 안 실린다
    const healed = toRosterEntries(p, picks, T0 + INJURY_RECOVER_MS);
    assert.ok(healed.every((e) => e.injured === undefined));
  });

  it('전투 결과의 `fallen`이 부상을 매긴다 — 승패와 무관하다', () => {
    let p = city();
    const picks: RosterPick[] = Object.keys(p.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));
    const fallen = [picks[0]!.officer];

    // **이긴 판에서도 퇴각한 장수는 다친다**
    const outcome: BattleOutcome = {
      result: 'win', mode: '3v3', opponent: 'siege', picks, fallen,
      power: { mine: 700, theirs: 700 }, at: T0,
    };
    p = applyBattleResult(p, outcome, 1).profile;
    assert.equal(isInjured(p.roster[fallen[0]!]!, T0), true, '이겼어도 다친다');
    assert.equal(isInjured(p.roster[picks[1]!.officer]!, T0), false, '살아남은 장수는 멀쩡하다');
  });

  it('대결에 져서 다친 채 살아남은 장수(`wounded`)도 같은 부상이다 — 쓰러지기도 했으면 한 번만 (GDD §3.11 R11)', () => {
    let p = city();
    const picks: RosterPick[] = Object.keys(p.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));
    const outcome: BattleOutcome = {
      result: 'lose', mode: '3v3', opponent: 'siege', picks,
      fallen: [picks[0]!.officer], wounded: [picks[0]!.officer, picks[1]!.officer],
      power: { mine: 700, theirs: 700 }, at: T0,
    };
    p = applyBattleResult(p, outcome, 1).profile;
    assert.equal(isInjured(p.roster[picks[1]!.officer]!, T0), true, '대결로 다친 장수');
    assert.equal(isInjured(p.roster[picks[0]!.officer]!, T0), true, '쓰러지고 대결로도 다친 장수 — 부상 하나');
    assert.equal(p.roster[picks[0]!.officer]!.injuredAt, T0);
    assert.equal(isInjured(p.roster[picks[2]!.officer]!, T0), false, '멀쩡한 장수');
  });

  it('`syncCity()`가 나은 자국과 지난 room을 지운다 — 안 바뀌면 같은 객체다', () => {
    let p = withHospital(1);
    const [a] = anyone(p, 1);
    p = applyInjuries(p, [a!], T0);
    p = applyHeal(p, a!, T0);

    assert.equal(syncCity(p, T0), p, '아무 일도 없으면 같은 객체 — 분마다 저장하지 않게');

    const after = syncCity(p, T0 + ROOM_CYCLE_MS);
    assert.equal(after.roster[a!]!.injuredAt, undefined, '나은 자국을 지운다');
    assert.equal(after.roster[a!]!.healingAt, undefined);
    assert.deepEqual(after.hospitalBusy, [], '지난 room을 지운다');
  });
});

describe('되접기', () => {
  it('`grainAt`이 없는 저장분은 0으로 채워진다', () => {
    const saved = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    delete saved.grainAt;
    const back = migrateProfile(saved)!;
    assert.equal(back.grainAt, 0, '없으면 0 — 첫 정산이 도장을 찍는다');
    assert.equal(back.version, PROFILE_VERSION);
  });

  it('**새 계정**은 추가 건물이 하나도 없다 — 되접힌 v3와 같은 자리에서 시작한다', () => {
    const fresh = createProfile('새성', 5);
    assert.equal(buildingLevel(fresh, 'palace'), 1, '기본 셋은 처음부터 있다');
    assert.equal(buildingLevel(fresh, 'farm'), 0, '추가 넷은 지어야 생긴다');
    assert.equal(hospitalRooms(fresh), 0, '병원이 없으면 room도 없다');
    assert.equal(grainPerHour(fresh), 1, '농지가 없어도 시간당 1은 찬다');
  });

  it('음수·쓰레기 시각은 0이다 — 미래 시각은 그대로 둔다(손해 보는 방향이라 안전)', () => {
    const base = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    assert.equal(migrateProfile({ ...base, grainAt: -5 })!.grainAt, 0);
    assert.equal(migrateProfile({ ...base, grainAt: 'x' })!.grainAt, 0);
    assert.equal(migrateProfile({ ...base, grainAt: T0 })!.grainAt, T0);
  });
});

describe('도시 전적 (41쪽)', () => {
  /**
   * **판수 대 인원수** — 완료 조건으로 적어 둔 자리다.
   *
   * 한 판에 3~5명이 함께 뛰므로 「장수 전적을 다 더하면 도시 전적이 된다」는 성립하지
   * 않는다. C1이 계정 칸(`PlayerProfile.record`)을 따로 세는 이유가 이것이고,
   * 41쪽의 「총 출전」은 그 칸에서 나온다. 장수 전적 칸은 2026-11-20에 없어졌다(전적은 부대로 본다).
   */
  it('도시는 판수로 센다 — 세 명이 한 판을 뛰어도 1전이고, 장수에는 전적 칸이 없다', () => {
    let p = city();
    const picks: RosterPick[] = Object.keys(p.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));

    const outcome: BattleOutcome = {
      result: 'win', mode: '3v3', opponent: 'siege', picks,
      power: { mine: 700, theirs: 700 }, at: T0,
    };
    p = applyBattleResult(p, outcome, 1).profile;

    assert.equal(accountTally(p).plays, 1, '도시는 판수로 센다');
    for (const k of picks) assert.ok(!('record' in p.roster[k.officer]!), `${k.officer}에 장수 전적 칸이 생겼다`);
  });
});

describe('부상은 되접기를 지나도 남는다 (2026-09-17)', () => {
  // 서버는 계정을 읽을 때마다 `migrateProfile()`을 지난다 — 여기서 빠지면
  // 다친 장수가 **다음 읽기에서 조용히 낫는다**(병영의 「부상」 표시가 늘 「건강」이었다)
  it('injuredAt · healingAt이 저장 왕복 뒤에도 같다', () => {
    const id = OFFICERS[5]!.id as OfficerId;
    const p = createProfile('부상성', 1);
    p.roster[id] = { ...newInstance(id), injuredAt: 1_000, healingAt: 2_000 };
    const back = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    assert.equal(back.roster[id]?.injuredAt, 1_000);
    assert.equal(back.roster[id]?.healingAt, 2_000);
    assert.ok(isInjured(back.roster[id]!, 1_500));
  });
});

describe('병원 현황판 — 치료실 줄 (2026-09-18)', () => {
  const hospital = (level: number): PlayerProfile => {
    const p = city();
    return { ...p, buildings: { ...p.buildings, hospital: level } };
  };
  const ids = (p: PlayerProfile, n: number): OfficerId[] => Object.keys(p.roster).slice(0, n) as OfficerId[];

  it('병원이 없으면 줄이 없고, 레벨만큼 빈 줄이 선다', () => {
    assert.deepEqual(hospitalWards(city(), T0), []);
    assert.deepEqual(hospitalWards(hospital(3), T0), [{ state: 'empty' }, { state: 'empty' }, { state: 'empty' }]);
  });

  it('치료 1분은 환자 이름이, 쿨타임 5분은 해제 시각만 — 그 뒤에는 빈다 ★', () => {
    let p = hospital(2);
    const [a] = ids(p, 1);
    p = applyHeal(applyInjuries(p, [a!], T0), a!, T0);

    assert.deepEqual(hospitalWards(p, T0 + HEAL_MS - 1), [
      { state: 'healing', officer: a!, healedAt: T0 + HEAL_MS, freeAt: T0 + ROOM_CYCLE_MS },
      { state: 'empty' },
    ]);
    // 나은 뒤 — `syncCity()`가 자국을 지워도 방은 쿨타임으로 남는다
    const healed = syncCity(p, T0 + HEAL_MS);
    assert.deepEqual(hospitalWards(healed, T0 + HEAL_MS), [{ state: 'cooldown', freeAt: T0 + ROOM_CYCLE_MS }, { state: 'empty' }]);
    assert.deepEqual(hospitalWards(p, T0 + ROOM_CYCLE_MS), [{ state: 'empty' }, { state: 'empty' }]);
  });

  it('바쁜 방이 먼저, 먼저 비는 방이 위다 — 같은 순간 둘이 들어가도 짝이 하나씩이다', () => {
    let p = hospital(3);
    const [a, b, c] = ids(p, 3);
    p = applyInjuries(p, [a!, b!, c!], T0);
    const later = T0 + 30_000;
    p = applyHeal(p, a!, later);
    p = applyHeal(p, b!, T0);
    p = applyHeal(p, c!, T0);

    const rows = hospitalWards(p, later);
    assert.deepEqual(rows.map((r) => r.state), ['healing', 'healing', 'healing']);
    const officers = rows.map((r) => (r.state === 'healing' ? r.officer : null));
    assert.deepEqual(new Set(officers.slice(0, 2)), new Set([b!, c!]), '먼저 넣은 둘이 위');
    assert.equal(officers[2], a!, '나중에 넣은 방이 아래');
  });

  it('치료 중 다시 다치면 환자는 빠지고 방은 쿨타임으로 남는다', () => {
    let p = hospital(1);
    const [a] = ids(p, 1);
    p = applyHeal(applyInjuries(p, [a!], T0), a!, T0);
    p = applyInjuries(p, [a!], T0 + 10_000);
    assert.deepEqual(hospitalWards(p, T0 + 20_000), [{ state: 'cooldown', freeAt: T0 + ROOM_CYCLE_MS }]);
  });
});

// 누적 승리 (2026-11-14 기획자) — 공성전 · 야전 · AI 대전의 승리. 첫 증축 1승 … Lv10 100승
describe('증축 조건 — 누적 승리 (2026-11-14)', () => {
  it('레벨마다 1 · 5 · 10 · 20 · 30 · 40 · 60 · 80 · 100승', () => {
    const need = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((lv) => upgradeChecklist(city({ cityLevel: lv - 1, battleWins: 0 }))!.checks.find((c) => c.kind === 'wins')?.need);
    assert.deepEqual(need, [1, 5, 10, 20, 30, 40, 60, 80, 100]);
  });

  it('모자라면 막고 이유를 말한다 — 다른 조건이 다 찼어도', () => {
    const p = stocked(city({ materials: 999, battleWins: 0 }));
    const check = canUpgradeCity(p);
    assert.equal(check.ok ? '' : check.code, 'city.wins');
    assert.deepEqual(check.ok ? null : check.params, { have: 0, need: 1 });
    assert.ok(canUpgradeCity({ ...p, battleWins: 1 }).ok);
  });

  it('AI 대전 승리도 센다 — 전적에는 안 남아도', () => {
    const p = city({ battleWins: 0 });
    const picks = Object.keys(p.roster).slice(0, 3).map((officer, i) => ({ piece: (['King', 'Rock', 'Queen'] as const)[i]!, officer: officer as never }));
    const won = applyBattleResult(p, { result: 'win', mode: '3v3', opponent: 'ai', picks, power: 500 } as never, 1).profile;
    assert.equal(battleWinsOf(won), 1);
    assert.deepEqual(won.record, p.record, 'AI 대전은 전적에 안 센다(그대로)');
    const lost = applyBattleResult(won, { result: 'loss', mode: '3v3', opponent: 'ai', picks, power: 500 } as never, 2).profile;
    assert.equal(battleWinsOf(lost), 1);
  });

  it('값이 없는 옛 계정은 전적의 승리 합으로 읽고, 되접기를 지나도 남는다', () => {
    const { battleWins: _b, ...old } = city({ record: { 'siege/3v3': { plays: 4, wins: 3, draws: 0, losses: 1, kills: 0, points: 0 } } });
    assert.equal(battleWinsOf(old as PlayerProfile), 3);
    assert.equal(migrateProfile(JSON.parse(JSON.stringify(city({ battleWins: 7 }))))!.battleWins, 7);
  });
});
