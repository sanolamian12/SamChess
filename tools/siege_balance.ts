/**
 * 수성전 밸런스 — 수비군 방침마다 공격자 승률 · 결말 · 결착 시간을 잰다 (GDD §8.8 「단계 6에서 정한 것」 · §12 「수비군 방침의 값어치」)
 *
 *   npm run balance:siege -- [시드 수] [--mode 3v3] [--level 1] [--stat mix] [--cap 6000]
 *                            [--attack ai,advance,assassinate] [--defend default,occupy,…]
 *
 * ## 무엇과 무엇을 견주나
 *
 * - **짝지은 비교** — 시드 하나에서 명단 A · B를 뽑고(`balance`와 같은 명단, `balanceRoster.ts`) **A가 칠 때와 B가 칠 때를
 *   둘 다** 둔다. 명단의 세기가 공격 · 수비에 똑같이 들어가 상쇄된다. 모든 칸이 **같은 시드 집합**을 쓰므로
 *   방침 사이의 차이는 시드마다의 차이로 잰다(표준오차가 작아진다).
 * - **수비(북군)** — 방침 없음(기본 AI) · 기본 방침과 그 변형 · 「양보 없음」(`POLICY_TUNING.skillYield`, 측정 전용).
 * - **공격(남군)** — 기본 AI, 그리고 사람의 공격 성향을 흉내 낸 방침 AI 둘(전원 진군 · 전원 암살 — 책략 · 고유기술은 기본 표).
 * - **기준선** — 같은 명단 · 같은 기본 AI로 둔 **야전**의 공격자(남군) 승률.
 *
 * ## 이 도구가 재는 것의 한계 ★
 *
 * 공격자가 AI다. 특히 **「제 군량고를 지키는 공격자」는 흉내 낼 방침이 없다**(호위는 King 둘레를 지킨다) —
 * 그래서 점령의 값어치는 **위쪽 한계**로 읽는다. 기본 AI가 책략을 「칠 수 없는 턴에만」 쓰는 한계(`balance.ts` 머리말)도 그대로다.
 *
 * 표준오차는 시드를 묶음으로 본 값이다(한 시드의 두 판은 서로 독립이 아니다).
 */

import { autoBattle, createBattle, FORMULA, POLICY_TUNING, SIEGE_DEFENDER, inSiegeCastle } from '@samchess/rules';
import {
  baseTactic, defaultSkillRules, defaultStances, defaultTacticRules, stancesFor,
} from '@samchess/rules';
import type {
  BattleConfig, BattleState, DefensePolicy, DefenseStance, PieceType, RosterEntry, TacticId,
} from '@samchess/rules';
import { roster, type StatPick } from './balanceRoster.ts';

const argv = process.argv.slice(2);
const seeds = Number(argv.find((a) => /^\d+$/.test(a)) ?? 1000);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const mode = flag('mode', '3v3') as BattleConfig['mode'];
const perSide = { '3v3': 3, '5v5': 5 }[mode];
const level = Math.max(1, Math.min(9, Number(flag('level', '1'))));
const statMode = flag('stat', 'mix') as StatPick | 'mix';
/** **측정 전용** — 60일(time 6000)을 바꿔 재 본다. `balance --cap`과 같이 이 프로세스 안에서만 덮는다 */
const capArg = flag('cap', '');
if (capArg) (FORMULA as { drawTimeLimit: number }).drawTimeLimit = Number(capArg);

const opts = { perSide, level, statMode };

// ═══════════════════════════════════════════════════════════════
// 방침
// ═══════════════════════════════════════════════════════════════

/** 부대가 쓸 수 있는 원본 책략 — 기본 책략 방침이 이 안의 줄만 싣는다(meta의 `squadPolicyTactics`와 같은 뜻) */
const tacticsOf = (r: readonly RosterEntry[]): Set<TacticId> =>
  new Set(r.flatMap((e) => e.tactics.map((t) => baseTactic(t))));

/** 기물마다 같은 방침 — King이 그 방침을 못 고르면 수성 */
const every = (r: readonly RosterEntry[], st: DefenseStance, king?: DefenseStance): Partial<Record<PieceType, DefenseStance>> =>
  Object.fromEntries(r.map((e) => [e.piece,
    e.piece === 'King' ? (king ?? (stancesFor('King').includes(st) ? st : 'hold')) : st]));

const defaultOf = (r: readonly RosterEntry[]): DefensePolicy => ({
  stances: defaultStances(r.map((e) => e.piece)),
  tactics: defaultTacticRules(tacticsOf(r)),
  skills: defaultSkillRules(r.map((e) => e.officer)),
});

interface Defend {
  key: string;
  label: string;
  /** `null`이면 방침 없음 — 기본 AI가 수성전 판에서 지킨다 */
  policy: (r: readonly RosterEntry[]) => DefensePolicy | null;
  noYield?: boolean;
}

const DEFENDS: Defend[] = [
  { key: 'none', label: '방침 없음 (기본 AI)', policy: () => null },
  { key: 'default', label: '기본 방침', policy: defaultOf },
  { key: 'occupy', label: 'King 수성 · 나머지 점령', policy: (r) => ({ ...defaultOf(r), stances: every(r, 'occupy', 'hold') }) },
  { key: 'advance', label: '전원 진군 (King도)', policy: (r) => ({ ...defaultOf(r), stances: every(r, 'advance') }) },
  { key: 'assassinate', label: '전원 암살 (King도)', policy: (r) => ({ ...defaultOf(r), stances: every(r, 'assassinate') }) },
  { key: 'turtle', label: 'King 수성 · 나머지 호위', policy: (r) => ({ ...defaultOf(r), stances: every(r, 'escort', 'hold') }) },
  { key: 'noSkills', label: '기본 − 고유기술 줄', policy: (r) => ({ ...defaultOf(r), skills: [] }) },
  { key: 'noTactics', label: '기본 − 책략 줄', policy: (r) => ({ ...defaultOf(r), tactics: [] }) },
  { key: 'noYield', label: '기본 · SP 양보 없음', policy: defaultOf, noYield: true },
];

interface Attack {
  key: string;
  label: string;
  policy: (r: readonly RosterEntry[]) => DefensePolicy | null;
}

const ATTACKS: Attack[] = [
  { key: 'ai', label: '기본 AI', policy: () => null },
  { key: 'advance', label: '전원 진군', policy: (r) => ({ ...defaultOf(r), stances: every(r, 'advance') }) },
  { key: 'assassinate', label: '전원 암살', policy: (r) => ({ ...defaultOf(r), stances: every(r, 'assassinate') }) },
];

const pick = <T extends { key: string }>(all: T[], name: string): T[] => {
  const want = flag(name, '');
  if (!want) return all;
  const keys = want.split(',');
  const out = all.filter((x) => keys.includes(x.key));
  if (out.length !== keys.length) throw new Error(`--${name}: 모르는 값 — ${keys.join(',')} (있는 것: ${all.map((x) => x.key).join(',')})`);
  return out;
};
const defends = pick(DEFENDS, 'defend');
const attacks = pick(ATTACKS, 'attack');

// ═══════════════════════════════════════════════════════════════
// 한 칸 재기
// ═══════════════════════════════════════════════════════════════

interface Cell {
  label: string;
  /** 시드마다 공격자가 이긴 판 수(0 · 1 · 2) — 짝지은 차이를 여기서 낸다 */
  wins: number[];
  outcomes: Record<string, number>;
  /** 수비 King이 성채 안에서 쓰러진 판 */
  castleFall: number;
  times: number[];
  /** 판마다 수비군이 쓴 고유기술 수 */
  defSkills: number;
  games: number;
}

const ATT = 'P1' as const;   // 공격자는 남군 — 수비군이 북군(SIEGE_DEFENDER)이다

function play(seed: number, attackR: RosterEntry[], defendR: RosterEntry[], siege: boolean, d?: Defend, a?: Attack): BattleState {
  const policy: BattleConfig['policy'] = {};
  const dp = d?.policy(defendR);
  const ap = a?.policy(attackR);
  if (dp) policy[SIEGE_DEFENDER] = dp;
  if (ap) policy[ATT] = ap;
  const cfg: BattleConfig = {
    matchId: `siege-bal-${seed}`, seed, mode,
    rosters: { [ATT]: attackR, [SIEGE_DEFENDER]: defendR } as BattleConfig['rosters'],
    ...(siege ? { scenario: 'siege' as const } : {}),
    ...(Object.keys(policy).length > 0 ? { policy } : {}),
  };
  POLICY_TUNING.skillYield = !d?.noYield;
  try {
    return autoBattle(createBattle(cfg)).state;
  } finally {
    POLICY_TUNING.skillYield = true;
  }
}

function measure(label: string, siege: boolean, d?: Defend, a?: Attack): Cell {
  const cell: Cell = { label, wins: [], outcomes: {}, castleFall: 0, times: [], defSkills: 0, games: 0 };
  for (let g = 0; g < seeds; g++) {
    const seed = 2_000_003 + g * 7919;
    const A = roster(opts, seed, 1);
    const B = roster(opts, seed, 2);
    let w = 0;
    for (const [att, def] of [[A, B], [B, A]] as const) {
      const s = play(seed, att, def, siege, d, a);
      cell.games++;
      if (s.winner === ATT) w++;
      const key = s.winner === ATT ? `공격 ${s.outcome}` : s.winner ? `수비 ${s.outcome}` : 'draw';
      cell.outcomes[key] = (cell.outcomes[key] ?? 0) + 1;
      const king = Object.values(s.units).find((u) => u.side === SIEGE_DEFENDER && u.piece === 'King')!;
      if (siege && !king.alive && inSiegeCastle(king.pos)) cell.castleFall++;
      cell.times.push(s.time);
      cell.defSkills += s.log.filter((e) => e.e === 'uniqueSkillCast' && s.units[e.unit]?.side === SIEGE_DEFENDER).length;
    }
    cell.wins.push(w);
  }
  return cell;
}

// ═══════════════════════════════════════════════════════════════
// 출력
// ═══════════════════════════════════════════════════════════════

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
/** 공격자 승률과 그 표준오차 — 시드(두 판)를 한 묶음으로 */
const rate = (c: Cell): { p: number; se: number } => {
  const per = c.wins.map((w) => w / 2);
  return { p: mean(per), se: sd(per) / Math.sqrt(per.length) };
};
/** 짝지은 차이(이 칸 − 기준 칸)와 그 표준오차 */
const diff = (c: Cell, base: Cell): { d: number; se: number } => {
  const per = c.wins.map((w, i) => (w - base.wins[i]!) / 2);
  return { d: mean(per), se: sd(per) / Math.sqrt(per.length) };
};
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pp = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
const q = (xs: number[], k: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * k))]!;
const share = (c: Cell, key: string): string => pct((c.outcomes[key] ?? 0) / c.games);

const started = process.hrtime.bigint();
const field = measure('야전 (기준선)', false);
const cells = new Map<string, Cell>();
for (const a of attacks) for (const d of defends) cells.set(`${a.key}/${d.key}`, measure(d.label, true, d, a));
const elapsed = Number(process.hrtime.bigint() - started) / 1e9;

const growthNote = level === 1 ? 'Lv1 (성장 없음)' : `Lv${level} · 능력 ${statMode} · 책략 ${level - 1}종`;
console.log(`\n수성전 ${mode} · ${growthNote} · 시드 ${seeds} × 2방향 = 칸마다 ${seeds * 2}판 (상한 time ${FORMULA.drawTimeLimit}) — ${elapsed.toFixed(0)}초`);
const fr = rate(field);
console.log(`\n야전 기준선(같은 명단 · 기본 AI): 남군 승 ${pct(fr.p)} ± ${(fr.se * 196).toFixed(1)}%p`);

const head = ['수비', '공격자 승 ±95%', '기본과 차 ±SE', '야전과 차', '수비: King', '수비: 군량고', '수비: 60일', '성채함락', '시간 중앙', '90%', '수비 기술/판'];
for (const a of attacks) {
  const base = cells.get(`${a.key}/default`);
  console.log(`\n── 공격: ${a.label} ──`);
  console.log(head.join(' | '));
  for (const d of defends) {
    const c = cells.get(`${a.key}/${d.key}`)!;
    const r = rate(c);
    const vsBase = base && d.key !== 'default' ? diff(c, base) : null;
    const vsField = a.key === 'ai' ? diff(c, field) : null;
    console.log([
      d.label,
      `${pct(r.p)} ± ${(r.se * 196).toFixed(1)}`,
      vsBase ? `${pp(vsBase.d)} ± ${(vsBase.se * 100).toFixed(1)}` : '—',
      vsField ? `${pp(vsField.d)}` : '—',
      share(c, '수비 kingDown'),
      share(c, '수비 supplyTaken'),
      share(c, '수비 timeLimit'),
      pct(c.castleFall / c.games),
      `${Math.round(q(c.times, 0.5) / 100)}일`,
      `${Math.round(q(c.times, 0.9) / 100)}일`,
      (c.defSkills / c.games).toFixed(2),
    ].join(' | '));
  }
}
console.log(`\n※ 「수비: …」 셋은 수비가 이긴 길이다 — 공격자 King 격퇴 · 공격자 군량고 탈취 · 60일 버팀.`);
console.log(`  공격자는 King으로만 이기므로 공격자 승과 셋의 합이 100%다.`);
console.log(`※ 「성채함락」은 수비 King이 성채 안에서 쓰러진 판 — 수성이 아닌 King은 성 밖에서 쓰러진다.`);
console.log(`※ 공격자가 AI라 제 군량고를 지키지 않는다 — 점령의 값어치는 위쪽 한계로 읽는다.`);
console.log('');
