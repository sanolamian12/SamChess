/**
 * 랭킹 회귀 — 전투 · 도시화 · 컬렉션 세 분야(2026-11-20 기획자, 옛 도시 · 부대 · 장수 세 판을 바꿨다).
 *
 * 여기서 고정하는 것.
 *  - **전투 = 공격대의 부대 전적** — 병영의 모드 줄과 같은 값(`squad.record`), 「전체」는 두 모드 합, 수비대는 안 센다,
 *    수성 성공은 받은 값을 그 모드만큼 더한다, 한 판도 안 뛴 도시는 줄에 안 선다
 *  - **도시화 = 도시 레벨 × 100 + 보유 장수(풀 + 보관함) × 10 + 올린 레벨 합** — 건물 레벨은 안 본다
 *  - **등수는 끝까지 정한다** — 같은 점수면 정한 다음 기준, 마지막은 도시 이름이라 같은 등수가 없다
 *  - 장수 카드의 행(`officerRankRows`)은 그대로 — 랭킹이 아니라 카드 데이터다
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId } from '@samchess/rules';
import {
  CITY_RANK_WEIGHTS, addSquad, applyBattleResult, attackTally, battleRankRow, battleRankable, battleScore, cityRankRow, cityScore,
  createProfile, levelMaturity, officerRankRows, ownedOfficers, sortBattleRows, sortCityRows, withRanks,
} from '../src/index.ts';
import type { BattleOutcome, PlayerProfile, RosterPick } from '../src/index.ts';

const AT = 1_700_000_000_000;

const profile = (name = '랭킹성'): PlayerProfile => createProfile(name, 1);

function picksOf(p: PlayerProfile, count: number): RosterPick[] {
  const pieces = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const;
  return Object.keys(p.roster).slice(0, count)
    .map((officer, i) => ({ piece: pieces[i]!, officer: officer as OfficerId }));
}

function fight(p: PlayerProfile, over: Partial<BattleOutcome> = {}, seed = 1): PlayerProfile {
  const mode = over.mode ?? '3v3';
  const outcome: BattleOutcome = {
    result: 'win', mode, opponent: 'field',
    picks: picksOf(p, mode === '3v3' ? 3 : 5),
    power: { mine: 600, theirs: 600 }, at: AT,
    ...over,
  };
  return applyBattleResult(p, outcome, seed).profile;
}

/** 3v3 · 5v5 공격대를 둔 계정 */
function withAttack(name = '랭킹성'): PlayerProfile {
  let p = profile(name);
  p = addSquad(p, { mode: '3v3', role: 'attack', picks: picksOf(p, 3) }).profile;
  return addSquad(p, { mode: '5v5', role: 'attack', picks: picksOf(p, 5) }).profile;
}

/** 3v3 공격대로 `wins`판 이긴 계정 */
function winner(wins: number, name = '랭킹성'): PlayerProfile {
  let p = withAttack(name);
  for (let i = 0; i < wins; i++) p = fight(p, { mode: '3v3', mySquad: 'atk-3v3' }, i + 1);
  return p;
}

describe('battleScore', () => {
  it('승점 칸 그대로 — 승패 수 · 격파는 더하지 않는다 (2026-10-27)', () => {
    assert.equal(battleScore({ plays: 4, wins: 2, draws: 0, losses: 2, kills: 5, points: 138 }), 138);
    assert.equal(battleScore({ plays: 0, wins: 0, draws: 0, losses: 0, kills: 0, points: 0 }), 0);
  });
});

describe('전투 랭킹 — 공격대의 부대 전적', () => {
  it('모드마다 그 공격대 칸의 전적 · 「전체」는 두 모드 합', () => {
    let p = withAttack();
    p = fight(p, { mode: '3v3', mySquad: 'atk-3v3' });
    p = fight(p, { mode: '5v5', mySquad: 'atk-5v5', result: 'lose' }, 2);
    assert.equal(attackTally(p, '3v3').wins, 1);
    assert.equal(attackTally(p, '5v5').losses, 1);
    const all = attackTally(p, 'all');
    assert.equal(all.plays, 2);
    assert.equal(all.points, attackTally(p, '3v3').points + attackTally(p, '5v5').points);
    assert.ok(all.points > 0, '이긴 판에 승점이 있어야 한다');
    assert.equal(battleRankRow(p, 'all').total, all.points);
  });

  it('수비대 칸의 전적은 안 센다 — 선전포고를 받아 싸운 판도', () => {
    let p = withAttack();
    p = addSquad(p, { mode: '3v3', role: 'defense', picks: picksOf(p, 3) }).profile;
    p = fight(p, { mode: '3v3', mySquad: 'def-3v3' });
    assert.equal(p.squads.find((s) => s.id === 'def-3v3')!.record['field/3v3']?.wins, 1, '수비대 칸에는 쌓였다');
    assert.equal(attackTally(p, 'all').plays, 0);
    assert.equal(battleRankable(battleRankRow(p, 'all')), false, '공격대로 안 뛰었으면 줄에 안 선다');
  });

  it('수성 성공은 받은 값을 그 모드만큼 — 「전체」는 두 모드 합', () => {
    const p = winner(1);
    const held = { '3v3': 4, '5v5': 2 };
    assert.equal(battleRankRow(p, '3v3', held).held, 4);
    assert.equal(battleRankRow(p, '5v5', held).held, 2);
    assert.equal(battleRankRow(p, 'all', held).held, 6);
    assert.equal(battleRankRow(p, 'all').held, 0, '방어 기록이 없으면 0');
  });

  it('승점 → 승 → 격파 → 도시 이름 — 같은 등수가 없다', () => {
    const a = battleRankRow(winner(1, '가성'), 'all');
    const b = battleRankRow(winner(1, '나성'), 'all');
    const c = battleRankRow(winner(3, '다성'), 'all');
    const ranked = withRanks(sortBattleRows([b, a, c]));
    assert.deepEqual(ranked.map((r) => [r.cityName, r.rank]), [['다성', 1], ['가성', 2], ['나성', 3]]);
  });

  it('공성전 목록의 도시 점수(`cityScore`)는 전투 「전체」의 점수다', () => {
    const p = winner(2);
    assert.equal(cityScore(p), battleRankRow(p, 'all').total);
  });
});

describe('도시화 랭킹 — 도시 레벨 · 보유 장수 · 레벨 성숙도', () => {
  it('가중 합 — 도시 레벨 × 100 + 보유 장수 × 10 + 올린 레벨 합', () => {
    const p = profile();
    const ids = Object.keys(p.roster) as OfficerId[];
    p.roster[ids[0]!]!.level = 4;   // 올린 레벨 3
    p.roster[ids[1]!]!.level = 2;   // 1
    p.cityLevel = 3;
    const row = cityRankRow(p);
    assert.equal(row.maturity, 4);
    assert.equal(levelMaturity(p), 4);
    assert.equal(row.officers, ownedOfficers(p).length);
    assert.equal(row.total, 3 * CITY_RANK_WEIGHTS.cityLevel + row.officers * CITY_RANK_WEIGHTS.officer + 4 * CITY_RANK_WEIGHTS.level);
  });

  it('건물 레벨은 점수에 안 들어간다', () => {
    const p = profile();
    const before = cityRankRow(p).total;
    const q: PlayerProfile = { ...p, buildings: Object.fromEntries(Object.keys(p.buildings).map((k) => [k, 5])) as PlayerProfile['buildings'] };
    assert.equal(cityRankRow(q).total, before);
  });

  it('점수 → 도시 레벨 → 도시 이름', () => {
    const a = { ...cityRankRow(profile('나성')), total: 500, cityLevel: 2 };
    const b = { ...cityRankRow(profile('가성')), total: 500, cityLevel: 2 };
    const c = { ...cityRankRow(profile('다성')), total: 500, cityLevel: 3 };
    const d = { ...cityRankRow(profile('라성')), total: 900, cityLevel: 1 };
    assert.deepEqual(withRanks(sortCityRows([a, b, c, d])).map((r) => r.cityName), ['라성', '다성', '가성', '나성']);
  });
});

describe('장수 카드의 행 — 옛 장수 랭킹의 행', () => {
  it('officerRankRows — 장수 카드가 필요한 필드(삼능력 · AT 범위 · 서사)를 낸다', () => {
    const rows = officerRankRows(fight(profile()));
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(typeof r.stats.hp, 'number');
      assert.equal(typeof r.might, 'number');
      assert.ok(r.at.max >= r.at.min, `AT 범위가 거꾸로다 — ${r.at.min}-${r.at.max}`);
      assert.ok(!('at' in r.stats));
      assert.ok(Array.isArray(r.tactics));
    }
    // G1이 218/260명만 채웠다 — 최소 한 명은 story · courtesyName이 있어야 한다
    assert.ok(rows.some((r) => r.story), '인물 서사가 하나도 안 붙었다');
    assert.ok(rows.some((r) => r.courtesyName), '자(courtesyName)가 하나도 안 붙었다');
    assert.ok(rows.some((r) => r.uniqueSkillId), '고유기술이 있는 장수가 하나도 없다');
    assert.ok(rows.some((r) => !r.uniqueSkillId), '고유기술이 없는 장수가 하나도 없다');
  });
});
