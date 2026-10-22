/**
 * 안내 내관 — 띄울 차례 · 본 것 적기 · 그림의 단 · 클라이언트 소유 · 되접기 (`guide.ts`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GUIDE_IDS, SERVER_OWNED_FIELDS, createProfile, guardServerOwned, guideHonor, guideSeen, hasEmperor, markGuideSeen,
  migrateProfile, pendingGuide, stewardTier,
} from '../src/index.ts';
import type { GuideId, PlayerProfile } from '../src/index.ts';

const fresh = (): PlayerProfile => createProfile('안내성', 7);
const at = (p: PlayerProfile, cityLevel: number): PlayerProfile => ({ ...p, cityLevel });
const seen = (p: PlayerProfile, ...ids: GuideId[]): PlayerProfile => ids.reduce(markGuideSeen, p);

describe('띄울 차례', () => {
  it('가입 직후 — 성 안이면 인사, 산 너머면 돌아오는 길', () => {
    assert.equal(pendingGuide(fresh(), 'core', false), 'main.intro');
    assert.equal(pendingGuide(fresh(), 'ext', true), 'town.enter');
  });

  it('인사를 봤으면 Lv1에는 더 할 말이 없다', () => {
    assert.equal(pendingGuide(seen(fresh(), 'main.intro'), 'core', false), null);
  });

  it('도시 레벨 — 지금 레벨 이하에서 가장 높은 것 하나', () => {
    const p = seen(fresh(), 'main.intro');
    assert.equal(pendingGuide(at(p, 2), 'core', false), 'city.lv2');
    assert.equal(pendingGuide(at(p, 4), 'core', false), 'city.lv3');
    assert.equal(pendingGuide(at(p, 11), 'core', false), 'city.lv9');
  });

  it('높은 레벨 안내를 보면 아래 것도 함께 본 것이 된다 — 뒤늦게 Lv2 소식이 오지 않는다', () => {
    const p = seen(at(fresh(), 5), 'main.intro', 'city.lv5');
    assert.ok(guideSeen(p, 'city.lv2') && guideSeen(p, 'city.lv3'));
    assert.equal(guideSeen(p, 'city.lv7'), false);
    assert.equal(pendingGuide(p, 'core', false), null);
  });

  it('산 너머 건물이 생기면 [마을로] — 도시 레벨 안내 다음 차례', () => {
    const p = seen(at(fresh(), 2), 'main.intro');
    assert.equal(pendingGuide(p, 'core', true), 'city.lv2');
    assert.equal(pendingGuide(seen(p, 'city.lv2'), 'core', true), 'town.open');
    assert.equal(pendingGuide(seen(p, 'city.lv2', 'town.open'), 'core', true), null);
  });
});

describe('황제 등극', () => {
  // 헌제(E급)를 거느린 계정 — 풀에 넣는다(보관함도 보유로 센다, `hasEmperor`)
  const withEmperor = (p: PlayerProfile): PlayerProfile => {
    const id = 'heon-je';
    return { ...p, roster: { ...p.roster, [id]: { ...Object.values(p.roster)[0]!, officer: id } } } as PlayerProfile;
  };

  it('헌제가 들어오면 인사 다음, 밀린 레벨 안내보다 먼저 — 호칭은 폐하', () => {
    const p = withEmperor(seen(at(fresh(), 5), 'main.intro'));
    assert.ok(hasEmperor(p));
    assert.equal(pendingGuide(p, 'core', false), 'emperor');
    assert.equal(guideHonor(p), 'emperor');
    assert.equal(pendingGuide(seen(p, 'emperor'), 'core', false), 'city.lv5');
  });

  it('헌제가 없으면 안 나오고, 호칭은 도시 레벨을 따른다', () => {
    const p = seen(at(fresh(), 5), 'main.intro', 'city.lv5');
    assert.equal(pendingGuide(p, 'core', false), null);
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
