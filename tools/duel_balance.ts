/**
 * 일기토 · 설전 밸런스 — 대결 AI · SP MAX 버프 · 「SP 아끼기」가 판을 어떻게 바꾸나 (GDD §3.11, 설계서 §8 단계 2)
 *
 *   npm run balance:duel -- [시드 수] [--mode 3v3] [--level 1] [--stat mix] [--cells nobuff,off,both,p1]
 *
 * ## 칸
 *
 * | 칸 | 대결을 거는 진영 | 그 밖 |
 * |---|---|---|
 * | `nobuff` | 없음 | SP MAX 버프도 끈다(`FORMULA.spMaxAtBonus = 0`, 이 프로세스 안에서만) — 대결 규칙 전의 판 |
 * | `off` | 없음 | 버프만 있다 |
 * | `both` | 양쪽 | — 실제 판의 모습 |
 * | `p1` | 남군만 | 북군은 걸지 않는다(받고 · 도망하는 판단은 한다) → **대결 AI가 득인가** |
 *
 * ## 짝지은 비교
 *
 * `siege_balance.ts`와 같다 — 시드 하나에서 명단 A · B를 뽑아(`balanceRoster.ts`) **A가 남군일 때와 B가 남군일 때를 둘 다** 둔다.
 * 모든 칸이 같은 시드 집합이라 칸 사이의 차이는 시드마다의 차이로 잰다. 표준오차는 시드를 한 묶음으로 본 값이다.
 *
 * ## 한계
 *
 * 패는 판의 시드 난수(균등)다 — 실제 사람도 무작위가 최선이라 같다. AI의 가중치(`DUEL_AI`)는 어림값이고 이 도구가 그 값을 잰다.
 */

import { FORMULA, autoBattle, createBattle } from '@samchess/rules';
import type { BattleConfig, BattleState, RosterEntry, Side } from '@samchess/rules';
import { roster, type StatPick } from './balanceRoster.ts';

const argv = process.argv.slice(2);
const seeds = Number(argv.find((a) => /^\d+$/.test(a)) ?? 200);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const mode = flag('mode', '3v3') as BattleConfig['mode'];
const perSide = { '3v3': 3, '5v5': 5 }[mode];
const level = Math.max(1, Math.min(9, Number(flag('level', '1'))));
const statMode = flag('stat', 'mix') as StatPick | 'mix';
const opts = { perSide, level, statMode };

interface CellDef { key: string; label: string; duels: Partial<Record<Side, boolean>>; buff: boolean }
const CELLS: CellDef[] = [
  { key: 'nobuff', label: '대결 없음 · 버프 없음', duels: {}, buff: false },
  { key: 'off', label: '대결 없음 · 버프만', duels: {}, buff: true },
  { key: 'both', label: '양쪽이 건다', duels: { P1: true, P2: true }, buff: true },
  { key: 'p1', label: '남군만 건다', duels: { P1: true }, buff: true },
];
const wanted = flag('cells', '').split(',').filter(Boolean);
const cells = wanted.length ? CELLS.filter((c) => wanted.includes(c.key)) : CELLS;

interface Cell {
  def: CellDef;
  /** 시드마다 남군이 이긴 판 수(0 · 1 · 2) */
  wins: number[];
  times: number[];
  draws: number;
  games: number;
  /** 대결 — 종류 × 끝난 이유 */
  ended: Record<string, number>;
  /** 남군이 건 대결에서 남군이 이긴 수 · 건 수 */
  p1Won: number;
  p1Asked: number;
  attacks: number;
  buffed: number;
  skills: number;
}

function play(seed: number, a: RosterEntry[], b: RosterEntry[], def: CellDef): BattleState {
  const base = FORMULA.spMaxAtBonus;
  (FORMULA as { spMaxAtBonus: number }).spMaxAtBonus = def.buff ? base : 0;
  try {
    return autoBattle(createBattle({ matchId: `duel-bal-${seed}`, seed, mode, rosters: { P1: a, P2: b } }), { duels: def.duels }).state;
  } finally {
    (FORMULA as { spMaxAtBonus: number }).spMaxAtBonus = base;
  }
}

/** 로그를 따라가며 진영 SP를 세어 「상한에서 친 공격」을 센다 */
function tally(cell: Cell, s: BattleState): void {
  const sp: Record<Side, number> = { P1: 0, P2: 0 };
  let asker: Side | null = null;
  for (const e of s.log) {
    if (e.e === 'spChanged') sp[e.side] = e.to;
    else if (e.e === 'attacked') {
      cell.attacks++;
      const side = s.units[e.unit]!.side;
      if (sp[side] >= s.spCap[side]) cell.buffed++;
    } else if (e.e === 'uniqueSkillCast') cell.skills++;
    else if (e.e === 'challengeOffered') {
      asker = s.units[e.by]!.side;
      if (asker === 'P1') cell.p1Asked++;
    } else if (e.e === 'duelEnded') {
      const k = `${e.kind}/${e.reason}`;
      cell.ended[k] = (cell.ended[k] ?? 0) + 1;
      if (asker === 'P1' && e.winner === 'P1') cell.p1Won++;
    }
  }
}

function measure(def: CellDef): Cell {
  const cell: Cell = { def, wins: [], times: [], draws: 0, games: 0, ended: {}, p1Won: 0, p1Asked: 0, attacks: 0, buffed: 0, skills: 0 };
  for (let g = 0; g < seeds; g++) {
    const seed = 3_000_017 + g * 7919;
    const A = roster(opts, seed, 1);
    const B = roster(opts, seed, 2);
    let w = 0;
    for (const [p1, p2] of [[A, B], [B, A]] as const) {
      const s = play(seed, p1, p2, def);
      cell.games++;
      if (s.winner === 'P1') w++;
      if (!s.winner) cell.draws++;
      cell.times.push(s.time);
      tally(cell, s);
    }
    cell.wins.push(w);
  }
  return cell;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pp = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
const q = (xs: number[], k: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * k))]!;
const rate = (c: Cell) => {
  const per = c.wins.map((w) => w / 2);
  return { p: mean(per), se: sd(per) / Math.sqrt(per.length) };
};
const diff = (c: Cell, base: Cell) => {
  const per = c.wins.map((w, i) => (w - base.wins[i]!) / 2);
  return { d: mean(per), se: sd(per) / Math.sqrt(per.length) };
};
/** 판 길이의 짝지은 차(일) */
const timeDiff = (c: Cell, base: Cell) => {
  const per = c.times.map((t, i) => (t - base.times[i]!) / 100);
  return { d: mean(per), se: sd(per) / Math.sqrt(per.length) };
};

const started = process.hrtime.bigint();
const out = new Map<string, Cell>();
for (const def of cells) out.set(def.key, measure(def));
const elapsed = Number(process.hrtime.bigint() - started) / 1e9;

const growthNote = level === 1 ? 'Lv1 (성장 없음)' : `Lv${level} · 능력 ${statMode} · 책략 ${level - 1}종`;
console.log(`\n일기토 · 설전 ${mode} · ${growthNote} · 시드 ${seeds} × 2방향 = 칸마다 ${seeds * 2}판 — ${elapsed.toFixed(0)}초`);
console.log(['칸', '남군 승 ±95%', '비교', '남군 승 차 ±SE', '판 길이 차(일) ±SE', '시간 중앙', '90%', '무승부', '대결/판', '남군이 건 것 승률', '버프 공격', '고유기술/판'].join(' | '));
const compare: Record<string, string> = { off: 'nobuff', both: 'off', p1: 'off' };
for (const def of cells) {
  const c = out.get(def.key)!;
  const r = rate(c);
  const baseKey = compare[def.key];
  const base = baseKey ? out.get(baseKey) : undefined;
  const dw = base ? diff(c, base) : null;
  const dt = base ? timeDiff(c, base) : null;
  const duels = Object.values(c.ended).reduce((a, b) => a + b, 0);
  console.log([
    def.label,
    `${pct(r.p)} ± ${(r.se * 196).toFixed(1)}`,
    baseKey ?? '—',
    dw ? `${pp(dw.d)} ± ${(dw.se * 100).toFixed(1)}` : '—',
    dt ? `${dt.d >= 0 ? '+' : ''}${dt.d.toFixed(2)} ± ${dt.se.toFixed(2)}` : '—',
    `${Math.round(q(c.times, 0.5) / 100)}일`,
    `${Math.round(q(c.times, 0.9) / 100)}일`,
    pct(c.draws / c.games),
    (duels / c.games).toFixed(2),
    c.p1Asked ? `${pct(c.p1Won / c.p1Asked)} (${c.p1Asked})` : '—',
    c.attacks ? pct(c.buffed / c.attacks) : '—',
    (c.skills / c.games).toFixed(2),
  ].join(' | '));
}
for (const def of cells) {
  const c = out.get(def.key)!;
  const keys = Object.keys(c.ended).sort();
  if (keys.length) console.log(`  ${def.label}: ${keys.map((k) => `${k} ${(c.ended[k]! / c.games).toFixed(2)}`).join(' · ')} (판당)`);
}
console.log('※ 「비교」 칸과의 차는 같은 시드 · 같은 명단의 짝지은 차다. 남군 승 차가 +면 그 칸의 바꾼 것이 남군에게 득이다.');
console.log('※ 「남군이 건 것 승률」은 남군이 건 대결 가운데 남군이 이긴 비율(거절 · 도망 · 0 포함, 결판 없음은 짐에도 이김에도 안 든다).');
console.log('');
