/**
 * 메타(계정·수집·성장) 회귀 — GDD §3.9 · §4.2 · §4.3 · §6.4 · §8
 *
 * 여기서 지키는 것은 **2026-08-04에 확정한 경제 규칙 둘**이다.
 *  - 레벨업에 실패가 없다 (전 레벨 100%)
 *  - 1:1이 없다 (3:3 / 5:5만)
 *
 * > 셋째였던 「AI 대전은 군량만 준다」는 **2026-08-18에 뒤집혔다** — 병영의 문이
 * > 하나로 합쳐지면서 상대가 사람인지 AI인지 고를 수 없게 됐다. 보상표와 전적은
 * > 이제 `records.test.ts`가 본다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattle } from '@samchess/rules';
import type { OfficerId } from '@samchess/rules';
import { OFFICERS, officerById, officersByGrade } from '@samchess/data';
import {
  addCard, applyBattleResult, applyLevelUp, canLevelUp, cardsToLevelUp, createProfile,
  grainCost, poolCap, refundGrain, spendGrain, statPicksOf, statsOf, tacticChoices,
  tacticsOf, teamSize, toRosterEntries, validateRoster,
} from '../src/index.ts';
import type { PlayerProfile, RosterPick, StatPick } from '../src/index.ts';

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
  // 풀이 60명이라 D급(44명)만으로는 안 찬다 — 등급을 가리지 않고 채운다
  const others = OFFICERS.filter((o) => !p.roster[o.id as OfficerId]);
  // 풀은 **궁궐**이 정한다 (2026-09-04). 온보딩 5명 위에 상한까지 채운다 —
  // 숫자를 여기 적으면 궁궐 표가 바뀔 때 검사가 조용히 뜻을 잃는다
  const room = poolCap(p) - Object.keys(p.roster).length;
  for (const o of others.slice(0, room)) p = addCard(p, o.id as OfficerId);
  assert.equal(Object.keys(p.roster).length, poolCap(p));

  const overflow = others[room]!.id as OfficerId;
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
  assert.deepEqual(statPicksOf(p.roster[who]!), ['hp']);
  assert.equal(tacticsOf(p.roster[who]!).length, 1);
  assert.equal(p.roster[who]!.growth.length, 1, 'growth.length === level - 1');
});

// 2026-09-03에 「Lv6·Lv7의 지원은 한 쌍」이 접혔다 — 수계·매립을 지우고
// 진화를 Lv7로 옮겨 **레벨마다 하나씩**이 됐다(GDD §3.7·§12).
test('책략은 레벨마다 지원 하나 · 환술 하나다 (GDD §3.7)', () => {
  for (let lv = 2; lv <= 9; lv++) {
    assert.equal(tacticChoices(lv).support.length, 1, `Lv${lv} 지원`);
    assert.equal(tacticChoices(lv).illusion.length, 1, `Lv${lv} 환술`);
  }
  assert.deepEqual(tacticChoices(6).support, ['hwa-gye'], 'Lv6은 화계');
  assert.deepEqual(tacticChoices(7).support, ['jin-hwa'], 'Lv7은 진화');
});

test('능력 선택이 능력치에 반영된다 (GDD §4.2)', () => {
  const all = (stat: StatPick) => ({
    officer: 'x' as OfficerId,
    level: 9,
    growth: Array.from({ length: 8 }, (_, i) => ({ stat, tactics: tacticChoices(i + 2).illusion })),
    record: {},
  });
  assert.deepEqual(statsOf(all('hp')), { hp: 50, mp: 5, at: 2 }, '전부 HP면 50');
  assert.deepEqual(statsOf(all('at')), { hp: 10, mp: 5, at: 6 });
  assert.deepEqual(statsOf(all('mp')), { hp: 10, mp: 21, at: 2 });
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
  assert.equal(p.roster[who]!.growth.length, 8, 'Lv9까지 8번 고른다');
  assert.equal(statPicksOf(p.roster[who]!).length, 8);
  // Lv6·7의 지원을 골랐으면 책략은 여덟보다 많다 — 그래서 **세는 기준은 능력 선택**이다
  assert.ok(tacticsOf(p.roster[who]!).length >= 8);
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

// AI 상대 생성은 `match.test.ts`가 본다 — 등급 점수가 아니라 **전투력**이 기준이다 (F)

// ── 보상 (GDD §6.4) ────────────────────────────────────────────
//
// **보상표와 전적은 `records.test.ts`가 본다** (2026-08-18, v3). 세 결말 × 두 모드 ×
// 두 상대 열두 조합과 40쪽 표가 거기 있다. 여기 남는 것은 다른 규약과의 접점뿐이다.

test('입력 프로필을 건드리지 않는다 (룰 엔진의 apply와 같은 규약)', () => {
  const p = profile();
  const before = JSON.stringify(p);
  const who = Object.keys(p.roster)[0]! as OfficerId;
  applyLevelUp(addCard(p, who, 3), who, 'hp', 'illusion');
  applyBattleResult(p, {
    result: 'win', mode: '3v3', opponent: 'online', picks: picksOf(p, 3),
    power: { mine: 300, theirs: 300 }, at: 1_700_000_000_000,
  }, 1);
  assert.equal(JSON.stringify(p), before);
});

const orReason = (r: { ok: boolean; reason?: string }): string => (r.ok ? '' : r.reason ?? '');

// ═══════════════════════════════════════════════════════════════
// 성립하지 않은 판의 환불 (GDD §3.9 이탈 표 · H2)
// ═══════════════════════════════════════════════════════════════

test('환불은 낸 만큼 그대로 돌아온다 — 전적도 보상도 건드리지 않는다', () => {
  const p = { ...profile(), grain: 4 };
  const spent = spendGrain(p, '3v3');
  const back = refundGrain(spent, '3v3');
  assert.equal(back.grain, p.grain, '낸 만큼이 안 돌아왔다');
  assert.deepEqual(back.matches, p.matches, '무효 판에 이력이 남았다');
  assert.deepEqual(back.record, p.record, '무효 판에 전적이 남았다');
});

test('환불이 창고를 넘기지 않는다 — 넘기면 「환불로 군량을 불린다」가 된다', () => {
  const p = profile();                       // 새 계정은 군량이 상한에 붙어 시작한다
  const cap = p.grain;
  assert.equal(refundGrain(p, '5v5').grain, cap, `상한 ${cap}을 넘겨 돌려줬다`);
});
