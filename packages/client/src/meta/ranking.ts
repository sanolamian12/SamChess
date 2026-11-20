/**
 * 랭킹 API 클라이언트 — 전투 · 도시화 · 컬렉션 세 분야(2026-11-20).
 * 점수는 화면이 제 프로필로 바로 낼 수 있지만(`@samchess/meta`의 `battleRankRow` · `cityRankRow` · `collectionPoints`),
 * **몇 등인가**는 전체를 모아야 알 수 있어 서버에 묻는다.
 */
import type {
  BattleRankMode, BattleRankRow, CityRankRow, CollectionRankRow, MyRanks, RankBoard, Ranked,
} from '@samchess/meta';
import { authedFetch } from './storage.ts';

/** 분야마다 줄의 모양 */
export interface BoardRows {
  battle: Ranked<BattleRankRow>;
  city: Ranked<CityRankRow>;
  collection: CollectionRankRow;
}

export interface RankingAnswer<B extends RankBoard> {
  /** 검색이 없으면 1~10위, 있으면 이름에 그 글자가 든 도시들(그 도시의 등수 그대로, 열 줄까지) */
  rows: BoardRows[B][];
  /** 내 줄 — 그 분야 줄에 안 서면 `null` */
  mine: BoardRows[B] | null;
}

/** 한 분야의 1~10위(또는 검색) + 내 줄 — `GET /ranking`. 실패하면 던진다 */
export async function fetchRanking<B extends RankBoard>(board: B, mode: BattleRankMode, q?: string): Promise<RankingAnswer<B>> {
  const query = new URLSearchParams({ board, mode });
  if (q?.trim()) query.set('q', q.trim());
  const res = await authedFetch(`/ranking?${query.toString()}`);
  if (!res.ok) throw new Error(`GET /ranking → ${res.status}`);
  return (await res.json()) as RankingAnswer<B>;
}

/** 세 분야의 내 순위 · 점수 — `GET /ranking/mine` (랭킹 메뉴 · 대자보의 위 판). 실패하면 던진다 */
export async function fetchMyRanks(): Promise<MyRanks> {
  const res = await authedFetch('/ranking/mine');
  if (!res.ok) throw new Error(`GET /ranking/mine → ${res.status}`);
  return ((await res.json()) as { ranks: MyRanks }).ranks;
}

export interface CollectionRanking { top: CollectionRankRow[]; mine: CollectionRankRow | null }

/**
 * 컬렉션 순위 1~10등 + 내 순위 — `GET /ranking/collection` (2026-10-13). 컬렉션 화면의 상단 판 「순위」와
 * [랭킹 보기] 팝업이 이 한 번으로 함께 찬다. 실패하면 던진다 — 화면은 순위를 「—위」로 두고 팝업에 사정을 적는다.
 */
export async function fetchCollectionRanking(): Promise<CollectionRanking> {
  const res = await authedFetch('/ranking/collection');
  if (!res.ok) throw new Error(`GET /ranking/collection → ${res.status}`);
  return (await res.json()) as CollectionRanking;
}
