/**
 * AI 대전 — 판 시작을 서버가 굳힌다 (2026-10-15, `aiBattle.ts`). 시계는 전부 가짜 시계다.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { challengeTargets, legalMovesFor } from '@samchess/rules';
import type { BattleState, Intent, OfficerId, PieceType } from '@samchess/rules';
import {
  AI_ABANDON_MS, BASIC_TUTORIALS, SORTIE_TUTORIALS, aiAbandonRemainingMs, aiBattleState, appendAiIntents, createProfile, grainCost,
  guardServerOwned, matchAiBattle, migrateProfile, newInstance, revealAiDuel, settleAiBattleIntents, startAiBattle, syncAiBattle,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';
import { withGarrisons } from './fixtures.ts';

const T0 = Date.UTC(2026, 9, 15, 3, 0, 0);
const MIN = 60_000;
const O = (id: string): OfficerId => id as OfficerId;
const P = (piece: PieceType, officer: string): RosterPick => ({ piece, officer: O(officer) });
// 관우는 Knight — 일기토는 Knight만 건다(R25, 2026-11-12). 아래 대결 검사가 관우로 건다
const PICKS = [P('King', 'yu-bi'), P('Knight', 'gwan-u'), P('Pawn', 'jang-bi')];

function city(): PlayerProfile {
  const base = createProfile('대전성', 7);
  const roster = { ...base.roster };
  for (const id of ['yu-bi', 'gwan-u', 'jang-bi']) roster[O(id)] = newInstance(O(id));
  // 기본 튜토리얼을 끝내고 수비군(3v3 · 5v5 부대)이 선 계정 — 아니면 [출정하기]가 잠긴다(`sortieGate`)
  return withGarrisons({ ...base, roster, grain: 40, grainAt: T0, tutorial: { done: [...SORTIE_TUTORIALS] } });
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
    assert.equal(r.profile.matches.length, 0, '순수 AI 대전은 이력에 안 남는다(2026-10-28)');
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
});

describe('★ 60분 방치 — 패배로 정산(기획자 확정)', () => {
  it('59분은 그대로 · 60분이면 패배 · 정산 시각은 시작 + 60분', () => {
    const p = fighting();
    assert.equal(aiAbandonRemainingMs(p, T0 + 59 * MIN), MIN);
    assert.equal(syncAiBattle(p, T0 + 59 * MIN), p, '바뀐 것이 없으면 같은 객체');
    const done = syncAiBattle(p, T0 + 3 * AI_ABANDON_MS);
    assert.equal(done.aiBattle!.status, 'abandoned');
    assert.equal(done.aiBattle!.settledAt, T0 + AI_ABANDON_MS);
    assert.equal(done.matches.length, p.matches.length, '순수 AI 대전은 이력에 안 남는다(2026-10-28)');
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


// ═══════════════════════════════════════════════════════════════
// 일기토 · 설전의 패 — 서버가 정해 공개를 적는다 (GDD §3.11 R16, 설계서 §3-5 · §8 단계 5)
// ═══════════════════════════════════════════════════════════════

const nearFoe = (st: BattleState, at: { x: number; y: number }): number =>
  Math.min(...Object.values(st.units).filter((u) => u.alive && u.side === 'P2').map((u) => Math.abs(u.pos.x - at.x) + Math.abs(u.pos.y - at.y)));

/** 사람이 다가가 일기토를 걸고 첫 합에 닿을 때까지의 수 — 붙은 적이 있으면 걸고, 아니면 한 걸음 다가가고 넘긴다 */
function toRound(p: PlayerProfile): Intent[] {
  const out: Intent[] = [];
  for (let i = 0; i < 400; i++) {
    const r = aiBattleState({ ...p.aiBattle!, intents: out });
    assert.ok(r.ok);
    const st = r.state;
    if (st.phase === 'deploy') { out.push({ t: 'ready' }); continue; }
    if (st.phase === 'duel') {
      if (st.duel!.step === 'offer') { out.push({ t: 'answerChallenge', accept: true }); continue; }
      return out;
    }
    assert.notEqual(st.phase, 'finished', '대결에 닿기 전에 판이 끝났다');
    const unit = st.units[st.activeUnit!]!;
    const target = challengeTargets(st, 'P1', 'duel')[0];
    if (target) { out.push({ t: 'challenge', kind: 'duel', target }); continue; }
    if (!st.activeTurn?.moved) {
      const best = legalMovesFor(st, unit.id).map((to) => ({ to, d: nearFoe(st, to) })).sort((a, b) => a.d - b.d)[0];
      if (best && best.d < nearFoe(st, unit.pos)) { out.push({ t: 'move', to: best.to }); continue; }
    }
    out.push({ t: 'endTurn' });
  }
  throw new Error('첫 합에 닿지 않았다');
}

/** 서버 비밀 대신 — 소금마다 기록해 두고 늘 가위(또는 3)를 고른다(시드와 무관한 값) */
function secretPick() {
  const salts: string[] = [];
  return { salts, pick: (salt: string, n: number) => { salts.push(salt); return n - 1; } };
}

describe('일기토 · 설전의 패 — 서버가 정해 공개를 적는다 (R16)', () => {
  it('★ 카운트 끝 — 맡긴 수를 덧붙이고, 안 낸 쪽(AI · 안 낸 사람)을 서버 비밀로 채운 공개를 기록에 적어 돌려준다', () => {
    const p = fighting();
    const pre = toRound(p);
    const s = secretPick();
    const r = revealAiDuel(p, 0, [...pre, { t: 'duelPick', pick: 'rock' }], s.pick);
    assert.ok(r.ok, r.ok ? '' : r.reason);
    if (!r.ok) return;
    assert.deepEqual(r.reveal, { t: 'duelReveal', fill: { P2: 'scissors' } }, '사람이 낸 패는 안 채우고 AI 패만 서버의 것으로');
    assert.equal(r.have, pre.length + 2);
    assert.deepEqual(r.profile.aiBattle!.intents!.at(-1), r.reveal, '공개는 서버의 기록에 적혔다');
    assert.equal(s.salts.length, 1);
    assert.ok(s.salts[0]!.startsWith(`${p.aiBattle!.seed}:`), '소금은 판의 시드 · 기록 위치 · 진영');
    // 안 낸 사람 패도 서버가 채운다 — 엔진 난수로 채우면 「안 낸 척」으로 유리한 값을 고른다
    const none = revealAiDuel(p, 0, pre, secretPick().pick);
    assert.ok(none.ok && none.reveal.t === 'duelReveal' && none.reveal.fill?.P1 === 'scissors' && none.reveal.fill?.P2 === 'scissors');
  });

  it('같은 물음이 다시 오면(응답을 못 받음) 적어 둔 공개를 그대로 — 새로 뽑지 않는다', () => {
    const p = fighting();
    const pre = toRound(p);
    const first = revealAiDuel(p, 0, pre, secretPick().pick);
    assert.ok(first.ok);
    if (!first.ok) return;
    const again = revealAiDuel(first.profile, 0, pre, () => 0);
    assert.ok(again.ok && again.have === first.have);
    assert.deepEqual(again.ok && again.reveal, first.reveal);
  });

  it('합 중이 아니면 거절한다', () => {
    const p = fighting();
    const r = revealAiDuel(p, 0, [{ t: 'ready' }], secretPick().pick);
    assert.equal(r.ok ? 'ok' : r.code, 'ai.notDuelRound');
  });

  it('★ 사람은 공개를 덧붙이지 못한다 — 미리 읽은 패로 채운 공개를 실어 보내면 덧붙이기 · 정산이 거절한다', () => {
    const p = fighting();
    const pre = toRound(p);
    const forged: Intent[] = [...pre, { t: 'duelPick', pick: 'paper' }, { t: 'duelReveal', fill: { P2: 'rock' } }];
    const app = appendAiIntents(p, 0, forged);
    assert.equal(app.ok ? 'ok' : app.code, 'ai.revealByServer');
    const seedReveal: Intent[] = [...pre, { t: 'duelReveal' }];
    assert.equal((r => (r.ok ? 'ok' : r.code))(appendAiIntents(p, 0, seedReveal)), 'ai.revealByServer', '패 없는 공개(시드로 채움)도 막는다');
    const settled = settleAiBattleIntents(p, [...forged, { t: 'surrender' }], T0 + 10 * MIN);
    assert.equal(settled.ok ? 'ok' : settled.code, 'ai.revealByServer');
  });

  it('서버가 적은 공개로 끝까지 — 겹쳐 다시 보낸 앞부분은 괜찮고, 정산이 기록의 패로 재생한다', () => {
    const p = fighting();
    const pre = toRound(p);
    const r = revealAiDuel(p, 0, pre, secretPick().pick);
    assert.ok(r.ok);
    if (!r.ok) return;
    const log = r.profile.aiBattle!.intents!;
    // 클라이언트는 받은 공개를 그대로 넣고 처음부터 다시 덧붙여도(겹침) 받아들여진다
    const again = appendAiIntents(r.profile, 0, log);
    assert.ok(again.ok, again.ok ? '' : again.reason);
    const settled = settleAiBattleIntents(r.profile, [...log, ...(fightingAfter(r.profile) ? [{ t: 'duelFlee' } as Intent] : []), { t: 'surrender' }], T0 + 10 * MIN);
    assert.ok(settled.ok, settled.ok ? '' : settled.reason);
  });

});

/** 공개 뒤에도 아직 대결 중인가(다음 합) — 그러면 항복 전에 도망해 대결을 닫는다 */
function fightingAfter(p: PlayerProfile): boolean {
  const st = aiBattleState(p.aiBattle!);
  return st.ok && st.state.phase === 'duel';
}
