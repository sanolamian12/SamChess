/**
 * 도적떼 자동 전투의 「가짜 전투」 연출 (2026-11-27 기획자) — 결말은 이미 정해져 있고(전투력 비교, `raidAutoForecast`),
 * 이 모듈은 그 결말을 7~10초짜리 미니 전투로 보여 줄 시간표만 낸다. **판정은 한 줄도 안 한다** — 누가 이기는지는 받은 값이다.
 *
 * 흐름: 양쪽이 가운데로 걸어 나온다(`marchMs`) → 맞붙어 앞뒤로 흔들리며 공격 · 피격을 주고받다 진 쪽 전원과
 * 이긴 쪽의 일부가 차례로 쓰러진다 → 남은 쪽이 평상 동작 → 「승리!」 / 「패배」(`verdictMs`) → [확인](`doneMs`).
 *
 * 이긴 쪽에 서 있는 수는 전투력 차로 정한다(`raidSurvivors` — 10 이하 1명 · 29 이하 2명 · 59 이하 3명 · 99 이하 4명 · 100 이상 5명,
 * 그 쪽 인원이 더 적으면 전원). 동점은 도적의 승리다(meta와 같다 — 여기서는 받은 `win`을 그대로 쓴다).
 *
 * **보초병이 없으면**(언제나 패배) 아군 자리에 빈 농지 그림(`raid-none`)이 서고, 도적이 그 그림 앞까지 쭉 걸어와
 * 좌우로 세 번 흔들린 뒤 「패배」다 — 걷는 길이 길어 시간표가 따로다(`RAID_FIGHT_EMPTY`, `timingOf`).
 *
 * DOM도 시계도 없다 — 화면(`RaidAlert`)이 경과 시간을 넣어 칸 번호를 묻는다. 그래서 `test/raidFight.test.ts`가 시간표를 잰다.
 */

import { ANIM, POSE } from '../battle/animSheet.ts';

export const RAID_FIGHT = {
  /** 가운데로 걸어 나오는 시간 */
  marchMs: 1500,
  /** 맞붙는 시간 — 쓰러짐은 이 안에 다 일어난다 */
  fightMs: 5000,
  /** 「승리!」 / 「패배」가 뜨는 때 */
  verdictMs: 7300,
  /** 「군량을 지켰습니다」 · (군량) -N이 뜨는 때 — 큰 글씨가 다 찍힌 뒤(2026-11-27 기획자) */
  afterMs: 7800,
  /** [확인]이 켜지는 때 — 연출 전체 길이 */
  doneMs: 8100,
} as const;

/** 보초병이 없는 판 — 걸어오기 3초 · 흔들기 2초(세 번) · 평상 동작 뒤 「패배」 */
export const RAID_FIGHT_EMPTY = {
  marchMs: 3000,
  fightMs: 2000,
  verdictMs: 6500,
  afterMs: 7000,
  doneMs: 7300,
} as const;
/** 빈 농지 앞에서 흔들리는 횟수 · 폭(rem) */
const EMPTY_SWAYS = 3;
const EMPTY_SWAY_REM = 0.35;

export type FightTiming = { readonly marchMs: number; readonly fightMs: number; readonly verdictMs: number; readonly afterMs: number; readonly doneMs: number };
export function timingOf(plan: FightPlan): FightTiming {
  return plan.empty ? RAID_FIGHT_EMPTY : RAID_FIGHT;
}

const FIGHT_END = RAID_FIGHT.marchMs + RAID_FIGHT.fightMs;
/** 쓰러짐이 일어나는 구간 — 맞붙은 직후는 비우고, 끝은 남은 쪽이 한숨 돌릴 틈을 둔다 */
const FALL_FROM = RAID_FIGHT.marchMs + 900;
const FALL_TO = FIGHT_END - 500;

/** 이긴 쪽에 서 있는 수 — 전투력 차(절댓값)로, 그 쪽 인원을 넘지 않는다 */
export function raidSurvivors(diff: number, winners: number): number {
  const d = Math.abs(diff);
  const k = d <= 10 ? 1 : d <= 29 ? 2 : d <= 59 ? 3 : d <= 99 ? 4 : 5;
  return Math.min(k, winners);
}

export type FightSide = 'ally' | 'foe';
export type FightUnit = {
  side: FightSide;
  /** 그 쪽 줄에서의 차례(꼬마 줄의 자리) */
  index: number;
  /** 쓰러지는 때(ms) — 끝까지 서 있으면 `null` */
  fallAt: number | null;
  /** 공격 · 피격 고리의 어긋남(ms) — 다 같은 박자로 휘두르지 않게 */
  phase: number;
};
export type FightPlan = { win: boolean; survivors: number; units: FightUnit[]; /** 보초병이 없다 — 빈 농지로 걸어온다 */ empty: boolean };

/**
 * 시간표를 짠다. `rand`는 [0, 1) — 화면은 `Math.random`, 시험은 고정 수열을 넣는다.
 * 쓰러지는 차례는 섞되 **맨 마지막은 진 쪽**이다(진 쪽이 다 쓰러지는 순간이 전투의 끝).
 */
export function planRaidFight(input: { win: boolean; mine: number; theirs: number; allies: number; foes: number }, rand: () => number): FightPlan {
  const winSide: FightSide = input.win ? 'ally' : 'foe';
  const winners = input.win ? input.allies : input.foes;
  const survivors = raidSurvivors(input.mine - input.theirs, winners);
  const units: FightUnit[] = [
    ...Array.from({ length: input.allies }, (_, index): FightUnit => ({ side: 'ally', index, fallAt: null, phase: 0 })),
    ...Array.from({ length: input.foes }, (_, index): FightUnit => ({ side: 'foe', index, fallAt: null, phase: 0 })),
  ];
  for (const u of units) u.phase = Math.floor(rand() * CYCLE_MS);

  // 이긴 쪽에서 서 있을 사람을 무작위로 고르고, 나머지 전부가 쓰러진다
  const winnerUnits = shuffle(units.filter((u) => u.side === winSide), rand);
  const standing = new Set(winnerUnits.slice(0, survivors));
  const doomed = shuffle(units.filter((u) => !standing.has(u)), rand);
  // 마지막에 쓰러지는 것은 진 쪽 — 이긴 쪽의 낙오자가 끝에 오면 「다 이겼는데 또 쓰러진다」로 보인다
  const lastLoser = doomed.map((u) => u.side !== winSide).lastIndexOf(true);
  if (lastLoser >= 0 && lastLoser !== doomed.length - 1) doomed.push(doomed.splice(lastLoser, 1)[0]!);
  doomed.forEach((u, k) => {
    u.fallAt = Math.round(FALL_FROM + ((k + 1) / doomed.length) * (FALL_TO - FALL_FROM));
  });
  return { win: input.win, survivors, units, empty: input.allies === 0 };
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 걷기 한 칸 */
const WALK_FRAME_MS = 150;
/** 맞붙은 동안의 고리 — 사이 칸 → 공격 자세(앞으로 내민다) → 평상 → 피격(물러선다) → 평상 */
const CYCLE: readonly { frame: number; ms: number; dx: number }[] = [
  ...ANIM.windup.map((frame) => ({ frame, ms: 110, dx: 0.08 })),
  { frame: POSE.attack, ms: 340, dx: 0.35 },
  { frame: POSE.idle, ms: 200, dx: 0 },
  { frame: POSE.hurt, ms: 240, dx: -0.2 },
  { frame: POSE.idle, ms: 240, dx: 0 },
];
const CYCLE_MS = CYCLE.reduce((s, c) => s + c.ms, 0);
/** 쓰러지기 직전 맞는 시간 · 쓰러지는 칸 하나 */
const HIT_BEFORE_FALL_MS = 260;
const FALL_FRAME_MS = 170;
const FLOURISH_FRAME_MS = 220;

/** 앞뒤로 흔들리는 폭(rem) · 주기 — 「진동하듯이 왔다갔다」 */
const SWAY_REM = 0.12;
const SWAY_MS = 560;

/** 그 순간의 자세 — 칸 번호, 앞(적 쪽)으로 내민 거리(rem), 쓰러졌는가 */
export type FightPose = { frame: number; dx: number; down: boolean };

export function fightPose(plan: FightPlan, u: FightUnit, t: number): FightPose {
  if (plan.empty) return emptyPose(t);
  if (t < RAID_FIGHT.marchMs) {
    const walk = [POSE.move, ...ANIM.walk];
    return { frame: walk[Math.floor(t / WALK_FRAME_MS) % walk.length]!, dx: 0, down: false };
  }
  if (u.fallAt !== null && t >= u.fallAt - HIT_BEFORE_FALL_MS) {
    const since = t - u.fallAt;
    if (since < 0) return { frame: POSE.hurt, dx: -0.25, down: false };
    const k = Math.floor(since / FALL_FRAME_MS);
    return { frame: ANIM.fall[Math.min(k, ANIM.fall.length - 1)]!, dx: -0.25, down: true };
  }
  if (t < FIGHT_END) {
    let at = (t - RAID_FIGHT.marchMs + u.phase) % CYCLE_MS;
    const sway = Math.sin(((t + u.phase) / SWAY_MS) * Math.PI * 2) * SWAY_REM;
    for (const c of CYCLE) {
      if (at < c.ms) return { frame: c.frame, dx: c.dx + sway, down: false };
      at -= c.ms;
    }
    return { frame: POSE.idle, dx: sway, down: false };
  }
  // 끝까지 선 사람 — 평상 동작 한 차례 뒤 평상 자세
  const k = Math.floor((t - FIGHT_END) / FLOURISH_FRAME_MS);
  return { frame: k < ANIM.flourish.length ? ANIM.flourish[k]! : POSE.idle, dx: 0, down: false };
}

/** 보초병 없는 판의 도적 — 걷기 → 빈 농지 앞에서 좌우로 세 번 → 평상 동작 → 평상 자세 */
function emptyPose(t: number): FightPose {
  const tl = RAID_FIGHT_EMPTY;
  if (t < tl.marchMs) {
    const walk = [POSE.move, ...ANIM.walk];
    return { frame: walk[Math.floor(t / WALK_FRAME_MS) % walk.length]!, dx: 0, down: false };
  }
  const end = tl.marchMs + tl.fightMs;
  if (t < end) {
    const phase = (t - tl.marchMs) / tl.fightMs;   // 0 → 1 동안 세 번
    const dx = Math.sin(phase * EMPTY_SWAYS * Math.PI * 2) * EMPTY_SWAY_REM;
    return { frame: dx >= 0 ? POSE.move : POSE.idle, dx, down: false };
  }
  const k = Math.floor((t - end) / FLOURISH_FRAME_MS);
  return { frame: k < ANIM.flourish.length ? ANIM.flourish[k]! : POSE.idle, dx: 0, down: false };
}

/** 가운데로(빈 판은 농지 앞까지) 나온 정도(0 → 1) — 처음엔 성큼, 닿을 때는 천천히 */
export function marchProgress(plan: FightPlan, t: number): number {
  const p = Math.min(1, Math.max(0, t / timingOf(plan).marchMs));
  return 1 - (1 - p) * (1 - p);
}

/** 맞붙은 동안인가 — 가운데 섬광을 띄운다. 빈 판에는 맞붙음이 없다 */
export function fighting(plan: FightPlan, t: number): boolean {
  return !plan.empty && t >= RAID_FIGHT.marchMs && t < FIGHT_END;
}
