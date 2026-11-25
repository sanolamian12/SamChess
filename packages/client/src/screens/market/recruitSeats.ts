/**
 * 장수 모집 연출의 자리 (2026-11-25 기획자, `Design/장수모집연출/시나리오.html`).
 *
 * 뽑힌 장수를 **등급 순**(E > S > A > B > C > D)으로 줄 세워 **가운데부터 가장자리 순**으로 앉힌다 —
 * 5명은 가운데 → 왼쪽 둘째 → 오른쪽 둘째 → 왼쪽 끝 → 오른쪽 끝, 3명은 가운데 → 왼쪽 → 오른쪽.
 * 걸어오는 창(`Celebrate`의 `recruit` 도입부)과 번쩍 뒤 무대(`RecruitCast`)가 **이 함수 하나**를 부른다 —
 * 따로 셈하면 걸어온 자리와 선 자리가 갈린다.
 *
 * 걷는 실루엣 그림은 자리에 붙는다(장수와 관계없다): 5명은 1 · 2 · 3 · 4 · 5, 3명은 2 · 3 · 4, 1명은 3(가운데 장수).
 */
import type { Grade } from '@samchess/rules';
import { STAND_GLOW } from '../BlinkGlow.tsx';
import type { BlinkTone } from '../BlinkGlow.tsx';

const RANK: Record<string, number> = { E: 6, S: 5, A: 4, B: 3, C: 2, D: 1 };

/** 가운데부터 가장자리 순의 자리(왼쪽 0부터) — 몇 명이냐에 따라 */
const CENTER_OUT: Record<number, readonly number[]> = { 1: [0], 3: [1, 0, 2], 5: [2, 1, 3, 0, 4] };

/** 자리마다 걷는 실루엣 그림 번호(`ui/intro-recruit-walker-{n}.png`) */
const WALKER_ART: Record<number, readonly number[]> = { 1: [3], 3: [2, 3, 4], 5: [1, 2, 3, 4, 5] };

/** 몇 명을 위한 자리인가 — 1 · 3 · 5 밖이면 가장 가까운 아래 칸(서버가 정한 수라 실제로는 셋뿐이다) */
const seatsFor = (n: number): number => (n >= 5 ? 5 : n >= 3 ? 3 : 1);

/**
 * 뽑힌 순서(i)마다 앉을 자리(왼쪽 0부터). 같은 등급은 뽑힌 순서대로 가운데에 가깝게.
 * 1 · 3 · 5가 아닌 수가 오면 남는 장수는 자리를 받지 않는다(-1).
 */
export function recruitSeats(grades: readonly Grade[]): number[] {
  const order = CENTER_OUT[seatsFor(grades.length)]!;
  const ranked = grades.map((g, i) => ({ i, r: RANK[g] ?? 0 })).sort((a, b) => b.r - a.r || a.i - b.i);
  const seat = new Array<number>(grades.length).fill(-1);
  ranked.forEach((x, k) => { if (k < order.length) seat[x.i] = order[k]!; });
  return seat;
}

/** 걷는 창 한 칸 — 왼쪽부터 자리 순: 실루엣 그림 번호 + 등 뒤 섬광 색(A 흰 · S 자주 · E 금, 그 밖은 없음) */
export type RecruitWalker = { art: number; glow: BlinkTone | null };

export function recruitWalkers(grades: readonly Grade[]): RecruitWalker[] {
  const n = seatsFor(grades.length);
  const seats = recruitSeats(grades);
  const out: RecruitWalker[] = WALKER_ART[n]!.map((art) => ({ art, glow: null }));
  grades.forEach((g, i) => {
    const s = seats[i]!;
    if (s >= 0) out[s] = { art: out[s]!.art, glow: STAND_GLOW[g] ?? null };
  });
  return out;
}
