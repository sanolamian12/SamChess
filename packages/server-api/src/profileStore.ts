/**
 * `profiles` 테이블 CRUD. uid 당 한 행, `PlayerProfile` 전체가 JSONB 한 칼럼이다.
 *
 * **판정은 여기 없다** — `migrateProfile()`(`@samchess/meta`)이 형식을 검증·되접고,
 * 이 파일은 읽고 쓰는 일만 한다. `client/src/meta/storage.ts`와 같은 규약이다
 * (되접기는 meta에, 저장 층에는 I/O만).
 */
import { pool } from './db.ts';
import {
  declineMatch, migrateProfile, refundGrain, spendGrain, syncCity,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';

/**
 * 읽으면서 **되접힌 값 + 서버 시계로 정산한 군량을 그 자리에서 되쓴다.**
 *
 * 되접기는 예전 클라이언트 전용 저장소의 `loadProfile()`("되접었으면 그 자리에서
 * 저장한다")이 하던 일이 옮겨 온 것이고, `syncGrain(profile, Date.now())`는 H3d가
 * 더한 것이다 — **지금 몇 시인지를 클라이언트가 대는 것을 여기서 끊는다.** `city.ts`의
 * `syncGrain`은 순수 함수라 시계는 부르는 쪽이 넣는데, 예전에는 그 자리가
 * `client/src/screens/App.tsx` 하나였다(오프라인 그림의 `bandForHour`와 같은 규약).
 * **`GET /profile`을 부를 때마다 서버 자신의 시계로 다시 정산하는 이 자리가 더해지며**,
 * 참가비 재계산(`applyGrainAction`)·전투 보상 반영도 전부 `getProfile()`을 거치므로
 * 공짜로 최신값 위에서 계산된다. 되접기와 정산 어느 한쪽만 바뀌어도 한 번에 되쓴다.
 */
export async function getProfile(uid: string): Promise<PlayerProfile | null> {
  const r = await pool.query<{ data: unknown }>('select data from profiles where uid = $1', [uid]);
  const row = r.rows[0];
  if (!row) return null;
  const migrated = migrateProfile(row.data);
  if (!migrated) return null;
  const synced = syncCity(migrated, Date.now());
  if (JSON.stringify(synced) !== JSON.stringify(row.data)) {
    await pool.query('update profiles set data = $1, updated_at = now() where uid = $2', [JSON.stringify(synced), uid]);
  }
  return synced;
}

/**
 * 서버가 **이미 직접 계산한** 프로필을 그대로 믿고 저장한다 — AI·온라인·무승부
 * 전투 보상 반영 전용(`battleResult.ts`)이다. `saveProfile()`과 달리 `grain`을
 * 보호하지 않는다 — 여기로 들어오는 `grain` 변화는 클라이언트가 우긴 값이 아니라
 * **서버 자신이 `applyBattleResult()`로 방금 낸 값**이기 때문이다.
 */
export async function saveProfileTrusted(uid: string, profile: PlayerProfile): Promise<PlayerProfile> {
  await pool.query(
    `insert into profiles (uid, data, updated_at) values ($1, $2, now())
     on conflict (uid) do update set data = excluded.data, updated_at = now()`,
    [uid, JSON.stringify(profile)],
  );
  return profile;
}

/**
 * `PUT /profile` 전용 — 클라이언트가 프로필 전체를 통째로 올린다(upsert).
 *
 * **`grain`·`grainAt`은 안 믿는다** (H3d). 시간 충전의 유일한 정본은 `getProfile()`의
 * 서버 시계 정산이고, 전투 보상의 유일한 정본은 `saveProfileTrusted()`로 오는 서버
 * 계산이다 — 그 둘을 거치지 않고 `PUT`으로 들어오는 `grain`은 클라이언트의 주장일
 * 뿐이라 조용히 버리고 **서버가 이미 갖고 있는 값을 그대로 지킨다.** 지킬 기존 행이
 * 없는 경우(로그인 뒤 로컬 캐시를 처음 올리는 「1회 이전」)에는 지킬 정본이 없으므로
 * 클라이언트 값을 그대로 받는다 — 그 경계 자체가 이미 `loadProfile()`의 1회 이전과
 * 같은 신뢰 수준이다.
 */
export async function saveProfile(uid: string, raw: unknown): Promise<PlayerProfile | null> {
  const incoming = migrateProfile(raw);
  if (!incoming) return null;
  const current = await getProfile(uid);
  const next = current ? { ...incoming, grain: current.grain, grainAt: current.grainAt } : incoming;
  return saveProfileTrusted(uid, next);
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
