/**
 * 수성전 연습 판 — 계정 · 서버 없이 공성전을 사람 손으로 둬 본다 (`?demo=1&siege=1`, 2026-10-31 기획자 요청).
 *
 *   ?demo=1&siege=1&mode=3v3&level=1   (mode 3v3 · 5v5, level 1 · 2, seed 숫자)
 *
 * 사람은 남군(공격), 북군(수비)은 **기본 방침**으로 둔다 — 진짜 수비군이 방침을 손대지 않았을 때와 같다(`policy.ts`의
 * `defaultStances` · `defaultTacticRules` · `defaultSkillRules`). 판은 진짜 공성전과 같은 수성전 판(`scenario: 'siege'`)이다.
 *
 * **밸런스는 진짜 공성전의 눈금이다** — 공격군을 시드로 뽑고, 수비군은 후보를 여럿 만들어 부대 전투력(`battlePower`)이
 * 가장 가까운 것을 고른다. 같은 전투력이어도 수성전은 수비가 유리하다(GDD §11 「수성전 — 수비군 방침의 값어치」).
 *
 * Lv2는 레벨업 한 번 몫 — 능력 선택 하나와 Lv2 책략 하나(시드로). 그래서 수비군의 책략 방침 줄이 실제로 생긴다.
 */

import { OFFICERS, TACTICS } from '@samchess/data';
import { battlePower, winChance } from '@samchess/meta';
import {
  baseTactic, createBattle, defaultSkillRules, defaultStances, defaultTacticRules, hash32,
} from '@samchess/rules';
import type {
  BattleMode, BattleState, DefensePolicy, OfficerId, PieceType, RosterEntry, TacticId,
} from '@samchess/rules';

const OTHER_PIECES: PieceType[] = ['Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];
const STAT_PICKS = ['hp', 'mp', 'at'] as const;
/** 수비군 후보 수 — 많을수록 전투력이 가깝다. 200으로는 5v5에서 매칭 구간(MATCH_BAND)을 넘는 시드가 있었다 */
const CANDIDATES = 1000;

export interface SiegeDemo {
  state: BattleState;
  /** 수비군(북군)의 방침 — 판에도 실려 있다(`state.policy.P2`). 팝업이 읽는다 */
  policy: DefensePolicy;
  power: { P1: number; P2: number };
  /** 남군(공격)의 예상 승률 — 전투력만 본 값이다(수성전의 수비 유리는 안 들어 있다) */
  chance: number;
}

/** 시드에서 한 진영을 뽑는다 — King + 나머지 기물 무작위, 장수는 `taken`과 겹치지 않게 */
function rosterOf(seed: number, salt: number, count: number, level: number, taken: ReadonlySet<string>): RosterEntry[] {
  const rest = [...OTHER_PIECES];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = hash32(seed, salt * 7717 + i) % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const pieces: PieceType[] = ['King', ...rest.slice(0, count - 1)];
  const lv2 = TACTICS.filter((t) => t.level === 2).map((t) => t.id as TacticId).sort();
  const used = new Set(taken);
  return pieces.map((piece, i) => {
    let n = 0;
    let officer = OFFICERS[hash32(seed, salt * 1000 + i * 37) % OFFICERS.length]!;
    while (used.has(officer.id)) officer = OFFICERS[hash32(seed, salt * 1000 + i * 37 + ++n) % OFFICERS.length]!;
    used.add(officer.id);
    const grow = level >= 2;
    return {
      officer: officer.id as OfficerId,
      piece,
      level,
      statPicks: grow ? [STAT_PICKS[hash32(seed, salt * 131 + i) % STAT_PICKS.length]!] : [],
      tactics: grow && lv2.length > 0 ? [lv2[hash32(seed, salt * 331 + i) % lv2.length]!] : [],
    };
  });
}

/** 수비군의 기본 방침 — 진짜 수비군이 손대지 않았을 때(`meta`의 `defaultPolicy`)와 같은 셋 */
export function defaultPolicyOf(roster: readonly RosterEntry[]): DefensePolicy {
  return {
    stances: defaultStances(roster.map((r) => r.piece)),
    tactics: defaultTacticRules(new Set(roster.flatMap((r) => r.tactics.map((t) => baseTactic(t))))),
    skills: defaultSkillRules(roster.map((r) => r.officer)),
  };
}

/** 공격군 · 수비군 명단 — 수비군은 전투력이 공격군에 가장 가까운 후보 */
export function siegeDemoRosters(seed: number, mode: BattleMode, level: number): { P1: RosterEntry[]; P2: RosterEntry[] } {
  const count = { '3v3': 3, '5v5': 5 }[mode];
  const P1 = rosterOf(seed, 1, count, level, new Set());
  const target = battlePower(mode, P1);
  const taken = new Set(P1.map((r) => r.officer as string));
  let best: RosterEntry[] = [];
  let gap = Infinity;
  for (let k = 0; k < CANDIDATES && gap > 0; k++) {
    const c = rosterOf(seed, 100 + k, count, level, taken);
    const d = Math.abs(battlePower(mode, c) - target);
    if (d < gap) { best = c; gap = d; }
  }
  return { P1, P2: best };
}

export function createSiegeDemo(seed: number, mode: BattleMode, level: number): SiegeDemo {
  const lv = Math.max(1, Math.min(2, level));
  const rosters = siegeDemoRosters(seed, mode, lv);
  const policy = defaultPolicyOf(rosters.P2);
  const state = createBattle({
    matchId: `siege-demo-${seed}`, seed, mode, scenario: 'siege', rosters, policy: { P2: policy },
  });
  const power = { P1: battlePower(mode, rosters.P1), P2: battlePower(mode, rosters.P2) };
  return { state, policy, power, chance: winChance(power.P1, power.P2) };
}
