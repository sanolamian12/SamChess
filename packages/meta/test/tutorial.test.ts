/**
 * 튜토리얼 진행 — 열리는 순서 · S급은 보유로 보인다 · 서버 소유 · 되접기 (`tutorial.ts`)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  ALL_TUTORIALS, BASIC_TUTORIALS, S_TUTORIAL_OFFICERS, SERVER_OWNED_FIELDS,
  applyTutorialDone, basicsDone, sortieGate, createProfile, guardServerOwned, migrateProfile, ownedOfficers,
  sTutorialId, tutorialList, tutorialStatus,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const fresh = (): PlayerProfile => createProfile('배움성', 7);
const finishBasics = (p: PlayerProfile): PlayerProfile =>
  BASIC_TUTORIALS.reduce((acc, id) => applyTutorialDone(acc, id), p);
const starterS = (p: PlayerProfile): OfficerId =>
  ownedOfficers(p).find((id) => officerById.get(id)?.grade === 'S')!;

describe('목록', () => {
  it('기본 셋 + S급 30 — S급 id는 s-{장수}', () => {
    assert.equal(S_TUTORIAL_OFFICERS.length, 30);
    assert.equal(ALL_TUTORIALS.length, 33);
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

describe('[출정하기] — 기본 셋이 먼저다', () => {
  it('가입 직후에는 막히고 이유 코드는 tutorial.required, 셋을 끝내면 열린다', () => {
    const gate = sortieGate(fresh());
    assert.equal(gate.ok, false);
    assert.equal(!gate.ok && gate.code, 'tutorial.required');
    assert.deepEqual(sortieGate(finishBasics(fresh())), { ok: true });
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
    const veteran = { ...old, record: { 'ai/3v3': { plays: 1, wins: 1, draws: 0, losses: 0, kills: 2 } } };
    assert.equal(basicsDone(migrateProfile(JSON.parse(JSON.stringify(veteran)))!), true);
    // 필드가 한 번 생기면(빈 배열이라도) 그 갈래는 다시 안 돈다
    const started = { ...veteran, tutorial: { done: [] } };
    assert.equal(basicsDone(migrateProfile(JSON.parse(JSON.stringify(started)))!), false);
  });
});
