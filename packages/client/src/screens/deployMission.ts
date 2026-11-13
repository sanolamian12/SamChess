/**
 * 첫 편성의 배치 미션 — **King과 Rock의 자리를 바꾼다** (2026-11-13 기획자). 기본 배치는 고른 차례대로 왼쪽 · 가운데 · 오른쪽에 세우므로
 * 3인팀의 King이 왼쪽에 선다 — King을 가운데로, 가운데에 섰던 기물을 왼쪽으로.
 *
 * 편집기는 **빈 칸으로만** 옮긴다(맞바꾸기 몸짓이 없다) — 그래서 바꾸기는 세 번 옮김이다(가운데 기물을 곁의 빈 칸으로 → King을 가운데로 →
 * 그 기물을 왼쪽으로). 화면은 **다음에 누를 곳 하나**에 단검을 꽂는다: 옮길 기물을 아직 안 집었으면 그 기물, 집었으면 갈 칸.
 * 손이 계획에서 벗어나도(다른 칸에 놓음) 지금 자리에서 다시 계산하므로 언제나 끝에 닿는다. 순수 함수다 — `test/deployMission.test.ts`.
 */
import type { SquadCell } from '@samchess/meta';
import type { PieceType, Vec2 } from '@samchess/rules';

export interface SwapGoal {
  /** King이 갈 자리(가운데) */
  center: Vec2;
  /** 가운데 기물이 갈 자리(왼쪽) */
  left: Vec2;
  /** 가운데에 섰던 기물 — 3인팀 처음 포지션의 둘째(Rock) */
  other: PieceType;
  /** 옮길 수 있는 칸(제 진영 구역) — 비켜 둘 칸을 여기서 찾는다 */
  zone: { x0: number; x1: number; y0: number; y1: number };
}

/** 다음 옮김 — `piece`를 `to`로. 다 바꿨으면 `null` */
export interface SwapMove { piece: PieceType; to: Vec2 }

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

export function swapDone(cells: readonly SquadCell[], g: SwapGoal): boolean {
  const at = (p: PieceType) => cells.find((c) => c.piece === p);
  const k = at('King'), o = at(g.other);
  return !!k && !!o && same(k, g.center) && same(o, g.left);
}

export function nextSwapMove(cells: readonly SquadCell[], g: SwapGoal): SwapMove | null {
  if (swapDone(cells, g)) return null;
  const at = (p: PieceType) => cells.find((c) => c.piece === p);
  const occupant = (v: Vec2) => cells.find((c) => same(c, v));
  const king = at('King');
  if (!king || !at(g.other)) return null;
  // 갈 자리가 비었으면 곧장 — King이 먼저
  for (const [piece, goal] of [['King', g.center], [g.other, g.left]] as const) {
    const me = at(piece)!;
    if (!same(me, goal) && !occupant(goal)) return { piece, to: goal };
  }
  // 둘 다 막혔다 — King 자리(가운데)를 막은 기물을, King이 가운데면 왼쪽을 막은 기물을 곁의 빈 칸으로 비켜 둔다
  const blocked = same(king, g.center) ? g.left : g.center;
  const blocker = occupant(blocked)!;
  return { piece: blocker.piece, to: spareCell(cells, g, blocker) };
}

/** 비켜 둘 칸 — 막은 기물에서 가장 가까운 빈 칸(가운데 · 왼쪽 자리는 뺀다). 거리가 같으면 위쪽 · 왼쪽부터 */
function spareCell(cells: readonly SquadCell[], g: SwapGoal, from: Vec2): Vec2 {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let y = g.zone.y0; y <= g.zone.y1; y++) {
    for (let x = g.zone.x0; x <= g.zone.x1; x++) {
      const v = { x, y };
      if (same(v, g.center) || same(v, g.left) || cells.some((c) => same(c, v))) continue;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (d < bestD) { best = v; bestD = d; }
    }
  }
  return best ?? from;
}
