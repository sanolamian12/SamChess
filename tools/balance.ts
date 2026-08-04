/**
 * 밸런스 통계 — 자동 대전을 대량으로 돌려 승률과 결착 시간을 뽑는다.
 *
 *   npm run balance -- [판수] [--mode 3v3]
 *
 * 편성은 시드에서 결정적으로 뽑으므로 **같은 판수·같은 옵션이면 결과가 완전히 같다.**
 * 무승부 상한은 엔진(`FORMULA.drawTimeLimit`)이 판정하므로 여기서 따로 걸지 않는다.
 */

import { OFFICERS, type OfficerData } from '@samchess/data';
import { FORMULA, autoBattle, createBattle } from '@samchess/rules';
import type { BattleConfig, OfficerId, PieceType, RosterEntry } from '@samchess/rules';
import { hash32 } from '@samchess/rules';

const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];

const argv = process.argv.slice(2);
const games = Number(argv.find((a) => /^\d+$/.test(a)) ?? 200);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const mode = flag('mode', '3v3') as BattleConfig['mode'];
const perSide = { '3v3': 3, '5v5': 5 }[mode];

/**
 * 시드에서 결정적으로 편성을 뽑는다. King은 반드시 포함하고,
 * 나머지 기물은 매번 다르게 골라 **기물별 통계가 한쪽으로 쏠리지 않게** 한다.
 */
function roster(seed: number, salt: number): RosterEntry[] {
  const rest = PIECES.filter((p) => p !== 'King');
  // Fisher–Yates를 해시로 돌린다 (Math.random 금지)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = hash32(seed, salt * 7717 + i) % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const pieces: PieceType[] = ['King', ...rest.slice(0, perSide - 1)];
  const used = new Set<string>();
  return pieces.map((piece, i) => {
    let officer: OfficerData;
    let n = 0;
    do {
      officer = OFFICERS[hash32(seed, salt * 1000 + i * 37 + n++) % OFFICERS.length]!;
    } while (used.has(officer.id));   // 한 진영에 같은 장수를 두 번 넣을 수 없다
    used.add(officer.id);
    return { officer: officer.id as OfficerId, piece, level: 1, statPicks: [], tactics: [] };
  });
}

const byGrade: Record<string, { win: number; play: number }> = {};
const byPiece: Record<string, { win: number; play: number }> = {};
const times: number[] = [];
let p1 = 0, p2 = 0, draws = 0, judged = 0;

const started = process.hrtime.bigint();

for (let g = 0; g < games; g++) {
  const seed = 1_000_003 + g * 7919;
  const rosters = { P1: roster(seed, 1), P2: roster(seed, 2) };
  const state = createBattle({ matchId: `bal-${g}`, seed, mode, rosters });
  const r = autoBattle(state);

  if (r.outcome === 'draw') draws++;
  if (r.outcome === 'timeLimit') judged++;
  if (r.winner === 'P1') p1++;
  else if (r.winner === 'P2') p2++;
  if (!r.timedOut) times.push(r.time);

  for (const side of ['P1', 'P2'] as const) {
    const won = r.winner === side;
    for (const entry of rosters[side]) {
      const officer = OFFICERS.find((o) => o.id === entry.officer)!;
      for (const [table, key] of [[byGrade, officer.grade], [byPiece, entry.piece]] as const) {
        table[key] ??= { win: 0, play: 0 };
        table[key]!.play++;
        if (won) table[key]!.win++;
      }
    }
  }
}

const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
const percentile = (arr: number[], q: number) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

console.log(`\n${mode} 자동 대전 ${games}판 (무승부 상한 time ${FORMULA.drawTimeLimit}) — ${elapsed.toFixed(1)}초\n`);
console.log(`선공(P1) 승 ${p1} (${pct(p1, games)})  후공(P2) 승 ${p2} (${pct(p2, games)})`);
console.log(`  그중 상한 판정승 ${judged} (${pct(judged, games)})  ·  진짜 무승부 ${draws} (${pct(draws, games)})`);

if (times.length) {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`\n결착 시간 (절대시간 / 게임 내 일수 / 시계가 흐른 실시간)`);
  const show = (label: string, t: number) =>
    console.log(`  ${label.padEnd(10)} ${String(t).padStart(6)}  ${String(Math.round(t / 100)).padStart(4)}일  ${(t / 100).toFixed(0).padStart(4)}초`);
  show('최소', times[0] !== undefined ? Math.min(...times) : 0);
  show('중앙값', percentile(times, 0.5));
  show('평균', Math.round(avg));
  show('상위 75%', percentile(times, 0.75));
  show('상위 90%', percentile(times, 0.9));
  show('상위 99%', percentile(times, 0.99));
  show('최대', Math.max(...times));

  const cap = FORMULA.drawTimeLimit;
  const longest = Math.max(...times);
  console.log(`\n상한 time ${cap}(${cap / 100}일)까지 여유 — 결착 최대가 ${longest}이라 ${(cap / longest).toFixed(1)}배`);
}

const table = (title: string, data: Record<string, { win: number; play: number }>, order?: string[]) => {
  console.log(`\n${title}`);
  const keys = order ?? Object.keys(data).sort();
  for (const k of keys) {
    const d = data[k];
    if (!d) continue;
    const rate = d.win / d.play;
    const bar = '█'.repeat(Math.round(rate * 40));
    console.log(`  ${k.padEnd(7)} ${pct(d.win, d.play).padStart(6)}  ${String(d.play).padStart(4)}회  ${bar}`);
  }
};

table('등급별 승률 (같은 팀에 있으면 함께 이긴 것으로 센다)', byGrade, ['S', 'A', 'B', 'C', 'D', 'E']);
table('기물별 승률', byPiece, PIECES);

console.log(`\n※ 승률은 "그 유닛이 속한 팀이 이겼는가"이므로 개별 기여도가 아니다.`);
console.log(`   편성이 무작위라 표본이 크면 등급 효과만 남는다 — 등급 간 격차가 곧 밸런스 신호다.\n`);
