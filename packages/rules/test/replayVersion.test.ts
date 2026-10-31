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
import { DATA_HASH, ENGINE_REVISION, REPLAY_VERSION, replayable } from '../src/replayVersion.ts';
import { defaultSkillRules, defaultStances, defaultTacticRules } from '../src/policy.ts';
import type { DefensePolicy, RosterEntry, TacticId } from '../src/types.ts';
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

/** 끝 상태의 지문 — 승자 · 끝 · 시각 · 차례 수 · 난수 커서 · 장수마다 HP */
function digest(): string {
  return CASES.map((c) => {
    const r = autoBattle(createBattle({
      matchId: `golden-${c.seed}`, seed: c.seed, mode: c.mode, rosters: { P1: c.P1, P2: c.P2 },
      ...(c.siege ? { scenario: 'siege' as const, policy: { P2: c.siege } } : {}),
    }));
    const hp = Object.values(r.state.units).sort((a, b) => a.id.localeCompare(b.id)).map((u) => `${u.id}:${u.hp}`).join(',');
    return `${r.winner ?? '-'}/${r.outcome}/${r.time}/${r.turns}/${r.state.rngCursor}/${hp}`;
  }).join(' | ');
}

/** 이 엔진 몫 · 데이터 몫에서 고정된 지문. 바뀌면 위 머리말대로 갈아 적는다 */
const GOLDEN = {
  engine: 2,
  data: '8cde5831',
  digest: 'P1/kingDown/1122/54/18/P1-King:10,P1-Pawn:2,P1-Rock:6,P2-Bishop:0,P2-King:0,P2-Queen:0 | P1/kingDown/1799/85/19/P1-King:20,P1-Knight:0,P1-Pawn:10,P2-King:0,P2-Queen:0,P2-Rock:0 | P1/kingDown/1031/83/28/P1-Bishop:6,P1-King:10,P1-Knight:6,P1-Pawn:3,P1-Rock:4,P2-Bishop:0,P2-King:0,P2-Knight:8,P2-Queen:0,P2-Rock:5 | P2/supplyTaken/514/43/27/P1-Bishop:20,P1-King:20,P1-Knight:20,P1-Pawn:20,P1-Rock:10,P2-Bishop:19,P2-King:20,P2-Knight:18,P2-Queen:15,P2-Rock:20',
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
