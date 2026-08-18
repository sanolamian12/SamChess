/**
 * 출전 · 매칭 — pptx 45쪽 · GDD §6.1 · §7.1 (F, 2026-08-18)
 *
 * ```
 * [출정하기] → 「상대를 찾는 중…」(최대 30초)
 *                ├ 온라인 상대를 찾았다  → 「찾았습니다!」 + 상대 부대 + [전투준비]
 *                └ 30초 안에 못 찾았다   → AI 상대를 **내 전투력에 맞춰** 생성 → 같은 화면
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * AI 상대도 **전투력**으로 뽑는다 ★ — 등급 점수를 버렸다
 * ────────────────────────────────────────────────────────────────
 *
 * 문이 [출정하기] 하나로 합쳐지면(§5-32) 상대가 사람인지 AI인지는 **고르는 것이
 * 아니라 그때의 운**이다. 그래서 보상도 전적도 같게 뒀는데(C1), 마지막 한 조각이
 * **눈금**이다 — 온라인 매칭이 `MATCH_BAND`로 고르는데 AI만 등급 점수로 뽑으면
 * 「상대가 바뀐 것뿐」이 성립하지 않는다. 실제로 옛 `makeAiPicks`는 등급만 봐서
 * **레벨을 아예 못 봤다** — Lv9 S급 셋(1211)이 Lv1 S급 셋(797)을 만났다.
 *
 * 지금은 `battlePower()`가 낸 목표값에 슬롯마다 맞춰 간다. 레벨도 후보 축이라
 * 44쪽이 요구한 「레벨 1~9 + 클래스 조합」이 그대로 쓰인다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「다시 찾기」는 **거절당하는 쪽을 지키는 값**이다 (§5-15·16)
 * ────────────────────────────────────────────────────────────────
 *
 * 상대가 계속 거절만 당하지 않도록 **거절하는 쪽**이 군량 −1을 낸다. 참가비
 * (`grainCost`)는 그 위에 얹히는 **별도 지출**이라, 거절하려면 참가비를 남겨 둔
 * 채로 낼 수 있어야 한다.
 *
 * | 잔여 군량 | 출전 | 거절 |
 * |---|---|---|
 * | `< cost` | ✕ | — |
 * | `= cost` (3v3 3 · 5v5 5) | ○ | **✕ — 매칭된 상대와 반드시 싸운다** |
 * | `> cost` | ○ | ○ (거절할 때마다 −1) |
 *
 * **판정이 여기 있는 이유** — 화면이 `grain > 3`을 다시 적으면 참가비나 패널티가
 * 바뀌었을 때 조용히 어긋난다. 「화면이 미리 보여 주는 숫자는 엔진이 낸다」와 같은 결이다.
 * 그래서 아래도 `grain > cost`가 아니라 **`grain − MATCH_DECLINE_GRAIN >= cost`**로 적는다.
 *
 * **AI 대전에는 이 프로세스 전체가 없다.** 상대를 「생성」하는 것이라 거절당하는
 * 상대가 없다 — 문이 하나가 되어도 이 경계는 남는다.
 */

import { GROWTH, officerById } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType, RosterEntry, TacticId } from '@samchess/rules';
import { unitPower } from './power.ts';
import { statsFrom, tacticChoices } from './profile.ts';
import { PIECE_TYPES, grainCost, teamSize } from './roster.ts';
import type { MetaResult, PlayerProfile, RosterPick, StatPick } from './types.ts';

const no = (reason: string): MetaResult => ({ ok: false, reason });

// ═══════════════════════════════════════════════════════════════
// 1. 군량 — 출전과 거절
// ═══════════════════════════════════════════════════════════════

/**
 * 매칭 거절(「다시 찾기」) 한 번에 드는 군량 (§5-15).
 *
 * 45쪽 목업 글자는 **「다시 찾기 (군량 3소모)」**이지만 **−1로 확정됐다** —
 * 3은 과했다. 화면 문구는 이 상수에서 나오므로 목업을 옮겨 적지 않는다.
 */
export const MATCH_DECLINE_GRAIN = 1;

/**
 * 온라인 상대를 찾는 시간 (기획자 지정 30초). 넘으면 AI로 넘어간다.
 *
 * **화면이 30을 다시 적지 않는다** — 남은 시간을 보여 주는 것도 이 값에서 센다.
 * 실제로 찾는 일은 서버 몫이라 클라이언트의 이음매
 * (`client/src/meta/matchmaking.ts`)가 이 값을 쓰고, Colyseus가 그 함수만 갈아 끼운다.
 */
export const ONLINE_SEARCH_MS = 30_000;

/** 출전할 수 있는가 — 참가비만큼 있으면 된다. **AI도 온라인도 같다** */
export function canStartMatch(profile: PlayerProfile, mode: BattleMode): MetaResult {
  const cost = grainCost(mode);
  if (profile.grain < cost) return no(`군량이 모자란다 — ${profile.grain}/${cost}`);
  return { ok: true };
}

/**
 * 매칭을 거절할 수 있는가 (**온라인 전용**).
 *
 * 참가비를 남겨 둔 채로 −1을 낼 수 있어야 한다. `grain > cost`로 적으면 패널티가
 * 2로 바뀌는 날 조용히 틀리므로 **뺄셈을 그대로** 적는다.
 */
export function canDeclineMatch(profile: PlayerProfile, mode: BattleMode): MetaResult {
  const cost = grainCost(mode);
  if (profile.grain - MATCH_DECLINE_GRAIN < cost) {
    return no(`대전을 위한 최소군량만 있을 때는 상대 매칭 시 거절을 할 수 없습니다.`);
  }
  return { ok: true };
}

/**
 * 거절한다 — 군량 −1. **바닥에서는 던진다.**
 *
 * 조용히 넘기면 「눌렀는데 아무 일도 없다」가 되고, 그건 화면이 [다시 찾기]를
 * 아예 안 그려서 막아야 하는 종류다(§5-20). 규칙 층은 마지막 그물이다.
 */
export function declineMatch(profile: PlayerProfile, mode: BattleMode): PlayerProfile {
  const check = canDeclineMatch(profile, mode);
  if (!check.ok) throw new Error(check.reason);
  return { ...profile, grain: profile.grain - MATCH_DECLINE_GRAIN };
}

// ═══════════════════════════════════════════════════════════════
// 2. AI 상대 — 내 전투력에 맞춰 만든다
// ═══════════════════════════════════════════════════════════════

/**
 * 매칭이 물어 온 상대. **AI든 사람이든 같은 모양이다** — 화면이 갈리지 않게.
 *
 * `entries`는 룰 엔진의 평면 형식 그대로다. AI에게는 계정이 없으므로 가짜
 * `PlayerProfile`을 만들지 않는다 — 만들면 「상대의 도시 레벨」 같은 뜻 없는 값이
 * 딸려 오고, 그걸 화면이 읽을 길이 열린다.
 */
export interface MatchOpponent {
  kind: 'ai' | 'online';
  /** 온라인 상대의 계정 id. **AI면 `null`** — 이력의 `opponentId`가 이 값이다 */
  id: string | null;
  /** 상대 부대 이름. **AI면 `null`** — AI에게는 부대가 없다 (§4-7②) */
  squadName: string | null;
  entries: RosterEntry[];
  /** 실제 전투력. 목표에 못 닿았어도 **잰 값 그대로** 준다 — 화면이 거짓말하지 않게 */
  power: number;
}

/** 능력 향상을 고르는 차례. `tools/power_fit.ts`의 표본과 같은 「균형 성장」이다 */
const STATS: readonly StatPick[] = ['hp', 'mp', 'at'];

/** 레벨 상한 — 데이터가 정한다(지금 9) */
const MAX_LEVEL: number = GROWTH.maxLevel;

/**
 * 균형 성장의 능력 선택 — `hp · mp · at`을 돌아가며. **레벨 하나에 하나**다.
 *
 * 무엇을 고르느냐로 전투력이 크게 갈리므로(3v3에서 `at` 한 번 = 19.2, `mp` 한 번 = 1.6)
 * AI가 몰빵하면 같은 등급·레벨인데 값이 요동친다. 균형으로 고정해 **후보가
 * (장수 × 레벨) 하나씩**이 되게 하고, 다양성은 시드가 만든다.
 */
const balancedPicks = (level: number): StatPick[] =>
  Array.from({ length: level - 1 }, (_, i) => STATS[i % STATS.length]!);

/** 그 레벨까지의 균형 성장 책략. **레벨마다 한 school 전부**라 `checkGrowth`를 통과한다 */
function balancedTactics(level: number, seed: number, salt: number): TacticId[] {
  const out: TacticId[] = [];
  for (let lv = 2; lv <= level; lv++) {
    const choices = tacticChoices(lv);
    // 지원/환술을 시드로 갈라 상대마다 결이 다르게 — 짝(Lv6·7의 둘)은 통째로 간다
    const school = hash32(seed, salt * 97 + lv) % 2 === 0 ? 'support' : 'illusion';
    const picked = choices[school].length > 0 ? choices[school] : choices.support;
    out.push(...picked);
  }
  return out;
}

/** 후보 하나 — (장수, 레벨)과 그 전투력 */
interface Candidate {
  officer: OfficerId;
  level: number;
  power: number;
}

/** 보정을 도는 최대 바퀴 수. 나아질 때만 갈아 끼우므로 보통 한 바퀴에 끝난다 */
const REPAIR_PASSES = 3;

/**
 * 아직 안 쓴 후보 중 목표에 가까운 앞쪽 `k`개.
 *
 * **전부 정렬하지 않는다** — 후보가 2340개인데 필요한 것은 앞의 열둘(또는 하나)뿐이고,
 * 슬롯마다·보정 바퀴마다 부르는 자리라 정렬로 두면 회귀 훑기가 9초가 된다.
 * **동점은 표의 차례(장수 등록 순 × 레벨)로 갈라 결정적이다** — 표가 고정이라
 * 같은 시드면 언제나 같은 답이 나온다.
 */
function nearest(
  all: readonly Candidate[], used: ReadonlySet<OfficerId>, want: number, k: number,
): Candidate[] {
  const top: { c: Candidate; d: number }[] = [];
  for (const c of all) {
    if (used.has(c.officer)) continue;
    const d = Math.abs(c.power - want);
    if (top.length === k && d >= top[k - 1]!.d) continue;
    let at = top.length;
    while (at > 0 && top[at - 1]!.d > d) at -= 1;
    top.splice(at, 0, { c, d });
    if (top.length > k) top.pop();
  }
  return top.map((x) => x.c);
}

const sumPower = (cs: readonly Candidate[]): number => cs.reduce((n, c) => n + c.power, 0);

/**
 * 후보 표 — **모드마다 한 번만 만든다.**
 *
 * (장수 260 × 레벨 9)의 전투력은 데이터가 바뀌지 않는 한 언제나 같은 값이고,
 * 계수는 실측 상수라 실행 중에 흔들리지 않는다(`power.ts`). 부를 때마다 다시
 * 만들었더니 한 번에 8ms가 들어 회귀 훑기가 14초가 됐다.
 * **목표에 가까운 순으로 미리 정렬해 두지 않는다** — 목표가 매번 다르다.
 */
const TABLES = new Map<BattleMode, Candidate[]>();

function candidates(mode: BattleMode): Candidate[] {
  const had = TABLES.get(mode);
  if (had) return had;
  const all: Candidate[] = [];
  for (const officer of officerById.keys()) {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      all.push({
        officer: officer as OfficerId,
        level,
        power: unitPower(mode, { officer: officer as OfficerId, statPicks: balancedPicks(level) }),
      });
    }
  }
  TABLES.set(mode, all);
  return all;
}

/**
 * 시드 셔플 (Fisher–Yates). **`Math.random()` 금지** — 룰 엔진과 같은 규약이다.
 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash32(seed, i * 7717) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * 내 전투력에 맞춘 AI 상대를 **시드에서 결정적으로** 만든다 (§5-32 · 45쪽).
 *
 * ────────────────────────────────────────────────────────────────
 * 어떻게 맞추나 — 슬롯마다 「남은 목표 ÷ 남은 자리」
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * 후보  = (아직 안 쓴 장수) × (레벨 1~9), 성장은 균형 고정  → 값 하나씩
 * 슬롯마다  d = 남은 목표 / 남은 자리
 *           |unitPower − d| 가 작은 앞쪽 몇에서 시드로 하나
 *           남은 목표 −= 고른 값
 * ```
 *
 * 앞쪽 **여럿** 중에서 고르는 것이 요점이다 — 늘 최적을 집으면 같은 목표에
 * 언제나 같은 얼굴이 나온다. 뒤 슬롯이 앞 슬롯의 오차를 메우므로 폭을 조금 줘도
 * 합계는 목표에 붙는다.
 *
 * **목표가 도달 범위 밖이면 던지지 않고 가장 가까운 값으로 물러난다** —
 * Lv9 S급 다섯 위나 Lv1 최약체 아래를 요구하면 만들 수 있는 것이 없다.
 * 막으면 「전투력을 너무 올려서 출전을 못 한다」가 되므로, 잰 값을 그대로 실어
 * 화면이 **실제 격차를 보여 주게** 한다(예상 승률이 그 자리에서 나온다).
 */
export function makeAiOpponent(
  mode: BattleMode,
  targetPower: number,
  seed: number,
  exclude: readonly OfficerId[] = [],
): MatchOpponent {
  const size = teamSize(mode);
  // 「내 장수」는 후보에서 미리 뺀다 — 한 판에 같은 얼굴이 양쪽에 서지 않게
  const banned = new Set(exclude);
  const all = candidates(mode).filter((c) => !banned.has(c.officer));

  const pieces: PieceType[] = ['King', ...shuffled(PIECE_TYPES.filter((p) => p !== 'King'), seed)];
  const chosen: Candidate[] = [];
  const used = new Set<OfficerId>();
  let remain = targetPower;

  // ── 한 바퀴: 슬롯마다 「남은 목표 ÷ 남은 자리」에 가까운 것을 시드로 ──
  for (let i = 0; i < size; i++) {
    const want = remain / (size - i);
    // 앞쪽 여럿에서 고른다 — 늘 1등을 집으면 같은 목표에 같은 얼굴만 나온다
    const window = nearest(all, used, want, size * 4);
    const pick = window[hash32(seed, i * 131 + 7) % window.length]!;
    used.add(pick.officer);
    chosen.push(pick);
    remain -= pick.power;
  }

  /*
   * ── 두 바퀴: 마지막 한 뼘을 메운다 ★ ────────────────────────────
   *
   * 탐욕만으로는 **앞 슬롯의 오차가 마지막 슬롯에 전부 몰린다** — 3v3 목표 250에서
   * 실제로 31이 벗어났다(구간은 ±20이다). 슬롯 하나씩 「나머지를 고정한 채의 최적」으로
   * 갈아 보면 몇 점 안으로 들어온다. **나아질 때만** 갈아 끼우므로 반드시 멈춘다.
   *
   * 다양성은 첫 바퀴의 시드가 이미 만들었다 — 여기서 바뀌는 것은 보통 한둘이다.
   */
  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < size; i++) {
      const here = chosen[i]!;
      const want = targetPower - (sumPower(chosen) - here.power);
      used.delete(here.officer);
      const best = nearest(all, used, want, 1)[0];
      if (best && Math.abs(best.power - want) < Math.abs(here.power - want) - 1e-9) {
        chosen[i] = best;
        improved = true;
      }
      used.add(chosen[i]!.officer);
    }
    if (!improved) break;
  }

  const picks: RosterPick[] = chosen.map((c, i) => ({
    piece: pieces[i]!, officer: c.officer, level: c.level,
  }));

  const entries: RosterEntry[] = picks.map((pick, i) => ({
    officer: pick.officer,
    piece: pick.piece,
    level: pick.level!,
    statPicks: balancedPicks(pick.level!),
    // 책략은 전투력에 안 들어가지만 **AI가 실제로 쓴다** — 없으면 상대가 조용히 약해진다
    tactics: balancedTactics(pick.level!, seed, i + 1),
  }));

  return {
    kind: 'ai',
    id: null,
    squadName: null,
    entries,
    // 잰 값을 그대로 — `battlePower()`와 같은 반올림을 지나게 합만 다시 낸다
    power: Math.round(entries.reduce(
      (n, e) => n + unitPower(mode, { officer: e.officer, statPicks: e.statPicks }), 0)),
  };
}

/** 화면이 상대 표에 쓰는 한 줄 — `등급 이름 Lv` */
export function opponentMembers(opponent: MatchOpponent): {
  piece: PieceType; officer: OfficerId; name: string; grade: string; level: number;
  stats: { hp: number; mp: number; at: number };
}[] {
  return opponent.entries.map((e) => {
    const data = officerById.get(e.officer);
    return {
      piece: e.piece,
      officer: e.officer,
      name: data?.name ?? e.officer,
      grade: data?.grade ?? '?',
      level: e.level,
      stats: statsFrom(e.statPicks as readonly StatPick[]),
    };
  });
}
