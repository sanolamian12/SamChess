/**
 * 접속 상태 (2026-10-28, GDD §8.8 단계 3) — 계정마다 마지막 핑 시각 한 줄(`sql/schema.sql`의 `presence`).
 *
 * 화면이 보이는 동안 `PRESENCE_PING_MS`마다 `POST /presence`가 온다(적는 자리는 `war.ts`의 `pingAction` — 응답에 선전포고를 싣는다). **시각은 서버 시계로 찍는다** — 클라가 시각을 대면
 * 「늘 접속 중」(공성전을 피한다)이나 「늘 미접속」을 자칭할 수 있다. 「접속 중」 판정은 meta의 `isPresent` 하나다.
 *
 * **실패해도 게임은 그대로 돈다** — `activity.ts`의 `recordActive`와 같은 결. 핑이 빠지면 그 도시가 잠시 「미접속」으로 보일 뿐이다.
 */
import { isPresent } from '@samchess/meta';
import { pool } from './db.ts';

/** 그 순간 접속 중인가 — 읽지 못하면 미접속으로 본다(핑이 빠진 것과 같다) */
export async function isOnlineNow(uid: string, nowMs = Date.now()): Promise<boolean> {
  try {
    const r = await pool.query<{ last_seen_at: Date }>('select last_seen_at from presence where uid = $1', [uid]);
    const at = r.rows[0]?.last_seen_at;
    return isPresent(at ? at.getTime() : null, nowMs);
  } catch (e) {
    console.warn('접속 상태 읽기 실패 — 미접속으로 본다', e instanceof Error ? e.message : e);
    return false;
  }
}
