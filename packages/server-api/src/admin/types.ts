/**
 * 관리자 API의 응답 모양 — **관리자 화면(SamChessAdmin)이 `import type`으로 직접 읽는 계약이다** (2026-10-20).
 *
 * 화면은 별도 저장소라 예전에는 이 모양을 손으로 옮겨 적었고, 조용히 낡았다(`marketTaken` · `squadSeq`가 빠져 있었다).
 * 이제 여기를 고치면 화면의 `npm run typecheck`가 바로 깨진다.
 *
 * **이 파일은 타입만 둔다** — 값을 들이면(`pg` · `process.env` …) 브라우저 쪽 타입 검사에 서버 코드가 딸려 간다.
 * `@samchess/*`에서 가져오는 것도 전부 `import type`이다.
 */
import type {
  BUILDINGS, CITY_LEVELS, COLLECTIONS, ECONOMY, EQUIPMENT, MARKET_ITEMS, OFFICERS, TACTIC_UPGRADES, TACTICS, UNIQUE_SKILLS,
} from '@samchess/data';
import type { Adjustment, PlayerProfile, Resolution } from '@samchess/meta';

export type { Adjustment, PlayerProfile, Resolution };

/** `GET /admin/me` */
export interface AdminUser {
  uid: string;
  email: string;
}

/** `GET /admin/stats` */
export interface Stats {
  accounts: number;
  testAccounts: number;
  profiles: number;
  signups7d: number;
  active24h: number;
  active7d: number;
  /** 시험 계정을 뺀 합 */
  totals: { gold: number; grain: number; materials: number };
}

/** `GET /admin/users` 의 `rows[]` */
export interface UserRow {
  uid: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  isTest: boolean;
  /** 아직 도시를 안 만들었으면(가입만 했으면) `null` */
  cityName: string | null;
  cityLevel: number | null;
  gold: number | null;
  updatedAt: string | null;
}

/** `GET /admin/users` 의 쿼리 문자열 — 전부 생략할 수 있다(최근 가입 순 50명) */
export interface UsersQuery {
  /** 이메일 · 도시 이름 일부, 또는 uid */
  q?: string;
  /** `1`이면 시험 계정(@samchess.test)도 */
  test?: '1';
  /** `banned` 지금 정지 중 · `noCity` 도시를 안 만듦 · `dormant` 30일 넘게 로그인 안 함 */
  filter?: 'banned' | 'noCity' | 'dormant';
  /** 기본 `created` — 값이 없는 줄(도시 없음 · 로그인 없음)은 방향과 상관없이 뒤로 */
  sort?: 'created' | 'lastSignIn' | 'updated' | 'level' | 'gold';
  /** 기본 `desc` */
  dir?: 'asc' | 'desc';
  /** 기본 50, 최대 200 */
  limit?: number;
  offset?: number;
}

/** `GET /admin/users` */
export interface UsersResponse {
  rows: UserRow[];
  /** 거른 전체 수 — 쪽 나누기용 */
  total: number;
}

/** `GET /admin/users/:uid` */
export interface UserDetail {
  uid: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  /** 지금 정지 중일 때만 — 관리자가 적은 사유(`app_metadata.ban.reason`) */
  banReason: string | null;
  isTest: boolean;
  profileUpdatedAt: string | null;
  /** 서버 시계로 정산한 값. 도시를 안 만들었으면 `null` */
  profile: PlayerProfile | null;
  /**
   * 지금 부상인 장수 — 서버가 `isInjured`로 가른 것. `roster`의 `injuredAt`은 나은 뒤에도 잠시 남아 있어(`syncCity`가
   * 늦게 지운다) 필드만 보면 틀린다. 화면이 회복 규칙을 다시 짓지 않게 여기서 준다.
   */
  injuries: { officer: string; healsAt: number; healing: boolean }[];
}

/**
 * `POST /admin/users/:uid/adjust` — 본문은 `Adjustment & { reason: string }`
 * `POST /admin/users/:uid/resolve` — 본문은 `Resolution & { reason: string }` (멈춘 상태 지금 정리)
 */
export interface AdjustResponse {
  profile: PlayerProfile;
  auditId: number;
}

/**
 * `POST /admin/users/:uid/ban` — 본문 `{ days, reason }`(`days` 1 ~ 36500, 36500은 화면의 「영구」)
 * `POST /admin/users/:uid/unban` — 본문 `{ reason }`
 */
export interface BanResponse {
  /** 해제면 `null` */
  bannedUntil: string | null;
  auditId: number;
}

/**
 * `GET /admin/audit` 의 `rows[]` — `action`은 `adjust.<kind>` · `resolve.<kind>` · `ban` · `unban`.
 * 거르기는 `AuditQuery`(쿼리 문자열), 최신부터 한 쪽에 `limit`(기본 50)개.
 */
export interface AuditQuery {
  target?: string;
  /** 관리자 이메일 — 정확히 같은 것(`GET /admin/audit/admins`에서 고른다) */
  admin?: string;
  /** `ban` · `adjust.gold`처럼 하나, 또는 `adjust` · `resolve`처럼 묶음 */
  action?: string;
  /** ISO 꼴(`2026-10-21T00:00:00.000Z`)만 — `from` 이상 `to` 미만 */
  from?: string;
  to?: string;
  /** 이 id보다 오래된 것(다음 쪽) */
  before?: number;
}

/** `GET /admin/audit/admins` — 감사 로그에 나온 관리자 이메일(거르기 목록) */
export interface AuditAdminsResponse {
  admins: string[];
}

export interface AuditRow {
  id: number;
  at: string;
  adminEmail: string;
  targetUid: string | null;
  targetCity: string | null;
  action: string;
  params: unknown;
  reason: string;
  before: unknown;
  after: unknown;
}

/** `GET /admin/gamedata` — `@samchess/data`를 그대로 싣는다(`academyTopics`만 Map → 객체) */
export interface AdminGameData {
  officers: typeof OFFICERS;
  uniqueSkills: typeof UNIQUE_SKILLS;
  tactics: typeof TACTICS;
  tacticUpgrades: typeof TACTIC_UPGRADES;
  /** 태학 레벨 → 책략 id 목록 */
  academyTopics: Record<string, readonly string[]>;
  equipment: typeof EQUIPMENT;
  marketItems: typeof MARKET_ITEMS;
  collections: typeof COLLECTIONS;
  buildings: typeof BUILDINGS;
  cityLevels: typeof CITY_LEVELS;
  economy: typeof ECONOMY;
}
