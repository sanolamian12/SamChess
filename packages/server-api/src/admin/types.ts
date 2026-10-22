/**
 * 관리자 API의 응답 모양 — **관리자 화면(SamChessAdmin)이 `import type`으로 직접 읽는 계약이다** (2026-10-20).
 *
 * 화면은 별도 저장소라 예전에는 이 모양을 손으로 옮겨 적었고, 조용히 낡았다(`marketTaken` · `squadSeq`가 빠져 있었다).
 * 이제 여기를 고치면 화면의 `npm run typecheck`가 바로 깨진다.
 *
 * **이 파일은 타입만 둔다** — 값을 들이면(`pg` · `process.env` …) 브라우저 쪽 타입 검사에 서버 코드가 딸려 간다.
 * `@samchess/*`에서 가져오는 것도 전부 `import type`이다.
 *
 * **화면이 실행 중에 써야 하는 상수**(정지 「영구」 · 우편 기한 · 우편 언어 …)는 값이 아니라 **리터럴 타입**으로 내보낸다 —
 * 화면이 같은 값을 적고 `satisfies`로 이 타입에 묶어, 본체가 값을 바꾸면 화면의 typecheck가 깨진다(2026-10-22).
 * 리터럴이 될 수 없는 값(엑셀에서 오는 분 · 계정마다 다른 마감)은 응답에 **시각으로** 싣는다(`UserDetail.autoResolveAt`).
 */
import type {
  BUILDINGS, CITY_LEVELS, COLLECTIONS, ECONOMY, EQUIPMENT, MARKET_ITEMS, OFFICERS, TACTIC_UPGRADES, TACTICS, UNIQUE_SKILLS,
} from '@samchess/data';
import type {
  Adjustment, AdminPermission, AdminRole, BAN_DAYS_MAX, CS_BAN_DAYS_MAX, CarriedBattle, CsCheck, CsLimitKind, CsUsage, MAIL_LANGS,
  MAIL_LIMITS, MAIL_TTL_DAYS, Mail, MailDraft, MailLang, MailReward, MailText, PlayerProfile, Resolution,
} from '@samchess/meta';

export type {
  Adjustment, AdminPermission, AdminRole, CarriedBattle, CsLimitKind, CsUsage, Mail, MailDraft, MailLang, MailReward, MailText, PlayerProfile,
  Resolution,
};

/** 한 번에 걸 수 있는 가장 긴 정지(일) = 화면의 「영구」 — 리터럴 `36500` */
export type BanDaysMax = typeof BAN_DAYS_MAX;
/** CS가 걸 수 있는 가장 긴 정지(일) — 이보다 길면 `ban.long` */
export type CsBanDaysMax = typeof CS_BAN_DAYS_MAX;

/**
 * 감사 로그 `action`의 전부 — 쓰는 길 넷(조정 · 정리 / 정지 · 해제 / 우편 보내기 / 우편 회수)이 적는 이름이다.
 * 서버의 `insertAudit()`이 이 타입만 받으므로 새 이름을 적으려면 여기가 먼저 늘고, 화면의 `Record<AdminAuditAction, …>`가 깨진다.
 * 조정 · 정리는 `Adjustment` · `Resolution`의 `kind`에서 나오므로 그 종류가 늘어도 함께 는다.
 */
export type AdminAuditAction =
  | `adjust.${Adjustment['kind']}`
  | `resolve.${Resolution['kind']}`
  | 'ban' | 'unban'
  | 'mail.send' | 'mail.revoke';

/** 거르기의 묶음 — 서버가 `adjust`를 `adjust.*`로 넓힌다 */
export type AdminAuditActionGroup = AdminAuditAction extends infer A ? (A extends `${infer G}.${string}` ? G : never) : never;

/** 관리자 API를 부른 사람 — 역할은 `admin` · `cs`(2026-10-21c) */
export interface AdminUser {
  uid: string;
  email: string;
  role: AdminRole;
}

/**
 * `GET /admin/me` — 화면은 `permissions`로 단추를 감추거나 잠근다(**막는 것은 서버다**).
 * `cs`는 주는 양에 상한이 걸리는 역할일 때만 — 한 번 상한 · 하루 상한 · 오늘(KST) 이미 준 양(지급 + 우편 보상).
 */
export interface AdminMe extends AdminUser {
  permissions: AdminPermission[];
  cs: { once: CsUsage; daily: CsUsage; used: CsUsage; banDaysMax: CsBanDaysMax } | null;
}

/**
 * 역할로 막힌 403 — 역할 자체가 없는 `forbidden`과 다르다(세션은 그대로, 「이 일은 관리자에게」).
 * `message`는 서버가 지은 사람 말이다(화면은 그대로 띄운다).
 */
export interface RoleForbiddenError {
  error: 'role_forbidden';
  need: AdminPermission;
  message: string;
}

/** CS 상한을 넘은 403 — `scope`가 `once`면 한 번 상한, `daily`면 오늘 합계. `used`는 이번 것을 뺀 오늘 양 */
export type CsLimitError = { error: 'cs_limit' } & Omit<Extract<CsCheck, { ok: false }>, 'ok'>;

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

/**
 * `GET /admin/stats/trend?days=30`(7 ~ 90) — 시험 계정 제외, 하루는 KST. 일별 접속자는 기록이 없어 못 센다 —
 * 대신 대전 이력(계정당 최근 200판)으로 대전 수와 그날 대전한 계정 수를 준다.
 */
export interface Trend {
  /** 오래된 날부터, 빈 날도 0으로 */
  days: { day: string; signups: number; battles: number; ai: number; online: number; players: number }[];
  /** 지금의 도시 레벨 분포 */
  levels: { level: number; count: number }[];
  /** 마지막 로그인이 — 하루 안 · 1~7일 · 7~30일 · 30일 넘게 · 한 번도 없음 */
  lastSignIn: { today: number; week: number; month: number; older: number; never: number };
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
  /**
   * 손대지 않으면 서버가 저절로 정산하는 시각(ms) — 정리 경고의 「그냥 두면 ○시에 같은 처리가 된다」. 정산과 같은 함수가 낸다
   * (`aiAbandonAt` · `raidAutoSurrenderAt`). 화면이 「60분 · 10분」을 다시 적지 않게 — 도적떼 응전 시간은 엑셀 값에 컬렉션이
   * 더해져 계정마다 다르고, 분은 엑셀에서 와서 리터럴 타입이 될 수 없다. 그 상태가 아니면 `null`.
   */
  autoResolveAt: { aiBattle: number | null; raid: number | null };
}

/**
 * `POST /admin/users/:uid/adjust` — 본문은 `Adjustment & { reason: string }`. 주는 쪽이면 `grant`, 거두는 쪽이면 `revoke` 권한
 *   (CS는 `RoleForbiddenError`), CS가 상한을 넘으면 `CsLimitError`
 * `POST /admin/users/:uid/resolve` — 본문은 `Resolution & { reason: string }` (멈춘 상태 지금 정리)
 */
export interface AdjustResponse {
  profile: PlayerProfile;
  auditId: number;
}

/**
 * `POST /admin/users/:uid/ban` — 본문 `{ days, reason }`(`days` 1 ~ `BanDaysMax`, 그 끝이 화면의 「영구」). CS는 `CS_BAN_DAYS_MAX`일까지
 * `POST /admin/users/:uid/unban` — 본문 `{ reason }`
 */
export interface BanResponse {
  /** 해제면 `null` */
  bannedUntil: string | null;
  auditId: number;
}

/**
 * `GET /admin/audit` 의 `rows[]` — `action`은 `AdminAuditAction`.
 * 거르기는 `AuditQuery`(쿼리 문자열), 최신부터 한 쪽에 `limit`(기본 50)개.
 */
export interface AuditQuery {
  target?: string;
  /** 관리자 이메일 — 정확히 같은 것(`GET /admin/audit/admins`에서 고른다) */
  admin?: string;
  /** `ban` · `adjust.gold`처럼 하나, 또는 `adjust` · `resolve`처럼 묶음 */
  action?: AdminAuditAction | AdminAuditActionGroup;
  /** 그 자격으로 한 것만 */
  role?: AdminRole;
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
  /** 그때의 자격 — 역할 나누기(2026-10-21c) 전의 줄은 전부 `admin` */
  adminRole: AdminRole;
  targetUid: string | null;
  targetCity: string | null;
  /** DB 칸은 `text`라 이 화면보다 새 서버가 적은 이름이 올 수도 있다 — 화면은 모르는 이름이면 원문을 띄운다 */
  action: AdminAuditAction;
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

// ── 우편 (2026-10-21) — 모양 · 검사는 `@samchess/meta`의 `mail.ts`(본체의 계약). 여기는 관리자 쪽 응답만 ──

/**
 * 화면이 실행 중에 쓰는 우편 상수의 **타입** — 값은 화면이 적고 `satisfies`로 이 타입에 묶는다.
 * 리터럴 타입이라 본체가 언어를 더하거나 상한을 바꾸면 화면의 typecheck가 깨진다(화면은 값을 들이지 않는다).
 */
export type MailLangs = typeof MAIL_LANGS;
export type MailLimits = typeof MAIL_LIMITS;
/** 받을 수 있는 기한(일) — 리터럴 `30`. 기한 자체는 서버가 `MAIL_TTL_MS`로 적고 화면은 문장에만 쓴다 */
export type MailTtlDays = typeof MAIL_TTL_DAYS;

/** 목록 거르기 — 살아 있음(회수 안 됨 · 기한 전) · 기한 지남 · 회수됨 */
export type MailStatus = 'live' | 'expired' | 'revoked';

/** `GET /admin/mail`의 쿼리 */
export interface MailQuery {
  status?: MailStatus;
  /** 그 계정에게 보낸 것만(전체 우편은 빠진다) */
  target?: string;
  /** 다음 쪽 — 이 번호보다 오래된 것 */
  before?: number;
}

/** `GET /admin/mail`의 `rows[]` — 우편 한 통 + 보낸 사람 · 받는 사람 · 읽은/받은 수 */
export interface AdminMail extends Mail {
  /** 보낸 관리자 이메일 */
  sentBy: string;
  /** 한 사람 우편이면 그 계정(지워졌으면 `null`), 전체면 `null` */
  targetEmail: string | null;
  targetCity: string | null;
  /**
   * 읽은 · 받은 계정 수 — **기한 전에만** 센다(계정의 `mailbox` 줄은 기한이 지나면 걷혀 셀 수 없다 → `null`).
   * 읽은 수는 받은 수를 품는다(받으면 읽은 것이다). 회수된 우편도 기한 전이면 센다(이미 받은 것은 그대로라서).
   */
  readCount: number | null;
  claimedCount: number | null;
}

export interface MailListResponse {
  rows: AdminMail[];
}

/**
 * `GET /admin/mail/audience` — 지금 전체 우편을 보내면 받을 수 있는 계정 수. 보낸 뒤 가입한 계정은 못 받으므로
 * 이것이 최대 인원이다. 시험 계정(@samchess.test)도 받으므로 따로 센다.
 */
export interface MailAudience {
  accounts: number;
  testAccounts: number;
}

/**
 * `POST /admin/mail`(본문 = `MailDraft` + `reason`) · `POST /admin/mail/:id/revoke`(본문 = `reason`)의 응답.
 * 회수는 「아직 안 받은 사람에게서 감춘다」 — **이미 받은 보상은 계정에서 거두지 않는다**(거둘 일은 지급 · 회수로 따로).
 */
export interface MailResponse {
  mail: AdminMail;
  auditId: number;
}
