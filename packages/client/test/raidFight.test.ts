/**
 * 도적떼 자동 전투의 가짜 전투 시간표 (2026-11-27 기획자) — 서 있는 수의 경계 · 길이 7~10초 · 진 쪽 전원이 쓰러진다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ANIM, POSE } from '../src/battle/animSheet.ts';
import { RAID_FIGHT, RAID_FIGHT_EMPTY, fightPose, fighting, marchProgress, planRaidFight, raidSurvivors } from '../src/screens/raidFight.ts';

/** 고정 수열 — 시험이 흔들리지 않게 */
function seq(seed: number): () => number {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; };
}

test('이긴 쪽에 서 있는 수 — 10 · 29 · 59 · 99의 경계, 인원을 넘지 않는다', () => {
  const cases: [number, number][] = [[0, 1], [10, 1], [11, 2], [29, 2], [30, 3], [59, 3], [60, 4], [99, 4], [100, 5], [400, 5]];
  for (const [d, want] of cases) {
    assert.equal(raidSurvivors(d, 5), want, `차 ${d}`);
    assert.equal(raidSurvivors(-d, 5), want, `차 −${d}`);
  }
  assert.equal(raidSurvivors(150, 3), 3);
  assert.equal(raidSurvivors(150, 0), 0);
});

test('연출은 7~10초이고 쓰러짐은 맞붙는 동안에 다 끝난다', () => {
  assert.ok(RAID_FIGHT.doneMs >= 7000 && RAID_FIGHT.doneMs <= 10_000);
  // 결말 줄은 큰 글씨가 찍힌 뒤에 뜬다
  assert.ok(RAID_FIGHT.verdictMs < RAID_FIGHT.afterMs && RAID_FIGHT.afterMs <= RAID_FIGHT.doneMs);
  const fightEnd = RAID_FIGHT.marchMs + RAID_FIGHT.fightMs;
  for (let s = 1; s <= 30; s++) {
    const plan = planRaidFight({ win: s % 2 === 0, mine: 300, theirs: 261 + s, allies: 1 + (s % 5), foes: 1 + ((s * 3) % 5) }, seq(s));
    for (const u of plan.units) if (u.fallAt !== null) assert.ok(u.fallAt > RAID_FIGHT.marchMs && u.fallAt < fightEnd);
  }
});

test('진 쪽은 전원 · 이긴 쪽은 서 있는 수만 빼고 쓰러진다 — 마지막에 쓰러지는 것은 진 쪽', () => {
  for (let s = 1; s <= 40; s++) {
    const win = s % 2 === 0;
    const allies = 1 + (s % 5);
    const foes = 1 + ((s * 7) % 5);
    const mine = win ? 500 : 100;
    const theirs = win ? 500 - (s * 9) : 100 + (s * 9);
    const plan = planRaidFight({ win, mine, theirs, allies, foes }, seq(s));
    const winSide = win ? 'ally' : 'foe';
    const standing = plan.units.filter((u) => u.fallAt === null);
    assert.equal(standing.length, raidSurvivors(mine - theirs, win ? allies : foes));
    assert.ok(standing.every((u) => u.side === winSide));
    const falls = plan.units.filter((u) => u.fallAt !== null).sort((a, b) => a.fallAt! - b.fallAt!);
    assert.notEqual(falls.at(-1)!.side, winSide);
  }
});

test('보초병이 없으면 아무도 안 쓰러지고 도적이 다 선다', () => {
  const plan = planRaidFight({ win: false, mine: 0, theirs: 443, allies: 0, foes: 3 }, seq(7));
  assert.equal(plan.units.length, 3);
  assert.ok(plan.units.every((u) => u.fallAt === null));
  assert.equal(plan.empty, true);
});

test('보초병이 없으면 — 3초 걸어와 좌우로 세 번 흔들리고 「패배」, 7~10초 · 섬광 없음', () => {
  const tl = RAID_FIGHT_EMPTY;
  assert.ok(tl.doneMs >= 7000 && tl.doneMs <= 10_000 && tl.verdictMs < tl.afterMs && tl.afterMs <= tl.doneMs);
  const plan = planRaidFight({ win: false, mine: 0, theirs: 261, allies: 0, foes: 2 }, seq(1));
  const u = plan.units[0]!;
  assert.ok(marchProgress(plan, tl.marchMs / 2) < 1);
  assert.equal(marchProgress(plan, tl.marchMs), 1);
  // 흔들기 동안 앞(+)과 뒤(−)를 세 번씩 지난다
  let flips = 0;
  let prev = 0;
  for (let t = tl.marchMs; t < tl.marchMs + tl.fightMs; t += 20) {
    const { dx } = fightPose(plan, u, t);
    if (prev <= 0 && dx > 0.1) flips++;
    if (Math.abs(dx) > 0.1) prev = dx;
    assert.equal(fighting(plan, t), false);
  }
  assert.equal(flips, 3);
  assert.equal(fightPose(plan, u, tl.doneMs).dx, 0);
});

test('자세 — 걷기 → 맞붙음 → 쓰러짐(마지막 칸에 머문다) · 남은 쪽은 평상 동작 뒤 평상 자세', () => {
  const plan = planRaidFight({ win: true, mine: 300, theirs: 100, allies: 3, foes: 1 }, seq(3));
  const foe = plan.units.find((u) => u.side === 'foe')!;
  const ally = plan.units.find((u) => u.side === 'ally' && u.fallAt === null)!;
  assert.ok([POSE.move, ...ANIM.walk].includes(fightPose(plan, ally, 100).frame as never));
  assert.equal(fightPose(plan, foe, foe.fallAt! + 5000).frame, ANIM.fall.at(-1));
  assert.equal(fightPose(plan, foe, foe.fallAt! + 5000).down, true);
  assert.equal(fightPose(plan, ally, RAID_FIGHT.doneMs).frame, POSE.idle);
  assert.equal(fightPose(plan, ally, RAID_FIGHT.marchMs + RAID_FIGHT.fightMs).frame, ANIM.flourish[0]);
});
