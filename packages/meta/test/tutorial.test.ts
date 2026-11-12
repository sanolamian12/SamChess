/**
 * 튜토리얼 진행 — 열리는 순서 · S급은 보유로 보인다 · 서버 소유 · 되접기 (`tutorial.ts`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  ALL_TUTORIALS, BASIC_TUTORIALS, DUEL_TUTORIALS, S_TUTORIAL_HISTORY, S_TUTORIAL_OFFICERS, SERVER_OWNED_FIELDS,
  applyTutorialDone, basicsDone, completeTutorial, sortieGate, createProfile, guardServerOwned, migrateProfile, ownedOfficers,
  sTutorialId, tutorialList, tutorialStatus,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const fresh = (): PlayerProfile => createProfile('배움성', 7);
const finishBasics = (p: PlayerProfile): PlayerProfile =>
  BASIC_TUTORIALS.reduce((acc, id) => applyTutorialDone(acc, id), p);
const starterS = (p: PlayerProfile): OfficerId =>
  ownedOfficers(p).find((id) => officerById.get(id)?.grade === 'S')!;

describe('목록', () => {
  it('기본 셋 + 일기토 · 설전 + S급 30 — S급 id는 s-{장수}', () => {
    assert.equal(S_TUTORIAL_OFFICERS.length, 30);
    assert.equal(ALL_TUTORIALS.length, 35);
    assert.ok(ALL_TUTORIALS.includes(sTutorialId('jang-bi' as OfficerId)));
  });
});

describe('열리는 순서', () => {
  it('가입 직후 — 기본 1만 열려 있고 기본 2 · 3은 잠겨 있다', () => {
    const p = fresh();
    assert.deepEqual(BASIC_TUTORIALS.map((id) => tutorialStatus(p, id)), ['open', 'locked', 'locked']);
    assert.equal(basicsDone(p), false);
  });

  it('앞 판을 끝내면 다음이 열리고, 셋 다 끝나면 [출정하기]가 열린다', () => {
    let p = applyTutorialDone(fresh(), 'basic-1');
    assert.deepEqual(BASIC_TUTORIALS.map((id) => tutorialStatus(p, id)), ['done', 'open', 'locked']);
    p = applyTutorialDone(p, 'basic-2');
    assert.equal(basicsDone(p), false);
    p = applyTutorialDone(p, 'basic-3');
    assert.equal(basicsDone(p), true);
  });

  it('잠긴 판은 끝낼 수 없고, 끝낸 판을 다시 끝내도 그대로다', () => {
    assert.throws(() => applyTutorialDone(fresh(), 'basic-2'), /locked/);
    const once = applyTutorialDone(fresh(), 'basic-1');
    assert.equal(applyTutorialDone(once, 'basic-1'), once);
  });
});

describe('일기토 · 설전 (2026-11-12) — 기본 셋 뒤에 일기토 → 설전 차례로 열리고, [출정하기]와는 무관하다', () => {
  it('기본 셋 전에는 둘 다 잠겨 있고, 셋을 끝내면 일기토만, 일기토를 끝내면 설전이 열린다', () => {
    const p = applyTutorialDone(applyTutorialDone(fresh(), 'basic-1'), 'basic-2');
    assert.deepEqual(DUEL_TUTORIALS.map((id) => tutorialStatus(p, id)), ['locked', 'locked']);
    assert.throws(() => applyTutorialDone(p, 'basic-duel'), /locked/);
    const done = applyTutorialDone(p, 'basic-3');
    assert.deepEqual(DUEL_TUTORIALS.map((id) => tutorialStatus(done, id)), ['open', 'locked']);
    assert.throws(() => applyTutorialDone(done, 'basic-debate'), /locked/);
    const dueled = applyTutorialDone(done, 'basic-duel');
    assert.deepEqual(DUEL_TUTORIALS.map((id) => tutorialStatus(dueled, id)), ['done', 'open']);
  });

  it('안 해도 [출정하기]가 열린다 — 필수가 아니다(넣으면 이미 기본 셋을 끝낸 계정이 다시 잠긴다)', () => {
    const done = withGarrisons(finishBasics(fresh()));
    assert.deepEqual(sortieGate(done), { ok: true });
  });

  it('처음 끝내면 첫 클리어 보상을 받고, 되접기를 지나도 남는다', () => {
    const { profile, rewards } = completeTutorial(applyTutorialDone(finishBasics(fresh()), 'basic-duel'), 'basic-debate', 11);
    assert.ok(rewards);
    assert.equal(tutorialStatus(profile, 'basic-debate'), 'done');
    assert.equal(tutorialStatus(migrateProfile(JSON.parse(JSON.stringify(profile)))!, 'basic-debate'), 'done');
  });
});

describe('[출정하기] — 기본 셋이 먼저다', () => {
  it('가입 직후에는 막히고 이유 코드는 tutorial.required, 셋을 끝내면 다음은 수비군이다', () => {
    const gate = sortieGate(fresh());
    assert.equal(gate.ok, false);
    assert.equal(!gate.ok && gate.code, 'tutorial.required');
    // 수비군이 없어도 튜토리얼이 먼저 말한다 — 부대를 다 만들어도 튜토리얼이 막는다
    assert.equal((g => !g.ok && g.code)(sortieGate(withGarrisons(fresh()))), 'tutorial.required');
    const done = finishBasics(fresh());
    assert.equal((g => !g.ok && g.code)(sortieGate(done)), 'sortie.noGarrison', '셋을 끝내도 3v3 · 5v5 부대가 없으면 막힌다');
    assert.deepEqual(sortieGate(withGarrisons(done)), { ok: true });
  });
});

describe('S급 — 역사 순서로 보인다 (2026-11-11 기획자)', () => {
  it('역사 순서 목록은 S급 30명을 빠짐없이 한 번씩 담는다', () => {
    assert.equal(new Set(S_TUTORIAL_HISTORY).size, S_TUTORIAL_HISTORY.length, '같은 장수가 두 번 있다');
    assert.deepEqual([...S_TUTORIAL_HISTORY].sort(), [...S_TUTORIAL_OFFICERS].sort(), 'S급 명단과 다르다 — 새 S급의 자리를 넣는다');
  });

  it('목록은 기본 셋 다음에 S급을 역사 순서로 — 가진 장수만', () => {
    const p = finishBasics(fresh());
    const all: PlayerProfile = { ...p, roster: Object.fromEntries(S_TUTORIAL_OFFICERS.map((id) => [id, { ...p.roster[starterS(p)]!, officer: id }])) };
    const ids = tutorialList(all).map((r) => r.id);
    assert.deepEqual(ids.slice(0, 5), [...BASIC_TUTORIALS, ...DUEL_TUTORIALS]);
    assert.deepEqual(ids.slice(5), S_TUTORIAL_HISTORY.map(sTutorialId));
    assert.equal(ids[5], 's-gwan-u', '사수관(190)이 맨 앞');
    assert.equal(ids.at(-1), 's-gang-yu', '철롱산(253)이 맨 끝');
  });
});

describe('S급 — 보유해야 보이고, 기본 셋을 끝내야 켜진다', () => {
  it('처음 받은 S급 하나만 보인다 — 처음에는 잠겨 있다', () => {
    const p = fresh();
    const mine = starterS(p);
    const shown = tutorialList(p).filter((row) => row.id.startsWith('s-'));
    assert.deepEqual(shown, [{ id: sTutorialId(mine), status: 'locked' }]);
  });

  it('기본 셋을 끝내면 켜진다', () => {
    const p = finishBasics(fresh());
    assert.equal(tutorialStatus(p, sTutorialId(starterS(p))), 'open');
  });

  it('S급 카드를 새로 얻으면 그 장수의 판이 보인다 — 따로 켜는 코드가 없다', () => {
    const p = finishBasics(fresh());
    const other = S_TUTORIAL_OFFICERS.find((id) => !ownedOfficers(p).includes(id))!;
    assert.equal(tutorialStatus(p, sTutorialId(other)), 'hidden');
    assert.throws(() => applyTutorialDone(p, sTutorialId(other)), /hidden/);
    const gained: PlayerProfile = { ...p, roster: { ...p.roster, [other]: { ...p.roster[starterS(p)]!, officer: other } } };
    assert.equal(tutorialStatus(gained, sTutorialId(other)), 'open');
  });
});

describe('저장', () => {
  it('서버 소유 — PUT으로 올린 진행은 서버 값으로 되쓴다', () => {
    assert.ok((SERVER_OWNED_FIELDS as readonly string[]).includes('tutorial'));
    const server = fresh();
    const forged = finishBasics(server);
    assert.deepEqual(guardServerOwned(forged, server).tutorial, { done: [] });
  });

  it('migrateProfile을 지나도 남는다 — 모르는 id · 겹친 id는 걸러진다', () => {
    const p = { ...fresh(), tutorial: { done: ['basic-1', 'basic-1', 'nope'] } };
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(p)))!.tutorial, { done: ['basic-1'] });
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(fresh())))!.tutorial, { done: [] }, '새 계정은 빈 진행을 들고 있다');
  });

  it('필드가 생기기 전에 이미 대전을 한 계정은 기본 셋을 끝낸 것으로 본다', () => {
    const { tutorial: _, ...old } = fresh();
    // 옛 AI 칸이다 — v7 되접기가 버리는 칸이라도 「싸운 적이 있다」는 남는다(2026-10-28)
    const veteran = { ...old, version: 6, record: { 'ai/3v3': { plays: 1, wins: 1, draws: 0, losses: 0, kills: 2 } } };
    assert.equal(basicsDone(migrateProfile(JSON.parse(JSON.stringify(veteran)))!), true);
    // 필드가 한 번 생기면(빈 배열이라도) 그 갈래는 다시 안 돈다
    const started = { ...veteran, tutorial: { done: [] } };
    assert.equal(basicsDone(migrateProfile(JSON.parse(JSON.stringify(started)))!), false);
  });
});

describe('첫 클리어 보상 (2026-11-11 기획자) — 군량 1 · 자재 1 · C~D급 카드 1장, 처음 한 번만', () => {
  it('처음 끝내면 셋을 다 받고, 카드는 C 또는 D급이며 계정에 들어간다', () => {
    const p = { ...fresh(), grain: 0 };
    const { profile, rewards } = completeTutorial(p, 'basic-1', 12345);
    assert.ok(rewards, '첫 클리어인데 보상이 없다');
    assert.equal(rewards.grain, 1);
    assert.equal(rewards.materials, 1);
    assert.equal(rewards.cards.length, 1);
    assert.ok(['C', 'D'].includes(rewards.cards[0]!.grade), `카드 등급이 ${rewards.cards[0]!.grade}`);
    assert.equal(profile.grain, 1);
    assert.equal(profile.materials, p.materials + 1);
    assert.ok(ownedOfficers(profile).includes(rewards.cards[0]!.officer), '받은 카드의 장수가 계정에 없다');
    assert.equal(tutorialStatus(profile, 'basic-1'), 'done');
  });

  it('다시 끝내면 보상이 없고 계정도 그대로다 — 반복으로 카드를 모으지 못한다', () => {
    const once = completeTutorial(fresh(), 'basic-1', 1).profile;
    const again = completeTutorial(once, 'basic-1', 2);
    assert.equal(again.rewards, null);
    assert.equal(again.profile, once);
  });

  it('S급 판도 처음엔 보상을 준다', () => {
    const p = finishBasics(fresh());
    const { rewards } = completeTutorial(p, sTutorialId(starterS(p)), 7);
    assert.ok(rewards && rewards.cards.length === 1);
  });

  it('잠긴 판은 여전히 던진다 — 보상으로 순서를 건너뛰지 못한다', () => {
    assert.throws(() => completeTutorial(fresh(), 'basic-2', 1), /locked/);
  });
});
