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
import type { BattleMode, BattlePhase, OfficerId } from '@samchess/rules';
import type {
  ADJUST_BATCH_MAX, Adjustment, AdminPermission, UpgradeCheck, AdminPlayStatus, AdminRole, BAN_DAYS_MAX, CITY_NAME_MAX, CS_BAN_DAYS_MAX, CarriedBattle, CsCheck, CsLimitKind, CsUsage, DefenseResult, FAN_OFFICER_SEATS, MAIL_LANGS,
  LiveRoomSeat, MAIL_LIMITS, MAIL_TTL_DAYS, Mail, MailDraft, MailLang, MailReward, MailText, PlayerProfile, Resolution,
} from '@samchess/meta';

export type {
  Adjustment, AdminPermission, AdminPlayStatus, AdminRole, BattleMode, CarriedBattle, DefenseResult, CsLimitKind, CsUsage, Mail, MailDraft, MailLang, MailReward, MailText, PlayerProfile,
  Resolution,
};
// 이상 징후의 이름표 — 화면이 `Record<…>`로 묶는다(2026-11-12)
export type { InvariantCode, LedgerGroup } from '@samchess/meta';

/** 한 번에 걸 수 있는 가장 긴 정지(일) = 화면의 「영구」 — 리터럴 `36500` */
export type BanDaysMax = typeof BAN_DAYS_MAX;
/** CS가 걸 수 있는 가장 긴 정지(일) — 이보다 길면 `ban.long` */
export type CsBanDaysMax = typeof CS_BAN_DAYS_MAX;
/** 일괄 지급 한 번의 줄 수 상한 — 리터럴 `50`(2026-11-13). 화면이 같은 값을 적고 `satisfies`로 묶는다 */
export type AdjustBatchMax = typeof ADJUST_BATCH_MAX;
/** 도시 이름 최대 길이 — 게임의 이름 변경과 같은 값(리터럴 `12`) */
export type CityNameMax = typeof CITY_NAME_MAX;
/**
 * 팬 장수를 신청할 수 있는 앞선 사람 수 — 리터럴 `100` (2026-11-12, meta `milestone.ts`). 260명 달성의 순번(`PlayerProfile.milestones`)이
 * 이 안이면 신청 자격이다. 화면이 같은 값을 적고 `satisfies`로 묶는다
 */
export type FanOfficerSeats = typeof FAN_OFFICER_SEATS;

/**
 * 감사 로그 `action`의 전부 — 쓰는 길 다섯(조정 · 정리 / 정지 · 해제 / 우편 보내기 / 우편 회수 / 도시 이름)이 적는 이름이다.
 * 서버의 `insertAudit()`이 이 타입만 받으므로 새 이름을 적으려면 여기가 먼저 늘고, 화면의 `Record<AdminAuditAction, …>`가 깨진다.
 * 조정 · 정리는 `Adjustment` · `Resolution`의 `kind`에서 나오므로 그 종류가 늘어도 함께 는다.
 */
export type AdminAuditAction =
  | `adjust.${Adjustment['kind']}`
  /** 일괄 지급(2026-11-13) — `params: { adjustments: Adjustment[] }`, 주는 쪽만 */
  | 'adjust.batch'
  | `resolve.${Resolution['kind']}`
  | 'ban' | 'unban'
  | 'mail.send' | 'mail.revoke'
  | 'city.rename'
  | 'anomaly.resolve'
  | 'account.delete';

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
  /** 열린 이상 징후 — 시험 계정 제외(2026-11-12) */
  openAnomalies: number;
}

/**
 * `GET /admin/stats/trend?days=30`(7 ~ 90) — 시험 계정 제외, 하루는 KST. 대전 수와 그날 대전한 계정 수는 대전 이력(계정당 최근 200판)에서,
 * **일별 접속자(`actives`)는 게임 API의 접속 기록(`daily_active`, 2026-10-22~)**에서 센다.
 */
export interface Trend {
  /**
   * 오래된 날부터, 빈 날도 0으로. `actives` = 그날 게임 API가 그 계정을 한 번이라도 읽은 계정 수.
   * `siege` · `field` = 공성전 · 야전(2026-10-28 — 예전 `ai` · `online`. **순수 AI 대전은 이제 이력에 안 남아 안 센다**)
   */
  days: { day: string; signups: number; battles: number; siege: number; field: number; players: number; actives: number }[];
  /** 접속 기록이 시작된 날(`YYYY-MM-DD`, 시험 계정 포함 가장 이른 줄) — 그 전 날의 `actives` 0은 「없었다」가 아니라 「안 적었다」다. 아직 없으면 `null` */
  activeSince: string | null;
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
  /**
   * 진행 상태 — 출정 막힘 · 튜토리얼 · 수비군(2026-10-31). 게임과 같은 함수(`sortieGate` …)가 낸 값이라 화면이 규칙을 다시 짓지 않는다.
   * 도시를 안 만들었으면 `null`
   */
  play: AdminPlayStatus | null;
  /**
   * 공성전 상대로 서는 수비군 스냅샷(`defenses` 표) — 계정을 쓸 때마다 서버가 맞춘다. 모드마다 한 줄, 수비군이 없는 모드는 빠진다.
   * `power`는 공성전 목록 · 매칭이 쓰는 값이다
   */
  defenseSnapshots: { mode: BattleMode; squadName: string; power: number; updatedAt: string }[];
  /**
   * 누적 결제(2026-11-13) — **결제 연동 전이라 언제나 `null`**이다(결제 기록 표가 아직 없다, `history/2026-09-25_현금결제연동_1차검토.md`).
   * 화면은 `null`이면 「연동 전」을 띄운다. 결제 주문 표가 생기면 `readUser()` 한 곳에서 채운다.
   */
  payments: AdminPayments | null;
  /**
   * 도시 — 증축 조건 · 남은 건설 기회 · 건물을 짓는 도시 레벨(2026-11-13, 「도시」 탭). 게임과 같은 함수(`upgradeChecklist` · `buildCreditsLeft`)가
   * 낸 값이라 화면이 규칙을 다시 짓지 않는다. 도시를 안 만들었으면 `null`
   */
  city: AdminCityStatus | null;
}

/** `UserDetail.city` */
export interface AdminCityStatus {
  /** 다음 레벨로 가는 조건 — 진짜 최대면 `null`. `checks`의 `kind`는 `emperor` · `credits` · `officers` · `topOfficers` · `materials` */
  upgrade: { from: number; to: number; checks: UpgradeCheck[] } | null;
  /** 남은 건설 기회 — 황궁 레벨이면 `null`(제한 없음) */
  creditsLeft: number | null;
  /** 건물을 짓거나 올릴 수 있는 도시 레벨(`BUILD_CITY_LEVEL`) — 그 아래에서는 관리자도 건물을 못 바꾼다 */
  buildCityLevel: number;
}

/**
 * 한 계정의 누적 결제 — 결제가 **확정되어 금화가 들어간** 주문만, 환불은 뺀다. 금액은 전부 **정수 최소 단위**(원 · 센트).
 *
 * **KRW 환산은 결제 시점에 고정한다** (2026-11-13 기획자 확정) — 주문마다 결제가 확정되는 순간의 KRW 금액(결제사가 준 정산 금액, 없으면
 * 그 순간의 환율)을 함께 적어 두고 그 합을 낸다. 볼 때 오늘 환율로 바꾸지 않는다 — 같은 계정의 숫자가 날마다 흔들리고 매출 · 환불 계산과 어긋난다.
 */
export interface AdminPayments {
  /** KRW 환산 합(원) — 결제 시점에 적어 둔 주문별 KRW 금액의 합, 환불 뺌 */
  krw: number;
  /** 원래 통화별 합 — `currency`는 ISO 4217(`KRW` · `USD` · `AUD` …), `amount`는 그 통화의 최소 단위 */
  byCurrency: { currency: string; amount: number }[];
  /** 확정된 결제 건수(환불된 것 빼고) */
  count: number;
  /** 마지막 결제 시각 — 없으면 `null` */
  lastAt: string | null;
  /** 환불된 KRW 환산 합(원) — `krw`에서 이미 뺀 값 */
  refundedKrw: number;
  /** 결제 내역 — 최근 것부터(「과금」 탭의 표). 확정 · 환불 · 실패를 다 싣는다 */
  recent: AdminPaymentRow[];
}

/** 결제 주문 한 줄 — 「과금」 탭의 표(2026-11-13, 결제 연동 전이라 아직 아무도 채우지 않는다) */
export interface AdminPaymentRow {
  /** 우리 주문 번호 */
  orderId: string;
  /** 주문을 만든 시각 · 결제가 확정된 시각(아직이면 `null`) */
  createdAt: string;
  paidAt: string | null;
  /** 금화 팩 id · 그 팩이 준 금화 */
  pack: string;
  gold: number;
  /** 원래 통화(ISO 4217)와 그 최소 단위 금액 */
  currency: string;
  amount: number;
  /** 결제 시점에 고정한 KRW 금액(원) — 확정 전이면 `null` */
  krw: number | null;
  /** 결제사(`toss` · `xsolla` · `google` · `apple` …)와 그쪽 거래 번호 */
  provider: string;
  providerTxId: string | null;
  status: 'created' | 'paid' | 'granted' | 'refunded' | 'failed';
  /** 환불 시각 · 환불된 KRW — 없으면 `null` */
  refundedAt: string | null;
  refundedKrw: number | null;
  /** 시험 결제(결제사 시험 키) */
  test: boolean;
}

// ── 방어 · 공격 기록 (2026-10-31) — 공성전 한 판이 `defense_log` 한 줄. 게임의 방어 기록 화면과 같은 표 ──

/** 이 계정이 막은 판(`defender`) · 친 판(`attacker`) */
export type DefenseSide = 'defender' | 'attacker';

/** `GET /admin/users/:uid/defenses`의 쿼리 — `side` 기본 `defender`, `before`는 이 id보다 오래된 것(다음 쪽) */
export interface DefenseQuery {
  side?: DefenseSide;
  before?: number;
}

export interface AdminDefenseRow {
  id: number;
  /** 판이 끝난 시각 */
  at: string;
  mode: BattleMode;
  /**
   * **방어자에게서 본** 결말(`defenseResultOf`) — 공격 기록 쪽에서 읽을 때도 그대로다(`fell` = 공격자가 이겼다).
   * `abandoned`는 공격자가 60분 방치했거나 관리자가 정리한 판(방어 승)
   */
  result: DefenseResult;
  defenderUid: string;
  /** 방어자의 **지금** 도시 이름 — 계정이 지워졌으면 행도 없다(`on delete cascade`) */
  defenderCity: string | null;
  /** 공격자가 지워졌으면 `null`(`on delete set null`) — 도시 이름은 그때 적은 것이 남는다 */
  attackerUid: string | null;
  attackerCity: string;
  attackerPower: number;
  defenderPower: number;
  /** 그때 막은 수비군의 이름 */
  defenderSquad: string;
  /** 공격자가 둔 수의 개수 */
  moves: number;
  /**
   * 수성전 판(성채 · 60일 수비 승, 단계 6)이었나 — 방침이 실린 판. 아니면 옛 야전 판.
   * 결말의 이유(왕 격파 · 60일 버팀 …)는 표에 없다 — 게임의 다시 보기로 둔다
   */
  siegeBoard: boolean;
  /** 게임에서 지금 다시 볼 수 있는가 — 규칙 버전이 같을 때만(`replayable`) */
  replayable: boolean;
  /** 방어자가 방어 기록 목록을 연 뒤의 줄인가 */
  seen: boolean;
}

export interface AdminDefenseResponse {
  /** 최신부터 한 쪽 */
  rows: AdminDefenseRow[];
  /** 그 쪽(`side`)의 전부를 결말마다 센 것 — 쪽과 상관없다 */
  summary: Record<DefenseResult, number>;
}

/**
 * `POST /admin/users/:uid/adjust` — 본문은 `Adjustment & { reason: string }`. 주는 쪽이면 `grant`, 거두는 쪽이면 `revoke` 권한
 *   (CS는 `RoleForbiddenError`), CS가 상한을 넘으면 `CsLimitError`
 * `POST /admin/users/:uid/adjust/batch` — 본문은 `AdjustBatchRequest`. **주는 쪽만**(권한 `grant`), 한 트랜잭션 · 감사 로그
 *   `adjust.batch` 한 줄. CS 상한은 줄을 더한 합으로 잰다(2026-11-13, 장수 탭의 「장수 카드 지급」 표)
 * `POST /admin/users/:uid/resolve` — 본문은 `Resolution & { reason: string }` (멈춘 상태 지금 정리)
 */
/** `POST /admin/users/:uid/adjust/batch`의 본문 — 줄은 전부 주는 쪽, 같은 대상은 한 줄 */
export interface AdjustBatchRequest {
  adjustments: Adjustment[];
  reason: string;
}

export interface AdjustResponse {
  profile: PlayerProfile;
  auditId: number;
}

/**
 * `POST /admin/users/:uid/ban` — 본문 `{ days, reason }`(`days` 1 ~ `BanDaysMax`, 그 끝이 화면의 「영구」). CS는 `CS_BAN_DAYS_MAX`일까지
 * `POST /admin/users/:uid/unban` — 본문 `{ reason }`
 */
/**
 * `POST /admin/users/:uid/rename` — 본문 `{ name, reason }`. 권한 `rename`. 이름을 바꾸고 3일 대기를 비우고, 같은 트랜잭션에서
 * 그 계정에 알림 우편(보상 없는 공지, **사유가 그대로 보인다**)을 넣는다. 다른 도시가 쓰는 이름이면 409(대소문자 무시).
 * 감사 로그는 `city.rename` 한 줄(`params: { name, mailId }`) — 따로 `mail.send` 줄을 적지 않는다.
 */
export interface RenameResponse extends AdjustResponse {
  mailId: number;
}

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

// ── 이상 징후 (2026-11-12, 본체 `history/2026-11-12_이상징후_설계.md`) ──────────────────────
//
// 게임 API가 1시간마다 점검(`server-api/src/anomaly.ts`)해 올린 것을 관리자가 보고 처리한다. 자동 정지 · 회수는 없다 —
// 조치는 기존 패널(회수 · 정지)로 하고, 여기서는 「정상」 · 「조치함」으로 닫는다(사유 필수 · 감사 로그 `anomaly.resolve`).

/**
 * 징후의 종류 —
 * `source` 그 길로는 늘 수 없는 값이 늘었다 · `create` 새 계정이 시작 꾸러미와 다르다 · `dev` 운영에서 개발용 지급 ·
 * `outside` 장부 밖에서 바뀌었다(DB 직접 수정 등) · `invariant` 있을 수 없는 상태 · `reject` 수상한 거절이 문턱 이상 ·
 * `market` 시장 아이템 추적표가 걸었다(2026-11-12) — 열쇠 `{gold|noSource|phantom}:{아이템 id}`, 근거 `{ units, route, … }` ·
 * `grant` 지급 대조가 안 맞는다(2026-11-12) — 열쇠 `{missing|mismatch|orphan}:{audit:id|mail:id|ledger:id}`, 근거 `{ ref, kind, label, expected, actual, ledgerIds, at }`
 */
export type AnomalyKind = 'source' | 'create' | 'dev' | 'outside' | 'invariant' | 'reject' | 'market' | 'grant';
export type AnomalyStatus = 'open' | 'ok' | 'fixed';

export interface AdminAnomaly {
  id: number;
  uid: string;
  email: string | null;
  cityName: string | null;
  /** `@samchess.test` 계정 */
  test: boolean;
  kind: AnomalyKind;
  /** 무엇이 — `source`는 `{라우트}:{묶음}`, `invariant`는 `{코드}:{칸}`, `reject`는 거절 코드, 나머지는 종류 이름 */
  key: string;
  /**
   * 근거 — 종류마다 모양이 다르다(서버가 적은 그대로).
   * `source` · `create` · `dev` · `outside`(쓰는 순간): `{ ledgerId, source, phase, delta, unexpected }`,
   * `outside`(점검이 본 것): `{ lastLedgerId, delta }`, `invariant`: `{ code, key, detail?, stored }`, `reject`: `{ count, limit, sources }`
   */
  detail: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
  /** 같은 일로 걸린 횟수 — 열려 있는 동안 점검마다 다시 걸리면 는다 */
  hits: number;
  status: AnomalyStatus;
  resolvedByEmail: string | null;
  resolvedAt: string | null;
  reason: string | null;
}

/** `GET /admin/anomalies`의 쿼리 — `status` 기본 `open`(`all`이면 전부), `test` 기본 거짓(시험 계정 빼기), `before`는 이 id보다 오래된 것 */
export interface AnomalyQuery {
  status?: AnomalyStatus | 'all';
  kind?: AnomalyKind;
  uid?: string;
  test?: boolean;
  before?: number;
}

/** 점검 한 번 */
export interface AnomalyScan {
  startedAt: string;
  finishedAt: string | null;
  accounts: number;
  /** 새로 연 징후 */
  found: number;
  error: string | null;
}

export interface AnomalyListResponse {
  /** 마지막에 본 것부터 한 쪽 */
  rows: AdminAnomaly[];
  /** 열린 징후 — 거르기와 상관없이, 시험 계정 제외 */
  open: number;
  /** 마지막 점검(실패한 것 포함) — 한 번도 안 돌았으면 `null` */
  lastScan: AnomalyScan | null;
}

/** `POST /admin/anomalies/:id/resolve` — 본문 `{ status: 'ok' | 'fixed', reason }`, 권한 `anomaly` */
export interface ResolveAnomalyResponse {
  anomaly: AdminAnomaly;
  auditId: number;
}

/** 변화 장부 한 줄 — 계정 상세의 「변화 내역」 */
export interface AdminLedgerRow {
  id: number;
  at: string;
  /** 어느 길로 — 라우트(`POST /market/gacha`), 요청 밖이면 `tool`, 점검이 적은 기준 줄은 `scan` */
  source: string;
  /** `sync` 읽는 순간의 정산 · `action` 그 요청이 한 일 · `create` 새 계정 · `baseline` 점검 · 쓰기가 적은 기준 */
  phase: 'sync' | 'action' | 'create' | 'baseline';
  /** 바뀐 만큼 — `{ gold: 300, 'cards.jo-un': 2 }` */
  delta: Record<string, number>;
  /** 쓰는 순간의 판정 — 정상이면 `null` */
  unexpected: string[] | null;
  /** 짝 — 관리자 지급이면 `audit:{감사 로그 id}`, 우편 받기면 `mail:{우편 id}`(2026-11-12부터). 화면이 「감사 #n」으로 가리킨다(2026-11-13) */
  ref: string | null;
}

/**
 * 변화 장부 거르기(2026-11-12) — 계정 상세의 「대장간」 · 「상점」 탭이 그 시설의 행동만 본다.
 * `forge` = 대장간 경로(`POST /forge/…`)이거나 병기 칸(`forge.*`)이 바뀐 줄, `market` = 장터 경로(`POST /market/…`)이거나 아이템 칸(`market.*`)이 바뀐 줄
 * (관리자 지급 · 판에서 쓴 아이템도 칸이 바뀌어 함께 걸린다). 없으면 전부.
 */
export type LedgerScope = 'forge' | 'market';

/** `GET /admin/users/:uid/ledger?before=&scope=` — 최신부터 한 쪽 */
export interface LedgerResponse {
  rows: AdminLedgerRow[];
}

// ── 시장 아이템 낱개 추적표 (2026-11-12, `market_items`) ────────────────────────

/** 어디서 왔나 — 구매 · 관리자 지급 · 우편 · 개발용 지급 · 추적표 전부터 있던 것 · 장부 밖 · 그 밖의 길 · 낱개 없이 사용 */
export type MarketUnitOrigin = 'buy' | 'admin' | 'mail' | 'dev' | 'baseline' | 'outside' | 'other' | 'none';
/** 보유 중 · 판에 나가 있음 · 사용(굳음) · 빠짐(컬렉션 등록 · 관리자 회수) */
export type MarketUnitStatus = 'held' | 'inPlay' | 'used' | 'removed';
/** 걸린 것 — 금화가 값만큼 안 줄었다 · 구매 · 지급이 아닌 길로 늘었다 · 가진 것 없이 판에 나갔다 */
export type MarketUnitFlag = 'gold' | 'noSource' | 'phantom';

/**
 * 시장 아이템 **낱개 하나** — 게임은 개수로만 세고, 이 표는 계정을 쓰는 트랜잭션이 쓰기 전 · 후를 견주어 낱개로 적는다(관리자만 본다).
 * 「어느 낱개가 나갔나」는 이 표의 규칙이다 — 판에 나간 것은 그 장수가 들던 낱개, 빠진 것은 아무도 안 든 오래된 것부터.
 */
export interface AdminMarketUnit {
  /** `{아이템 id}#{번호}` — 계정 안에서 고유 */
  unit: string;
  item: string;
  origin: MarketUnitOrigin;
  /** 들어오게 한 요청 경로(`POST /market/items` …) · `baseline` · `outside` · `sync` */
  route: string;
  /** 이 표에 들어온 시각 */
  gotAt: string;
  /** 구매일 — 구매면 산 시각, 처음 본 것이면 계정에 남은 구매 시각(없으면 `null`) */
  boughtAt: string | null;
  /** 구매면 그 낱개를 산 순간의 금화 전 → 후(장바구니는 차례로 뺀다)와 값 */
  goldBefore: number | null;
  goldAfter: number | null;
  price: number | null;
  /** 지금(또는 마지막) 들고 갈 장수 */
  holder: string | null;
  /** 양도일 — 들고 갈 장수가 마지막으로 바뀐 시각(내려놓은 것도) */
  handedAt: string | null;
  status: MarketUnitStatus;
  /** 사용일 · 사용자 — 판에 나간 시각과 든 장수. 판이 무르면 지워진다 */
  usedAt: string | null;
  usedBy: string | null;
  /** 판 종류(`ai` · `online` · `raid`) */
  usedBattle: string | null;
  /** 사용으로 굳은 · 빠진 시각과 경로 */
  endedAt: string | null;
  endRoute: string | null;
  flag: MarketUnitFlag | null;
  /** 지급이면 그 짝 — `audit:{감사 로그 id}` · `mail:{우편 id}`(2026-11-12). 구매 · 그 전의 지급은 `null` */
  ref: string | null;
}

// ── 지급 대조 (2026-11-12) ──────────────────────────────────────────

export type { GrantStatus } from '@samchess/meta';

/**
 * 지급 한 건 — 관리자 지급(감사 로그 `adjust.*`)이나 우편 받기가 **약속한 양**(`expected`)과 같은 쓰기의 장부 줄이 **실제로 바꾼 양**(`actual`).
 * 칸은 장부 칸을 접은 것이다 — `gold` · `grain` · `materials` · `cards.{장수}`(풀에 든 본체도 한 장) · `market.{아이템}` · `forge.{병기}`(자루를 합친 수).
 * `status`: `ok` · `capped`(우편 군량이 창고 상한에 걸려 덜 들어감 — 정상) · `missing`(장부 줄 없음) · `mismatch`(양이 다름) · `orphan`(지급 길의 장부 줄인데 짝 없음) ·
 * `before`(장부가 생기기 전의 지급 — 견줄 수 없다, 징후 아님)
 */
export interface AdminGrantCheck {
  /** `audit:{id}` · `mail:{id}`, 짝 없는 줄은 `null` */
  ref: string | null;
  at: string;
  kind: 'audit' | 'mail';
  /** 감사 로그 이름(`adjust.item`) · 우편 제목 */
  label: string;
  expected: Record<string, number>;
  actual: Record<string, number> | null;
  status: import('@samchess/meta').GrantStatus;
  ledgerIds: number[];
}

/** `GET /admin/users/:uid/grants` — 최근 감사 로그 200건 + 지급 길의 장부 줄, 최근부터 */
export interface GrantsResponse {
  rows: AdminGrantCheck[];
}

/** `GET /admin/users/:uid/market-items` — 살아 있는 것(보유 · 판에 나감)이 먼저, 그다음 끝난 것 최근부터. 최대 500줄 */
export interface MarketUnitsResponse {
  units: AdminMarketUnit[];
  /** 500줄에서 잘렸다 */
  truncated: boolean;
}

// ── 계정 삭제 (2026-11-12) ──────────────────────────────────────────

/**
 * `POST /admin/users/:uid/delete` — 본문 `{ reason, confirm }`, 권한 `delete`(관리자만). `confirm`은 그 계정의 **이메일 그대로**
 * (이메일이 없는 계정은 uid) — 잘못 누른 단추 하나로 계정이 사라지지 않게 서버가 다시 본다.
 * `auth.users` 줄을 지우고(계정의 표는 전부 `on delete cascade` · `set null`) 감사 로그 `account.delete`를 **같은 트랜잭션**에 적는다 —
 * `before`에 지우기 전 계정 전체(`{ email, createdAt, profile }`)가 남아 손으로 되살릴 근거가 된다. 관리자 · CS · 자기 계정은 400.
 */
export interface DeleteAccountResponse {
  auditId: number;
}

// ── 전투 현황 (2026-11-13) ──────────────────────────────────────────

/** 관리자 「전투」의 탭 넷 — 야전(사람 대 사람 · 선전포고 · AI 대전) · 공성전 · 도적떼 · 튜토리얼 */
export type AdminBattleKind = 'field' | 'siege' | 'raid' | 'tutorial';

/** 야전의 갈래 — 대기열에서 붙은 사람 대 사람 · 선전포고 · AI 대전 */
export type AdminFieldVia = 'queue' | 'war' | 'ai';

export interface AdminBattlePlayer {
  uid: string;
  email: string | null;
  cityName: string | null;
  test: boolean;
}

/** 판에 선 한 쪽 — 명단 · 전투력. 사람 대 사람 판이면 접속 · 살아 있는 수까지(대전 서버가 낸 값) */
export interface AdminBattleSide {
  /** 사람이면 그 계정, AI · 도적이면 `null` */
  player: AdminBattlePlayer | null;
  squadName: string | null;
  power: number | null;
  officers: OfficerId[];
  /** 사람 대 사람 판만 — 대전 서버가 낸 것 */
  room?: Pick<LiveRoomSeat, 'connected' | 'alive' | 'total'>;
}

/**
 * 지금 벌어지고 있는 판 하나. **읽기만 한다** — 계정을 정산하지 않는다(방치된 판도 그대로 보이고 `autoEndAt`이 지나 있다).
 * 어디서 읽나: 사람 대 사람은 대전 서버(Colyseus)의 방, AI 대전 · 공성전은 `profiles.data.aiBattle`, 도적떼는 `profiles.data.raid`,
 * 튜토리얼은 접속 핑(`presence.tutorial` — 튜토리얼은 서버에 판이 없다).
 */
export interface AdminLiveBattle {
  kind: AdminBattleKind;
  /** 야전만 — 다른 탭은 `null` */
  via: AdminFieldVia | null;
  /** 줄 열쇠 — 방 id 또는 `{kind}:{uid}` */
  key: string;
  mode: BattleMode | null;
  /** 판이 열린 시각(튜토리얼은 그 판의 첫 핑) */
  startedAt: string | null;
  /** 판을 연 쪽(사람 대 사람이면 남군) */
  attacker: AdminBattleSide;
  /** 상대 — 북군 · AI · 공성전의 수비군. 튜토리얼은 `null` */
  defender: AdminBattleSide | null;
  /** 사람 대 사람 판의 단계(대전 서버) — 나머지는 서버가 판을 돌리지 않아 `null` */
  phase: BattlePhase | null;
  /** 서버에 덧붙여 둔 사람의 수(AI 대전 · 공성전 · 도적떼) */
  moves: number | null;
  /** 손대지 않으면 서버가 패배 · 항복으로 정산하는 시각 — 지났으면 그 계정을 다음에 읽을 때 정산된다(방치) */
  autoEndAt: string | null;
  /** 공성전 — 수비 방침이 실린 수성전 판인가(성채 · 60일 수비 승) */
  siegeFort?: boolean;
  /** 도적떼 — 도적 수 */
  bandits?: number;
  /** 튜토리얼 — 판 id(`basic-1` · `s-{장수 id}` …) */
  tutorial?: string;
  /** 튜토리얼 — 마지막 핑 */
  lastSeen?: string;
}

/** `GET /admin/battles` — 탭 넷의 줄을 한 번에(판 수가 적다). 시험 계정도 싣고 `test`로 가린다 */
export interface AdminBattlesResponse {
  at: string;
  rows: AdminLiveBattle[];
  /** 대전 서버에 닿았나 — 못 닿았으면 사람 대 사람 판(대기열 · 선전포고)이 빠져 있다 */
  rooms: { ok: true } | { ok: false; error: string };
}
