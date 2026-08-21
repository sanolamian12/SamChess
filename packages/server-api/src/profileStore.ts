/**
 * `profiles` 테이블 CRUD. uid 당 한 행, `PlayerProfile` 전체가 JSONB 한 칼럼이다.
 *
 * **판정은 여기 없다** — `migrateProfile()`(`@samchess/meta`)이 형식을 검증·되접고,
 * 이 파일은 읽고 쓰는 일만 한다. `client/src/meta/storage.ts`와 같은 규약이다
 * (되접기는 meta에, 저장 층에는 I/O만).
 */
import { pool } from './db.ts';
import { declineMatch, migrateProfile, refundGrain, spendGrain } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';

/**
 * 읽으면서 **되접힌 값을 그 자리에서 되쓴다** — 예전 클라이언트 전용 저장소의
 * `loadProfile()`("되접었으면 그 자리에서 저장한다")이 하던 일이 옮겨 온 것이다.
 * 안 하면 저장 행은 영원히 옛 형식으로 남고, 읽을 때마다 같은 되접기를 반복하며
 * `version`이 저장에는 안 올라 「저장까지 올라와야 한다」가 안 선다.
 */
export async function getProfile(uid: string): Promise<PlayerProfile | null> {
  const r = await pool.query<{ data: unknown }>('select data from profiles where uid = $1', [uid]);
  const row = r.rows[0];
  if (!row) return null;
  const profile = migrateProfile(row.data);
  if (profile && JSON.stringify(profile) !== JSON.stringify(row.data)) {
    await pool.query('update profiles set data = $1, updated_at = now() where uid = $2', [JSON.stringify(profile), uid]);
  }
  return profile;
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

export type GrainAction = 'spend' | 'decline' | 'refund';

/**
 * 참가비·거절 군량·환불을 **서버가 직접** 재계산한다 (H3b) — 클라이언트가 보낸 값은
 * 아예 안 본다. `@samchess/meta`의 같은 순수 함수(`spendGrain`·`declineMatch`·
 * `refundGrain`)를 **서버가 DB에서 읽은 프로필**에 적용할 뿐이다 — `PUT /profile`처럼
 * 클라이언트가 만든 전체 블록을 받는 것이 아니라, 여기서 새로 지어 저장한다.
 *
 * 부족한 군량으로 낼 수 없는 요청은 `spendGrain`/`declineMatch`가 그대로 던진다 —
 * 부르는 쪽(`packages/server`의 Colyseus 셸)이 잡아서 로그만 남기고 판을 막지 않는다.
 */
export async function applyGrainAction(
  uid: string,
  mode: BattleMode,
  action: GrainAction,
): Promise<PlayerProfile | null> {
  const profile = await getProfile(uid);
  if (!profile) return null;
  const next = action === 'spend' ? spendGrain(profile, mode)
    : action === 'decline' ? declineMatch(profile, mode)
    : refundGrain(profile, mode);
  await pool.query('update profiles set data = $1, updated_at = now() where uid = $2', [JSON.stringify(next), uid]);
  return next;
}

/** 스모크·테스트 정리용. 정상 경로에서는 `auth.users`가 지워지면 cascade로 함께 지워진다 */
export async function deleteProfile(uid: string): Promise<void> {
  await pool.query('delete from profiles where uid = $1', [uid]);
}
