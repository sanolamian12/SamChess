/**
 * **천하의 장수 260명을 모두 거느림** — 팬 장수 등록의 자격 (2026-11-12 기획자 확정).
 *
 * ```
 * 조건      원래 장수 260명(팬 장수 제외)을 모두 보유 — 풀 + 보관함(`ownedOfficers`, 증축 조건과 같은 셈)
 * 기회      한 계정에 한 번 · 앞선 100명(`FAN_OFFICER_SEATS`)까지
 * 신청      게임 밖 — 공식 홈페이지의 신청란. 운영자가 관리자 화면에서 순번 · 시각을 보고 받는다
 * 지급      그 계정에만 — 팬 장수를 데이터로 들인 뒤 관리자의 카드 지급(`admin.ts`의 `cards`)으로
 * 보상      달성한 순간부터 장수 보유 상한 +1(`poolCap`) — 팬 장수가 앉을 자리다
 * ```
 *
 * - **달성은 서버가 한 번만 적는다**(`PlayerProfile.milestones`, 서버 소유). 그 뒤 카드 정리로 장수가 빠져도 지우지 않는다 —
 *   신청 자격 · 상한 +1이 흔들리면 「받았다가 빼앗긴」 것이 된다. 순번은 서버의 `roster_milestones` 표가 매긴다
 *   (`server-api/src/milestones.ts`) — 프로필만 보고는 다른 계정과의 순서를 모른다.
 * - **기준은 원래 260명으로 굳힌다**(`FOUNDING_OFFICERS`) — 팬 장수가 데이터에 들어온 뒤 「모든 장수」로 세면 아무도 못 닿는다.
 *   팬 장수는 데이터에 `fan: true`를 단다.
 *
 * 순수 함수다. 시계 · 순번은 밖(서버)에서 받는다.
 */

import { OFFICERS } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { ownedOfficers } from './profile.ts';
import type { PlayerProfile } from './types.ts';

/** 팬 장수 신청을 받는 앞선 사람 수 */
export const FAN_OFFICER_SEATS = 100;

/** 달성한 계정의 장수 보유 상한 덧셈 — 팬 장수 한 명이 앉을 자리 */
export const ALL_OFFICERS_POOL_BONUS = 1;

/** 조건의 기준 — 원래 장수(팬 장수 제외) */
export const FOUNDING_OFFICERS: readonly OfficerId[] = OFFICERS.filter((o) => !o.fan).map((o) => o.id as OfficerId);

/** 달성 기록 — `at`은 서버 시각, `seat`는 서버가 매긴 순번(1부터). 순번을 아직 못 받았으면 없다 */
export interface RosterMilestone {
  at: number;
  seat?: number;
}

export interface Milestones {
  allOfficers?: RosterMilestone;
}

/** 원래 장수를 모두 보유했나 — 지금 이 순간의 사실(기록과 다르다) */
export function ownsAllOfficers(profile: PlayerProfile): boolean {
  const owned = new Set<string>(ownedOfficers(profile));
  return FOUNDING_OFFICERS.every((id) => owned.has(id));
}

/** 기록된 달성 — 읽는 자리는 이것 하나 */
export const allOfficersMilestone = (profile: PlayerProfile): RosterMilestone | undefined => profile.milestones?.allOfficers;

/** 팬 장수를 신청할 수 있는 계정인가 — 순번이 앞선 100 안 */
export function fanOfficerEligible(profile: PlayerProfile): boolean {
  const seat = allOfficersMilestone(profile)?.seat;
  return seat !== undefined && seat <= FAN_OFFICER_SEATS;
}

/** 달성 기록에서 오는 장수 보유 상한 덧셈(`poolCap`이 더한다) */
export const milestonePoolBonus = (profile: PlayerProfile): number =>
  allOfficersMilestone(profile) ? ALL_OFFICERS_POOL_BONUS : 0;

/**
 * 순번을 받아 달성을 적는다 — **부르는 자리는 서버의 계정 쓰기 하나다**(`profileStore.ts`의 `transact`).
 * 이미 적혀 있으면 같은 객체(순번이 없던 기록에 순번만 채우는 것은 예외).
 */
export function recordAllOfficers(profile: PlayerProfile, at: number, seat: number): PlayerProfile {
  const cur = allOfficersMilestone(profile);
  if (cur?.seat !== undefined) return profile;
  return { ...profile, milestones: { ...profile.milestones, allOfficers: { at: cur?.at ?? at, seat } } };
}

/** 저장된 값을 되접는다(`migrateProfile`). 모르는 꼴은 버린다. 비면 `undefined` */
export function readMilestones(raw: unknown): Milestones | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const a = (raw as { allOfficers?: unknown }).allOfficers;
  if (typeof a !== 'object' || a === null) return undefined;
  const { at, seat } = a as { at?: unknown; seat?: unknown };
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  const okSeat = typeof seat === 'number' && Number.isInteger(seat) && seat >= 1;
  return { allOfficers: okSeat ? { at, seat } : { at } };
}
