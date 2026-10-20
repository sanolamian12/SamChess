/**
 * 계정 정지 — 게임 API가 정지된 계정을 **403 `account_banned`로 따로** 거절한다 (2026-10-20).
 *
 * 401로 막지 않는 이유: 게임 화면은 서버에 못 닿거나 401이면 로컬 캐시로 물러나 「오프라인」처럼 돈다.
 * 정지된 사람이 「서버가 이상하다」로 보지 않게, 코드와 함께 기간 · 사유를 실어 보낸다.
 *
 * 라우트 서른여 곳이 `if (!user) return 401`을 쓰고 있어 그 자리를 건드리지 않는다 — `verifyToken`이
 * `AccountBannedError`를 던지고, 여기 오류 처리기 하나가 응답을 짓는다.
 *
 * 정지를 거는 쪽은 관리자 API(`admin/store.ts`의 `setBan`)다. 기간은 `auth.users.banned_until`(Supabase가
 * 로그인 · 토큰마다 보는 칸), 사유는 `app_metadata.ban.reason`.
 */
import type { FastifyInstance } from 'fastify';
import { ACCOUNT_BANNED } from '@samchess/meta';
import { pool } from './db.ts';

export interface BanInfo {
  /** ISO */
  until: string;
  reason: string | null;
}

/** 지금 정지 중이면 기간 · 사유, 아니면 `null` */
export async function readBan(uid: string): Promise<BanInfo | null> {
  const r = await pool.query<{ banned_until: Date; reason: string | null }>(
    `select banned_until, raw_app_meta_data->'ban'->>'reason' as reason
       from auth.users where id = $1 and banned_until > now()`,
    [uid],
  );
  const row = r.rows[0];
  return row ? { until: row.banned_until.toISOString(), reason: row.reason } : null;
}

export class AccountBannedError extends Error {
  /** 토큰에서 못 읽었으면 `null`(`readAuthUser` 머리말) — 그때는 기간 · 사유 없이 거절한다 */
  readonly uid: string | null;

  // 매개변수 속성(`constructor(readonly uid …)`)은 Node의 타입 지우기가 못 지운다 — 필드로 적는다
  constructor(uid: string | null) {
    super(ACCOUNT_BANNED);
    this.name = 'AccountBannedError';
    this.uid = uid;
  }
}

/**
 * `AccountBannedError` → `403 { error: 'account_banned', until, reason }`.
 * 다른 오류는 그대로 다시 보내 Fastify 기본 처리기에 맡긴다.
 */
export function registerBanReply(app: FastifyInstance): void {
  app.setErrorHandler(async (err, _req, reply) => {
    if (!(err instanceof AccountBannedError)) return reply.send(err);
    const ban = err.uid ? await readBan(err.uid) : null;
    return reply.code(403).send({ error: ACCOUNT_BANNED, until: ban?.until ?? null, reason: ban?.reason ?? null });
  });
}
