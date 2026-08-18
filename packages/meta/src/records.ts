/**
 * 전적과 대전 이력을 읽는 자리 — pptx 40쪽 · GDD §7 (저장 형식 v3, 2026-08-18)
 *
 * ────────────────────────────────────────────────────────────────
 * 한 번만 세고 나머지는 합으로 낸다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 40쪽은 같은 숫자를 세 가지로 요구한다 — **기물별 여섯 줄** · **모드별 두 줄** ·
 * **총합 한 줄**. 셋을 따로 세면 언젠가 서로 어긋나고, 어긋나도 화면은 아무 말도
 * 하지 않는다. 그래서 `{상대}/{모드}/{기물}`로 **교차해 한 번만** 세고 표의 모든
 * 줄을 그 합으로 낸다. 「기물별 합 = 총합」이 계약이 아니라 산수가 되는 자리다.
 *
 * ────────────────────────────────────────────────────────────────
 * DB로 옮길 것을 전제로 둔다
 * ────────────────────────────────────────────────────────────────
 *
 * 지금 저장은 브라우저지만 서비스는 서버 DB로 간다(기획자). 그래서
 *  - 집계 키는 `{상대}/{모드}/{기물}` — 그대로 테이블의 복합 키다
 *  - 이력 한 줄은 평평하고 참조가 없다 — `seq`가 PK, `picks`가 자식 테이블
 *  - 읽는 자리는 **`sumTally()`와 `recentMatches()` 둘뿐**이다 — 옮길 때 이 둘만
 *    쿼리로 갈면 화면은 한 글자도 안 바뀐다
 *
 * **집계와 이력은 따로 쌓는다.** 이력에서 집계를 파생시키면 오래된 줄을 덜어 낼 때
 * 통산이 조용히 줄어든다 — 「최근 50판」과 「통산 전적」은 다른 것이다.
 */

import { UNITS_PER_SIDE } from '@samchess/rules';
import type { BattleMode, OfficerId, PieceType } from '@samchess/rules';
import { PIECE_TYPES } from './roster.ts';
import type {
  BattleResult, MatchRow, OfficerInstance, OpponentKind, PlayerProfile, RecordTally,
} from './types.ts';

/** 전적을 갈라 보는 세 갈래 (2026-08-18 기획자 지정 — 「AI인 것만/아닌 것만/전체」) */
export type RecordFilter = 'all' | 'online' | 'ai';
export const RECORD_FILTERS: readonly RecordFilter[] = ['all', 'online', 'ai'];

export const OPPONENT_KINDS: readonly OpponentKind[] = ['online', 'ai'];
export const BATTLE_MODES: readonly BattleMode[] = Object.keys(UNITS_PER_SIDE) as BattleMode[];

/**
 * 브라우저에 남겨 두는 이력의 길이.
 *
 * **DB로 옮기면 지우는 줄 하나다** — 서버에서는 자를 이유가 없다. 통산 집계는
 * 이 상한과 무관하게 남으므로, 잘려 나가는 것은 「최근 목록의 꼬리」뿐이다.
 */
export const MATCH_LOG_CAP = 200;

export const emptyTally = (): RecordTally => ({ plays: 0, wins: 0, draws: 0, losses: 0, kills: 0 });

/** 장수 전적의 키 — `online/3v3/King` */
export const recordKey = (opponent: OpponentKind, mode: BattleMode, piece: PieceType): string =>
  `${opponent}/${mode}/${piece}`;

/** 계정 전적의 키 — `online/3v3`. 기물 차원이 없다(한 판에 여러 기물이 함께 뛴다) */
export const accountKey = (opponent: OpponentKind, mode: BattleMode): string =>
  `${opponent}/${mode}`;

/** 한 판을 칸에 더한다. **여기가 `plays = wins + draws + losses`를 지키는 유일한 자리다** */
export function bumpTally(
  record: Record<string, RecordTally>,
  key: string,
  result: BattleResult,
  kills: number,
): void {
  const cell = record[key] ?? (record[key] = emptyTally());
  cell.plays += 1;
  if (result === 'win') cell.wins += 1;
  else if (result === 'draw') cell.draws += 1;
  else cell.losses += 1;
  cell.kills += kills;
}

/** 무엇으로 걸러 셀 것인가. 빠뜨린 것은 「전부」라는 뜻이다 */
export interface TallyWhere {
  opponent?: OpponentKind;
  mode?: BattleMode;
  piece?: PieceType;
}

/**
 * 조건에 맞는 칸을 전부 더한다. **표의 모든 줄이 이 함수 하나에서 나온다.**
 *
 * 계정 전적(2조각 키)과 장수 전적(3조각 키)을 같이 받는다 — 없는 조각은 묻지
 * 않으면 그만이라, 「기물로 걸러 달라」를 계정 전적에 물으면 아무것도 안 나온다.
 */
export function sumTally(record: Record<string, RecordTally>, where: TallyWhere = {}): RecordTally {
  const out = emptyTally();
  for (const [key, cell] of Object.entries(record)) {
    const [opponent, mode, piece] = key.split('/');
    if (where.opponent && opponent !== where.opponent) continue;
    if (where.mode && mode !== where.mode) continue;
    if (where.piece && piece !== where.piece) continue;
    out.plays += cell.plays;
    out.wins += cell.wins;
    out.draws += cell.draws;
    out.losses += cell.losses;
    out.kills += cell.kills;
  }
  return out;
}

/** 필터를 조건으로 옮긴다. `all`은 「묻지 않는다」이지 「둘 다 더한다」가 아니다 */
export const whereOf = (filter: RecordFilter): TallyWhere =>
  (filter === 'all' ? {} : { opponent: filter });

/** 40쪽의 기물 여섯 줄. **한 판도 안 뛴 기물도 0으로 나온다** — 목업이 여섯 줄 고정이다 */
export function pieceRows(
  inst: OfficerInstance,
  filter: RecordFilter = 'all',
): { piece: PieceType; tally: RecordTally }[] {
  const where = whereOf(filter);
  return PIECE_TYPES.map((piece) => ({ piece, tally: sumTally(inst.record, { ...where, piece }) }));
}

/** 40쪽 아래의 모드별 두 줄 */
export function modeRows(
  inst: OfficerInstance,
  filter: RecordFilter = 'all',
): { mode: BattleMode; tally: RecordTally }[] {
  const where = whereOf(filter);
  return BATTLE_MODES.map((mode) => ({ mode, tally: sumTally(inst.record, { ...where, mode }) }));
}

/** 40쪽의 「총 출전」. `pieceRows`의 합·`modeRows`의 합과 **언제나 같다** */
export const totalTally = (inst: OfficerInstance, filter: RecordFilter = 'all'): RecordTally =>
  sumTally(inst.record, whereOf(filter));

/** 계정(도시) 전적 — 41쪽의 「총 출전」 (C2) */
export const accountTally = (profile: PlayerProfile, filter: RecordFilter = 'all'): RecordTally =>
  sumTally(profile.record, whereOf(filter));

/**
 * 41쪽의 모드별 두 줄 — 계정판 `modeRows()`.
 *
 * **화면이 `profile.record`를 직접 훑지 않게 하려고 있다.** 한 줄이면 될 것을
 * 굳이 여기 두는 이유는 키 규약(`{상대}/{모드}`)을 아는 자리를 늘리지 않기
 * 위해서다 — 서버 DB로 옮길 때 갈아야 할 함수가 이 파일 안에만 있어야 한다.
 *
 * **장수 전적을 더해서는 못 만든다** — 한 판에 3~5명이 함께 뛰므로 출전 수가
 * 사람 수만큼 부풀려진다. 그래서 계정 칸을 따로 센다(`bumpTally`가 두 번 부린다).
 */
export const accountModeRows = (
  profile: PlayerProfile,
  filter: RecordFilter = 'all',
): { mode: BattleMode; tally: RecordTally }[] =>
  BATTLE_MODES.map((mode) => ({ mode, tally: sumTally(profile.record, { ...whereOf(filter), mode }) }));

export interface MatchQuery {
  filter?: RecordFilter;
  /** 이 장수가 출전한 판만. 40쪽은 장수 화면이라 늘 걸린다 */
  officer?: OfficerId;
  /** 최근 몇 줄. 생략하면 전부 */
  limit?: number;
  offset?: number;
}

/**
 * 대전 이력 — **최근 것이 먼저**.
 *
 * 서버로 옮기면 이 함수가 `SELECT … ORDER BY seq DESC LIMIT ? OFFSET ?`가 된다.
 * 화면이 `profile.matches`를 직접 뒤집어 자르면 그 자리마다 쿼리를 다시 쓰게 된다.
 */
export function recentMatches(profile: PlayerProfile, query: MatchQuery = {}): MatchRow[] {
  const { filter = 'all', officer, limit, offset = 0 } = query;
  const rows = profile.matches
    .filter((row) => (filter === 'all' || row.opponent === filter)
      && (!officer || row.picks.some((p) => p.officer === officer)))
    .sort((a, b) => b.seq - a.seq)
    .slice(offset);
  return limit === undefined ? rows : rows.slice(0, limit);
}
