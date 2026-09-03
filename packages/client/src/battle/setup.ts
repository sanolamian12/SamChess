/**
 * 데모 편성 — 화면 확인용.
 *
 * 편성 화면(GDD §3.9의 「기물 편성」)은 아직 없으므로, 시드에서 결정적으로 뽑아 세운다.
 * 화면을 새로고침해도 같은 판이 나오므로 눈으로 비교하기 쉽다.
 *
 * **전원 Lv9 · 능력은 전부 HP · 책략은 전 레벨 환술** (기획자 지정, 2026-08-03).
 * 이유는 화면 테스트다 — Lv1은 책략이 하나도 없어서 버프·디버프 배지가 아예 생기지 않고,
 * MP를 쓸 데가 없어 「명상」도 의미가 없다. HP 50이면 한두 대에 죽지 않아 상태이상이
 * 화면에 남아 있는 시간도 길어진다. **밸런스 하네스(`tools/balance.ts`)는 여전히 Lv1이다** —
 * 저기까지 바꾸면 5000판 실측치와 비교가 안 된다.
 */

import { OFFICERS, TACTICS } from '@samchess/data';
import { FORMULA, createBattle, hash32 } from '@samchess/rules';
import type {
  BattleMode, BattleState, OfficerId, PieceType, RosterEntry, TacticId, TerrainId,
} from '@samchess/rules';

const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];

/** Lv9까지 8번의 선택 — 전부 HP (10 + 5×8 = 50) */
const STAT_PICKS = Array.from({ length: 8 }, () => 'hp' as const);

/**
 * 레벨 2~9의 환술 8종 — 공포·침묵·함정·탈진·유인·경직·질병·초선.
 * `school`로 거르고 레벨 오름차순으로 세운다 (데이터 순서에 기대지 않는다).
 */
const ILLUSION_TACTICS: TacticId[] = TACTICS
  .filter((t) => t.school === 'illusion')
  .sort((a, b) => a.level - b.level)
  .map((t) => t.id as TacticId);

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
    return {
      officer: officer.id as OfficerId,
      piece,
      level: 9,
      statPicks: STAT_PICKS,       // HP 50 / MP 5 / AT 2
      tactics: ILLUSION_TACTICS,   // 환술 8종
    };
  });
}

export interface DemoOptions {
  /**
   * 시작 SP (양 진영 동일). `?sp=15` 같은 URL 쿼리로 준다.
   *
   * 고유기술은 SP를 4~7 모아야 쓸 수 있어 판이 시작하고 4~7일이 지나야 시전 단계가 열린다.
   * 그때까지 기다리지 않고 **고유기술 시전과 그 결과(버프·무적·조종 등)를 바로 확인**하려고 둔 통로다.
   * 룰 엔진은 건드리지 않는다 — 만들어진 초기 상태의 SP만 올린다.
   */
  sp?: number;
  /**
   * 판 한가운데에 화계·수계·성지를 하나씩 놓는다. `?terrain=1`로 준다.
   *
   * 지형을 만드는 것은 책략 「화계」와 손권 「수성지주」인데 **데모 편성은
   * 환술 8종뿐**이라(위 참조) 판을 아무리 돌려도 지형이 생기지 않는다. 수계
   * (`water`)는 2026-09-03에 그것을 만들던 책략이 지워져 **이 통로가 유일하게
   * 남은 등장 자리**다 — 엔진의 진입 불가 판정을 눈으로 확인하는 데 쓴다. `?sp=15`와
   * 같은 성격의 확인용 통로다 — 룰 엔진은 건드리지 않고 초기 상태에 칸만 얹는다.
   */
  terrain?: boolean;
}

export function createDemoBattle(
  seed: number,
  mode: BattleMode = '3v3',
  options: DemoOptions = {},
): BattleState {
  const count = { '3v3': 3, '5v5': 5 }[mode];
  const state = createBattle({
    matchId: `demo-${seed}`,
    seed,
    mode,
    rosters: { P1: roster(seed, 1, count), P2: roster(seed, 2, count) },
  });
  // 배치 화면이 아직 없으므로 기본 배치 그대로 시작한다
  const started: BattleState = { ...state, phase: 'running', ready: { P1: true, P2: true } };
  if (options.sp !== undefined) {
    const sp = Math.max(0, options.sp);
    started.sp = { P1: Math.min(sp, started.spCap.P1), P2: Math.min(sp, started.spCap.P2) };
  }
  if (options.terrain) {
    // 배치 구역(위아래 5행)을 피해 판 한가운데에 나란히 놓는다. 유닛이 서 있는
    // 칸에 수계를 놓으면 「들어갈 수 없는 칸에 유닛이 있는」 상태가 되어 버린다.
    const mid = { x: Math.floor(FORMULA.board.cols / 2), y: Math.floor(FORMULA.board.rows / 2) };
    started.terrain = (['fire', 'water', 'holy'] as TerrainId[]).map((terrain, i) => ({
      pos: { x: mid.x - 1 + i, y: mid.y },
      terrain,
      lastTickedAt: started.time,
    }));
  }
  return started;
}

export const officerIdsOf = (state: BattleState): string[] =>
  [...new Set(Object.values(state.units).map((u) => u.officer as string))];
