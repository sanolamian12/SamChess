/**
 * 도시 회귀 — 군량 시간 충전과 증축 (pptx 41쪽 · GDD §5, C2 · 2026-08-18)
 *
 * 여기서 고정하는 것 다섯.
 *  - **충전이 상한을 넘지 않는다** — 상한은 「더 못 쌓는다」이지 「나중에 받는다」가 아니다
 *  - **시계가 뒤로 가도 줄지 않고, 앞뒤로 흔들어도 못 뽑는다** (`grainAt`을 당기지 않는다)
 *  - **자투리 시간이 다음 접속으로 이어진다** — 30분씩 접속해도 결국 받는다
 *  - **증축 후 풀·상한·요율이 따라온다** — 셋 다 `cityLevel`을 보고 있다
 *  - **도시(계정) 전적 합 ≠ 장수 전적 합** — 판수 대 인원수. C1이 칸을 따로 둔 이유다
 *
 * 시각은 전부 밖에서 넣는다 — meta는 `Date.now()`를 부르지 않는다(`city.ts` 참조).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId } from '@samchess/rules';
import {
  MAX_CITY_LEVEL, MS_PER_HOUR, accountTally, applyBattleResult, applyCityUpgrade,
  canUpgradeCity, cityLevel, createProfile, grainCap, grainPerHour, grainStepMs,
  migrateProfile, poolCap, syncGrain, totalTally, upgradeCost,
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
    assert.equal(grainStepMs(1), MS_PER_HOUR);

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

  it('레벨이 오르면 빨라진다 — Lv9는 9분에 하나', () => {
    assert.equal(grainStepMs(9), MS_PER_HOUR / 9);
    const p = city({ cityLevel: 9, grain: 0 });
    assert.equal(syncGrain(p, T0 + MS_PER_HOUR).grain, 9);
    assert.equal(syncGrain(p, T0 + MS_PER_HOUR / 9).grain, 1);
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

  it('최대 레벨은 더 올리지 못한다', () => {
    const p = city({ cityLevel: MAX_CITY_LEVEL, materials: 999 });
    assert.equal(canUpgradeCity(p).ok, false);
    assert.throws(() => applyCityUpgrade(p, T0), /최대 레벨/);
  });

  it('증축하면 풀·상한·요율이 따라온다 ★', () => {
    const cost = upgradeCost(1)!;
    const p = city({ materials: cost + 2, grain: 20 });
    assert.equal(canUpgradeCity(p).ok, true);

    const next = applyCityUpgrade(p, T0);
    assert.equal(next.cityLevel, 2);
    assert.equal(next.materials, 2, '재료를 정확히 그만큼 낸다');
    assert.equal(poolCap(next), cityLevel(2).characterPool);
    assert.equal(grainCap(next), cityLevel(2).grainCap);
    assert.equal(grainPerHour(next), cityLevel(2).grainPerHour);
    assert.equal(next.grain, 20, '상한이 늘 뿐 가진 군량은 그대로다');
  });

  it('증축은 **옛 요율로 먼저 정산하고** 넘어간다 ★', () => {
    // 정산을 안 하고 레벨을 올리면 Lv1에서 논 세 시간이 Lv2 요율(2/h)로 계산된다
    const p = city({ materials: upgradeCost(1)!, grain: 0 });
    const next = applyCityUpgrade(p, T0 + 3 * MS_PER_HOUR);
    assert.equal(next.grain, 3, 'Lv1의 세 시간은 3이다 (6이 아니다)');
    assert.equal(syncGrain(next, T0 + 4 * MS_PER_HOUR).grain, 5, '그 뒤 한 시간은 Lv2 요율로 2다');
  });
});

describe('되접기 — 필드가 더해질 뿐이라 버전은 안 올린다', () => {
  it('`grainAt`이 없는 저장분은 0으로 채워진다 (버전은 그대로 3)', () => {
    const saved = JSON.parse(JSON.stringify(createProfile('옛성', 5))) as Record<string, unknown>;
    delete saved.grainAt;
    const back = migrateProfile(saved)!;
    assert.equal(back.grainAt, 0, '없으면 0 — 첫 정산이 도장을 찍는다');
    assert.equal(back.version, 3, '뜻이 바뀌지 않았으므로 버전은 그대로다');
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
