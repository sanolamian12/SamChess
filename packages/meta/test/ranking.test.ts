/**
 * 랭킹 회귀 (pptx 46~49쪽, 2026-08-26) — 도시/부대/장수 세 판을 낸다.
 *
 * 여기서 고정하는 것 셋.
 *  - **부대 전적이 이력 꼬리와 무관하게 쌓이는가** — `applyBattleResult()`가
 *    `outcome.mySquad`(부대 이름)로 찾아 `squad.record`를 계정 전적과 같이 올리는가
 *  - **`battleScore()`가 세 판에서 같은 식(`wins*3 - losses + kills`)인가**
 *  - **세 정렬이 각자의 기준대로 내림차순인가**
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OfficerId } from '@samchess/rules';
import {
  addSquad, applyBattleResult, battleScore, cityRankRow, createProfile,
  officerRankRows, sortCityRows, sortOfficerRows, sortSquadRows, squadRankRows,
} from '../src/index.ts';
import type { BattleOutcome, PlayerProfile, RosterPick } from '../src/index.ts';

const AT = 1_700_000_000_000;

const profile = (): PlayerProfile => createProfile('랭킹성', 1);

function picksOf(p: PlayerProfile, count: number): RosterPick[] {
  const pieces = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const;
  return Object.keys(p.roster).slice(0, count)
    .map((officer, i) => ({ piece: pieces[i]!, officer: officer as OfficerId }));
}

function fight(p: PlayerProfile, over: Partial<BattleOutcome> = {}, seed = 1): PlayerProfile {
  const mode = over.mode ?? '3v3';
  const outcome: BattleOutcome = {
    result: 'win', mode, opponent: 'online',
    picks: picksOf(p, mode === '3v3' ? 3 : 5),
    power: { mine: 600, theirs: 600 }, at: AT,
    ...over,
  };
  return applyBattleResult(p, outcome, seed).profile;
}

describe('battleScore — 세 판이 같은 식을 쓴다', () => {
  it('wins*3 - losses + kills', () => {
    assert.equal(battleScore({ plays: 4, wins: 2, draws: 0, losses: 2, kills: 5 }), 2 * 3 - 2 + 5);
    assert.equal(battleScore({ plays: 0, wins: 0, draws: 0, losses: 0, kills: 0 }), 0);
  });
});

describe('도시 랭킹', () => {
  it('cityRankRow — 도시명·레벨·장수 수·전적을 낸다', () => {
    const p = fight(profile());
    const row = cityRankRow(p, 'all');
    assert.equal(row.cityName, p.cityName);
    assert.equal(row.cityLevel, p.cityLevel);
    assert.equal(row.officerCount, Object.keys(p.roster).length);
    assert.equal(row.tally.wins, 1);
    assert.equal(row.total, battleScore(row.tally));
  });

  it('sortCityRows — 총점 순은 내림차순이다', () => {
    const weak = cityRankRow(profile(), 'all');
    const strong = cityRankRow(fight(profile()), 'all');
    const sorted = sortCityRows([weak, strong], 'total');
    assert.equal(sorted[0], strong);
  });
});

describe('부대 랭킹 — 이력이 아니라 `squad.record`에 쌓인다', () => {
  it('출전한 부대의 전적이 오른다 (mySquad는 부대 이름이다)', () => {
    let p = profile();
    const made = addSquad(p, { name: '초전박살', mode: '3v3', picks: picksOf(p, 3) });
    p = made.profile;
    const squad = made.squad;
    assert.deepEqual(squad.record, {}, '만들 때는 빈 전적이다');

    p = fight(p, { mode: '3v3', mySquad: squad.name });
    const rows = squadRankRows(p, 'all');
    const row = rows.find((r) => r.squad.id === squad.id)!;
    assert.equal(row.tally.wins, 1);
    assert.equal(row.total, battleScore(row.tally));
  });

  it('부대 없이 나간 판은 조용히 건너뛴다 — 다른 부대의 전적을 안 건드린다', () => {
    let p = profile();
    const made = addSquad(p, { name: '무관', mode: '3v3', picks: picksOf(p, 3) });
    p = made.profile;
    p = fight(p, { mode: '3v3', mySquad: null });
    const row = squadRankRows(p, 'all').find((r) => r.squad.id === made.squad.id)!;
    assert.deepEqual(row.tally, { plays: 0, wins: 0, draws: 0, losses: 0, kills: 0 });
  });

  it('sortSquadRows — 총점 순은 내림차순이다 (부대 랭킹에는 전투력 표시값이 없다, 2026-08-27)', () => {
    let p = profile();
    const a = addSquad(p, { name: '3인편성', mode: '3v3', picks: picksOf(p, 3) });
    p = a.profile;
    p = fight(p, { mode: '3v3', mySquad: '3인편성' });
    const b = addSquad(p, { name: '5인편성', mode: '5v5', picks: picksOf(p, 5) });
    p = b.profile;
    const rows = squadRankRows(p, 'all');
    const sorted = sortSquadRows(rows, 'total');
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1]!.total >= sorted[i]!.total);
    }
    // 부대 랭킹 행에는 `power` 필드가 아예 없다 — 타입에서부터 빠졌다
    assert.ok(!('power' in rows[0]!));
  });
});

describe('장수 랭킹', () => {
  it('officerRankRows — 레벨·스탯·전적을 낸다', () => {
    const p = fight(profile());
    const rows = officerRankRows(p, 'all');
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(typeof r.stats.hp, 'number');
      assert.equal(r.total, battleScore(r.tally));
    }
  });

  it('officerRankRows — 장수 카드가 필요한 필드(삼능력·AT 범위)를 낸다 (pptx 53쪽)', () => {
    const rows = officerRankRows(fight(profile()), 'all');
    for (const r of rows) {
      assert.equal(typeof r.might, 'number');
      assert.equal(typeof r.intellect, 'number');
      assert.equal(typeof r.leadership, 'number');
      assert.ok(r.at.max >= r.at.min, `AT 범위가 거꾸로다 — ${r.at.min}-${r.at.max}`);
      // 「stats」에는 이제 hp·mp만 있다 — at은 범위라 별도 필드다
      assert.ok(!('at' in r.stats));
    }
    // G1이 218/260명만 채웠다 — 최소 한 명은 story·courtesyName이 있어야 한다
    assert.ok(rows.some((r) => r.story), '인물 서사가 하나도 안 붙었다');
    assert.ok(rows.some((r) => r.courtesyName), '자(courtesyName)가 하나도 안 붙었다');
  });

  it('officerRankRows — 고유기술 id·책략 목록을 낸다 (장수 카드 4·5번째 줄)', () => {
    const p = fight(profile());
    const rows = officerRankRows(p, 'all');
    // S~B급은 고유기술이 있다(SP_COST에 등급이 있다), C·D급은 없다 — 둘 다 나와야 한다
    assert.ok(rows.some((r) => r.uniqueSkillId), '고유기술이 있는 장수가 하나도 없다');
    assert.ok(rows.some((r) => !r.uniqueSkillId), '고유기술이 없는 장수가 하나도 없다');
    // 갓 만든 계정은 아직 책략을 안 배웠다 — 빈 배열이지 undefined가 아니다
    for (const r of rows) assert.ok(Array.isArray(r.tactics));
    assert.ok(rows.every((r) => r.tactics.length === 0), '레벨 1인데 이미 책략을 배웠다');
  });

  it('sortOfficerRows — 레벨 순은 내림차순이다', () => {
    const rows = officerRankRows(fight(profile()), 'all');
    const sorted = sortOfficerRows(rows, 'level');
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1]!.level >= sorted[i]!.level);
    }
  });
});
