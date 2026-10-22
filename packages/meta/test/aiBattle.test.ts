/**
 * AI 대전 — 판 시작을 서버가 굳힌다 (2026-10-15, `aiBattle.ts`). 시계는 전부 가짜 시계다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Intent, OfficerId, PieceType } from '@samchess/rules';
import {
  AI_ABANDON_MS, BASIC_TUTORIALS, aiAbandonRemainingMs, aiBattleState, appendAiIntents, clearAiBattle, createProfile, grainCost,
  guardServerOwned, matchAiBattle, migrateProfile, newInstance, settleAiBattleIntents, startAiBattle, syncAiBattle,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 15, 3, 0, 0);
const MIN = 60_000;
const O = (id: string): OfficerId => id as OfficerId;
const P = (piece: PieceType, officer: string): RosterPick => ({ piece, officer: O(officer) });
const PICKS = [P('King', 'yu-bi'), P('Rock', 'gwan-u'), P('Pawn', 'jang-bi')];

function city(): PlayerProfile {
  const base = createProfile('대전성', 7);
  const roster = { ...base.roster };
  for (const id of ['yu-bi', 'gwan-u', 'jang-bi']) roster[O(id)] = newInstance(O(id));
  // 기본 튜토리얼을 끝낸 계정 — 안 끝냈으면 [출정하기]가 잠긴다(`sortieGate`)
  return { ...base, roster, grain: 40, grainAt: T0, tutorial: { done: [...BASIC_TUTORIALS] } };
}

function matched(seed = 4242): PlayerProfile {
  const r = matchAiBattle(city(), '3v3', PICKS, null, seed);
  assert.ok(r.ok);
  return r.ok ? r.profile : city();
}

function fighting(seed = 4242): PlayerProfile {
  const r = startAiBattle(matched(seed), T0);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.ok ? r.profile : city();
}

/** 실제로 둘 수 있는 사람의 수 n개 — 배치는 준비, 차례는 턴 종료 */
function play(p: PlayerProfile, n: number): Intent[] {
  const out: Intent[] = [];
  for (let i = 0; i < n; i++) {
    const r = aiBattleState({ ...p.aiBattle!, intents: out });
    assert.equal(r.ok, true);
    if (!r.ok || r.state.phase === 'finished') break;
    out.push(r.state.phase === 'deploy' ? { t: 'ready' } : { t: 'endTurn' });
  }
  return out;
}

/** 준비 한 번 뒤 항복 — 패배로 끝나는 가장 짧은 판 */
const SURRENDER: Intent[] = [{ t: 'ready' }, { t: 'surrender' }];

describe('상대 찾기 — 서버의 시드, 군량은 안 낸다', () => {
  it('같은 시드면 같은 상대(순수 함수) · 군량 그대로 · 다시 찾으면 덮는다', () => {
    const a = matched(7);
    const b = matched(7);
    assert.deepEqual(a.aiBattle!.foe, b.aiBattle!.foe);
    assert.equal(a.aiBattle!.status, 'matched');
    assert.equal(a.grain, 40, '매칭만 하고 뒤로 가면 한 톨도 안 나간다');
    const again = matchAiBattle(a, '3v3', PICKS, null, 8);
    assert.ok(again.ok && again.profile.aiBattle!.seed === 8);
  });

  it('싸우는 중이면 새로 찾지 못한다', () => {
    const r = matchAiBattle(fighting(), '3v3', PICKS, null, 9);
    assert.equal(r.ok ? 'ok' : r.code, 'ai.inProgress');
  });
});

describe('시작 — 참가비와 함께 명단을 굳힌다', () => {
  it('참가비를 내고 싸우는 중이 된다 · 명단은 시작 시각의 것', () => {
    const p = fighting();
    assert.equal(p.grain, 40 - grainCost('3v3'));
    assert.equal(p.aiBattle!.status, 'fighting');
    assert.equal(p.aiBattle!.startedAt, T0);
    assert.equal(p.aiBattle!.entries!.length, 3);
    assert.deepEqual(p.aiBattle!.intents, []);
  });

  it('찾은 상대가 없으면 시작하지 못한다 — 두 번 눌러도 참가비는 한 번', () => {
    const r = startAiBattle(city(), T0);
    assert.equal(r.ok ? 'ok' : r.code, 'ai.notMatched');
    const twice = startAiBattle(fighting(), T0);
    assert.equal(twice.ok ? 'ok' : twice.code, 'ai.notMatched');
  });

  it('★ 판 도중에 장수가 계정에서 바뀌어도 재생은 시작한 명단으로 한다', () => {
    const p = fighting();
    const { [O('gwan-u')]: _gone, ...roster } = p.roster;
    const r = settleAiBattleIntents({ ...p, roster }, SURRENDER, T0 + MIN);
    assert.ok(r.ok && !('draw' in r), r.ok ? '' : r.reason);
  });
});

describe('싸우는 동안 — 덧붙이기 · 끊긴 자리', () => {
  it('덧붙인 수까지 재생한 판이 끊긴 자리다 · 같은 요청은 한 번만', () => {
    const p = fighting();
    const moves = play(p, 3);
    const a = appendAiIntents(p, 0, moves);
    assert.ok(a.ok);
    if (!a.ok) return;
    assert.deepEqual(a.profile.aiBattle!.intents, moves);
    const again = appendAiIntents(a.profile, 0, moves);
    assert.ok(again.ok && again.profile === a.profile);
    const resumed = aiBattleState(a.profile.aiBattle!);
    assert.ok(resumed.ok && resumed.state.phase !== 'deploy', '배치를 지나 판 안이다');
  });

  it('앞부분을 바꿔 끼우지 못한다 · 싸우는 중이 아니면 안 받는다', () => {
    const p = fighting();
    const a = appendAiIntents(p, 0, [{ t: 'ready' }]);
    assert.ok(a.ok);
    if (!a.ok) return;
    const rewrite = appendAiIntents(a.profile, 0, [{ t: 'surrender' }]);
    assert.equal(rewrite.ok ? 'ok' : rewrite.code, 'ai.intentsGap');
    const idle = appendAiIntents(matched(), 0, [{ t: 'ready' }]);
    assert.equal(idle.ok ? 'ok' : idle.code, 'ai.notFighting');
  });
});

describe('정산 — 적힌 판만, 한 번만', () => {
  it('★ 패배를 반영하고 판을 지운다 — 같은 기록을 다시 보내면 거절', () => {
    const p = fighting();
    const r = settleAiBattleIntents(p, SURRENDER, T0 + MIN);
    assert.ok(r.ok && !('draw' in r));
    if (!r.ok || 'draw' in r) return;
    assert.equal(r.profile.aiBattle, undefined, '정산한 판은 지운다');
    assert.equal(r.profile.matches.at(-1)!.result, 'lose');
    assert.equal(r.rewards.cards.length, 1, '패배도 카드 한 장');
    const twice = settleAiBattleIntents(r.profile, SURRENDER, T0 + 2 * MIN);
    assert.equal(twice.ok ? 'ok' : twice.code, 'ai.notFighting', '같은 판을 두 번 정산하면 보상이 두 번 나온다');
  });

  it('덧붙여 둔 수로 시작하지 않는 기록은 거절 — 다른 수로 처음부터 다시 둔 판', () => {
    const p = fighting();
    const a = appendAiIntents(p, 0, play(p, 2));
    assert.ok(a.ok);
    if (!a.ok) return;
    const r = settleAiBattleIntents(a.profile, SURRENDER, T0 + MIN);
    assert.equal(r.ok ? 'ok' : r.code, 'ai.intentsGap');
  });

  it('무승부 택1이 끝나면 지운다 — 싸우는 중이 아니면 그대로', () => {
    assert.equal(clearAiBattle(fighting()).aiBattle, undefined);
    const m = matched();
    assert.equal(clearAiBattle(m), m);
  });
});

describe('★ 60분 방치 — 패배로 정산(기획자 확정)', () => {
  it('59분은 그대로 · 60분이면 패배 · 정산 시각은 시작 + 60분', () => {
    const p = fighting();
    assert.equal(aiAbandonRemainingMs(p, T0 + 59 * MIN), MIN);
    assert.equal(syncAiBattle(p, T0 + 59 * MIN), p, '바뀐 것이 없으면 같은 객체');
    const done = syncAiBattle(p, T0 + 3 * AI_ABANDON_MS);
    assert.equal(done.aiBattle!.status, 'abandoned');
    assert.equal(done.aiBattle!.settledAt, T0 + AI_ABANDON_MS);
    assert.equal(done.matches.length, p.matches.length + 1);
    assert.equal(done.matches.at(-1)!.result, 'lose');
    assert.equal(done.matches.at(-1)!.at, T0 + AI_ABANDON_MS);
    assert.equal(syncAiBattle(done, T0 + 4 * AI_ABANDON_MS), done, '한 번만 정산한다');
    const late = settleAiBattleIntents(done, SURRENDER, T0 + 3 * AI_ABANDON_MS);
    assert.equal(late.ok ? 'ok' : late.code, 'ai.notFighting', '방치로 정산된 판을 다시 정산하지 못한다');
  });
});

describe('저장 — 되접기 · 서버 소유', () => {
  it('★ 되접기(JSON 왕복)를 지나도 남는다 — 안 담으면 서버가 읽을 때마다 버린다', () => {
    const p = appendAiIntents(fighting(), 0, [{ t: 'ready' }]);
    assert.ok(p.ok);
    if (!p.ok) return;
    const back = migrateProfile(JSON.parse(JSON.stringify(p.profile)))!;
    assert.deepEqual(back.aiBattle, p.profile.aiBattle);
  });

  it('★ PUT이 지우거나 고쳐 올려도 서버 값이 남는다', () => {
    const server = fighting();
    const { aiBattle: _erased, ...incoming } = server;
    assert.deepEqual(guardServerOwned(incoming as PlayerProfile, server).aiBattle, server.aiBattle);
  });
});
