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
import { BUILDINGS, OFFICERS } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  BUILD_ACTIONS_PER_UPGRADE, INJURY_PENALTY, PROFILE_VERSION, battlePower, buildCreditsLeft,
  hasEmperor, injuredStat, newInstance, unlockedBy,
  nextRoomFreeAt, toRosterEntries,
  HEAL_MS, INJURY_RECOVER_MS, MAX_CITY_LEVEL, MS_PER_HOUR, ROOM_CYCLE_MS, accountTally,
  applyBattleResult, applyBuild, applyCityUpgrade, applyHeal, applyInjuries, buildingLevel,
  canBuild, canHeal, canUpgradeCity, cityLevel, createProfile, freeRooms, grainCap,
  grainPerHour, grainStepMs, hospitalRooms, isInjured, maxCityLevel, migrateProfile,
  poolCap, syncCity, syncGrain, totalTally, upgradeCost,
} from '../src/index.ts';
import type { BattleOutcome, PlayerProfile, RosterPick } from '../src/index.ts';

/** 2023-11-14 22:13:20 UTC — 아무 뜻 없는 고정 시각. 시계를 읽지 않는다는 것이 요점이다 */
const T0 = 1_700_000_000_000;

/** 이미 한 번 정산해 둔 계정 — 「첫 정산은 도장만」 규칙을 매번 지나지 않으려고 */
function city(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return { ...createProfile('도시성', 7), grainAt: T0, ...over };
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

describe('증축 (GDD §5)', () => {
  it('재료는 `city.json`이 정한다 — 표를 옮겨 적지 않는다', () => {
    assert.equal(upgradeCost(1), cityLevel(2).materialsToUpgrade);
    assert.equal(upgradeCost(MAX_CITY_LEVEL), null, '최대 레벨에는 다음이 없다');
  });

  it('재료가 모자라면 왜인지 말한다', () => {
    const p = city({ materials: 0 });
    const check = canUpgradeCity(p);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /자재/);
    assert.throws(() => applyCityUpgrade(p, T0), /자재/);
  });

  /**
   * **황궁이 레벨을 하나 더 연다** (GDD §5.5). 헌제가 없으면 그 앞에서 멈추고,
   * 있으면 마지막 레벨까지 간다 — 「헌제는 지금 효과가 없다」(2026-08-17)가
   * 여기서 채워졌다. 한쪽만 보면 「기본값과 같은 값을 확인하는」 검사가 된다.
   */
  it('헌제가 없으면 마지막 한 레벨 앞에서 막힌다 ★', () => {
    const p = city({ cityLevel: MAX_CITY_LEVEL - 1, materials: 999 });
    assert.equal(hasEmperor(p), false);
    assert.equal(maxCityLevel(p), MAX_CITY_LEVEL - 1);
    const check = canUpgradeCity(p);
    assert.equal(check.ok, false);
    assert.match(check.ok ? '' : check.reason, /황제/, '왜 막혔는지 말한다');
    assert.throws(() => applyCityUpgrade(p, T0), /황제/);
  });

  it('헌제를 옹립하면 마지막 레벨이 열리고 거기서 끝난다 ★', () => {
    const emperor = OFFICERS.find((o) => o.grade === 'E')!.id as OfficerId;
    const withHeon = (over: Partial<PlayerProfile>): PlayerProfile => {
      const p = city(over);
      return { ...p, roster: { ...p.roster, [emperor]: newInstance(emperor) } };
    };

    const ready = withHeon({ cityLevel: MAX_CITY_LEVEL - 1, materials: 999 });
    assert.equal(hasEmperor(ready), true);
    assert.equal(maxCityLevel(ready), MAX_CITY_LEVEL);
    assert.equal(canUpgradeCity(ready).ok, true);
    assert.equal(applyCityUpgrade(ready, T0).cityLevel, MAX_CITY_LEVEL);

    const done = withHeon({ cityLevel: MAX_CITY_LEVEL, materials: 999 });
    assert.equal(canUpgradeCity(done).ok, false);
    assert.throws(() => applyCityUpgrade(done, T0), /최대 레벨/);
  });

  it('증축하면 풀·상한·요율이 따라온다 ★', () => {
    const cost = upgradeCost(1)!;
    const p = city({ materials: cost + 2, grain: 20 });
    assert.equal(canUpgradeCity(p).ok, true);

    const next = applyCityUpgrade(p, T0);
    assert.equal(next.cityLevel, 2);
    assert.equal(next.materials, 2, '재료를 정확히 그만큼 낸다');
    // ★ **증축만으로는 아무 수치도 안 늘어난다** — 늘어나는 것은 「지을 수 있는 것」이다
    assert.equal(poolCap(next), poolCap(p), '캐릭터 풀은 궁궐이 정한다');
    assert.equal(grainCap(next), grainCap(p), '군량 상한은 병영이 정한다');
    assert.equal(grainPerHour(next), grainPerHour(p), '생산량은 농지가 정한다');
    assert.equal(next.grain, 20, '가진 군량은 그대로다');
  });

  it('**농지 증축이** 옛 요율로 먼저 정산하고 넘어간다 ★', () => {
    // 정산을 안 하고 올리면 농지 없이 논 세 시간이 새 요율(2/h)로 계산된다.
    // 요율이 바뀌는 자리가 도시 증축에서 **건물 증축으로 옮겨 왔다** (2026-09-04)
    const p = city({ grain: 0, cityLevel: 1 });
    assert.equal(canBuild(p, 'farm').ok, true, '농지는 도시 Lv1부터 지을 수 있다');
    const next = applyBuild(p, 'farm', T0 + 3 * MS_PER_HOUR);
    assert.equal(next.grain, 3, '농지 없던 세 시간은 3이다 (6이 아니다)');
    assert.equal(syncGrain(next, T0 + 4 * MS_PER_HOUR).grain, 5, '그 뒤 한 시간은 농지 Lv1 요율로 2다');
  });
});

describe('건물 해금 — 도시 레벨이 문을 연다 (GDD §5.3)', () => {
  it('도시 레벨이 모자라면 못 짓고 **왜인지 말한다**', () => {
    const p = city({ cityLevel: 1 });
    assert.equal(canBuild(p, 'farm').ok, true, '농지는 도시 Lv1부터');
    const forge = canBuild(p, 'forge');
    assert.equal(forge.ok, false, '대장간은 도시 Lv2부터');
    assert.match(forge.ok ? '' : forge.reason, /Lv2/);
    assert.throws(() => applyBuild(p, 'forge', T0), /Lv2/);
  });

  /**
   * ★ **황궁 없이는 다섯이 만렙에 못 간다** (GDD §5.3). 도시 레벨을 끝까지 올려도
   * 막히는 것이 이 설계의 요점이라, 「Lv9까지 다 지어 본다」로 실제로 부딪혀 본다.
   */
  it('도시를 끝까지 올려도 다섯 건물의 Lv5는 안 열린다 ★', () => {
    // 헌제가 없을 때의 상한까지 올린 계정. **기회는 넉넉히 준다** — 여기서
    // 보려는 것은 해금 게이트이지 기회 제한이 아니다(그건 아래 describe가 본다)
    const p = city({ cityLevel: MAX_CITY_LEVEL - 1, buildCredits: 99 });
    for (const id of ['market', 'academy', 'farm', 'hospital', 'forge'] as const) {
      let cur = p;
      // 열리는 데까지 다 짓는다
      while (canBuild(cur, id).ok) cur = applyBuild(cur, id, T0);
      assert.equal(buildingLevel(cur, id), 4, `${id}는 Lv4에서 막힌다`);
      const why = canBuild(cur, id);
      assert.match(why.ok ? '' : why.reason, /Lv10/, `${id}: 황궁 레벨이 필요하다고 말한다`);
    }
    // 궁궐·병영만 마지막 레벨 앞에서 만렙에 닿는다
    for (const id of ['palace', 'barracks'] as const) {
      let cur = p;
      while (canBuild(cur, id).ok) cur = applyBuild(cur, id, T0);
      assert.equal(buildingLevel(cur, id), 5, `${id}는 Lv5까지 간다`);
    }
  });
});

describe('건설 기회 — 자재가 아니라 기회를 쓴다 (GDD §5.2)', () => {
  it('증축 한 번에 정해진 만큼 쌓이고, 지을 때마다 하나씩 준다', () => {
    const cost = upgradeCost(1)!;
    const p = city({ materials: cost, buildCredits: 1 });
    assert.equal(buildCreditsLeft(p), 1);

    const built = applyBuild(p, 'farm', T0);
    assert.equal(buildCreditsLeft(built), 0);
    // **건축 자재는 그대로다** — 값을 받는 것은 도시 증축뿐이다
    assert.equal(built.materials, p.materials);

    const check = canBuild(built, 'hospital');
    assert.equal(check.ok, false, '기회를 다 쓰면 못 짓는다');
    assert.match(check.ok ? '' : check.reason, /기회/);
    assert.throws(() => applyBuild(built, 'hospital', T0), /기회/);

    const grown = applyCityUpgrade(built, T0);
    assert.equal(buildCreditsLeft(grown), BUILD_ACTIONS_PER_UPGRADE, '증축이 사는 것은 기회다');
  });

  /**
   * ★ **해금 표가 레벨마다 정확히 `BUILD_ACTIONS_PER_UPGRADE`만큼 연다.**
   *
   * 그래서 이 제한은 「막는 것」이 아니라 **속도**다 — 성실히 따라가면 남지도
   * 모자라지도 않는다. 표를 고쳐 어느 레벨이 넷을 열면 그 레벨부터 영영 밀리는데,
   * 화면에는 「지을 게 있는데 기회가 없다」로만 보인다.
   */
  it('레벨마다 열리는 칸 수 = 증축당 기회 — 황궁만 예외다 ★', () => {
    const p = city();
    for (let lv = 1; lv < MAX_CITY_LEVEL; lv++) {
      assert.equal(unlockedBy(p, lv).length, BUILD_ACTIONS_PER_UPGRADE, `Lv${lv}`);
    }
    assert.equal(unlockedBy(p, MAX_CITY_LEVEL).length, 5, '황궁만 다섯을 한꺼번에 연다');
  });

  it('황궁 레벨에서는 제한이 풀린다 — 남은 것을 전부 짓는다 ★', () => {
    // 아무것도 안 짓고 도시만 끝까지 올린 계정(기회 0)이라도 Lv10이면 다 지어진다
    let p = city({ cityLevel: MAX_CITY_LEVEL, buildCredits: 0 });
    assert.equal(buildCreditsLeft(p), null, 'null이 「제한 없음」이다');

    for (const b of BUILDINGS) {
      while (canBuild(p, b.id).ok) p = applyBuild(p, b.id, T0);
      assert.equal(buildingLevel(p, b.id), b.maxLevel, `${b.name}은 만렙까지 간다`);
    }
  });

  it('되접기는 기회를 공짜로 주지 않는다 — 받은 만큼에서 지은 만큼을 뺀다', () => {
    const saved = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    saved.version = 3;
    saved.cityLevel = 7;
    delete saved.buildings;
    delete saved.buildCredits;
    // v3는 그 레벨에서 지을 수 있었던 것을 다 지어 둔 상태로 되만들어지므로 0이다
    assert.equal(buildCreditsLeft(migrateProfile(saved)!), 0);
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
      result: 'win', mode: '3v3', opponent: 'ai', picks, fallen,
      power: { mine: 700, theirs: 700 }, at: T0,
    };
    p = applyBattleResult(p, outcome, 1).profile;
    assert.equal(isInjured(p.roster[fallen[0]!]!, T0), true, '이겼어도 다친다');
    assert.equal(isInjured(p.roster[picks[1]!.officer]!, T0), false, '살아남은 장수는 멀쩡하다');
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

  /**
   * **v3에는 `buildings`가 없다** — 도시 레벨 하나가 상한·풀·생산량을 전부
   * 정하던 시절의 저장이다. 그 레벨에서 **지을 수 있었던 것을 최대로 지은
   * 상태**로 되만든다. 되접기가 계정을 세게 만드는 유일한 자리이고, 대안은
   * 「전부 Lv1로 두어 상한이 보유 장수보다 작아지는 것」이다.
   */
  it('v3 → v4 — 도시 레벨에서 건물을 되만든다 ★', () => {
    const saved = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    saved.version = 3;
    saved.cityLevel = 7;
    delete saved.buildings;

    const back = migrateProfile(saved)!;
    assert.equal(back.version, PROFILE_VERSION);
    // 도시 Lv7이면 궁궐·병영·시장은 Lv4, 태학·농지·병원은 Lv3, 대장간은 Lv3
    assert.equal(buildingLevel(back, 'palace'), 4);
    assert.equal(buildingLevel(back, 'barracks'), 4);
    assert.equal(buildingLevel(back, 'academy'), 3);
    assert.equal(buildingLevel(back, 'hospital'), 3);
    // **Lv5는 황궁 전용이라 도시 레벨만으로는 절대 안 나온다** (GDD §5.3)
    for (const id of ['market', 'academy', 'farm', 'hospital', 'forge'] as const) {
      assert.ok(buildingLevel(back, id) < 5, `${id}는 Lv10 전에 만렙이 될 수 없다`);
    }
  });

  it('Lv1 계정도 그때 지을 수 있던 것까지는 받는다 — 대장간만 못 받는다', () => {
    const saved = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    saved.version = 3;
    delete saved.buildings;
    const back = migrateProfile(saved)!;
    assert.equal(buildingLevel(back, 'palace'), 1);
    assert.equal(buildingLevel(back, 'farm'), 1, '농지는 도시 Lv1부터 지을 수 있었다');
    assert.equal(buildingLevel(back, 'forge'), 0, '대장간은 도시 Lv2부터라 아직 없다');
  });

  it('**새 계정**은 추가 건물이 하나도 없다 — 되접기와 다른 길이다 ★', () => {
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
   * 41쪽의 「총 출전」은 그 칸에서 나온다.
   */
  it('도시 전적 합 ≠ 장수 전적 합 — 세 명이 한 판을 뛰면 1전 대 3전 ★', () => {
    let p = city();
    const picks: RosterPick[] = Object.keys(p.roster).slice(0, 3)
      .map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: officer as OfficerId }));

    const outcome: BattleOutcome = {
      result: 'win', mode: '3v3', opponent: 'ai', picks,
      power: { mine: 700, theirs: 700 }, at: T0,
    };
    p = applyBattleResult(p, outcome, 1).profile;

    assert.equal(accountTally(p).plays, 1, '도시는 판수로 센다');
    const sumOfficers = picks.reduce((n, k) => n + totalTally(p.roster[k.officer]!).plays, 0);
    assert.equal(sumOfficers, 3, '장수 전적을 더하면 사람 수만큼 부푼다');
    assert.notEqual(accountTally(p).plays, sumOfficers);
  });
});
