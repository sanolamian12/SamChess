/**
 * `GET /ranking` — 전체 유저의 도시/부대/장수 랭킹.
 *
 * "내 랭킹"은 여기서 안 낸다 — 클라이언트가 이미 들고 있는 `profile`에
 * `@samchess/meta`의 같은 순수 함수(`cityRankRow`/`squadRankRows`/`officerRankRows`)를
 * 직접 돌려서 만든다. 여기는 **다른 유저들 것**만 준다(§계획 참조).
 *
 * 이메일·uid는 응답에 안 싣는다 — 도시명이 이미 공개 식별자다.
 */
import {
  cityRankRow, migrateProfile, officerRankRows, sortCityRows, sortOfficerRows, sortSquadRows,
  squadRankRows, syncGrain,
} from '@samchess/meta';
import type {
  CityRankRow, CityRankSort, OfficerRankRow, OfficerRankSort, PlayerProfile, RankBoard,
  RecordFilter, SquadRankRow, SquadRankSort,
} from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { pool } from './db.ts';

/**
 * 지금 규모에서 전체 스캔이 감당되는 자리표시자다. 유저가 늘면 인덱스를 둔 SQL
 * 정렬·페이지네이션으로 바꿀 자리 — 지금은 `profiles`에 uid·data 둘뿐이라(스키마
 * 변경 없음) `@samchess/meta`의 순정 함수를 그대로 재사용하는 쪽을 골랐다.
 */
const SCAN_CAP = 2000;

async function scanProfiles(): Promise<PlayerProfile[]> {
  const r = await pool.query<{ data: unknown }>('select data from profiles limit $1', [SCAN_CAP]);
  const out: PlayerProfile[] = [];
  for (const row of r.rows) {
    const migrated = migrateProfile(row.data);
    if (!migrated) continue;
    out.push(syncGrain(migrated, Date.now()));
  }
  return out;
}

export interface RankingQuery {
  board: RankBoard;
  filter: RecordFilter;
  mode?: BattleMode;
  sort: string;
  q?: string;
  /** 기본 5 — 검색(`q`)이 있으면 화면이 더 큰 값을 준다 */
  limit?: number;
}

export type RankRow = CityRankRow | SquadRankRow | OfficerRankRow;

export async function queryRanking(query: RankingQuery): Promise<RankRow[]> {
  const profiles = await scanProfiles();
  const limit = query.limit ?? 5;
  const q = query.q?.trim().toLowerCase();

  if (query.board === 'city') {
    let rows = profiles.map((p) => cityRankRow(p, query.filter, query.mode));
    if (q) rows = rows.filter((r) => r.cityName.toLowerCase().includes(q));
    return sortCityRows(rows, (query.sort as CityRankSort) || 'total').slice(0, limit);
  }

  if (query.board === 'squad') {
    let rows = profiles.flatMap((p) => squadRankRows(p, query.filter, query.mode));
    if (q) {
      rows = rows.filter((r) => r.cityName.toLowerCase().includes(q)
        || r.squad.name.toLowerCase().includes(q));
    }
    return sortSquadRows(rows, (query.sort as SquadRankSort) || 'total').slice(0, limit);
  }

  let rows = profiles.flatMap((p) => officerRankRows(p, query.filter, query.mode));
  if (q) {
    rows = rows.filter((r) => r.cityName.toLowerCase().includes(q)
      || r.name.toLowerCase().includes(q));
  }
  return sortOfficerRows(rows, (query.sort as OfficerRankSort) || 'total').slice(0, limit);
}
