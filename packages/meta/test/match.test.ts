/**
 * 출전 · 매칭 회귀 — pptx 45쪽 (F, 2026-08-18)
 *
 * 두 덩이다.
 *  ① **군량 경계** — 「딱 최소면 거절할 수 없다」는 §5-16의 표 그대로다. 화면은
 *     이 판정을 그리기만 하므로, 경계가 틀리면 **눌러 놓고 나서야** 드러난다.
 *  ② **AI 상대의 전투력** — 등급 점수를 버리고 `battlePower()`로 갈아 끼운 자리.
 *     온라인 매칭이 `MATCH_BAND`로 고르는 것과 **같은 눈금**인지를 여기서 잡는다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBattle } from '@samchess/rules';
import type { BattleMode, OfficerId } from '@samchess/rules';
import { officerById } from '@samchess/data';
import {
  MATCH_BAND, MATCH_DECLINE_GRAIN, battlePower, canDeclineMatch, canStartMatch, createProfile,
  declineMatch, grainCost, makeAiOpponent, opponentMembers, teamSize,
} from '../src/index.ts';
import type { PlayerProfile } from '../src/index.ts';

const MODES: BattleMode[] = ['3v3', '5v5'];
const withGrain = (grain: number): PlayerProfile => ({ ...createProfile('테스트성', 1), grain });

// ── ① 군량 경계 (§5-15 · §5-16) ────────────────────────────────

test('참가비는 기물 수만큼이고, 그만큼 있으면 출전한다', () => {
  for (const mode of MODES) {
    const cost = grainCost(mode);
    assert.equal(cost, teamSize(mode), `${mode}의 참가비는 기물 수와 같다`);
    assert.equal(canStartMatch(withGrain(cost - 1), mode).ok, false);
    assert.equal(canStartMatch(withGrain(cost), mode).ok, true, '딱 최소여도 출전은 된다');
    assert.equal(canStartMatch(withGrain(cost + 1), mode).ok, true);
  }
});

/**
 * 45쪽의 표 그대로다.
 *
 * | 잔여 군량 | 출전 | 거절 |
 * |---|---|---|
 * | `< cost` | ✕ | — |
 * | `= cost` | ○ | **✕** |
 * | `> cost` | ○ | ○ |
 */
test('딱 최소 군량이면 매칭을 거절할 수 없다 — 3v3 3 · 5v5 5 각각', () => {
  for (const mode of MODES) {
    const cost = grainCost(mode);
    assert.equal(canDeclineMatch(withGrain(cost - 1), mode).ok, false, `${mode}: 출전조차 못 한다`);
    assert.equal(canDeclineMatch(withGrain(cost), mode).ok, false,
      `${mode}: 딱 최소면 매칭된 상대와 반드시 싸운다`);
    assert.equal(canDeclineMatch(withGrain(cost + 1), mode).ok, true, `${mode}: 하나 더 있으면 거절한다`);
  }
});

test('거절할 수 없는 이유는 45쪽 안내문 그대로다 — 화면이 문구를 다시 적지 않는다', () => {
  const why = canDeclineMatch(withGrain(3), '3v3');
  assert.equal(why.ok, false);
  assert.match(why.ok === false ? why.reason : '', /최소군량만 있을 때는 상대 매칭 시 거절을 할 수 없습니다/);
});

test('거절은 군량 −1이고 바닥에서는 던진다', () => {
  assert.equal(MATCH_DECLINE_GRAIN, 1, '45쪽 목업의 「3소모」는 −1로 확정됐다 (§5-15)');
  const p = withGrain(5);
  assert.equal(declineMatch(p, '3v3').grain, 4);
  assert.equal(p.grain, 5, '입력을 건드리지 않는다');
  // 3 → 거절 불가. 조용히 넘기면 「눌렀는데 아무 일도 없다」가 된다
  assert.throws(() => declineMatch(withGrain(3), '3v3'), /거절을 할 수 없습니다/);
});

test('거절을 반복하면 참가비 자리에서 정확히 멈춘다', () => {
  let p = withGrain(6);
  let declines = 0;
  while (canDeclineMatch(p, '3v3').ok) { p = declineMatch(p, '3v3'); declines += 1; }
  assert.equal(declines, 3, '6 → 5 → 4 → 3에서 멈춘다');
  assert.equal(p.grain, grainCost('3v3'), '참가비는 남아 있다 — 매칭된 상대와 싸울 수 있다');
  assert.equal(canStartMatch(p, '3v3').ok, true);
});

// ── ② AI 상대 — 전투력이 눈금이다 (§5-32) ──────────────────────

/**
 * 훑는 구간 — **만들 수 있는 범위 전체**다.
 *
 * 점 몇 개만 보면 「가운데만 맞고 끝은 어긋나는」 것을 놓친다(실제로 바닥 근처
 * 250에서 31이 벗어나 보정 한 바퀴를 붙였다). 위/아래 끝은 균형 성장으로 닿을 수
 * 있는 자리이고, 그보다 밖은 아래 「도달 범위 밖」 검사가 따로 본다.
 */
const SWEEP: Record<BattleMode, { lo: number; hi: number }> = {
  '3v3': { lo: 215, hi: 1290 },
  '5v5': { lo: 260, hi: 1285 },
};

test('AI 상대의 전투력이 내 부대와 같은 구간에 든다 — 전 범위 훑기 (MATCH_BAND)', () => {
  for (const mode of MODES) {
    const { lo, hi } = SWEEP[mode];
    let worst = 0;
    for (let target = lo; target <= hi; target += 10) {
      for (const seed of [1, 7919, 55433]) {
        const foe = makeAiOpponent(mode, target, seed);
        const off = Math.abs(foe.power - target);
        worst = Math.max(worst, off);
        assert.ok(off <= MATCH_BAND,
          `${mode} 목표 ${target} 시드 ${seed} → ${foe.power} (차 ${foe.power - target}, 구간 ±${MATCH_BAND})`);
      }
    }
    // 실측 최대 오차 — 3v3 11 · 5v5 20 (2026-08-18). 여유가 사라지면 여기서 먼저 보인다
    assert.ok(worst <= MATCH_BAND, `${mode} 최대 오차 ${worst}`);
  }
});

test('AI 상대는 성립하는 편성이다 — 인원 · King · 기물/장수 중복 없음', () => {
  for (const mode of MODES) {
    const foe = makeAiOpponent(mode, 700, 3);
    assert.equal(foe.entries.length, teamSize(mode));
    assert.ok(foe.entries.some((e) => e.piece === 'King'), 'King이 반드시 들어간다');
    assert.equal(new Set(foe.entries.map((e) => e.piece)).size, teamSize(mode), '기물이 겹치지 않는다');
    assert.equal(new Set(foe.entries.map((e) => e.officer)).size, teamSize(mode), '장수가 겹치지 않는다');
    assert.equal(foe.kind, 'ai');
    assert.equal(foe.id, null, 'AI에게는 계정 id가 없다');
    assert.equal(foe.squadName, null, 'AI에게는 부대가 없다 (§4-7②)');
  }
});

/**
 * **엔진이 최종 권위다.** `createBattle`은 `statPicks.length === level − 1`을 다시
 * 보고 어기면 던진다 — AI의 성장 스택을 손으로 만드는 자리라 여기가 그물이다.
 */
test('AI 상대는 언제나 createBattle을 통과한다', () => {
  for (const mode of MODES) {
    for (const seed of [1, 2, 3, 99]) {
      const mine = makeAiOpponent(mode, 600, seed * 17);
      const foe = makeAiOpponent(mode, 600, seed, mine.entries.map((e) => e.officer));
      assert.doesNotThrow(() => createBattle({
        matchId: `t${seed}`, seed, mode, rosters: { P1: mine.entries, P2: foe.entries },
      }));
    }
  }
});

test('AI 상대의 전투력은 battlePower가 낸 값과 같다 — 화면이 딴 숫자를 보지 않는다', () => {
  for (const mode of MODES) {
    const foe = makeAiOpponent(mode, 850, 11);
    assert.equal(foe.power, battlePower(mode, foe.entries));
  }
});

test('같은 시드·목표면 같은 상대가 나온다 (Math.random 금지)', () => {
  const a = makeAiOpponent('3v3', 777, 2026);
  const b = makeAiOpponent('3v3', 777, 2026);
  assert.deepEqual(a, b);
  const other = makeAiOpponent('3v3', 777, 2027);
  assert.notDeepEqual(a.entries.map((e) => e.officer), other.entries.map((e) => e.officer),
    '시드가 다르면 얼굴도 다르다 — 늘 최적을 집으면 같은 상대만 나온다');
});

test('목표가 높으면 상대도 세진다 (단조)', () => {
  for (const mode of MODES) {
    let last = -Infinity;
    for (let target = SWEEP[mode].lo; target <= SWEEP[mode].hi; target += 100) {
      const power = makeAiOpponent(mode, target, 5).power;
      assert.ok(power > last, `${mode} 목표 ${target} → ${power} (앞은 ${last})`);
      last = power;
    }
  }
});

/**
 * 도달 범위 밖에서도 **던지지 않는다.** 막으면 「전투력을 너무 올려서 출전을 못 한다」가
 * 되므로, 만들 수 있는 가장 가까운 것을 주고 실제 값을 그대로 싣는다 —
 * 화면이 예상 승률로 그 격차를 보여 준다.
 */
test('도달 범위 밖의 목표에서도 상대를 만든다 — 잰 값을 그대로 준다', () => {
  for (const mode of MODES) {
    const tiny = makeAiOpponent(mode, 1, 4);
    assert.ok(tiny.power > 0 && tiny.power < 400, `바닥 목표 → ${tiny.power}`);
    const huge = makeAiOpponent(mode, 99_999, 4);
    assert.ok(huge.power > 1000 && huge.power < 2000, `천장 목표 → ${huge.power}`);
    assert.equal(huge.power, battlePower(mode, huge.entries));
  }
});

test('내 장수는 상대로 뽑히지 않는다', () => {
  const mine = ['조조', '관우', '장비'].map((n) =>
    [...officerById.values()].find((o) => o.name === n)?.id as OfficerId).filter(Boolean);
  const foe = makeAiOpponent('3v3', 900, 8, mine);
  for (const e of foe.entries) assert.ok(!mine.includes(e.officer), `${e.officer}가 양쪽에 있다`);
});

test('상대 표의 한 줄은 화면이 그릴 것을 다 갖는다', () => {
  const foe = makeAiOpponent('3v3', 700, 6);
  const rows = opponentMembers(foe);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(row.name.length > 0);
    assert.ok(row.level >= 1 && row.level <= 9);
    assert.ok(row.stats.hp >= 10, '능력치는 성장 스택이 아니라 statsFrom을 지난다');
  }
});
