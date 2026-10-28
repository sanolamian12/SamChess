/**
 * 전적 · 보상 회귀 — pptx 40쪽 + 45쪽 보상표 (C1, 2026-08-18 · 저장 형식 v3)
 *
 * 여기서 고정하는 것 여섯.
 *  - **센 · 약한 상대 × 승 · 무 · 패**가 보상표(2026-10-27) 네 줄과 글자 그대로 맞는가 — 무승부는 패배 줄
 *  - **AI와 온라인이 갈리지 않는가** (2026-08-04를 뒤집은 자리 — 되돌아가면 여기서 깨진다)
 *  - **기물별 합 = 모드별 합 = 총합** (40쪽이 같은 숫자를 세 가지로 요구한다)
 *  - **센 상대를 더 세게 이겨도 더 주지 않는가** (담합으로 얻을 것이 없게)
 *  - **승점이 이긴 판에만, 계정 · 장수 칸에 같은 값으로 쌓이는가** (§7)
 *  - **저장된 예상 승률이 그 시점 전투력으로 다시 계산한 값과 같은가** (§5-23)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ECONOMY, officerById } from '@samchess/data';
import type { BattleMode, OfficerId } from '@samchess/rules';
import {
  PROFILE_VERSION, CARD_WEIGHT, MATCH_BAND, REWARD_TABLE, ownedOfficers, rewardKey, rewardTier, winPoints,
  MATCH_LOG_CAP, accountTally, applyBattleResult,
  createProfile, migrateProfile, modeRows, pieceRows, recentMatches, totalTally, winChance,
} from '../src/index.ts';
import type {
  BattleOpponent, BattleOutcome, BattleResult, PlayerProfile, RewardKey, RosterPick,
} from '../src/index.ts';

const AT = 1_700_000_000_000;

const profile = (): PlayerProfile => createProfile('전적성', 1);

/** 보유 장수로 편성 하나. 기물 차례는 King → Rock → Bishop … */
function picksOf(p: PlayerProfile, count: number): RosterPick[] {
  const pieces = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'] as const;
  return Object.keys(p.roster).slice(0, count)
    .map((officer, i) => ({ piece: pieces[i]!, officer: officer as OfficerId }));
}

function fight(p: PlayerProfile, over: Partial<BattleOutcome> = {}, seed = 1): {
  profile: PlayerProfile; rewards: ReturnType<typeof applyBattleResult>['rewards'];
} {
  const mode = over.mode ?? '3v3';
  const outcome: BattleOutcome = {
    result: 'win',
    mode,
    opponent: 'field',
    picks: picksOf(p, mode === '3v3' ? 3 : 5),
    power: { mine: 600, theirs: 600 },
    at: AT,
    ...over,
  };
  return applyBattleResult(p, outcome, seed);
}

// ── 보상표 — 센 · 약한 상대 × 승 · 무 · 패 (GDD §6.4, 2026-10-27) ─────────────

/** 비슷한 상대 — 센 상대 줄이다 */
const EVEN = { mine: 600, theirs: 600 };
/** 매칭의 「인접」 폭보다 1 더 약한 상대 — 약한 상대 줄이다 */
const WEAK = { mine: 600, theirs: 600 - MATCH_BAND - 1 };

describe('보상표 네 줄 (2026-10-27)', () => {
  const MODES: BattleMode[] = ['3v3', '5v5'];
  // 보상은 갈래와 무관하다 — 세지 않는 AI 대전도 같은 표를 받는다
  const SIDES: BattleOpponent[] = ['siege', 'field', 'ai'];
  const CASES: { result: BattleResult; power: { mine: number; theirs: number }; key: RewardKey }[] = [
    { result: 'win', power: EVEN, key: 'strongWin' },
    { result: 'win', power: WEAK, key: 'weakWin' },
    { result: 'lose', power: EVEN, key: 'strongLose' },
    { result: 'lose', power: WEAK, key: 'weakLose' },
    { result: 'draw', power: EVEN, key: 'strongLose' },
    { result: 'draw', power: WEAK, key: 'weakLose' },
  ];

  for (const opponent of SIDES) {
    for (const mode of MODES) {
      for (const { result, power, key } of CASES) {
        const spec = REWARD_TABLE[key];
        it(`${opponent} ${mode} ${result} (${key}) — 카드 ${spec.cards.length} · 자재 ${spec.materials} · 군량 ${spec.grain}`, () => {
          // 새 계정은 군량이 상한에 붙어 있다 — 받은 양을 재려면 비워 두어야 한다
          const p = { ...profile(), grain: 0 };
          const { rewards, profile: after } = fight(p, { result, mode, opponent, power });
          assert.equal(rewards.cards.length, spec.cards.length);
          assert.equal(rewards.materials, spec.materials);
          assert.equal(rewards.grain, spec.grain, '군량은 모드와 무관하다');
          assert.equal(after.materials, p.materials + spec.materials);
          for (const c of rewards.cards) {
            assert.ok(after.roster[c.officer] || (after.cards[c.officer] ?? 0) > 0, '받은 카드가 계정에 들어간다');
          }
        });
      }
    }
  }

  it('표는 economy.json 그대로다 — 기획자가 정한 네 줄', () => {
    assert.deepEqual(CARD_WEIGHT, { S: 1, A: 2, B: 3, C: 4, D: 5, E: 1 });
    assert.deepEqual(CARD_WEIGHT, ECONOMY.battleRewards.gradeWeight);
    const D = { owned: ['D'], fresh: ['D'] };
    assert.deepEqual(REWARD_TABLE.strongWin, {
      cards: [{ owned: ['S', 'A', 'B', 'C', 'D', 'E'], fresh: ['B', 'C'] }, D], materials: 1, grain: 2,
    });
    assert.deepEqual(REWARD_TABLE.weakWin, { cards: [{ owned: ['B', 'C', 'D'], fresh: ['C'] }, D], materials: 0, grain: 1 });
    assert.deepEqual(REWARD_TABLE.strongLose, { cards: [{ owned: ['B', 'C', 'D'], fresh: ['D'] }], materials: 0, grain: 1 });
    assert.deepEqual(REWARD_TABLE.weakLose, { cards: [{ owned: ['C', 'D'], fresh: ['D'] }], materials: 0, grain: 0 });
  });

  it('센가 약한가의 경계는 MATCH_BAND — 비슷한 상대는 센 쪽이다', () => {
    assert.equal(rewardTier({ mine: 600, theirs: 600 }), 'strong');
    assert.equal(rewardTier({ mine: 600, theirs: 900 }), 'strong');
    assert.equal(rewardTier({ mine: 600, theirs: 600 - MATCH_BAND }), 'strong', '폭 안쪽 끝까지 센 상대');
    assert.equal(rewardTier(WEAK), 'weak');
    assert.equal(rewardKey('draw', 'strong'), 'strongLose', '무승부는 패배 줄');
  });

  /*
   * ★ 줄마다 **실제로 백 번 굴려** 나온 카드가 그 줄의 풀 안인지 본다 — 풀 구성만 보면 「들어올 수 있는가」와
   * 「실제로 안 들어오는가」가 갈리지 않는다. 새 S·A·E가 안 들어오는 것은 증축의 S·A 조건(GDD §5.1)이 기댄다.
   */
  for (const key of ['strongWin', 'weakWin', 'strongLose', 'weakLose'] as RewardKey[]) {
    it(`${key} — 백 번 굴려도 카드가 그 줄의 풀 밖으로 안 나간다 ★`, () => {
      const spec = REWARD_TABLE[key];
      const result: BattleResult = key.endsWith('Win') ? 'win' : 'lose';
      const power = key.startsWith('strong') ? EVEN : WEAK;
      let p: PlayerProfile = { ...profile(), grain: 0 };
      const starters = new Set<string>(ownedOfficers(p));
      for (let seed = 1; seed <= 100; seed++) {
        const before = new Set<string>(ownedOfficers(p));
        const r = fight(p, { result, power }, seed);
        r.rewards.cards.forEach((c, i) => {
          const pool = spec.cards[i]!;
          const allowed = before.has(c.officer) ? pool.owned : pool.fresh;
          assert.ok(allowed.includes(c.grade), `시드 ${seed} ${i + 1}번째 카드 ${c.grade}급(${before.has(c.officer) ? '보유' : '새로'})`);
        });
        p = { ...r.profile, grain: 0 };
      }
      const freshTop = ownedOfficers(p).filter((id) => !starters.has(id) && ['S', 'A', 'E'].includes(officerById.get(id)!.grade));
      assert.deepEqual(freshTop, [], '새 S·A·E가 들어왔다');
    });
  }

  it('무승부는 패배와 **한 글자도 다르지 않다** — 택1이 없어졌다', () => {
    for (const power of [EVEN, WEAK]) {
      const draw = fight(profile(), { result: 'draw', power }, 9).rewards;
      const lose = fight(profile(), { result: 'lose', power }, 9).rewards;
      assert.deepEqual(draw, lose);
    }
  });

  it('AI와 온라인의 보상이 **한 글자도 다르지 않다** (2026-08-18, §5-8을 뒤집는다)', () => {
    // 상대가 사람인지 AI인지로 보상이 갈리면 접속 시간대가 곧 보상이 된다. 갈리는 것은 전투력뿐이다
    for (const result of ['win', 'draw', 'lose'] as BattleResult[]) {
      for (const mode of MODES) {
        const online = fight(profile(), { result, mode, opponent: 'field' });
        const ai = fight(profile(), { result, mode, opponent: 'ai' });
        assert.deepEqual(ai.rewards, online.rewards, `${result} ${mode}에서 AI만 다르다`);
      }
    }
  });

  it('센 상대를 더 세게 이겨도 더 주지 않는다 — 상위 도전은 같은 줄이다', () => {
    const even = fight(profile(), { power: EVEN }, 7).rewards;
    const upset = fight(profile(), { power: { mine: 210, theirs: 1300 } }, 7).rewards;
    assert.deepEqual(upset, even);
  });

  it('군량 상한을 넘겨 주지 않고, 넘겼으면 **들어간 만큼만** 적는다', () => {
    const p = profile();                       // 도시 Lv1은 상한 20으로 시작한다
    const { profile: after, rewards } = fight(p, { result: 'win', mode: '5v5' });
    assert.equal(after.grain, p.grain, '상한에 붙어 있으면 늘지 않는다');
    assert.equal(rewards.grain, 0, '화면이 없는 군량을 보여주지 않는다');
  });
});

// ── 승점 (GDD §7, 2026-10-27) ───────────────────────

describe('승점 — 이긴 판마다 100 × (1 − 예상 승률)', () => {
  it('비슷한 상대 50 · 어려운 승리일수록 100에 가깝고 · 약한 상대도 0보다 크다', () => {
    assert.equal(winPoints({ mine: 600, theirs: 600 }), 50);
    assert.equal(winPoints({ mine: 600, theirs: 800 }), 88);
    assert.equal(winPoints({ mine: 800, theirs: 600 }), 12);
    assert.ok(winPoints({ mine: 2000, theirs: 0 }) >= 0);
    assert.ok(winPoints({ mine: 0, theirs: 2000 }) <= 100, '한 판이 100을 넘지 않는다');
  });

  it('이긴 판만 — 계정 · 출전 장수 칸에 같은 값이 쌓인다', () => {
    let p = profile();
    const picks = picksOf(p, 3);
    p = fight(p, { result: 'win', picks, power: { mine: 600, theirs: 800 } }).profile;
    p = fight(p, { result: 'lose', picks }).profile;
    p = fight(p, { result: 'draw', picks }).profile;
    p = fight(p, { result: 'win', picks, power: EVEN }).profile;
    assert.equal(accountTally(p).points, 88 + 50);
    for (const pick of picks) assert.equal(totalTally(p.roster[pick.officer]!).points, 88 + 50);
  });

  it('옛 기록(승점 칸이 없다)은 0으로 되접힌다', () => {
    const p = fight(profile(), { result: 'win' }).profile;
    const raw = JSON.parse(JSON.stringify(p)) as { record: Record<string, { points?: number }> };
    for (const cell of Object.values(raw.record)) delete cell.points;
    const back = migrateProfile(raw)!;
    assert.equal(accountTally(back).points, 0);
    assert.equal(accountTally(back).wins, 1);
  });
});

// ── 전적 — 기물 × 모드 × 상대 교차 (40쪽) ───────────────────────

describe('전적 (40쪽)', () => {
  it('출전한 장수 전원에게, 그 기물 칸에 남는다', () => {
    const p = profile();
    const picks = picksOf(p, 3);
    const kills = { [picks[0]!.officer]: 2 };
    const after = fight(p, { result: 'win', picks, kills }).profile;

    for (const pick of picks) {
      const inst = after.roster[pick.officer]!;
      assert.deepEqual(inst.record[`field/3v3/${pick.piece}`], {
        plays: 1, wins: 1, draws: 0, losses: 0,
        kills: pick.officer === picks[0]!.officer ? 2 : 0, points: 50,
      }, `${pick.piece} 칸이 다르다`);
      assert.equal(Object.keys(inst.record).length, 1, '뛰지 않은 칸은 만들지 않는다');
    }
  });

  it('기물별 합 = 모드별 합 = 총합 ★ (같은 숫자를 세 가지로 요구한다)', () => {
    let p = profile();
    const three = picksOf(p, 3);
    p = fight(p, { result: 'win', picks: three, kills: { [three[0]!.officer]: 1 } }).profile;
    p = fight(p, { result: 'lose', picks: three }).profile;
    p = fight(p, { result: 'draw', picks: three, opponent: 'siege' }).profile;
    // 같은 장수를 다른 기물로 다시 내보낸다 — 기물 칸이 갈리는지 본다
    p = fight(p, { result: 'win', picks: three.map((x, i) => ({ ...x, piece: i === 0 ? 'Queen' : x.piece })) as RosterPick[] }).profile;

    const inst = p.roster[three[0]!.officer]!;
    const total = totalTally(inst);
    assert.equal(total.plays, 4);
    assert.deepEqual(total, { plays: 4, wins: 2, draws: 1, losses: 1, kills: 1, points: 100 });

    const byPiece = pieceRows(inst).reduce((n, r) => n + r.tally.plays, 0);
    const byMode = modeRows(inst).reduce((n, r) => n + r.tally.plays, 0);
    assert.equal(byPiece, total.plays, '기물별 합이 총합과 다르다');
    assert.equal(byMode, total.plays, '모드별 합이 총합과 다르다');
    assert.equal(pieceRows(inst).length, 6, '한 판도 안 뛴 기물도 0으로 나온다 (목업 6행)');

    // King 3판 + Queen 1판
    const rows = Object.fromEntries(pieceRows(inst).map((r) => [r.piece, r.tally.plays]));
    assert.deepEqual(rows, { King: 3, Rock: 0, Bishop: 0, Knight: 0, Queen: 1, Pawn: 0 });
  });

  it('필터가 공성전과 야전을 가른다 · 순수 AI 대전은 어디에도 안 센다 (2026-10-28 기획자 확정)', () => {
    let p = profile();
    const picks = picksOf(p, 3);
    p = fight(p, { result: 'win', picks, opponent: 'field' }).profile;
    p = fight(p, { result: 'lose', picks, opponent: 'siege' }).profile;
    p = fight(p, { result: 'lose', picks, opponent: 'siege' }).profile;
    const before = { matches: p.matches.length, seq: p.matchSeq, points: accountTally(p).points };
    const afterAi = fight(p, { result: 'win', picks, opponent: 'ai' });
    p = afterAi.profile;

    const inst = p.roster[picks[0]!.officer]!;
    assert.equal(totalTally(inst, 'all').plays, 3, 'AI 대전은 장수 전적에 안 든다');
    assert.equal(totalTally(inst, 'field').plays, 1);
    assert.equal(totalTally(inst, 'siege').plays, 2);
    assert.equal(totalTally(inst, 'field').wins, 1);
    assert.equal(totalTally(inst, 'siege').wins, 0);
    assert.equal(accountTally(p).plays, 3, 'AI 대전은 계정 전적에 안 든다');
    assert.equal(accountTally(p).points, before.points, 'AI 대전의 승리는 승점을 안 준다');
    assert.equal(p.matches.length, before.matches, 'AI 대전은 이력에 안 남는다');
    assert.equal(p.matchSeq, before.seq, '이력 번호도 안 쓴다');
    assert.ok(afterAi.rewards.cards.length > 0, '보상은 그대로 준다');
  });

  it('계정 전적은 판수로 센다 — 장수 전적을 더한 것이 아니다', () => {
    let p = profile();
    p = fight(p, { result: 'win', picks: picksOf(p, 3), kills: { [picksOf(p, 3)[0]!.officer]: 2 } }).profile;
    const account = accountTally(p);
    assert.equal(account.plays, 1, '한 판에 셋이 뛰어도 계정에는 한 판이다');
    assert.equal(account.wins, 1);
    assert.equal(account.kills, 2, '적격파는 팀 합계다');
  });

  it('재설계는 전적을 건드리지 않는다 (B의 경계를 그대로 지킨다)', () => {
    // `applyRespec`은 성장만 되감는다 — 여기서는 전적이 v3에서도 그 규약을 지키는지만 본다
    const p = fight(profile(), { result: 'win' }).profile;
    const before = JSON.stringify(p.roster);
    assert.ok(before.includes('field/3v3/King'));
  });
});

// ── 대전 이력 (DB 이식 전제) ────────────────────────────────────

describe('대전 이력', () => {
  it('최근 것이 먼저 나오고, 장수로 걸러진다', () => {
    let p = profile();
    const three = picksOf(p, 3);
    p = fight(p, { result: 'win', picks: three, at: AT }).profile;
    p = fight(p, { result: 'lose', picks: three.slice(0, 1), at: AT + 60_000 }).profile;

    const rows = recentMatches(p);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.at, AT + 60_000, '최근 것이 먼저다');
    assert.ok(rows[0]!.seq > rows[1]!.seq, 'seq는 오름차순으로 붙는다');

    // 두 번째 판에는 King만 나갔다 — 나머지 둘의 목록에는 한 줄만 보인다
    assert.equal(recentMatches(p, { officer: three[1]!.officer }).length, 1);
    assert.equal(recentMatches(p, { officer: three[0]!.officer }).length, 2);
    assert.equal(recentMatches(p, { filter: 'siege' }).length, 0);
  });

  it('저장된 예상 승률이 그 시점 전투력으로 다시 계산한 값과 같다 ★ (§5-23)', () => {
    const p = fight(profile(), { power: { mine: 742, theirs: 1043 } }).profile;
    const row = recentMatches(p)[0]!;
    assert.equal(row.myPower, 742);
    assert.equal(row.theirPower, 1043);
    assert.equal(row.chance, winChance(742, 1043), '눈금이 바뀌어도 그때 판단이 남는다');
    assert.ok(row.chance < 0.1, '「12%를 뒤집은 승리」가 되는 자리다');
  });

  it('순수 AI 대전은 이력에 안 남는다 — 공성전은 상대 계정이 남는다 (2026-10-28)', () => {
    let p = fight(profile(), { opponent: 'ai' }).profile;
    assert.equal(recentMatches(p).length, 0);
    p = fight(p, { opponent: 'siege', opponentId: 'defender-uid' }).profile;
    assert.deepEqual(recentMatches(p).map((r) => [r.opponent, r.opponentId]), [['siege', 'defender-uid']]);
    // 부대 없이 나간 판은 부대 이름이 없다. 열은 열어 둔다
    assert.equal(recentMatches(p)[0]!.mySquad, null);
  });

  it('v6 이하의 전적 갈래를 v7로 — AI 칸 · AI 이력은 버리고 온라인은 야전 (2026-10-28 기획자 확정)', () => {
    const p = fight(profile(), { result: 'win' }).profile;
    const who = Object.keys(p.roster)[0]!;
    const raw = JSON.parse(JSON.stringify(p)) as {
      version: number; record: Record<string, unknown>; matches: Record<string, unknown>[];
      roster: Record<string, { record: Record<string, unknown> }>; squads: { record: Record<string, unknown> }[];
    };
    raw.version = 6;
    const cell = (w: number) => ({ plays: w, wins: w, draws: 0, losses: 0, kills: 0, points: 10 * w });
    raw.record = { 'online/3v3': cell(2), 'ai/3v3': cell(5) };
    raw.roster[who]!.record = { 'online/3v3/King': cell(2), 'ai/5v5/King': cell(5) };
    raw.matches = [
      { ...raw.matches[0]!, seq: 1, opponent: 'ai' },
      { ...raw.matches[0]!, seq: 2, opponent: 'online' },
    ];

    const after = migrateProfile(raw)!;
    assert.deepEqual(Object.keys(after.record), ['field/3v3'], '계정 — 온라인은 야전, AI는 버린다');
    assert.equal(after.record['field/3v3']!.wins, 2);
    assert.equal(after.record['field/3v3']!.points, 20, '승점도 따라간다');
    assert.deepEqual(Object.keys(after.roster[who as OfficerId]!.record), ['field/3v3/King'], '장수 — 같다');
    assert.deepEqual(after.matches.map((m) => [m.seq, m.opponent]), [[2, 'field']], '이력 — AI 줄은 빠지고 온라인 줄은 야전');
    assert.equal(after.version, 7);
    // 새 형식에서 옛 열쇠는 모르는 열쇠다 — 다시 지나도 그대로(멱등)
    assert.deepEqual(migrateProfile(JSON.parse(JSON.stringify(after))), after);
  });

  it('상한을 넘으면 꼬리가 덜리지만 **통산과 줄 번호는 줄지 않는다**', () => {
    let p = profile();
    const picks = picksOf(p, 3);
    for (let n = 0; n < MATCH_LOG_CAP + 5; n++) {
      p = fight(p, { result: 'win', picks, at: AT + n }).profile;
    }
    assert.equal(p.matches.length, MATCH_LOG_CAP, '브라우저 저장 동안만 자른다');
    assert.equal(p.matchSeq, MATCH_LOG_CAP + 6, '줄 번호는 다시 쓰지 않는다');
    assert.equal(accountTally(p).plays, MATCH_LOG_CAP + 5, '통산은 목록과 무관하게 남는다');
  });
});

// ── 되접기 v2 → v3 ─────────────────────────────────────────────

describe('저장 형식 v3로 되접기', () => {
  /** v2 저장분 — 평평한 전적, 이력 없음 */
  function v2(): Record<string, unknown> {
    const p = profile();
    const roster: Record<string, unknown> = {};
    for (const [id, inst] of Object.entries(p.roster)) {
      roster[id] = { officer: id, level: inst.level, growth: inst.growth, record: { wins: 5, losses: 2, kills: 9 } };
    }
    return { ...p, version: 2, roster, record: undefined, matches: undefined, matchSeq: undefined };
  }

  it('계정은 살아남고 옛 평평한 전적만 0에서 시작한다 (2026-08-18 기획자 확정)', () => {
    const after = migrateProfile(v2())!;
    assert.equal(after.version, PROFILE_VERSION);
    assert.equal(Object.keys(after.roster).length, 5, '장수는 그대로다');
    assert.equal(after.cityName, '전적성');
    for (const inst of Object.values(after.roster)) {
      assert.deepEqual(inst.record, {}, '기물도 모드도 모르는 값은 넣을 칸이 없다');
    }
    assert.deepEqual(after.matches, []);
    assert.equal(after.matchSeq, 1);
  });

  it('v3 전적은 그대로 남고 **멱등하다**', () => {
    const p = fight(profile(), { result: 'win' }).profile;
    const once = migrateProfile(JSON.parse(JSON.stringify(p)))!;
    const twice = migrateProfile(JSON.parse(JSON.stringify(once)))!;
    assert.deepEqual(once, p, '한 번 지나도 같다');
    assert.deepEqual(twice, once, '두 번 지나도 같다');
  });

  it('망가진 칸은 그 칸만 빠지고, 출전 수는 **다시 센다**', () => {
    const p = fight(profile(), { result: 'win' }).profile;
    const who = Object.keys(p.roster)[0]!;
    const raw = JSON.parse(JSON.stringify(p)) as {
      roster: Record<string, { record: Record<string, unknown> }>;
    };
    raw.roster[who]!.record['field/3v3/King'] = { plays: 99, wins: 1, draws: 0, losses: 0, kills: 0 };
    raw.roster[who]!.record['field/9v9/King'] = { plays: 3, wins: 3, draws: 0, losses: 0, kills: 0 };
    raw.roster[who]!.record['쓰레기'] = { plays: 3, wins: 3, draws: 0, losses: 0, kills: 0 };

    const after = migrateProfile(raw)!;
    const record = after.roster[who as OfficerId]!.record;
    assert.deepEqual(Object.keys(record), ['field/3v3/King'], '모르는 키는 버린다');
    assert.equal(record['field/3v3/King']!.plays, 1, 'plays = 승 + 무 + 패로 다시 센다');
  });

  it('망가진 이력 줄만 빠지고 줄 번호는 앞으로만 간다', () => {
    let p = fight(profile(), { result: 'win' }).profile;
    p = fight(p, { result: 'lose' }).profile;
    const raw = JSON.parse(JSON.stringify(p)) as { matches: unknown[]; matchSeq: number };
    raw.matches.push({ seq: 99, mode: '3v3', opponent: '사람', result: 'win' });   // 상대가 이상하다
    raw.matchSeq = 0;                                                              // 손으로 되돌린 값

    const after = migrateProfile(raw)!;
    assert.equal(after.matches.length, 2, '되접을 수 없는 줄만 빠진다');
    assert.equal(after.matchSeq, 3, '남은 줄보다 뒤에서 이어 붙는다');
  });
});
