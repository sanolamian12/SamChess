/**
 * 전적 · 보상 회귀 — pptx 40쪽 + 45쪽 보상표 (C1, 2026-08-18 · 저장 형식 v3)
 *
 * 여기서 고정하는 것 다섯.
 *  - **세 결말 × 두 모드 × 두 상대 열두 조합**이 보상표와 글자 그대로 맞는가
 *  - **AI와 온라인이 갈리지 않는가** (2026-08-04를 뒤집은 자리 — 되돌아가면 여기서 깨진다)
 *  - **기물별 합 = 모드별 합 = 총합** (40쪽이 같은 숫자를 세 가지로 요구한다)
 *  - **전투력 격차가 카드 등급을 바꾸지 않는가** (§5-22 담합 방지)
 *  - **저장된 예상 승률이 그 시점 전투력으로 다시 계산한 값과 같은가** (§5-23)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BattleMode, OfficerId } from '@samchess/rules';
import {
  PROFILE_VERSION,
  CARD_GRADES, GRAIN_REWARD, MATCH_LOG_CAP, MATERIAL_REWARD, accountTally, applyBattleResult,
  createProfile, migrateProfile, modeRows, pieceRows, recentMatches, totalTally, winChance,
} from '../src/index.ts';
import type {
  BattleOutcome, BattleResult, DrawReward, OpponentKind, PlayerProfile, RosterPick,
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
    opponent: 'online',
    picks: picksOf(p, mode === '3v3' ? 3 : 5),
    power: { mine: 600, theirs: 600 },
    at: AT,
    ...over,
  };
  return applyBattleResult(p, outcome, seed);
}

// ── 보상표 — 세 결말 × 두 모드 × 두 상대 (GDD §6.4) ─────────────

describe('보상표 열두 조합 (45쪽)', () => {
  const MODES: BattleMode[] = ['3v3', '5v5'];
  const SIDES: OpponentKind[] = ['online', 'ai'];

  for (const opponent of SIDES) {
    for (const mode of MODES) {
      it(`${opponent} ${mode} — 승리는 카드 1 + 재료 1 + 군량 ${GRAIN_REWARD[mode]}`, () => {
        // 새 계정은 군량이 상한에 붙어 있다 — 받은 양을 재려면 비워 두어야 한다
        const p = { ...profile(), grain: 0 };
        const { rewards, profile: after } = fight(p, { result: 'win', mode, opponent });
        assert.ok(rewards.card, '승리하면 카드가 나온다');
        assert.ok((CARD_GRADES as readonly string[]).includes(rewards.cardGrade!),
          `카드 등급 상한은 B급이다 — ${rewards.cardGrade}`);
        assert.equal(rewards.materials, MATERIAL_REWARD);
        assert.equal(rewards.grain, GRAIN_REWARD[mode]);
        assert.equal(after.materials, p.materials + MATERIAL_REWARD);
      });

      it(`${opponent} ${mode} — 패배는 군량 ${GRAIN_REWARD[mode]}만`, () => {
        const p = profile();
        // 상한에 걸리면 받은 양이 0으로 보인다. 군량을 비워 두고 잰다
        const empty = { ...p, grain: 0 };
        const { rewards, profile: after } = fight(empty, { result: 'lose', mode, opponent });
        assert.equal(rewards.grain, GRAIN_REWARD[mode], '패배도 승리와 같은 양이다');
        assert.equal(rewards.card, null, '패배에는 카드가 없다');
        assert.equal(rewards.materials, 0);
        assert.deepEqual(after.cards, {}, '카드 보유가 늘지 않는다');
      });

      it(`${opponent} ${mode} — 무승부는 셋 중 고른 하나만 준다`, () => {
        const p = { ...profile(), grain: 0 };
        const picked: Record<DrawReward, () => void> = {
          card: () => {
            const { rewards } = fight(p, { result: 'draw', mode, opponent, drawPick: 'card' });
            assert.ok(rewards.card);
            assert.equal(rewards.grain, 0);
            assert.equal(rewards.materials, 0);
          },
          material: () => {
            const { rewards } = fight(p, { result: 'draw', mode, opponent, drawPick: 'material' });
            assert.equal(rewards.materials, MATERIAL_REWARD);
            assert.equal(rewards.card, null);
            assert.equal(rewards.grain, 0);
          },
          grain: () => {
            const { rewards } = fight(p, { result: 'draw', mode, opponent, drawPick: 'grain' });
            assert.equal(rewards.grain, GRAIN_REWARD[mode]);
            assert.equal(rewards.card, null);
            assert.equal(rewards.materials, 0);
          },
        };
        for (const run of Object.values(picked)) run();
      });
    }
  }

  it('AI와 온라인의 보상이 **한 글자도 다르지 않다** (2026-08-18, §5-8을 뒤집는다)', () => {
    // 문이 [출정하기] 하나로 합쳐지면 상대가 사람인지 AI인지는 고르는 것이 아니라
    // 그때의 운이다. 보상이 갈리면 접속 시간대가 곧 보상이 된다.
    for (const result of ['win', 'draw', 'lose'] as BattleResult[]) {
      for (const mode of MODES) {
        const extra = result === 'draw' ? { drawPick: 'card' as DrawReward } : {};
        const online = fight(profile(), { result, mode, opponent: 'online', ...extra });
        const ai = fight(profile(), { result, mode, opponent: 'ai', ...extra });
        assert.deepEqual(ai.rewards, online.rewards, `${result} ${mode}에서 AI만 다르다`);
      }
    }
  });

  it('무승부를 고르지 않고 반영하려 하면 던진다 — 「고르는 도중」을 저장하지 않는다', () => {
    assert.throws(() => fight(profile(), { result: 'draw' }), /무승부/);
  });

  it('전투력 격차가 카드 등급을 바꾸지 않는다 (§5-22 — 담합이 상한을 파밍 목표로 만든다)', () => {
    const weak = fight(profile(), { power: { mine: 210, theirs: 1300 } }, 7).rewards;
    const strong = fight(profile(), { power: { mine: 1300, theirs: 210 } }, 7).rewards;
    assert.deepEqual(weak, strong, '같은 시드면 이변이든 압승이든 같은 카드다');
  });

  it('군량 상한을 넘겨 주지 않고, 넘겼으면 **들어간 만큼만** 적는다', () => {
    const p = profile();                       // 도시 Lv1은 상한 20으로 시작한다
    const { profile: after, rewards } = fight(p, { result: 'win', mode: '5v5' });
    assert.equal(after.grain, p.grain, '상한에 붙어 있으면 늘지 않는다');
    assert.equal(rewards.grain, 0, '화면이 없는 군량을 보여주지 않는다');
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
      assert.deepEqual(inst.record[`online/3v3/${pick.piece}`], {
        plays: 1, wins: 1, draws: 0, losses: 0,
        kills: pick.officer === picks[0]!.officer ? 2 : 0,
      }, `${pick.piece} 칸이 다르다`);
      assert.equal(Object.keys(inst.record).length, 1, '뛰지 않은 칸은 만들지 않는다');
    }
  });

  it('기물별 합 = 모드별 합 = 총합 ★ (같은 숫자를 세 가지로 요구한다)', () => {
    let p = profile();
    const three = picksOf(p, 3);
    p = fight(p, { result: 'win', picks: three, kills: { [three[0]!.officer]: 1 } }).profile;
    p = fight(p, { result: 'lose', picks: three }).profile;
    p = fight(p, { result: 'draw', drawPick: 'grain', picks: three, opponent: 'ai' }).profile;
    // 같은 장수를 다른 기물로 다시 내보낸다 — 기물 칸이 갈리는지 본다
    p = fight(p, { result: 'win', picks: three.map((x, i) => ({ ...x, piece: i === 0 ? 'Queen' : x.piece })) as RosterPick[] }).profile;

    const inst = p.roster[three[0]!.officer]!;
    const total = totalTally(inst);
    assert.equal(total.plays, 4);
    assert.deepEqual(total, { plays: 4, wins: 2, draws: 1, losses: 1, kills: 1 });

    const byPiece = pieceRows(inst).reduce((n, r) => n + r.tally.plays, 0);
    const byMode = modeRows(inst).reduce((n, r) => n + r.tally.plays, 0);
    assert.equal(byPiece, total.plays, '기물별 합이 총합과 다르다');
    assert.equal(byMode, total.plays, '모드별 합이 총합과 다르다');
    assert.equal(pieceRows(inst).length, 6, '한 판도 안 뛴 기물도 0으로 나온다 (목업 6행)');

    // King 3판 + Queen 1판
    const rows = Object.fromEntries(pieceRows(inst).map((r) => [r.piece, r.tally.plays]));
    assert.deepEqual(rows, { King: 3, Rock: 0, Bishop: 0, Knight: 0, Queen: 1, Pawn: 0 });
  });

  it('필터가 AI와 온라인을 가른다 (2026-08-18 — 세지 않는 것이 아니라 갈라 본다)', () => {
    let p = profile();
    const picks = picksOf(p, 3);
    p = fight(p, { result: 'win', picks, opponent: 'online' }).profile;
    p = fight(p, { result: 'lose', picks, opponent: 'ai' }).profile;
    p = fight(p, { result: 'lose', picks, opponent: 'ai' }).profile;

    const inst = p.roster[picks[0]!.officer]!;
    assert.equal(totalTally(inst, 'all').plays, 3);
    assert.equal(totalTally(inst, 'online').plays, 1);
    assert.equal(totalTally(inst, 'ai').plays, 2);
    assert.equal(totalTally(inst, 'online').wins, 1);
    assert.equal(totalTally(inst, 'ai').wins, 0);
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
    assert.ok(before.includes('online/3v3/King'));
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
    assert.equal(recentMatches(p, { filter: 'ai' }).length, 0);
  });

  it('저장된 예상 승률이 그 시점 전투력으로 다시 계산한 값과 같다 ★ (§5-23)', () => {
    const p = fight(profile(), { power: { mine: 742, theirs: 1043 } }).profile;
    const row = recentMatches(p)[0]!;
    assert.equal(row.myPower, 742);
    assert.equal(row.theirPower, 1043);
    assert.equal(row.chance, winChance(742, 1043), '눈금이 바뀌어도 그때 판단이 남는다');
    assert.ok(row.chance < 0.1, '「12%를 뒤집은 승리」가 되는 자리다');
  });

  it('AI는 상대 id가 없다 — 화면이 그때 「AI」라고 적는다', () => {
    const p = fight(profile(), { opponent: 'ai' }).profile;
    assert.equal(recentMatches(p)[0]!.opponentId, null);
    // E(42·43쪽)가 붙기 전에는 부대 이름도 없다. 열은 지금 열어 둔다
    assert.equal(recentMatches(p)[0]!.mySquad, null);
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
    raw.roster[who]!.record['online/3v3/King'] = { plays: 99, wins: 1, draws: 0, losses: 0, kills: 0 };
    raw.roster[who]!.record['online/9v9/King'] = { plays: 3, wins: 3, draws: 0, losses: 0, kills: 0 };
    raw.roster[who]!.record['쓰레기'] = { plays: 3, wins: 3, draws: 0, losses: 0, kills: 0 };

    const after = migrateProfile(raw)!;
    const record = after.roster[who as OfficerId]!.record;
    assert.deepEqual(Object.keys(record), ['online/3v3/King'], '모르는 키는 버린다');
    assert.equal(record['online/3v3/King']!.plays, 1, 'plays = 승 + 무 + 패로 다시 센다');
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
