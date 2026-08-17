/**
 * 부대 전투력 산출식 도출 — pptx 44쪽 「전투 통계 기반으로 산출식을 도출하는 게 좋겠음」
 *
 *   npm run power -- [판수] [--mode 3v3|5v5|both] [--calib 5000] [--seed N] [--floor 20]
 *
 * `npm run balance`의 형제 도구다. **balance.ts를 확장하지 않고 따로 둔 이유**는 둘이다.
 *
 *  1. `npm run balance`의 Lv1 기본 출력은 HANDOFF §7의 기준선(S 66.4 / A 59.4 / …)과
 *     글자 단위로 비교되는 자산이다. 그 파일 안에서 표본 추출을 갈아 끼우면 기준선이
 *     조용히 흔들린다.
 *  2. **표본 추출 요구가 근본적으로 다르다.** balance.ts는 양쪽에 같은 레벨·같은 능력
 *     정책을 준다 — 그러면 `hp`·`mp`·`at`이 레벨과 완전히 공선이라 셋의 가중치를 따로
 *     뽑을 수 없고, 두 팀의 특징 차이도 좁다. 회귀에는 **한쪽씩 독립으로 굴린 표본**이 필요하다.
 *
 * ## 무엇을 재나
 *
 * ```
 * P(A 승) = 1 / (1 + exp(−β·(특징합(A) − 특징합(B))))      ← 로지스틱 회귀
 * 전투력  = POWER_SCALE · β·특징합 + 유닛수 · offset
 * ```
 *
 * 특징을 뽑는 함수는 `@samchess/meta`의 `unitFeatures()` **하나**다 — 회귀가 잰 것과
 * 식이 쓰는 것이 갈리면 「무엇을 재서 나온 계수인지」를 알 수 없게 된다.
 *
 * ## 표본에서 뺀 것
 *
 * **E급(헌제)은 표본에서 뺀다.** 등급당 한 명씩 균등하게 뽑는 설계인데 E급은 장수가
 * 하나뿐(능력치 1/1/1)이라 슬롯의 1/6을 단일 이상치가 차지하게 된다. 산출식은 능력치
 * 기반이라 헌제에게도 그대로 적용되며 자동으로 최저값을 준다.
 *
 * ## 결과를 어떻게 쓰나
 *
 * 이 도구는 **계수를 찍기만 한다.** 그 값을 손으로 `packages/meta/src/power.ts`의
 * `POWER_MODELS`에 옮겨 적는다 — 실행할 때마다 다시 적합시키면 전투력이 조용히 흔들리고
 * 매칭도 함께 흔들린다. 옮겨 적은 값은 `packages/meta/test/power.test.ts`가 고정한다.
 */

import { OFFICERS, TACTICS, officersByGrade } from '@samchess/data';
import { FORMULA, UNITS_PER_SIDE, autoBattle, createBattle, hash32 } from '@samchess/rules';
import type { BattleMode, Grade, OfficerId, PieceType, RosterEntry, TacticId } from '@samchess/rules';
import { POWER_FEATURES, teamFeatures, unitFeatures } from '@samchess/meta';
import type { PowerFeature } from '@samchess/meta';

// ── 옵션 ───────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};
const games = Number(argv.find((a) => /^\d+$/.test(a)) ?? 20_000);
const calibGames = Number(flag('calib', '5000'));
const baseSeed = Number(flag('seed', '20260817'));
/** 유닛 1인 전투력의 바닥값. 가장 약한 장수(Lv1)가 이 값이 된다 */
const floorValue = Number(flag('floor', '20'));
const modeArg = flag('mode', 'both');
const MODES: BattleMode[] = modeArg === 'both' ? ['3v3', '5v5'] : [modeArg as BattleMode];

/** 표시 눈금 — `POWER_SCALE`과 같은 값이어야 한다 (meta/src/power.ts) */
const SCALE = 100;

const STATS = ['hp', 'mp', 'at'] as const;
type StatPick = (typeof STATS)[number];
/** 등급 균등 추출. E급(헌제 한 명)은 뺀다 — 위 주석 */
const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D'];
const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];
/**
 * 기물 열 (탐색용). **King과 Pawn을 뺀다 — 둘 다 열이 성립하지 않는다.**
 *
 *  - King은 양쪽에 반드시 있어 차분이 항상 0이다.
 *  - 나머지 다섯을 다 넣으면 **합이 항상 `유닛수−1`**이라 차분의 합이 0이 되어
 *    다섯 열이 완전 공선이다. 첫 시험에서 표준오차가 6435로 폭발해 드러났다 —
 *    계수가 뜻을 잃는다. 하나를 **기준(Pawn)**으로 빼면 나머지는 「Pawn 대신 이걸
 *    넣으면 승률이 얼마나 달라지나」로 읽힌다.
 */
const PIECE_BASE: PieceType = 'Pawn';
const PIECE_COLS: PieceType[] = ['Rock', 'Bishop', 'Knight', 'Queen'];

const TACTICS_BY_LEVEL = new Map<number, TacticId[]>();
for (const t of TACTICS) {
  const list = TACTICS_BY_LEVEL.get(t.level) ?? [];
  list.push(t.id as TacticId);
  TACTICS_BY_LEVEL.set(t.level, list.sort());
}

// ── 표본 추출 ──────────────────────────────────────────────────

/**
 * 한 진영을 뽑는다. **레벨·등급을 유닛마다 독립으로** 굴리는 것이 balance.ts와 다른 점이다.
 * 능력 선택도 유닛마다 무작위다 — 고정 정책이면 hp/mp/at이 레벨과 공선이 되어 분리되지 않는다.
 */
function sampleRoster(seed: number, salt: number, mode: BattleMode): RosterEntry[] {
  const perSide = UNITS_PER_SIDE[mode];
  const rest = PIECES.filter((p) => p !== 'King');
  for (let i = rest.length - 1; i > 0; i--) {
    const j = hash32(seed, salt * 7717 + i) % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const pieces: PieceType[] = ['King', ...rest.slice(0, perSide - 1)];

  const used = new Set<string>();
  return pieces.map((piece, i) => {
    const grade = GRADES[hash32(seed, salt * 613 + i * 29) % GRADES.length]!;
    const pool = officersByGrade(grade);
    let officer = pool[0]!;
    for (let n = 0; n < 200; n++) {
      officer = pool[hash32(seed, salt * 1009 + i * 37 + n) % pool.length]!;
      if (!used.has(officer.id)) break;
    }
    used.add(officer.id);

    const level = 1 + (hash32(seed, salt * 271 + i * 53) % 9);
    const statPicks: StatPick[] = [];
    const tactics: TacticId[] = [];
    for (let lv = 2; lv <= level; lv++) {
      statPicks.push(STATS[hash32(seed, salt * 131 + i * 17 + lv) % STATS.length]!);
      const choices = TACTICS_BY_LEVEL.get(lv) ?? [];
      if (choices.length > 0) tactics.push(choices[hash32(seed, salt * 331 + i * 19 + lv) % choices.length]!);
    }
    return { officer: officer.id as OfficerId, piece, level, statPicks, tactics };
  });
}

interface Sample {
  /** 특징 차분 (P1 − P2) + 기물 차분 */
  x: number[];
  /** P1이 이겼으면 1, 졌으면 0, 진짜 무승부면 0.5 */
  y: number;
  gradeDiff: number;
  levelDiff: number;
}

const gradeSum = (r: readonly RosterEntry[]): number =>
  r.reduce((n, e) => n + FORMULA.gradeScore[OFFICERS.find((o) => o.id === e.officer)!.grade], 0);

const pieceVec = (r: readonly RosterEntry[]): number[] =>
  PIECE_COLS.map((p) => (r.some((e) => e.piece === p) ? 1 : 0));

function play(mode: BattleMode, count: number, seedBase: number): Sample[] {
  const out: Sample[] = [];
  for (let g = 0; g < count; g++) {
    const seed = seedBase + g * 7919;
    const rosters = { P1: sampleRoster(seed, 1, mode), P2: sampleRoster(seed, 2, mode) };
    const state = createBattle({ matchId: `pw-${g}`, seed, mode, rosters });
    const r = autoBattle(state);

    const f1 = teamFeatures(rosters.P1);
    const f2 = teamFeatures(rosters.P2);
    const x = [1, ...POWER_FEATURES.map((k) => f1[k] - f2[k])];
    const p1p = pieceVec(rosters.P1);
    const p2p = pieceVec(rosters.P2);
    for (let i = 0; i < PIECE_COLS.length; i++) x.push(p1p[i]! - p2p[i]!);

    const y = r.winner === 'P1' ? 1 : r.winner === 'P2' ? 0 : 0.5;
    const lv = (rr: readonly RosterEntry[]) => rr.reduce((n, e) => n + e.level, 0) / rr.length;
    out.push({ x, y, gradeDiff: gradeSum(rosters.P1) - gradeSum(rosters.P2), levelDiff: lv(rosters.P1) - lv(rosters.P2) });
  }
  return out;
}

// ── 로지스틱 회귀 (IRLS, 의존성 0) ────────────────────────────

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** 가우스 소거 (부분 피벗). `A`를 파괴한다 */
function solveInverse(A: number[][]): number[][] {
  const n = A.length;
  const m = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    const d = m[c]![c]!;
    if (Math.abs(d) < 1e-14) throw new Error('특이 행렬 — 특징이 서로 완전히 겹친다');
    for (let j = c; j < 2 * n; j++) m[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      if (f === 0) continue;
      for (let j = c; j < 2 * n; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

interface Fit {
  /** 원래 단위의 계수 */
  beta: number[];
  /** 표준오차 */
  se: number[];
  logLik: number;
  n: number;
}

/**
 * `cols`에 든 열만 써서 적합한다. 열을 표준편차로 나눠 조건수를 낮추고 마지막에 되돌린다 —
 * 특징이 (능력치 ~300)과 (0/1)로 스케일이 세 자릿수 차이라 그냥 풀면 수치가 흔들린다.
 */
function logistic(samples: readonly Sample[], cols: readonly number[]): Fit {
  const n = samples.length;
  const p = cols.length;
  const X: number[][] = samples.map((s) => cols.map((c) => s.x[c]!));
  const y = samples.map((s) => s.y);

  const sd = Array.from({ length: p }, (_, j) => {
    const mean = X.reduce((a, r) => a + r[j]!, 0) / n;
    const v = X.reduce((a, r) => a + (r[j]! - mean) ** 2, 0) / n;
    return Math.sqrt(v) || 1;
  });
  for (const row of X) for (let j = 0; j < p; j++) row[j]! /= sd[j]!;

  const w = new Array<number>(p).fill(0);
  for (let iter = 0; iter < 60; iter++) {
    const grad = new Array<number>(p).fill(0);
    const H: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < n; i++) {
      const row = X[i]!;
      let eta = 0;
      for (let j = 0; j < p; j++) eta += row[j]! * w[j]!;
      const mu = sigmoid(eta);
      const wt = Math.max(mu * (1 - mu), 1e-9);
      const resid = y[i]! - mu;
      for (let j = 0; j < p; j++) {
        grad[j]! += row[j]! * resid;
        for (let k = j; k < p; k++) H[j]![k]! += row[j]! * row[k]! * wt;
      }
    }
    for (let j = 0; j < p; j++) {
      H[j]![j]! += 1e-8;
      for (let k = 0; k < j; k++) H[j]![k]! = H[k]![j]!;
    }
    const inv = solveInverse(H.map((r) => [...r]));
    let maxStep = 0;
    for (let j = 0; j < p; j++) {
      let d = 0;
      for (let k = 0; k < p; k++) d += inv[j]![k]! * grad[k]!;
      w[j]! += d;
      maxStep = Math.max(maxStep, Math.abs(d));
    }
    if (maxStep < 1e-11) break;
  }

  // 표준오차 — 마지막 Fisher 정보의 역행렬
  const H: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  let logLik = 0;
  for (let i = 0; i < n; i++) {
    const row = X[i]!;
    let eta = 0;
    for (let j = 0; j < p; j++) eta += row[j]! * w[j]!;
    const mu = sigmoid(eta);
    const wt = Math.max(mu * (1 - mu), 1e-9);
    logLik += y[i]! * Math.log(Math.max(mu, 1e-12)) + (1 - y[i]!) * Math.log(Math.max(1 - mu, 1e-12));
    for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) H[j]![k]! += row[j]! * row[k]! * wt;
  }
  for (let j = 0; j < p; j++) H[j]![j]! += 1e-8;
  const cov = solveInverse(H);

  return {
    beta: w.map((v, j) => v / sd[j]!),
    se: cov.map((r, j) => Math.sqrt(Math.max(r[j]!, 0)) / sd[j]!),
    logLik,
    n,
  };
}

// ── 보고 ───────────────────────────────────────────────────────

const COL_NAMES = ['(절편)', ...POWER_FEATURES, ...PIECE_COLS.map((p) => `기물:${p}`)];
const FEATURE_COLS = POWER_FEATURES.map((_, i) => i + 1);
/**
 * 최종 모형에서 특징을 빼지 않는다 — 기물만 뺀다(기획자 확정).
 *
 * 고유기술을 「보유 0/1 + SP 코스트」로 두었다가 **등급 더미 셋**으로 바꾼 경위는
 * `meta/src/power.ts`의 `unitFeatures()` 주석에 있다. 코스트는 헌제(7)가 표본에 없어
 * 외삽이 위험했다.
 */
const DROPPED: PowerFeature[] = [];
const FINAL_COLS = POWER_FEATURES.map((f, i) => (DROPPED.includes(f) ? -1 : i + 1)).filter((c) => c > 0);
/** 이 |z| 미만이면 「표본이 모른다」로 보고 가중치를 0으로 둔다 */
const Z_KEEP = 2;
const PIECE_COLS_IDX = PIECE_COLS.map((_, i) => 1 + POWER_FEATURES.length + i);
const num = (v: number, d = 4) => v.toFixed(d).padStart(d + 6);

function showFit(title: string, fit: Fit, cols: readonly number[]): void {
  console.log(`\n${title}  (n=${fit.n}, logLik=${fit.logLik.toFixed(1)})`);
  console.log('  열              계수        표준오차       z      전투력/1단위');
  cols.forEach((c, j) => {
    const z = fit.beta[j]! / (fit.se[j]! || 1e-12);
    const mark = Math.abs(z) >= 3 ? '★' : Math.abs(z) >= 2 ? '·' : ' ';
    console.log(`  ${COL_NAMES[c]!.padEnd(12)} ${num(fit.beta[j]!, 5)} ${num(fit.se[j]!, 5)} ${z.toFixed(1).padStart(7)} ${mark} ${(fit.beta[j]! * SCALE).toFixed(2).padStart(8)}`);
  });
}

/** 예측 승률 구간별 실제 승률 — 「전투력이 높은 쪽이 정말 이기는가」 */
function calibrate(samples: readonly Sample[], fit: Fit, cols: readonly number[]): void {
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9, 1.001];
  const buckets = edges.slice(0, -1).map(() => ({ n: 0, win: 0, pred: 0 }));
  for (const s of samples) {
    let eta = 0;
    cols.forEach((c, j) => { eta += fit.beta[j]! * s.x[c]!; });
    const p = sigmoid(eta);
    const b = edges.findIndex((e, i) => p >= e && p < edges[i + 1]!);
    if (b < 0) continue;
    buckets[b]!.n++;
    buckets[b]!.win += s.y;
    buckets[b]!.pred += p;
  }
  console.log('\n  예측 승률       판수     예측평균    실제     차이');
  buckets.forEach((b, i) => {
    if (b.n === 0) return;
    const pred = b.pred / b.n;
    const act = b.win / b.n;
    console.log(`  ${(edges[i]! * 100).toFixed(0).padStart(3)}~${(Math.min(edges[i + 1]!, 1) * 100).toFixed(0).padStart(3)}%  ${String(b.n).padStart(7)}   ${(pred * 100).toFixed(1).padStart(6)}%  ${(act * 100).toFixed(1).padStart(6)}%  ${((act - pred) * 100).toFixed(1).padStart(6)}%p`);
  });
}

/** Δ등급점수 × Δ평균레벨 2차원 승률 표 (44쪽 「등급 조합 × 레벨」) */
function sweepTable(samples: readonly Sample[]): void {
  const gEdges = [-Infinity, -12, -6, -2, 2, 6, 12, Infinity];
  const lEdges = [-Infinity, -3, -1, 1, 3, Infinity];
  const gLabel = ['≤−12', '−12~−6', '−6~−2', '−2~2', '2~6', '6~12', '≥12'];
  const lLabel = ['≤−3', '−3~−1', '−1~1', '1~3', '≥3'];
  const cell = gLabel.map(() => lLabel.map(() => ({ n: 0, win: 0 })));
  for (const s of samples) {
    const gi = gEdges.findIndex((e, i) => s.gradeDiff >= e && s.gradeDiff < gEdges[i + 1]!);
    const li = lEdges.findIndex((e, i) => s.levelDiff >= e && s.levelDiff < lEdges[i + 1]!);
    if (gi < 0 || li < 0) continue;
    cell[gi]![li]!.n++;
    cell[gi]![li]!.win += s.y;
  }
  console.log('\n  P1 승률 — 세로 Δ등급점수 · 가로 Δ평균레벨');
  console.log(`  ${''.padEnd(9)}${lLabel.map((l) => l.padStart(11)).join('')}`);
  gLabel.forEach((g, gi) => {
    const row = lLabel.map((_, li) => {
      const c = cell[gi]![li]!;
      return c.n < 30 ? '—'.padStart(11) : `${((c.win / c.n) * 100).toFixed(1)}%`.padStart(11);
    });
    console.log(`  ${g.padEnd(9)}${row.join('')}`);
  });
}

// ── 실행 ───────────────────────────────────────────────────────

interface ModeResult {
  mode: BattleMode;
  weights: Record<PowerFeature, number>;
  offset: number;
  fit: Fit;
}

const results: ModeResult[] = [];
const started = process.hrtime.bigint();

for (const mode of MODES) {
  console.log(`\n${'═'.repeat(78)}\n  ${mode} — 표본 ${games}판 수집 중…`);
  const t0 = process.hrtime.bigint();
  const samples = play(mode, games, baseSeed);
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const p1 = samples.filter((s) => s.y === 1).length;
  const dr = samples.filter((s) => s.y === 0.5).length;
  console.log(`  ${secs.toFixed(0)}초 · P1 승 ${((p1 / games) * 100).toFixed(1)}% · 진짜 무승부 ${dr}`);

  sweepTable(samples);

  // ① 기물을 넣은 탐색 모형 — 기물 효과의 크기를 재기 위해서만 돌린다
  const fullCols = [0, ...FEATURE_COLS, ...PIECE_COLS_IDX];
  const full = logistic(samples, fullCols);
  showFit(`① 탐색 모형 — 기물 포함 (기준 ${PIECE_BASE}, ★ = |z|≥3)`, full, fullCols);

  // ①b 기물만 뺀 모형 — 기물이 설명하던 몫을 따로 떼어 보기 위해
  const noPieceCols = [0, ...FEATURE_COLS];
  const noPiece = logistic(samples, noPieceCols);

  // ② 최종 모형 — 기물(기획자 확정)과 skillCost(외삽 위험)를 뺀다.
  //    표본에서 기물이 무작위라 빼도 나머지 계수는 흔들리지 않는다(직교).
  const cols = [0, ...FINAL_COLS];
  const fit = logistic(samples, cols);
  showFit(`② 최종 모형 — 기물 제외${DROPPED.length ? ` · ${DROPPED.join('·')} 제외` : ''}`, fit, cols);
  const lr = (a: Fit, b: Fit) => 2 * (a.logLik - b.logLik);
  console.log(`  기물을 빼서 잃은 것    logLik ${full.logLik.toFixed(1)} → ${noPiece.logLik.toFixed(1)} (LR ${lr(full, noPiece).toFixed(1)}, ${PIECE_COLS.length}자유도)`);
  // 기물이 만드는 승률 폭 — 「전투력이 같아도 기물 조합 때문에 얼마나 갈리나」
  const pw = PIECE_COLS_IDX.map((_, j) => full.beta[1 + POWER_FEATURES.length + j]!);
  const spread = Math.max(...pw, 0) - Math.min(...pw, 0);
  console.log(`  → 전투력이 같아도 기물 조합만으로 승률이 최대 ${((sigmoid(spread) - 0.5) * 100).toFixed(1)}%p 갈린다 (편도)`);

  /**
   * 날계수를 두 번 손본다. 둘 다 **버리는 쪽으로만** 움직이므로 실측을 부풀리지 않는다.
   *  ① `|z| < Z_KEEP`이면 0 — 표본이 「모른다」고 답한 항을 식에 남기지 않는다.
   *  ② 성장분(hp·mp·at)은 하한 0 — 음수면 **레벨을 내렸는데 전투력이 오른다.**
   *     E의 「레벨 하향」이 성립하려면 단조성이 구조로 보장돼야 한다.
   */
  const weights = {} as Record<PowerFeature, number>;
  POWER_FEATURES.forEach((f) => {
    const j = FINAL_COLS.indexOf(POWER_FEATURES.indexOf(f) + 1);
    const raw = j < 0 ? 0 : fit.beta[j + 1]! * SCALE;
    const z = j < 0 ? 0 : fit.beta[j + 1]! / (fit.se[j + 1]! || 1e-12);
    let v = raw;
    if (Math.abs(z) < Z_KEEP) {
      v = 0;
      console.log(`  ⚠ ${f} 가중치 ${raw.toFixed(3)} → 0 (|z|=${Math.abs(z).toFixed(1)} < ${Z_KEEP}, 표본이 모른다)`);
    } else if ((f === 'hp' || f === 'mp' || f === 'at') && v < 0) {
      v = 0;
      console.log(`  ⚠ ${f} 가중치 ${raw.toFixed(3)} → 0 (성장분 하한. 레벨 단조성)`);
    }
    weights[f] = Number(v.toFixed(3));
  });

  // 바닥값 — 가장 약한 유닛(모든 장수 × 모든 레벨 × 극단 성장)이 floorValue가 되게 한다
  let minRaw = Infinity, maxRaw = -Infinity;
  for (const o of OFFICERS) {
    for (let level = 1; level <= 9; level++) {
      for (const s of STATS) {
        const picks = new Array<StatPick>(level - 1).fill(s);
        const f = unitFeatures({ officer: o.id as OfficerId, statPicks: picks });
        let v = 0;
        for (const k of POWER_FEATURES) v += weights[k] * f[k];
        minRaw = Math.min(minRaw, v);
        maxRaw = Math.max(maxRaw, v);
      }
    }
  }
  const offset = Number((floorValue - minRaw).toFixed(3));
  console.log(`\n  유닛 1인 기여 ${minRaw.toFixed(1)} ~ ${maxRaw.toFixed(1)}  →  offset ${offset} (바닥 ${floorValue})`);

  results.push({ mode, weights, offset, fit });

  // ③ 보정 검사 — 다른 시드의 새 표본
  console.log(`\n③ 보정 검사 — 새 시드 ${calibGames}판`);
  const calib = play(mode, calibGames, baseSeed + 999_331);
  calibrate(calib, fit, cols);
}

// ── 모드 간 계수 비교 ─────────────────────────────────────────

if (results.length === 2) {
  const [a, b] = results as [ModeResult, ModeResult];
  console.log(`\n${'═'.repeat(78)}\n  모드 간 계수 비교 — 겹치면 하나로 공유해도 된다`);
  console.log('  특징           3v3        5v5      차이의 z   판정');
  POWER_FEATURES.filter((f) => !DROPPED.includes(f)).forEach((f) => {
    const i = FINAL_COLS.indexOf(POWER_FEATURES.indexOf(f) + 1);
    const b1 = a.fit.beta[i + 1]!, b2 = b.fit.beta[i + 1]!;
    const s1 = a.fit.se[i + 1]!, s2 = b.fit.se[i + 1]!;
    const z = (b1 - b2) / Math.sqrt(s1 * s1 + s2 * s2);
    console.log(`  ${f.padEnd(12)} ${num(b1 * SCALE, 2)} ${num(b2 * SCALE, 2)} ${z.toFixed(1).padStart(9)}   ${Math.abs(z) >= 2 ? '갈린다' : '겹친다'}`);
  });
}

// ── 분포 · 매칭 구간 · 등급 조합 표 ───────────────────────────

const MATCH_BAND = Math.round(SCALE * Math.log(0.55 / 0.45));

for (const r of results) {
  const perSide = UNITS_PER_SIDE[r.mode];
  const unitPower = (officer: OfficerId, picks: readonly StatPick[]): number => {
    const f = unitFeatures({ officer, statPicks: picks });
    let v = r.offset;
    for (const k of POWER_FEATURES) v += r.weights[k] * f[k];
    return v;
  };
  /** 균형 성장(mix)을 기준으로 한 대표값 */
  const mixPicks = (level: number): StatPick[] =>
    Array.from({ length: level - 1 }, (_, i) => STATS[i % 3]!);

  console.log(`\n${'═'.repeat(78)}\n  ${r.mode} 전투력 분포 (균형 성장 기준)`);
  console.log('  등급   Lv1(최소~최대)      Lv5              Lv9');
  for (const g of [...GRADES, 'E' as Grade]) {
    const pool = officersByGrade(g);
    const cellOf = (level: number) => {
      const vs = pool.map((o) => unitPower(o.id as OfficerId, mixPicks(level)));
      return `${Math.round(Math.min(...vs))}~${Math.round(Math.max(...vs))}`;
    };
    console.log(`  ${g.padEnd(5)} ${cellOf(1).padEnd(18)} ${cellOf(5).padEnd(16)} ${cellOf(9)}`);
  }

  // 팀 전투력의 실제 폭
  const all = OFFICERS.map((o) => ({ id: o.id as OfficerId, g: o.grade }));
  const teamAt = (grade: Grade, level: number, pick: 'min' | 'max'): number => {
    const pool = all.filter((o) => o.g === grade);
    const vs = pool.map((o) => unitPower(o.id, mixPicks(level))).sort((x, y) => x - y);
    const v = pick === 'min' ? vs[0]! : vs[vs.length - 1]!;
    return Math.round(v * perSide);
  };
  console.log(`\n  부대 전투력 폭 — ${r.mode} (${perSide}명)`);
  console.log(`    가장 약한 부대  Lv1 D×${perSide}  = ${teamAt('D', 1, 'min')}`);
  console.log(`    가장 센 부대    Lv9 S×${perSide}  = ${teamAt('S', 9, 'max')}`);
  console.log(`    매칭 구간 폭 ±${MATCH_BAND} (예상 승률 45~55%) → 전 구간을 ${Math.ceil((teamAt('S', 9, 'max') - teamAt('D', 1, 'min')) / (2 * MATCH_BAND))}개 구간이 덮는다`);

  // 등급 조합 표 (3v3만 — 13행 teamScores와 대응)
  if (r.mode === '3v3') {
    console.log('\n  등급 조합별 전투력 (균형 성장 · 등급 내 중앙값)');
    const med = (g: Grade, level: number): number => {
      const pool = officersByGrade(g).map((o) => unitPower(o.id as OfficerId, mixPicks(level))).sort((x, y) => x - y);
      return pool[Math.floor(pool.length / 2)]!;
    };
    console.log('  조합       Lv1     Lv5     Lv9');
    for (const combo of ['SSS', 'SSA', 'SAA', 'AAA', 'ABB', 'BBB', 'BCC', 'CCC', 'CDD', 'DDD']) {
      const cells = [1, 5, 9].map((lv) => {
        const v = [...combo].reduce((n, g) => n + med(g as Grade, lv), 0);
        return String(Math.round(v)).padStart(7);
      });
      console.log(`  ${[...combo].join('+').padEnd(9)}${cells.join('')}`);
    }
  }
}

// ── 옮겨 적을 블록 ─────────────────────────────────────────────

console.log(`\n${'═'.repeat(78)}\n  packages/meta/src/power.ts 의 POWER_MODELS 에 옮겨 적는다\n`);
console.log('export const POWER_MODELS: Readonly<Record<BattleMode, PowerModel>> = {');
for (const r of results) {
  console.log(`  '${r.mode}': {`);
  console.log('    weights: {');
  console.log(`      ${POWER_FEATURES.map((f) => `${f}: ${r.weights[f]}`).join(', ')},`);
  console.log('    },');
  console.log(`    offset: ${r.offset},`);
  console.log('  },');
}
console.log('};');

console.log(`\n총 ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(0)}초\n`);
