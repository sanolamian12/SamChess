/**
 * `PUT /profile`이 **무엇을 안 믿는가** (GDD §10 · H3d, 2026-09-04).
 *
 * 이 방어는 **깨져도 화면에 아무것도 안 뜬다** — 필드를 하나 빠뜨리면 그 필드만
 * 조용히 클라이언트 주장대로 저장되고 서버 로그에도 흔적이 없다. 그래서 규칙을
 * `packages/server-api`가 아니라 `@samchess/meta`에 두었고(되접기와 같은 이유),
 * 여기서 **실제로 우겨 보고** 안 먹히는 것을 확인한다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  SERVER_OWNED_FIELDS, applyLevelUp, cardsToLevelUp, addCard, createProfile,
  guardServerOwned, initialBuildings, isInjured,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const T0 = 1_700_000_000_000;

/** 서버가 갖고 있는 정본 */
const server = (): PlayerProfile => ({
  ...createProfile('내성', 7),
  grain: 10, grainAt: T0, materials: 4, buildCredits: 1, cityLevel: 3,
  buildings: { ...initialBuildings(), farm: 2 },
  hospitalBusy: [T0 + 60_000],
  forgeOrder: { equipmentId: 'dae-gam-do', startedAt: T0 },
});

describe('PUT /profile — 서버 소유 필드는 클라이언트가 못 바꾼다', () => {
  /**
   * ★ **목록을 여기 손으로 적는다.** 처음에는 `SERVER_OWNED_FIELDS`를 돌면서
   * 확인했는데, 그러면 **검사가 자기가 검사할 목록에서 기대값을 뽑는다** — 소스에서
   * `materials`를 빼 보니 볼 항목이 하나 줄 뿐 **그대로 통과했다.** 「기본값과 같은
   * 값을 확인하면 아무것도 확인하지 않는 것」의 사촌이고, 실제로 밟았다.
   *
   * 그래서 **기대 목록을 따로 적고, 소스의 목록과 같은지도 함께 본다** — 필드를
   * 더하면 아래 두 줄이 함께 깨지면서 「전용 경로는 만들었나」를 묻게 된다.
   */
  const EXPECTED = [
    'grain', 'grainAt', 'materials', 'buildings', 'buildCredits', 'hospitalBusy', 'forgeOrder',
    // 제작일(2026-09-11) — 찍는 자리가 `collectForgeOrder()` 하나이고, 그 함수를
    // 시각과 함께 부르는 것은 서버의 `getProfile()`이다
    'forgeMadeAt',
    // 금화와 가챠 배열(2026-09-14, A1) — 로컬 가챠·도시 이름·재설계가 `PUT`으로 금화를 적을 수 있었다
    'gold', 'gachaPool',
    // 장수 명단과 카드(2026-09-14, A2) — 레벨업·재설계·카드 정리가 서버 경로로 옮겨 오며
    // 장수 한 명 안에 클라이언트가 바꾸는 값이 남지 않았다
    'roster', 'cards',
    // 도시 이름(2026-09-19) — 계정 사이에 고유해졌다. 첫 저장과 `POST /city/rename`만 정한다
    'cityName', 'cityNameChangedAt',
    // 도적떼(2026-09-21) — 출몰·정산이 서버 시계로만 일어난다. 파수꾼(`farmGuards`)은 클라이언트 것이다
    'raid',
    // 태학 연구(2026-09-22) — 전투의 책략을 바꾼다. `POST /academy/*`만 정한다
    'academy',
  ];

  it('서버 소유 목록이 이것뿐이다 — 늘거나 줄면 여기서 먼저 걸린다', () => {
    assert.deepEqual([...SERVER_OWNED_FIELDS].sort(), [...EXPECTED].sort());
  });

  it('군량·자재·건물·기회·병원·금화·가챠 배열·명단·카드를 우겨도 서버 값이 남는다 ★', () => {
    const base = server();
    const [who] = Object.keys(base.roster) as OfficerId[];
    const current: PlayerProfile = {
      ...base, gold: 30, gachaPool: { seed: 11, drawn: 7 }, cards: { [who!]: 2 } as PlayerProfile['cards'],
      cityNameChangedAt: T0,
      raid: { day: '2026-09-21', bandits: 5, spawnedAt: T0, grainAtSpawn: 40, status: 'pending' },
      academy: { done: [], research: { level: 1, tactic: 'jeung-pok-plus' as TacticId, startedAt: T0 } },
    };
    const greedy: PlayerProfile = {
      ...current,
      grain: 9999, grainAt: 0, materials: 9999, buildCredits: 99,
      buildings: { ...initialBuildings(), palace: 5, barracks: 5, farm: 5, hospital: 5 },
      hospitalBusy: [],
      forgeOrder: { equipmentId: 'su-geuk', startedAt: 0 },
      forgeMadeAt: { 'su-geuk': 1 },
      // 금화를 불리고, 가챠 배열을 처음으로 되감아 좋은 줄을 다시 뽑으려 한다
      gold: 999_999, gachaPool: { seed: 11, drawn: 0 },
      // 카드를 불리고 장수를 Lv9로 적는다 — 도시 레벨 상한도 증축의 보유 조건도 이걸 본다
      cards: { [who!]: 999 } as PlayerProfile['cards'],
      roster: { ...current.roster, [who!]: { ...current.roster[who!]!, level: 9 } },
      // 금화·쿨다운 없이 이름을 바꾸려 한다 — 남의 도시 이름이면 그 뒤 저장이 전부 막힌다
      cityName: '남의성', cityNameChangedAt: 0,
      // 도적떼를 「이미 이겼다」로 적는다 — 약탈을 피하고 출정의 막힘도 푼다
      raid: { day: '2026-09-21', bandits: 5, spawnedAt: T0, grainAtSpawn: 40, status: 'won', loot: 0 },
      // 태학 연구를 1시간 기다리지 않고 「끝났다」로 적는다 — 개량형으로 싸운다
      academy: { done: [{ level: 1, tactic: 'jeung-pok-plus' as TacticId, doneAt: 0 }] },
    };
    const saved = guardServerOwned(greedy, current);
    for (const key of EXPECTED as (keyof PlayerProfile)[]) {
      assert.deepEqual(saved[key], current[key], `${key}는 서버 값이 남아야 한다`);
      assert.notDeepEqual(saved[key], greedy[key], `${key}: 우긴 값과 같으면 검사가 헐겁다`);
    }
  });

  /**
   * **레벨업은 이제 서버 경로다** (2026-09-14, A2). 예전 이 자리의 검사는 「레벨업은
   * 통과시키고 부상만 지킨다」였다 — 정확히 그 틈이 레벨 상한을 무력하게 했다.
   * 규칙대로 올린 것이라도 `PUT`으로 온 레벨은 남지 않는다.
   */
  it('규칙대로 올렸어도 PUT으로 온 레벨·카드 소비는 저장되지 않는다 ★', () => {
    const current: PlayerProfile = { ...server(), cityLevel: 3 };
    const [who] = Object.keys(current.roster) as OfficerId[];
    let claimed = addCard(current, who!, cardsToLevelUp(1)!);
    claimed = applyLevelUp(claimed, who!, 'hp', 'support');
    assert.equal(claimed.roster[who!]!.level, 2, '우긴 쪽은 올라 있어야 검사가 헐겁지 않다');

    const saved = guardServerOwned(claimed, current);
    assert.equal(saved.roster[who!]!.level, 1);
    assert.equal(saved.roster[who!]!.growth.length, 0);
    assert.deepEqual(saved.cards, current.cards);
  });

  it('PUT으로 새 장수를 얹어도 사라진다 — 명단은 보상·가챠·지급 경로로만 는다', () => {
    const current = server();
    const fresh = (['jo-jo', 'gwan-u', 'yu-bi'] as OfficerId[]).find((id) => !current.roster[id])!;
    const claimed = addCard(current, fresh);
    assert.ok(claimed.roster[fresh] || claimed.cards[fresh], '우긴 쪽에는 그 장수가 있어야 한다');

    const saved = guardServerOwned(claimed, current);
    assert.equal(saved.roster[fresh], undefined);
    assert.equal(saved.cards[fresh], undefined);
  });

  it('부상은 어느 방향으로 우겨도 서버 값이다', () => {
    const base = server();
    const [who] = Object.keys(base.roster) as OfficerId[];
    const hurt: PlayerProfile = {
      ...base,
      roster: { ...base.roster, [who!]: { ...base.roster[who!]!, injuredAt: T0 } },
    };
    // 서버는 다쳤다고 알고 클라이언트가 지운다
    const { injuredAt: _drop, ...healed } = hurt.roster[who!]!;
    const erased = guardServerOwned({ ...hurt, roster: { ...hurt.roster, [who!]: healed } }, hurt);
    assert.equal(isInjured(erased.roster[who!]!, T0), true, '부상은 지워지지 않는다');
    // 서버는 멀쩡하다고 알고 클라이언트가 부상을 우긴다(이득은 없지만 방향과 무관하게 서버가 정본이다)
    const claimedHurt = guardServerOwned(hurt, base);
    assert.equal(claimedHurt.roster[who!]!.injuredAt, undefined);
  });
});
