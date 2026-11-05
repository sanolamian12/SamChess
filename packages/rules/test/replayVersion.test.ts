/**
 * 리플레이 버전 · 황금 재생 (2026-10-28, `replayVersion.ts` · GDD §8.8 단계 5).
 *
 * **황금 재생** — 고정 판 몇 개를 AI끼리 끝까지 두고 끝 상태의 지문(승자 · 끝 · 시각 · 차례 수 · 난수 커서 · 장수마다 HP)을 고정한다.
 * 방어 기록은 수만 적어 두고 지금의 엔진으로 다시 두므로, **엔진이 같은 수에서 다른 판을 내면** 옛 기록의 다시 보기가 거짓말을 한다.
 * 이 회귀가 깨지면 둘 중 하나다:
 *  - **데이터가 바뀌었다**(엑셀 수치) — `DATA_HASH`는 저절로 바뀌었다. 출력된 새 줄로 `GOLDEN`을 갈아 적는다.
 *  - **엔진이 바뀌었다**(데이터 해시는 그대로) — `ENGINE_REVISION`을 하나 올리고 `GOLDEN`을 갈아 적는다. 안 올리면 옛 기록이 다른 판을 보여 준다.
 * 둘 다 **의도된 변경**이어야 한다 — 전투력 계수(`POWER_MODELS`)를 다시 재는 것과 같은 결.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoBattle } from '../src/ai.ts';
import { createBattle } from '../src/battle.ts';
import { challengeTargets } from '../src/commands.ts';
import { replayLocalMatch, replayPrefix, type ReplayInput } from '../src/replay.ts';
import { controllingSide } from '../src/state.ts';
import { DATA_HASH, ENGINE_REVISION, REPLAY_VERSION, replayable } from '../src/replayVersion.ts';
import { defaultSkillRules, defaultStances, defaultTacticRules } from '../src/policy.ts';
import type { BattleState, DefensePolicy, DuelPick, Intent, RosterEntry, TacticId } from '../src/types.ts';
import { R } from './fixtures.ts';

const T = (...ids: string[]): TacticId[] => ids as TacticId[];
const LV5 = ['hp', 'mp', 'at', 'hp'] as ('hp' | 'mp' | 'at')[];
/**
 * 수성전 판 하나(2026-10-31) — 방어 기록은 수비군 방침 AI(`policyTurn`)의 수도 다시 두므로 그 길도 지문에 넣는다.
 * 넣기 전에는 방침 AI의 걸음 순서를 뒤집어도 이 회귀가 아무 말을 안 했다.
 */
const SIEGE_P2: RosterEntry[] = [
  R('jo-jo', 'King', 5, LV5, T('jeung-pok', 'ban-gam', 'hoe-bok', 'gyeol-gye')),
  R('jang-hap', 'Bishop', 5, LV5, T('gong-po', 'chim-muk', 'ham-jeong', 'tal-jin')),
  R('ga-hu', 'Queen', 5, LV5, T('jeung-pok', 'ban-gam', 'hoe-bok', 'gyeol-gye')),
  R('ha-hu-don', 'Rock', 5, LV5, T('gong-po', 'ban-gam', 'hoe-bok', 'tal-jin')),
  R('heo-jeo', 'Knight', 5, LV5, T('jeung-pok', 'chim-muk', 'ham-jeong', 'gyeol-gye')),
];
const SIEGE_POLICY: DefensePolicy = {
  stances: defaultStances(SIEGE_P2.map((r) => r.piece)),
  tactics: defaultTacticRules(new Set(SIEGE_P2.flatMap((r) => r.tactics))),
  skills: defaultSkillRules(SIEGE_P2.map((r) => r.officer)),
};

const CASES: { seed: number; mode: '3v3' | '5v5'; P1: RosterEntry[]; P2: RosterEntry[]; siege?: DefensePolicy }[] = [
  { seed: 11, mode: '3v3', P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn')], P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen')] },
  { seed: 29, mode: '3v3', P1: [R('jo-jo', 'King', 5, ['hp', 'at', 'hp', 'mp']), R('jang-hap', 'Knight'), R('yu-bi', 'Pawn')], P2: [R('gwan-u', 'King'), R('jo-sik', 'Queen'), R('heon-je', 'Rock')] },
  { seed: 7, mode: '5v5', P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jo-sik', 'Pawn'), R('jang-bi', 'Knight'), R('jo-un', 'Bishop')], P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('heon-je', 'Queen'), R('ha-hu-don', 'Rock'), R('heo-jeo', 'Knight')] },
  {
    seed: 13, mode: '5v5', siege: SIEGE_POLICY, P2: SIEGE_P2,
    P1: [R('yu-bi', 'King', 5, LV5, T('hoe-bok')), R('gwan-u', 'Rock', 5, LV5), R('jo-sik', 'Pawn', 5, LV5), R('jang-bi', 'Knight', 5, LV5), R('jo-un', 'Bishop', 5, LV5)],
  },
];

/**
 * **사람과 두는 AI 대전을 서버가 다시 두는 길**(2026-11-05, 일기토 · 설전 단계 3a) — `replayLocalMatch`는 AI의 신청 · 답 · 도망과
 * 판정 주체의 마감(카운트 끝에 시드로 채우는 패)을 스스로 다시 낸다. AI끼리 두는 판(`autoBattle`)만 보면 이 길이 바뀌어도 회귀가 아무 말을 안 한다.
 * 사람은 대본대로 둔다 — 붙은 적이 있으면 걸고(종류를 번갈아) 아니면 넘긴다, 받으면 받는다, 합마다 패를 하나 내고 마감을 넘긴다.
 */
function scriptedHuman(seed: number): BattleState {
  const input: ReplayInput = {
    matchId: `golden-human-${seed}`, mode: '3v3', seed, humanSide: 'P1', deploy: null, humanIntents: [],
    rosters: { P1: [R('yu-bi', 'King'), R('gwan-u', 'Rock'), R('jang-bi', 'Pawn')], P2: [R('jo-jo', 'King'), R('jang-hap', 'Bishop'), R('ha-hu-don', 'Rock')] },
  };
  const intents: Intent[] = [];
  for (let n = 0; n < 400; n++) {
    const r = replayPrefix({ ...input, humanIntents: intents });
    if (!r.ok) throw new Error(r.reason);
    const s = r.state;
    if (s.phase === 'finished') return s;
    let next: Intent;
    if (s.phase === 'deploy') next = { t: 'ready' };
    else if (s.phase === 'duel') {
      const d = s.duel!;
      const hands: DuelPick[] = d.kind === 'duel' ? ['rock', 'paper', 'scissors'] : [1, 2, 3];
      next = d.step === 'offer' ? { t: 'answerChallenge', accept: true }
        : d.picks.P1 === undefined ? { t: 'duelPick', pick: hands[n % 3]! } : { t: 'duelReveal' };
    } else {
      const kind = n % 2 ? 'duel' : 'debate';
      const target = s.activeUnit && controllingSide(s, s.units[s.activeUnit]!) === 'P1' ? challengeTargets(s, 'P1', kind)[0] : undefined;
      next = target ? { t: 'challenge', kind, target } : { t: 'endTurn' };
    }
    intents.push(next);
  }
  const done = replayLocalMatch({ ...input, humanIntents: intents });
  if (!done.ok) throw new Error(done.reason);
  return done.state;
}

/** 끝 상태의 지문 — 승자 · 끝 · 시각 · 차례 수 · 난수 커서 · 장수마다 HP (사람 판은 차례 수 대신 대결 수) */
function digest(): string {
  const human = [5].map((seed) => {
    const s = scriptedHuman(seed);
    const duels = s.log.filter((e) => e.e === 'duelEnded').length;
    const hp = Object.values(s.units).sort((a, b) => a.id.localeCompare(b.id)).map((u) => `${u.id}:${u.hp}`).join(',');
    return `${s.winner ?? '-'}/${s.outcome}/${s.time}/duels${duels}/${s.rngCursor}/${hp}`;
  });
  return [...CASES.map((c) => {
    const r = autoBattle(createBattle({
      matchId: `golden-${c.seed}`, seed: c.seed, mode: c.mode, rosters: { P1: c.P1, P2: c.P2 },
      ...(c.siege ? { scenario: 'siege' as const, policy: { P2: c.siege } } : {}),
    }));
    const hp = Object.values(r.state.units).sort((a, b) => a.id.localeCompare(b.id)).map((u) => `${u.id}:${u.hp}`).join(',');
    return `${r.winner ?? '-'}/${r.outcome}/${r.time}/${r.turns}/${r.state.rngCursor}/${hp}`;
  }), ...human].join(' | ');
}

/** 이 엔진 몫 · 데이터 몫에서 고정된 지문. 바뀌면 위 머리말대로 갈아 적는다 */
const GOLDEN = {
  engine: 4,
  data: '9d88ae05',
  digest: 'P1/kingDown/2330/89/44/P1-King:10,P1-Pawn:2,P1-Rock:0,P2-Bishop:0,P2-King:0,P2-Queen:0 | P1/kingDown/1930/93/18/P1-King:20,P1-Knight:0,P1-Pawn:10,P2-King:0,P2-Queen:0,P2-Rock:10 | P1/supplyTaken/1273/101/73/P1-Bishop:7,P1-King:10,P1-Knight:6,P1-Pawn:4,P1-Rock:2,P2-Bishop:0,P2-King:10,P2-Knight:0,P2-Queen:0,P2-Rock:0 | P2/supplyTaken/514/44/42/P1-Bishop:20,P1-King:20,P1-Knight:20,P1-Pawn:20,P1-Rock:10,P2-Bishop:19,P2-King:20,P2-Knight:15,P2-Queen:14,P2-Rock:20 | P2/supplyTaken/1247/duels2/29/P1-King:10,P1-Pawn:0,P1-Rock:0,P2-Bishop:10,P2-King:10,P2-Rock:10',
};

test('황금 재생 — 엔진이 같은 수에서 같은 판을 낸다', () => {
  const now = digest();
  const line = `const GOLDEN = { engine: ${ENGINE_REVISION}, data: '${DATA_HASH}', digest: '${now}' };`;
  if (GOLDEN.data !== DATA_HASH) {
    assert.fail(`데이터가 바뀌었다(DATA_HASH ${GOLDEN.data} → ${DATA_HASH}) — 리플레이 버전은 저절로 바뀌었다. 이 줄로 GOLDEN을 갈아 적는다:\n${line}`);
  }
  if (GOLDEN.digest !== now) {
    assert.ok(GOLDEN.engine !== ENGINE_REVISION,
      `데이터는 그대로인데 판이 달라졌다 — 엔진이 바뀌었다. ENGINE_REVISION을 올리고(옛 기록은 「이전 규칙의 판」이 된다) 이 줄로 갈아 적는다:\n${line.replace(`engine: ${ENGINE_REVISION}`, `engine: ${ENGINE_REVISION + 1}`)}`);
    assert.fail(`ENGINE_REVISION을 올렸으면 GOLDEN도 갈아 적는다:\n${line}`);
  }
  assert.equal(GOLDEN.engine, ENGINE_REVISION, `판은 그대로인데 ENGINE_REVISION만 바뀌었다 — 옛 기록을 공연히 막는다`);
});

test('버전 — 지금 값만 다시 볼 수 있다', () => {
  assert.equal(REPLAY_VERSION, `${ENGINE_REVISION}.${DATA_HASH}`);
  assert.ok(replayable(REPLAY_VERSION));
  assert.ok(!replayable(null));
  assert.ok(!replayable(`${ENGINE_REVISION + 1}.${DATA_HASH}`));
  assert.ok(!replayable(`${ENGINE_REVISION}.00000000`));
});
