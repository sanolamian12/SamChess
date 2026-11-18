/**
 * 첫 편성의 배치 미션 — **King과 Rock의 자리를 바꾼다** (2026-11-13 기획자). 기본 배치는 고른 차례대로 왼쪽 · 가운데 · 오른쪽에 세우므로
 * 3인팀의 King이 왼쪽에 선다 — King을 가운데로, 가운데에 섰던 기물을 왼쪽으로.
 *
 * 몸짓은 장수 카드 하나다 (2026-11-18 기획자 — 옛 「누르면 노란 칸 → 한 번 더」 세 번 옮김을 걷었다). 머리 판의 장수 카드를
 * 누르면 그 장수 한 명의 차례가 서고, **우리 장수가 선 칸을 누르면 둘이 자리를 바꾼다** — 그래서 바꾸기는 「King의 카드 → 가운데 칸」
 * 한 번이다. 화면은 **다음에 누를 곳 하나**에 표지를 단다: 차례가 꺼져 있으면 아직 제자리가 아닌 장수(King부터)의 카드, 켜져 있으면
 * 그 장수가 설 칸. 이 미션과 상관없는 장수의 차례면 **제 칸**(그대로 두기 — 누르면 차례가 꺼진다)을 가리킨다.
 * 손이 계획에서 벗어나도(엉뚱한 칸) 지금 자리 · 차례에서 다시 내므로 언제나 끝에 닿는다. 순수 함수다 — `test/deployMission.test.ts`.
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
}

/** 다음에 누를 곳 — 그 장수의 카드 단추(`button`) 또는 판의 칸. 다 바꿨으면 `null` */
export type MissionTarget = { kind: 'button'; piece: PieceType } | { kind: 'cell'; at: Vec2 } | null;

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

export function swapDone(cells: readonly SquadCell[], g: SwapGoal): boolean {
  const at = (p: PieceType) => cells.find((c) => c.piece === p);
  const k = at('King'), o = at(g.other);
  return !!k && !!o && same(k, g.center) && same(o, g.left);
}

/** `turn` — 지금 카드 차례인 기물(꺼져 있으면 `null`) */
export function missionTarget(cells: readonly SquadCell[], g: SwapGoal, turn: PieceType | null): MissionTarget {
  if (swapDone(cells, g)) return null;
  const king = cells.find((c) => c.piece === 'King');
  const firstOff: PieceType = king && same(king, g.center) ? g.other : 'King';
  if (turn === null) return { kind: 'button', piece: firstOff };
  const me = cells.find((c) => c.piece === turn);
  if (!me) return { kind: 'button', piece: firstOff };
  const goal = turn === 'King' ? g.center : turn === g.other ? g.left : null;
  return { kind: 'cell', at: goal && !same(me, goal) ? goal : { x: me.x, y: me.y } };
}
