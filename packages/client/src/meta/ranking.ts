/**
 * 랭킹 API 클라이언트 — `GET /ranking`. 전체 유저 top 5(또는 검색)만 서버에 묻는다.
 * "내 랭킹"은 여기 안 온다 — 화면이 `@samchess/meta`의 `cityRankRow`/`squadRankRows`/
 * `officerRankRows`를 자기 `profile`에 바로 돌린다(`ranking.ts`의 머리말 참조).
 */
import type {
  CityRankRow, MyRanks, OfficerRankRow, RankBoard, RecordFilter, SquadRankRow,
} from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { authedFetch } from './storage.ts';

export interface FetchRankingParams {
  board: RankBoard;
  filter: RecordFilter;
  mode?: BattleMode;
  sort: string;
  q?: string;
}

type RankRow = CityRankRow | SquadRankRow | OfficerRankRow;

/** 실패하면 던진다 — 화면이 잡아서 "top 5를 못 불러왔다"로 보여 준다(내 랭킹은 무관하게 뜬다) */
export async function fetchRanking(params: FetchRankingParams): Promise<RankRow[]> {
  const q = new URLSearchParams({ board: params.board, filter: params.filter, sort: params.sort });
  if (params.mode) q.set('mode', params.mode);
  if (params.q?.trim()) q.set('q', params.q.trim());

  const res = await authedFetch(`/ranking?${q.toString()}`);
  if (!res.ok) throw new Error(`GET /ranking → ${res.status}`);
  const body = (await res.json()) as { rows: RankRow[] };
  return body.rows;
}

/**
 * 내 도시·최고 부대·최고 장수의 **순위**만 — `GET /ranking/mine` (랭킹 메뉴 위쪽 판,
 * 2026-09-18). 행(이름·총점)은 화면이 제 프로필로 내므로 서버가 안 닿아도 뜨고,
 * 순위 칸만 「—」로 남는다. 실패하면 던진다.
 */
export async function fetchMyRanks(filter: RecordFilter, mode: BattleMode): Promise<MyRanks> {
  const q = new URLSearchParams({ filter, mode });
  const res = await authedFetch(`/ranking/mine?${q.toString()}`);
  if (!res.ok) throw new Error(`GET /ranking/mine → ${res.status}`);
  return ((await res.json()) as { ranks: MyRanks }).ranks;
}
