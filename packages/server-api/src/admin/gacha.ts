/**
 * 관리자 「가챠」 탭 (2026-11-13) — 계정의 가챠 배열을 그 시드로 다시 섞어 한 쪽씩 낸다. **읽기만 한다.**
 * 배열을 만드는 자리는 게임과 같은 meta `shuffledGachaDeck(seed)` 하나다 — 따로 섞으면 관리자가 본 「다음 한 장」과 게임이 줄 장이 갈린다.
 */
import { officerById } from '@samchess/data';
import { gachaDeckBase, gachaPullCost, migrateProfile, shuffledGachaDeck } from '@samchess/meta';
import { pool } from '../db.ts';
import type { AdminGachaResponse } from './types.ts';

/** 한 쪽 = 한 줄 10칸 × 20줄 */
export const GACHA_ADMIN_PAGE = 200;

/** 계정이 없으면 `null`. `page`가 없거나 범위 밖이면 다음 칸이 든 쪽으로 */
export async function readGacha(uid: string, page: number | null): Promise<AdminGachaResponse | null> {
  const r = await pool.query<{ data: unknown }>('select data from profiles where uid = $1', [uid]);
  if (!r.rows[0]) return null;
  const profile = migrateProfile(r.rows[0].data);
  if (!profile) return null;
  const total = gachaDeckBase().length;
  const pages = Math.ceil(total / GACHA_ADMIN_PAGE);
  const multiCount = gachaPullCost('multi').count;
  const gp = profile.gachaPool;
  if (!gp) return { started: false, drawn: 0, total, page: 1, pages, pageSize: GACHA_ADMIN_PAGE, slots: [], drawnByGrade: {}, multiCount };

  const deck = shuffledGachaDeck(gp.seed);
  const nextPage = Math.min(pages, Math.floor(gp.drawn / GACHA_ADMIN_PAGE) + 1);
  const p = page !== null && page >= 1 && page <= pages ? page : nextPage;
  const from = (p - 1) * GACHA_ADMIN_PAGE;
  const drawnByGrade: Record<string, number> = {};
  for (const id of deck.slice(0, gp.drawn)) {
    const g = officerById.get(id)?.grade ?? '?';
    drawnByGrade[g] = (drawnByGrade[g] ?? 0) + 1;
  }
  return {
    started: true, drawn: gp.drawn, total, page: p, pages, pageSize: GACHA_ADMIN_PAGE,
    slots: deck.slice(from, from + GACHA_ADMIN_PAGE).map((officer, i) => ({ index: from + i, officer })),
    drawnByGrade, multiCount,
  };
}
