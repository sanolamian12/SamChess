/**
 * `profiles` 테이블 CRUD. uid 당 한 행, `PlayerProfile` 전체가 JSONB 한 칼럼이다.
 *
 * **판정은 여기 없다** — `migrateProfile()`(`@samchess/meta`)이 형식을 검증·되접고,
 * 이 파일은 읽고 쓰는 일만 한다. `client/src/meta/storage.ts`와 같은 규약이다
 * (되접기는 meta에, 저장 층에는 I/O만).
 */
import { pool } from './db.ts';
import { migrateProfile } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';

export async function getProfile(uid: string): Promise<PlayerProfile | null> {
  const r = await pool.query<{ data: unknown }>('select data from profiles where uid = $1', [uid]);
  const row = r.rows[0];
  if (!row) return null;
  return migrateProfile(row.data);
}

/** `raw`가 유효한 형식이 아니면 `null` — 라우트가 400으로 돌려준다 */
export async function saveProfile(uid: string, raw: unknown): Promise<PlayerProfile | null> {
  const profile = migrateProfile(raw);
  if (!profile) return null;
  await pool.query(
    `insert into profiles (uid, data, updated_at) values ($1, $2, now())
     on conflict (uid) do update set data = excluded.data, updated_at = now()`,
    [uid, JSON.stringify(profile)],
  );
  return profile;
}

/** 스모크·테스트 정리용. 정상 경로에서는 `auth.users`가 지워지면 cascade로 함께 지워진다 */
export async function deleteProfile(uid: string): Promise<void> {
  await pool.query('delete from profiles where uid = $1', [uid]);
}
