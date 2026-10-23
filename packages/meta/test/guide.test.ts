/**
 * 안내 내관 — 띄울 차례 · 본 것 적기 · 그림의 단 · 클라이언트 소유 · 되접기 (`guide.ts`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BASIC_TUTORIALS, GUIDE_IDS, canUpgradeCity, nextTourStop, GUIDE_SCREEN_OF, GUIDE_SCREENS, SERVER_OWNED_FIELDS, applyTutorialDone, cardsToLevelUp, createProfile, guardServerOwned, guideHonor, guideSeen, hasEmperor, markGuideSeen,
  migrateProfile, pendingGuide, stewardTier,
} from '../src/index.ts';
import type { GuideId, PlayerProfile } from '../src/index.ts';
import { COLLECTIONS, OFFICERS } from '@samchess/data';

const fresh = (): PlayerProfile => createProfile('안내성', 7);
const at = (p: PlayerProfile, cityLevel: number): PlayerProfile => ({ ...p, cityLevel });
const seen = (p: PlayerProfile, ...ids: GuideId[]): PlayerProfile => ids.reduce(markGuideSeen, p);

describe('띄울 차례', () => {
  it('가입 직후 — 성 안이면 인사, 산 너머면 돌아오는 길', () => {
    assert.equal(pendingGuide(fresh(), 'main', { view: 'core', extended: false }), 'main.intro');
    assert.equal(pendingGuide(fresh(), 'main', { view: 'ext', extended: true }), 'town.enter');
  });

  it('인사를 봤으면 Lv1에는 더 할 말이 없다', () => {
    assert.equal(pendingGuide(seen(fresh(), 'main.intro'), 'main', { view: 'core', extended: false }), null);
  });

  it('도시 레벨 — 지금 레벨 이하에서 가장 높은 것 하나', () => {
    const p = seen(fresh(), 'main.intro');
    assert.equal(pendingGuide(at(p, 2), 'main', { view: 'core', extended: false }), 'city.lv2');
    assert.equal(pendingGuide(at(p, 4), 'main', { view: 'core', extended: false }), 'city.lv3');
    assert.equal(pendingGuide(at(p, 11), 'main', { view: 'core', extended: false }), 'city.lv9');
  });

  it('높은 레벨 안내를 보면 아래 것도 함께 본 것이 된다 — 뒤늦게 Lv2 소식이 오지 않는다', () => {
    const p = seen(at(fresh(), 5), 'main.intro', 'city.lv5');
    assert.ok(guideSeen(p, 'city.lv2') && guideSeen(p, 'city.lv3'));
    assert.equal(guideSeen(p, 'city.lv7'), false);
    assert.equal(pendingGuide(p, 'main', { view: 'core', extended: false }), null);
  });

  it('산 너머 건물이 생기면 [마을로] — 도시 레벨 안내 다음 차례', () => {
    const p = seen(at(fresh(), 2), 'main.intro');
    assert.equal(pendingGuide(p, 'main', { view: 'core', extended: true }), 'city.lv2');
    assert.equal(pendingGuide(seen(p, 'city.lv2'), 'main', { view: 'core', extended: true }), 'town.open');
    assert.equal(pendingGuide(seen(p, 'city.lv2', 'town.open'), 'main', { view: 'core', extended: true }), null);
  });
});

describe('1차 묶음 — 메인 밖의 화면', () => {
  it('병영 — 기본 튜토리얼 전에는 「잠겼다」, 끝낸 뒤에는 「출정 길이 열렸다」만', () => {
    assert.equal(pendingGuide(fresh(), 'barracks'), 'barracks.intro');
    const done = BASIC_TUTORIALS.reduce((p, id) => applyTutorialDone(p, id), fresh());
    assert.equal(pendingGuide(done, 'barracks'), 'barracks.sortieOpen');
    assert.equal(pendingGuide(seen(done, 'barracks.sortieOpen'), 'barracks'), null);
  });

  it('화면마다 처음 한 번 — 튜토리얼 목록 · 부대 · 출정 · 결과 · 궁궐', () => {
    const cases = [['tutorial', 'tutorial.list'], ['squads', 'squads.intro'], ['sortie', 'sortie.intro'],
      ['result', 'result.first'], ['palace', 'palace.intro']] as const;
    for (const [screen, id] of cases) {
      assert.equal(pendingGuide(fresh(), screen), id);
      assert.equal(pendingGuide(seen(fresh(), id), screen), null);
    }
  });

  it('장수 일람 — 레벨업할 수 있는 장수가 생겼을 때만', () => {
    const p = at(fresh(), 3);
    assert.equal(pendingGuide(p, 'officers'), null);
    const id = Object.keys(p.roster)[0]!;
    const ready = { ...p, cards: { ...p.cards, [id]: cardsToLevelUp(1)! } } as PlayerProfile;
    assert.equal(pendingGuide(ready, 'officers'), 'officer.levelup');
    assert.equal(pendingGuide(seen(ready, 'officer.levelup'), 'officers'), null);
  });

  it('모든 안내는 화면 하나에 속하고, 다시 보기 묶음은 처음 지나가는 차례다', () => {
    for (const id of GUIDE_IDS) assert.ok(GUIDE_SCREENS.includes(GUIDE_SCREEN_OF[id]), id);
    assert.equal(GUIDE_SCREENS[0], 'main');
  });
});

describe('동선 재설계 (2026-10-23) — 둘러보기 · 증축 · 궁궐 · 장터 · 대자보 · 건물', () => {
  it('둘러보기 — 궁궐 → 장터 → 대자보 → 병영, 다녀온 곳은 건너뛴다', () => {
    assert.equal(nextTourStop(fresh()), null);   // 인사 전에는 가리키지 않는다
    let p = seen(fresh(), 'main.intro');
    assert.equal(nextTourStop(p), 'palace');
    assert.equal(pendingGuide(p, 'main', { view: 'core' }), null);   // 궁궐은 인사가 가리켰다
    p = seen(p, 'palace.intro');
    assert.equal(pendingGuide(p, 'main', { view: 'core' }), 'tour.market');
    p = seen(p, 'tour.market', 'board.intro');   // 장터를 건너뛰고 대자보에 먼저 갔다
    assert.equal(nextTourStop(p), 'market');
    p = seen(p, 'market.intro');
    assert.equal(nextTourStop(p), 'barracks');
    assert.equal(pendingGuide(p, 'main', { view: 'core' }), 'tour.barracks');
    assert.equal(nextTourStop(seen(p, 'barracks.sortieOpen')), null);
  });

  it('증축할 채비 — 조건이 채워졌을 때 메인에서 처음 한 번만', () => {
    const toured = seen(fresh(), 'main.intro', 'palace.intro', 'market.intro', 'board.intro', 'barracks.intro');
    assert.equal(pendingGuide(toured, 'main', { view: 'core' }), null);
    const extra = OFFICERS.filter((o) => !toured.roster[o.id as keyof typeof toured.roster]).slice(0, 20);
    const ready = {
      ...toured, materials: 99,
      roster: { ...toured.roster, ...Object.fromEntries(extra.map((o) => [o.id, { ...Object.values(toured.roster)[0]!, officer: o.id }])) },
    } as PlayerProfile;
    assert.ok(canUpgradeCity(ready).ok, JSON.stringify(canUpgradeCity(ready)));
    assert.equal(pendingGuide(ready, 'main', { view: 'core' }), 'city.ready');
    assert.equal(pendingGuide(seen(ready, 'city.ready'), 'main', { view: 'core' }), null);
  });

  it('궁궐 — Lv1은 소개만, Lv2부터 건축 · 증축 · 장수 레벨업', () => {
    assert.equal(pendingGuide(fresh(), 'palace'), 'palace.intro');
    assert.equal(pendingGuide(seen(fresh(), 'palace.intro'), 'palace'), null);
    assert.equal(pendingGuide(seen(at(fresh(), 2), 'palace.intro'), 'palace'), 'palace.grow');
    // Lv2에 처음 궁궐에 왔으면 소개 → 새로 열린 것 차례로
    assert.equal(pendingGuide(at(fresh(), 2), 'palace'), 'palace.intro');
  });

  it('장터 · 대자보 — 처음 한 번, 대자보는 컬렉션을 채울 수 있게 되면 다시', () => {
    assert.equal(pendingGuide(fresh(), 'market'), 'market.intro');
    assert.equal(pendingGuide(fresh(), 'board'), 'board.intro');
    const p = seen(fresh(), 'board.intro');
    const card = COLLECTIONS.flatMap((c) => c.slots).find((s) => s.kind === 'card')!;
    const ready = { ...p, cards: { ...p.cards, [card.id]: 3 } } as PlayerProfile;
    assert.equal(pendingGuide(ready, 'board'), 'board.collection');
    assert.equal(pendingGuide(seen(ready, 'board.collection'), 'board'), null);
  });

  it('산 너머 건물 — 지은 것에 처음 들어갈 때만', () => {
    const p = fresh();
    assert.equal(pendingGuide(p, 'building', { building: 'academy' }), null);
    const built = { ...p, buildings: { ...p.buildings, academy: 1 } } as PlayerProfile;
    assert.equal(pendingGuide(built, 'building', { building: 'academy' }), 'building.academy');
    assert.equal(pendingGuide(built, 'building', { building: 'farm' }), null);
    assert.equal(pendingGuide(seen(built, 'building.academy'), 'building', { building: 'academy' }), null);
  });
});

describe('황제 등극', () => {
  // 헌제(E급)를 거느린 계정 — 풀에 넣는다(보관함도 보유로 센다, `hasEmperor`)
  const withEmperor = (p: PlayerProfile): PlayerProfile => {
    const id = 'heon-je';
    return { ...p, roster: { ...p.roster, [id]: { ...Object.values(p.roster)[0]!, officer: id } } } as PlayerProfile;
  };

  it('헌제가 들어오면 인사 다음, 밀린 레벨 안내보다 먼저 — 호칭은 도시 레벨 그대로(군주가 황제가 되는 것이 아니다)', () => {
    const p = withEmperor(seen(at(fresh(), 5), 'main.intro'));
    assert.ok(hasEmperor(p));
    assert.equal(pendingGuide(p, 'main', { view: 'core', extended: false }), 'emperor');
    assert.equal(guideHonor(p), 3);
    assert.equal(pendingGuide(seen(p, 'emperor'), 'main', { view: 'core', extended: false }), 'city.lv5');
  });

  it('헌제가 없으면 안 나오고, 호칭은 도시 레벨을 따른다', () => {
    const p = seen(at(fresh(), 5), 'main.intro', 'city.lv5');
    assert.equal(pendingGuide(p, 'main', { view: 'core', extended: false }), null);
    assert.equal(guideHonor(p), 3);
  });
});

describe('본 것 적기', () => {
  it('이미 봤으면 같은 객체 — 화면이 「바뀌었으면 저장」으로 쓴다', () => {
    const p = seen(fresh(), 'main.intro');
    assert.equal(markGuideSeen(p, 'main.intro'), p);
  });
});

describe('그림의 단', () => {
  it('도시 레벨 둘씩 한 사람 — 황제(Lv11)도 다섯째', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(stewardTier), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5]);
  });
});

describe('저장', () => {
  it('클라이언트 소유 — PUT으로 올린 값이 그대로 남는다', () => {
    assert.equal((SERVER_OWNED_FIELDS as readonly string[]).includes('guide'), false);
    const server = fresh();
    const incoming = seen(fresh(), 'main.intro');
    assert.deepEqual(guardServerOwned(incoming, server).guide, { seen: ['main.intro'] });
  });

  it('되접기(JSON 왕복)를 지나도 남는다 — 모르는 id · 겹친 id는 버린다', () => {
    const p = seen(at(fresh(), 3), 'main.intro', 'city.lv3');
    const raw = JSON.parse(JSON.stringify(p)) as { guide: { seen: string[] } };
    raw.guide.seen.push('main.intro', 'nope');
    const back = migrateProfile(raw)!;
    assert.deepEqual(back.guide, { seen: ['main.intro', 'city.lv3', 'city.lv2'] });
    assert.ok(back.guide!.seen.every((id) => (GUIDE_IDS as readonly string[]).includes(id)));
  });
});
