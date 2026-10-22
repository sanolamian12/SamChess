/**
 * 일별 접속 기록 (2026-10-22) — 계정마다 하루(KST)에 한 줄(`sql/schema.sql`의 `daily_active`). 관리자 대시보드의 「일별 접속자」가 센다.
 *
 * **「접속」 = 게임 API가 그 계정을 읽은 것**(`GET /profile`, 기획자 확정) — 로그인 · 새로고침 · 앱을 다시 연 때 전부 여기를 지난다.
 * 하루 경계는 게임의 `raidDay()`(KST 자정 — 도적떼 · CS 하루 상한과 같은 날)이고, 서버 시계로 날을 정해 적는다.
 *
 * **실패해도 계정 읽기는 그대로 돈다** — 기록은 운영용 숫자라, 이것 때문에 게임이 멈추면 안 된다(대전 서버가 server-api 없이도 도는 것과 같은 결).
 * 같은 날 두 번째부터는 DB에 가지 않는다(프로세스 안의 `seen`). 프로세스가 여럿이거나 다시 떠도 `on conflict do nothing`이 한 줄로 지킨다.
 */
import { raidDay } from '@samchess/meta';
import { pool } from './db.ts';

let seenDay = '';
const seen = new Set<string>();

export async function recordActive(uid: string, nowMs = Date.now()): Promise<void> {
  const day = raidDay(nowMs);
  if (day !== seenDay) { seenDay = day; seen.clear(); }
  if (seen.has(uid)) return;
  try {
    await pool.query('insert into daily_active (day, uid) values ($1::date, $2) on conflict do nothing', [day, uid]);
    seen.add(uid);
  } catch (e) {
    console.warn('일별 접속 기록 실패 — 계정 읽기는 그대로', e instanceof Error ? e.message : e);
  }
}
