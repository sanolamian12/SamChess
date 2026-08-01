/**
 * 데모 편성 — 1차 확인용.
 *
 * 편성 화면(GDD §3.9의 「기물 편성」)은 아직 없으므로, 시드에서 결정적으로 뽑아 세운다.
 * 화면을 새로고침해도 같은 판이 나오므로 눈으로 비교하기 쉽다.
 */

import { OFFICERS } from '@samchess/data';
import { createBattle, hash32 } from '@samchess/rules';
import type { BattleState, OfficerId, PieceType, RosterEntry } from '@samchess/rules';

const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];

function roster(seed: number, salt: number, count: number): RosterEntry[] {
  const rest = PIECES.filter((p) => p !== 'King');
  for (let i = rest.length - 1; i > 0; i--) {
    const j = hash32(seed, salt * 7717 + i) % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const pieces: PieceType[] = ['King', ...rest.slice(0, count - 1)];
  const used = new Set<string>();
  return pieces.map((piece, i) => {
    let officer = OFFICERS[0]!;
    let n = 0;
    do {
      officer = OFFICERS[hash32(seed, salt * 1000 + i * 37 + n++) % OFFICERS.length]!;
    } while (used.has(officer.id));
    used.add(officer.id);
    return { officer: officer.id as OfficerId, piece, level: 1, statPicks: [], tactics: [] };
  });
}

export function createDemoBattle(seed: number, mode: '1v1' | '3v3' | '5v5' = '3v3'): BattleState {
  const count = { '1v1': 1, '3v3': 3, '5v5': 5 }[mode];
  const state = createBattle({
    matchId: `demo-${seed}`,
    seed,
    mode,
    rosters: { P1: roster(seed, 1, count), P2: roster(seed, 2, count) },
  });
  // 배치 화면이 아직 없으므로 기본 배치 그대로 시작한다
  return { ...state, phase: 'running', ready: { P1: true, P2: true } };
}

export const officerIdsOf = (state: BattleState): string[] =>
  [...new Set(Object.values(state.units).map((u) => u.officer as string))];
