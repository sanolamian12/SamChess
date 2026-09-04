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
import type { OfficerId } from '@samchess/rules';
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
  const EXPECTED = ['grain', 'grainAt', 'materials', 'buildings', 'buildCredits', 'hospitalBusy'];

  it('서버 소유 목록이 이것뿐이다 — 늘거나 줄면 여기서 먼저 걸린다', () => {
    assert.deepEqual([...SERVER_OWNED_FIELDS].sort(), [...EXPECTED].sort());
  });

  it('군량·자재·건물·기회·병원을 우겨도 서버 값이 남는다 ★', () => {
    const current = server();
    const greedy: PlayerProfile = {
      ...current,
      grain: 9999, grainAt: 0, materials: 9999, buildCredits: 99,
      buildings: { ...initialBuildings(), palace: 5, barracks: 5, farm: 5, hospital: 5 },
      hospitalBusy: [],
    };
    const saved = guardServerOwned(greedy, current);
    for (const key of EXPECTED as (keyof PlayerProfile)[]) {
      assert.deepEqual(saved[key], current[key], `${key}는 서버 값이 남아야 한다`);
      assert.notDeepEqual(saved[key], greedy[key], `${key}: 우긴 값과 같으면 검사가 헐겁다`);
    }
  });

  /**
   * **`roster`를 통째로 지킬 수는 없다** — 같은 자리에 레벨업이 들어 있다.
   * 한쪽만 확인하면 「전부 지킨다」로 고쳐도 통과해 버리므로 둘을 함께 본다.
   */
  it('레벨업은 통과시키고 부상만 지킨다 ★', () => {
    let current = server();
    const [who] = Object.keys(current.roster) as OfficerId[];
    // 서버는 이 장수를 부상으로 알고 있다
    current = {
      ...current,
      roster: { ...current.roster, [who!]: { ...current.roster[who!]!, injuredAt: T0 } },
    };

    // 클라이언트는 레벨을 올리고(정당) 부상을 지운다(우김)
    let claimed = addCard(current, who!, cardsToLevelUp(1)!);
    claimed = applyLevelUp(claimed, who!, 'hp', 'support');
    const { injuredAt: _drop, ...healed } = claimed.roster[who!]!;
    claimed = { ...claimed, roster: { ...claimed.roster, [who!]: healed } };

    const saved = guardServerOwned(claimed, current);
    assert.equal(saved.roster[who!]!.level, 2, '레벨업은 저장된다');
    assert.equal(saved.roster[who!]!.growth.length, 1);
    assert.equal(isInjured(saved.roster[who!]!, T0), true, '부상은 지워지지 않는다');
  });

  it('서버가 모르는 장수는 그대로 통과한다 — 지킬 자국이 없다', () => {
    const current = server();
    const fresh = Object.keys(current.roster)[0] === 'jo-jo' ? 'gwan-u' : 'jo-jo';
    const claimed = addCard(current, fresh as OfficerId);
    // 풀에 자리가 있으면 새 장수로 들어온다
    if (!claimed.roster[fresh as OfficerId]) return;
    const saved = guardServerOwned(claimed, current);
    assert.ok(saved.roster[fresh as OfficerId], '새 장수가 사라지면 카드가 증발한다');
  });

  it('서버가 부상을 「이미 나은 것」으로 알면 그쪽이 이긴다 — 방향이 한쪽이 아니다', () => {
    const current = server();
    const [who] = Object.keys(current.roster) as OfficerId[];
    // 클라이언트가 없는 부상을 우긴다(자기를 약하게 만드는 방향이라 이득은 없지만,
    // 「서버 값이 정본」이 방향과 무관하다는 것을 여기서 고정한다)
    const claimed: PlayerProfile = {
      ...current,
      roster: { ...current.roster, [who!]: { ...current.roster[who!]!, injuredAt: T0 } },
    };
    const saved = guardServerOwned(claimed, current);
    assert.equal(saved.roster[who!]!.injuredAt, undefined);
  });
});
