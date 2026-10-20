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
import type { Adjustment, PlayerProfile } from '@samchess/meta';

export type { Adjustment, PlayerProfile };

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

/** `GET /admin/users/:uid` */
export interface UserDetail {
  uid: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  isTest: boolean;
  profileUpdatedAt: string | null;
  /** 서버 시계로 정산한 값. 도시를 안 만들었으면 `null` */
  profile: PlayerProfile | null;
}

/** `POST /admin/users/:uid/adjust` — 본문은 `Adjustment & { reason: string }` */
export interface AdjustResponse {
  profile: PlayerProfile;
  auditId: number;
}

/** `GET /admin/audit` 의 `rows[]` */
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
