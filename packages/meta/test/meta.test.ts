/**
 * 메타(계정·수집·성장) 회귀 — GDD §3.9 · §4.2 · §4.3 · §6.4 · §8
 *
 * 여기서 지키는 것은 **2026-08-04에 확정한 경제 규칙 셋**이다.
 *  - 레벨업에 실패가 없다 (전 레벨 100%)
 *  - AI 대전은 군량만 준다 (카드 없음)
 *  - 1:1이 없다 (3:3 / 5:5만)
 * 이 셋이 흔들리면 여기서 먼저 깨진다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattle } from '@samchess/rules';
import type { OfficerId } from '@samchess/rules';
import { officerById, officersByGrade } from '@samchess/data';
import {
  addCard, applyBattleResult, applyLevelUp, canLevelUp, cardsToLevelUp, createProfile,
  grainCost, makeAiPicks, poolCap, spendGrain, statsOf, tacticChoices, teamSize,
  toRosterEntries, validateRoster, GRADE_SCORE,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';

const profile = (): PlayerProfile => createProfile('테스트성', 1);

/** 보유 장수에서 기물을 채운 편성 하나 */
function picksOf(p: PlayerProfile, count: number): RosterPick[] {
  const pieces = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const;
  return Object.keys(p.roster).slice(0, count)
    .map((officer, i) => ({ piece: pieces[i]!, officer: officer as OfficerId }));
}

// ── 계정 생성 (GDD §8) ─────────────────────────────────────────

test('새 계정 — S·A·B·C·D 각 1명을 지급한다', () => {
  const p = profile();
  const grades = Object.keys(p.roster).map((id) => officerById.get(id)!.grade).sort();
  assert.deepEqual(grades, ['A', 'B', 'C', 'D', 'S']);
  assert.equal(p.cityLevel, 1);
  assert.equal(p.grain, 20, '도시 Lv1의 군량 상한만큼 채워 시작한다');
});

test('같은 시드면 같은 계정이 나온다 (Math.random 금지)', () => {
  assert.deepEqual(Object.keys(createProfile('가', 7).roster), Object.keys(createProfile('나', 7).roster));
  assert.notDeepEqual(Object.keys(createProfile('가', 7).roster), Object.keys(createProfile('가', 8).roster));
});

// ── 카드와 레벨업 (GDD §4.3) ───────────────────────────────────

test('처음 얻은 장수는 카드가 아니라 보유 풀로 들어간다', () => {
  const p = profile();
  const fresh = officersByGrade('C').find((o) => !p.roster[o.id as OfficerId])!.id as OfficerId;
  const after = addCard(p, fresh);
  assert.ok(after.roster[fresh], '풀에 들어왔다');
  assert.equal(after.cards[fresh], undefined, '카드로는 쌓이지 않는다');
  // 두 번째부터는 레벨업용 카드
  assert.equal(addCard(after, fresh).cards[fresh], 1);
});

test('보유 풀이 가득 차면 카드로 쌓인다 (GDD §5)', () => {
  let p = profile();
  const others = officersByGrade('D').filter((o) => !p.roster[o.id as OfficerId]);
  // Lv1 풀은 10명. 이미 5명이라 5명을 더 넣으면 찬다.
  for (const o of others.slice(0, 5)) p = addCard(p, o.id as OfficerId);
  assert.equal(Object.keys(p.roster).length, poolCap(p));

  const overflow = others[5]!.id as OfficerId;
  p = addCard(p, overflow);
  assert.equal(p.roster[overflow], undefined);
  assert.equal(p.cards[overflow], 1, '풀이 차면 카드로 남는다');
});

test('레벨업은 실패하지 않는다 — 카드만 채우면 반드시 오른다 (2026-08-04 확정)', () => {
  let p = profile();
  const who = Object.keys(p.roster)[0]! as OfficerId;

  assert.equal(canLevelUp(p, who).ok, false, '카드가 없으면 안 된다');
  assert.equal(cardsToLevelUp(1), 3);

  p = addCard(p, who, 3);
  assert.equal(p.cards[who], 3);
  assert.equal(canLevelUp(p, who).ok, true);

  p = applyLevelUp(p, who, 'hp', 'illusion');
  assert.equal(p.roster[who]!.level, 2);
  assert.equal(p.cards[who], undefined, '카드는 정확히 필요한 만큼만 소모된다');
  assert.deepEqual(p.roster[who]!.statPicks, ['hp']);
  assert.equal(p.roster[who]!.tactics.length, 1);
});

test('Lv6·Lv7의 지원은 생성/제거가 한 쌍으로 들어온다 (GDD §3.7)', () => {
  assert.deepEqual(tacticChoices(2).support.length, 1);
  assert.equal(tacticChoices(6).support.length, 2, '화계 + 진화');
  assert.equal(tacticChoices(7).support.length, 2, '수계 + 매립');
  assert.equal(tacticChoices(6).illusion.length, 1);
});

test('능력 선택이 능력치에 반영된다 (GDD §4.2)', () => {
  const inst = { officer: 'x' as OfficerId, level: 9, statPicks: Array(8).fill('hp' as const), tactics: [], record: { wins: 0, losses: 0, kills: 0 } };
  assert.deepEqual(statsOf(inst), { hp: 50, mp: 5, at: 2 }, '전부 HP면 50');
  assert.deepEqual(statsOf({ ...inst, statPicks: Array(8).fill('at' as const) }), { hp: 10, mp: 5, at: 6 });
  assert.deepEqual(statsOf({ ...inst, statPicks: Array(8).fill('mp' as const) }), { hp: 10, mp: 21, at: 2 });
});

test('최대 레벨에서는 더 올릴 수 없다', () => {
  let p = profile();
  const who = Object.keys(p.roster)[0]! as OfficerId;
  for (let lv = 1; lv < 9; lv++) {
    p = addCard(p, who, cardsToLevelUp(lv)!);
    p = applyLevelUp(p, who, 'hp', lv % 2 === 0 ? 'support' : 'illusion');
  }
  assert.equal(p.roster[who]!.level, 9);
  assert.equal(cardsToLevelUp(9), null);
  assert.equal(canLevelUp(p, who).ok, false);
  assert.equal(p.roster[who]!.statPicks.length, 8, 'Lv9까지 8번 고른다');
});

// ── 편성 (GDD §3.9) ────────────────────────────────────────────

test('편성 검증 — 인원수 · King 필수 · 기물/장수 중복 · 보유 여부', () => {
  const p = profile();
  const ok = picksOf(p, 3);
  assert.equal(validateRoster(p, '3v3', ok).ok, true);

  assert.equal(validateRoster(p, '3v3', ok.slice(0, 2)).ok, false, '인원수');
  assert.equal(validateRoster(p, '5v5', ok).ok, false, '5v5는 5명');

  const noKing = ok.map((x, i) => (i === 0 ? { ...x, piece: 'Pawn' as const } : x));
  assert.match(orReason(validateRoster(p, '3v3', noKing)), /King/);

  const dupPiece = [ok[0]!, { ...ok[1]!, piece: 'King' as const }, ok[2]!];
  assert.match(orReason(validateRoster(p, '3v3', dupPiece)), /기물/);

  const dupOfficer = [ok[0]!, { ...ok[1]!, officer: ok[0]!.officer }, ok[2]!];
  assert.match(orReason(validateRoster(p, '3v3', dupOfficer)), /같은 장수/);

  const notOwned = officersByGrade('D').find((o) => !p.roster[o.id as OfficerId])!.id as OfficerId;
  const unowned = [ok[0]!, ok[1]!, { ...ok[2]!, officer: notOwned }];
  assert.match(orReason(validateRoster(p, '3v3', unowned)), /보유하지 않은/);
});

test('편성 검증을 통과하면 룰 엔진도 받아들인다 — 두 곳이 어긋나지 않는다', () => {
  const p = profile();
  const picks = picksOf(p, 3);
  assert.equal(validateRoster(p, '3v3', picks).ok, true);
  const entries = toRosterEntries(p, picks);
  // 엔진이 최종 권위다. 여기서 던지면 화면이 "가능하다"고 거짓말한 것이다.
  const state = createBattle({ matchId: 't', seed: 1, mode: '3v3', rosters: { P1: entries, P2: entries } });
  assert.equal(Object.keys(state.units).length, 6);
});

test('편성은 보유 장수의 레벨·빌드를 그대로 가져온다', () => {
  let p = profile();
  const who = Object.keys(p.roster)[0]! as OfficerId;
  p = applyLevelUp(addCard(p, who, 3), who, 'at', 'support');

  const entry = toRosterEntries(p, picksOf(p, 3)).find((e) => e.officer === who)!;
  assert.equal(entry.level, 2);
  assert.deepEqual(entry.statPicks, ['at']);
  assert.equal(entry.tactics.length, 1);
});

test('군량은 기물 1개당 1 (GDD §6.1)', () => {
  const p = profile();
  assert.equal(grainCost('3v3'), 3);
  assert.equal(grainCost('5v5'), 5);
  assert.equal(spendGrain(p, '3v3').grain, p.grain - 3);

  const poor = { ...p, grain: 2 };
  assert.equal(validateRoster(poor, '3v3', picksOf(poor, 3)).ok, false);
  assert.equal(validateRoster(poor, '3v3', picksOf(poor, 3), false).ok, true, '군량 검사를 끄면 통과');
  assert.throws(() => spendGrain(poor, '3v3'), /군량/);
});

test('AI 편성은 내 팀 점수에 맞춰 뽑히고 시드로 재현된다', () => {
  const pool = officersByGrade('C').map((o) => o.id as OfficerId);
  const score = (id: OfficerId) => GRADE_SCORE[officerById.get(id)!.grade];
  const a = makeAiPicks('3v3', 12, 5, score, pool);
  const b = makeAiPicks('3v3', 12, 5, score, pool);
  assert.deepEqual(a, b, '같은 시드면 같은 편성');
  assert.equal(a.length, teamSize('3v3'));
  assert.equal(a[0]!.piece, 'King', 'King은 반드시 들어간다');
  assert.equal(new Set(a.map((x) => x.officer)).size, 3, '같은 장수를 두 번 넣지 않는다');
});

// ── 보상 (GDD §6.4) ────────────────────────────────────────────

test('AI 대전은 군량만 준다 — 카드는 없다 (2026-08-04 확정)', () => {
  const p = profile();
  const picks = picksOf(p, 3);
  const win = applyBattleResult(p, { won: true, mode: '3v3', opponent: 'ai', picks }, 1);
  assert.equal(win.rewards.grain, 1);
  assert.equal(win.rewards.card, null, 'AI 대전에서 카드가 나오면 봇 파밍이 된다');
  assert.deepEqual(win.profile.cards, {}, '카드 보유가 늘지 않는다');

  const lose = applyBattleResult(p, { won: false, mode: '3v3', opponent: 'ai', picks }, 1);
  assert.equal(lose.rewards.grain, 0);
  assert.equal(lose.rewards.card, null);
});

test('온라인 대전은 카드를 준다 — 승리는 팀 구성 보정, 패배는 C~D급', () => {
  const p = profile();
  const picks = picksOf(p, 3);
  const win = applyBattleResult(p, { won: true, mode: '3v3', opponent: 'online', picks }, 3);
  assert.ok(win.rewards.card, '승리하면 카드가 나온다');
  assert.ok(['B', 'C', 'D'].includes(win.rewards.cardGrade!));

  const lose = applyBattleResult(p, { won: false, mode: '3v3', opponent: 'online', picks }, 3);
  assert.ok(['C', 'D'].includes(lose.rewards.cardGrade!), '패배는 C~D급');
});

test('전적은 출전한 장수 전원에게 남는다 (GDD §7)', () => {
  const p = profile();
  const picks = picksOf(p, 3);
  const kills = { [picks[0]!.officer]: 2 };
  const after = applyBattleResult(p, { won: true, mode: '3v3', opponent: 'ai', picks, kills }, 1).profile;

  for (const pick of picks) assert.equal(after.roster[pick.officer]!.record.wins, 1);
  assert.equal(after.roster[picks[0]!.officer]!.record.kills, 2);
  assert.equal(after.roster[picks[1]!.officer]!.record.kills, 0);

  const lost = applyBattleResult(after, { won: false, mode: '3v3', opponent: 'ai', picks }, 1).profile;
  assert.equal(lost.roster[picks[0]!.officer]!.record.losses, 1);
  assert.equal(lost.roster[picks[0]!.officer]!.record.wins, 1, '승수는 그대로 남는다');
});

test('입력 프로필을 건드리지 않는다 (룰 엔진의 apply와 같은 규약)', () => {
  const p = profile();
  const before = JSON.stringify(p);
  const who = Object.keys(p.roster)[0]! as OfficerId;
  applyLevelUp(addCard(p, who, 3), who, 'hp', 'illusion');
  applyBattleResult(p, { won: true, mode: '3v3', opponent: 'online', picks: picksOf(p, 3) }, 1);
  assert.equal(JSON.stringify(p), before);
});

const orReason = (r: { ok: boolean; reason?: string }): string => (r.ok ? '' : r.reason ?? '');
