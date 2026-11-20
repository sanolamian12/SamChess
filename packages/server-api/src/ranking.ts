/**
 * 랭킹 — 전투 · 도시화 · 컬렉션 세 분야(2026-11-20 기획자, 옛 도시 · 부대 · 장수를 바꿨다).
 *
 * - `GET /ranking/:board` — 1~10위, 또는 도시 이름 검색(그 도시의 **진짜 등수**로, 열 줄까지). 내 줄도 함께.
 * - `GET /ranking/mine` — 세 분야의 내 순위 · 점수(랭킹 메뉴 · 대자보의 위 판).
 * - `GET /ranking/collection` — 컬렉션 화면의 상단 「순위」 · [랭킹 보기] 팝업(2026-10-13, 그대로).
 *
 * 줄 세우기는 전부 `@samchess/meta`의 순수 함수다(`battleRankRow` · `cityRankRow` · `collectionRankRows`). 여기는 전체를
 * 모으고, 전투의 수성 성공(방어 기록 — 프로필에 없다)을 붙이고, 등수를 매겨 자른다.
 *
 * 이메일·uid는 응답에 안 싣는다 — 도시명이 이미 공개 식별자다.
 */
import {
  RANK_TOP, battleRankRow, battleRankable, cityRankRow, collectionRankRows, migrateProfile, sortBattleRows, sortCityRows,
  syncCity, withRanks, COLLECTION_RANK_TOP,
} from '@samchess/meta';
import type {
  BattleRankMode, BattleRankRow, CityRankRow, CollectionRankRow, MyRanks, PlayerProfile, RankBoard, Ranked,
} from '@samchess/meta';
import { pool } from './db.ts';
import { heldByModeAll } from './defense.ts';
import { getProfile } from './profileStore.ts';

/**
 * 지금 규모에서 전체 스캔이 감당되는 자리표시자다. 유저가 늘면 인덱스를 둔 SQL
 * 정렬·페이지네이션으로 바꿀 자리 — 지금은 `@samchess/meta`의 순정 함수를 그대로 재사용하는 쪽을 골랐다.
 */
const SCAN_CAP = 2000;

interface Scanned { uid: string; profile: PlayerProfile }

/**
 * 전체 계정 + 나. 나는 훑기 목록이 아니라 저장소에서 따로 읽어 **갈아 끼운다** — `SCAN_CAP` 밖에 있어도 순위가 나오고,
 * 방금 쓴 내 값이 반영된다. 내 프로필이 없으면 `null`.
 */
async function scanWithMe(uid: string): Promise<{ all: Scanned[]; me: Scanned } | null> {
  const mine = await getProfile(uid);
  if (!mine) return null;
  const now = Date.now();
  const r = await pool.query<{ uid: string; data: unknown }>('select uid, data from profiles where uid <> $1 limit $2', [uid, SCAN_CAP]);
  const all: Scanned[] = [];
  for (const row of r.rows) {
    const migrated = migrateProfile(row.data);
    if (migrated) all.push({ uid: row.uid, profile: syncCity(migrated, now) });
  }
  const me = { uid, profile: syncCity(mine, now) };
  all.push(me);
  return { all, me };
}

/** 한 분야의 줄 전부 — 등수까지 매긴 것 */
type BoardRow = Ranked<BattleRankRow> | Ranked<CityRankRow> | CollectionRankRow;

async function rankedRows(all: Scanned[], board: RankBoard, mode: BattleRankMode): Promise<BoardRow[]> {
  if (board === 'battle') {
    const held = await heldByModeAll();
    return withRanks(sortBattleRows(all.map((s) => battleRankRow(s.profile, mode, held.get(s.uid))).filter(battleRankable)));
  }
  if (board === 'city') return withRanks(sortCityRows(all.map((s) => cityRankRow(s.profile))));
  return collectionRankRows(all.map((s) => s.profile));
}

export interface RankingAnswer {
  /** 검색이 없으면 1~10위, 있으면 이름에 그 글자가 든 도시들(등수 순, 열 줄까지) */
  rows: BoardRow[];
  /** 내 줄 — 그 분야 줄에 안 서면(전투 0판 · 컬렉션 0점) `null` */
  mine: BoardRow | null;
}

/** `GET /ranking/:board` */
export async function queryRanking(uid: string, board: RankBoard, mode: BattleRankMode, q?: string): Promise<RankingAnswer | null> {
  const scan = await scanWithMe(uid);
  if (!scan) return null;
  const rows = await rankedRows(scan.all, board, mode);
  const needle = q?.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.cityName.toLowerCase().includes(needle)) : rows;
  return { rows: shown.slice(0, RANK_TOP), mine: rows.find((r) => r.cityName === scan.me.profile.cityName) ?? null };
}

/** `GET /ranking/mine` — 세 분야의 내 순위 · 점수. 전투는 「전체」(두 모드 합) */
export async function queryMyRanks(uid: string): Promise<MyRanks | null> {
  const scan = await scanWithMe(uid);
  if (!scan) return null;
  const name = scan.me.profile.cityName;
  const find = async (board: RankBoard) => (await rankedRows(scan.all, board, 'all')).find((r) => r.cityName === name) ?? null;
  const [battle, city, collection] = await Promise.all([find('battle'), find('city'), find('collection')]);
  const pick = (r: BoardRow | null) => (r ? { rank: r.rank, total: 'points' in r ? r.points : r.total } : null);
  return { battle: pick(battle), city: pick(city) ?? { rank: 0, total: 0 }, collection: pick(collection) };
}

/**
 * `GET /ranking/collection` — 컬렉션 순위 1~10등 + 내 순위 (컬렉션 화면의 상단 판 · [랭킹 보기], 2026-10-13).
 * `mine`이 `null`이면 아직 완성한 컬렉션이 없다(점수 0은 줄에 안 선다).
 */
export async function queryCollectionRanking(
  uid: string,
): Promise<{ top: CollectionRankRow[]; mine: CollectionRankRow | null } | null> {
  const scan = await scanWithMe(uid);
  if (!scan) return null;
  const rows = collectionRankRows(scan.all.map((s) => s.profile));
  return { top: rows.slice(0, COLLECTION_RANK_TOP), mine: rows.find((r) => r.cityName === scan.me.profile.cityName) ?? null };
}
