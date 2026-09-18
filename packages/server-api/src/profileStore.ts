/**
 * `profiles` 테이블 CRUD. uid 당 한 행, `PlayerProfile` 전체가 JSONB 한 칼럼이다.
 *
 * **판정은 여기 없다** — `migrateProfile()`(`@samchess/meta`)이 형식을 검증·되접고,
 * 이 파일은 읽고 쓰는 일만 한다. `client/src/meta/storage.ts`와 같은 규약이다
 * (되접기는 meta에, 저장 층에는 I/O만).
 */
import { pool } from './db.ts';
import {
  addCard, applyBuild, applyBuyMaterials, applyCancelForgeOrder, applyCityUpgrade, applyHeal, applyInjuries,
  applyLevelUp, applyRecycle, applyRenameCity, applyRespec, applyStartForgeOrder, buyGacha,
  declineMatch, guardServerOwned, migrateProfile, refundGrain, spendGrain, syncCity,
} from '@samchess/meta';
import type { GachaPullKind, PlayerProfile, RecycleInputs, StatPick } from '@samchess/meta';
import type { BattleMode, OfficerId } from '@samchess/rules';
import type { BuildingId } from '@samchess/data';

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
  return mutateProfile(uid, (current) => ({ next: current, value: current }));
}

/**
 * 한 계정 행의 **「읽고 → 고치고 → 쓰기」를 행 잠금 안에서** 한다 (2026-09-14).
 *
 * ★ 이 자리가 없을 때 `smoke:meta`가 2026-09-04부터 「거절 군량이 server-api에 안
 * 남았다」에서 멈춰 있었다. 화면이 [다시 찾기]를 누르면 **같은 순간에** 둘이 나간다 —
 * 로컬 계산을 올리는 `PUT /profile`과, 대기열이 부르는 `POST /internal/grain`. 둘 다
 * 행을 읽고 고쳐서 통째로 쓰므로, `PUT`이 군량 4를 읽은 뒤 거절이 3을 쓰고 `PUT`이
 * 제가 읽은 4를 **되써** 거절이 사라졌다(`guardServerOwned`는 「읽은 서버 값」을 지킬
 * 뿐이라 그 사이의 쓰기를 모른다). 거절만이 아니다 — 자재·대장간 주문·전투 보상도
 * 겹치는 `PUT` 하나에 똑같이 삼켜질 수 있었고, **화면에는 「가끔 값이 되돌아간다」로만
 * 보인다.** 그래서 쓰는 자리 전부가 이 함수 하나를 지난다.
 *
 * `fn`은 순수해야 한다(잠금을 쥔 채 도므로 I/O를 넣지 않는다). 던지면 되감고 그대로
 * 올린다. `next`가 읽은 행과 같으면 쓰지 않는다 — 읽기(`getProfile`)도 여기를 지나지만
 * 대부분 한 줄 읽고 끝난다. 트랜잭션 풀러(6543)에서도 `begin`~`commit`은 한 연결에
 * 묶이므로 그대로 선다.
 */
export async function mutateProfile<T>(
  uid: string,
  fn: (current: PlayerProfile | null) => { next: PlayerProfile | null; value: T },
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query<{ data: unknown }>('select data from profiles where uid = $1 for update', [uid]);
    const row = r.rows[0];
    const migrated = row ? migrateProfile(row.data) : null;
    const current = migrated ? syncCity(migrated, Date.now()) : null;
    const { next, value } = fn(current);
    if (next && (!row || JSON.stringify(next) !== JSON.stringify(row.data))) {
      await client.query(
        `insert into profiles (uid, data, updated_at) values ($1, $2, now())
         on conflict (uid) do update set data = excluded.data, updated_at = now()`,
        [uid, JSON.stringify(next)],
      );
    }
    await client.query('commit');
    return value;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 서버가 **이미 직접 계산한** 프로필을 잠금 없이 그대로 덮어쓴다 — **스모크·도구 전용**이다.
 * 제품 경로는 전부 `mutateProfile()`을 지난다(읽은 것 위에서 고쳐야 겹친 쓰기를 안 삼킨다).
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
  return mutateProfile(uid, (current) => {
    const next = current ? guardServerOwned(incoming, current) : incoming;
    return { next, value: next };
  });
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
  return mutateProfile(uid, (profile) => {
    if (!profile) return { next: null, value: null };
    const next = action === 'spend' ? spendGrain(profile, mode)
      : action === 'decline' ? declineMatch(profile, mode)
      : refundGrain(profile, mode);
    return { next, value: next };
  });
}

// ── 도시 행위 (2026-09-04) ─────────────────────────────────────
//
// **`PUT`이 버리는 필드마다 전용 경로가 있어야 한다.** 버리기만 하고 경로를 안
// 만들면 「증축했는데 자재만 줄고 레벨은 그대로」처럼 조용히 삼킨다 — 무승부
// 군량 택1이 `/battle/draw-result`를 새로 만든 것과 같은 자리다(H3d).
//
// 셋 다 같은 모양이다: **서버가 DB에서 읽은 프로필**에 `@samchess/meta`의 순수
// 함수를 적용할 뿐이고, 클라이언트가 보내는 것은 「무엇을」뿐이다. 시각은 서버가
// 넣는다 — 클라이언트 시계로 군량·치료 시간을 흔들 수 없다.

export type CityAction =
  | { kind: 'upgrade' }
  | { kind: 'build'; building: BuildingId }
  | { kind: 'heal'; officer: OfficerId }
  // **장터에서 부르지만 여기 있다** — 바꾸는 것이 `materials`(서버 소유 필드)라
  // 같은 기계를 그대로 탄다. 금화(`gold`)는 서버 소유가 아니지만, 자재를 늘리는
  // 쪽이 서버라 **내는 쪽도 같은 자리에서 함께** 깎아야 어긋나지 않는다
  | { kind: 'buyMaterials' };

/** 규칙이 거부하면 그 이유를 그대로 올린다 — 「왜 안 되는지 말한다」가 API에도 선다 */
export type CityActionResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; status: number; reason: string };

export async function applyCityAction(uid: string, action: CityAction): Promise<CityActionResult> {
  const now = Date.now();
  return mutateProfile<CityActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      const next = action.kind === 'upgrade' ? applyCityUpgrade(profile, now)
        : action.kind === 'build' ? applyBuild(profile, action.building, now)
        : action.kind === 'buyMaterials' ? applyBuyMaterials(profile, now)
        : applyHeal(profile, action.officer, now);
      return { next, value: { ok: true, profile: next } };
    } catch (e) {
      // `canUpgradeCity`·`canBuild`·`canHeal`이 던진 사람 말이다. 400으로 그대로 돌린다
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid action' } };
    }
  });
}

// ── 대장간 (2026-09-09) ────────────────────────────────────────
//
// 금화(클라이언트 소유)를 내고 아이템(서버 소유 `forgeOrder`/`forgeOwned`의 키)을
// 받는 거래라 `/city/*`·`/market/materials`와 같은 기계를 탄다 — 로컬로 계산해
// `PUT`으로 올리면 `forgeOrder`가 조용히 삼켜지고 금화만 준다(§5-54와 같은 결).

export type ForgeAction = { kind: 'start'; equipmentId: string } | { kind: 'cancel' };

export async function applyForgeAction(uid: string, action: ForgeAction): Promise<CityActionResult> {
  const now = Date.now();
  return mutateProfile<CityActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      const next = action.kind === 'start'
        ? applyStartForgeOrder(profile, action.equipmentId, now)
        : applyCancelForgeOrder(profile);
      return { next, value: { ok: true, profile: next } };
    } catch (e) {
      // `canStartForgeOrder`·`canCancelForgeOrder`가 던진 사람 말이다. 400으로 그대로 돌린다
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid action' } };
    }
  });
}

// ── 계정 거래 — 가챠 · 도시 이름 · 재설계 · 개발용 지급 (2026-09-14, A1) ─────
//
// **`gold`·`gachaPool`이 서버 소유가 되었다**(`meta/authority.ts`). 그전에는 셋 다
// 로컬로 계산해 `PUT`으로 올렸고, API를 직접 부르면 금화를 마음대로 적을 수 있었다.
// 모양은 도시 행위와 같다 — 서버가 잠근 행 위에서 meta의 순수 함수를 부르고,
// 클라이언트는 「무엇을」만 보낸다. 규칙이 거부하면 그 말을 그대로 올린다.

export type GachaPullOutcome =
  | { ok: true; profile: PlayerProfile; drawn: OfficerId[]; exhausted: boolean }
  | { ok: false; status: number; reason: string };

/** `seed`는 라우트가 넣는다 — 이 계정의 **첫** 가챠에서만 쓰인다(`drawGacha()` 머리말) */
export async function pullGacha(uid: string, kind: GachaPullKind, seed: number): Promise<GachaPullOutcome> {
  return mutateProfile<GachaPullOutcome>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      const r = buyGacha(profile, kind, seed);
      return { next: r.profile, value: { ok: true, profile: r.profile, drawn: r.drawn, exhausted: r.exhausted } };
    } catch (e) {
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid pull' } };
    }
  });
}

export type AccountAction =
  | { kind: 'rename'; name: string }
  | { kind: 'respec'; officer: OfficerId }
  /** 레벨업 (A2) — 능력 하나 · 학파 하나. 도시 레벨 상한도 `canLevelUp()`이 여기서 본다 */
  | { kind: 'levelUp'; officer: OfficerId; stat: StatPick; school: 'support' | 'illusion' }
  /** 카드 정리 (A2) — 받을 장수와 재료 수. 3:1 · 2장 이상만 재료는 `canRecycle()`이 본다 */
  | { kind: 'recycle'; target: OfficerId; inputs: RecycleInputs }
  /** 개발용 — 라우트가 `SAMCHESS_DEV_GRANTS=1`일 때만 부른다. 값의 범위도 라우트가 본다.
      `injure`는 병원 시험용 강제 부상(2026-09-18) — 전투의 퇴각과 같은 `applyInjuries()`를 서버 시계로 */
  | { kind: 'devGrant'; gold: number; officer: OfficerId | null; cards: number; injure: OfficerId[] };

export async function applyAccountAction(uid: string, action: AccountAction): Promise<CityActionResult> {
  const now = Date.now();
  return mutateProfile<CityActionResult>(uid, (profile) => {
    if (!profile) return { next: null, value: { ok: false, status: 404, reason: 'no profile' } };
    try {
      let next: PlayerProfile;
      if (action.kind === 'rename') next = applyRenameCity(profile, action.name, now);
      else if (action.kind === 'respec') next = applyRespec(profile, action.officer);
      else if (action.kind === 'levelUp') next = applyLevelUp(profile, action.officer, action.stat, action.school);
      else if (action.kind === 'recycle') next = applyRecycle(profile, action.target, action.inputs);
      else {
        next = { ...profile, gold: profile.gold + action.gold };
        if (action.officer && action.cards > 0) next = addCard(next, action.officer, action.cards);
        if (action.injure.length > 0) next = applyInjuries(next, action.injure, now);
      }
      return { next, value: { ok: true, profile: next } };
    } catch (e) {
      // `canRenameCity`·`canRespec`이 던진 사람 말이다. 400으로 그대로 돌린다
      return { next: null, value: { ok: false, status: 400, reason: e instanceof Error ? e.message : 'invalid action' } };
    }
  });
}

/** 스모크·테스트 정리용. 정상 경로에서는 `auth.users`가 지워지면 cascade로 함께 지워진다 */
export async function deleteProfile(uid: string): Promise<void> {
  await pool.query('delete from profiles where uid = $1', [uid]);
}
