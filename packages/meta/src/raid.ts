/**
 * 도적떼 — 농지 방어전의 계정 쪽 규칙 (GDD §5.11, 2026-09-21)
 *
 * ```
 * 출몰    날이 바뀐 뒤 첫 접속 · 농지 Lv1 이상 → 도적 = 농지 레벨, 10분 시작
 * 10분    [지금 전투] → 서버가 시드를 내고 그날의 도적떼를 써 버린다 (fighting)
 *         그대로 흘러가면 → 자동 항복 (출몰한 수 × 10% 약탈)
 * 결말    승리 = AI 대전 승리와 같은 보상 · 패배 = 살아 있는 도적 × 10% · 무승부 = 없음
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 시계는 밖에서 받는다
 * ────────────────────────────────────────────────────────────────
 *
 * `syncGrain(profile, nowMs)`와 같은 규약이다 — 「10분 뒤」·「다음 날」을 가짜 시계로
 * 고정해야 회귀가 선다. 시각을 넣는 자리는 **서버의 `mutateProfile()`** 하나다
 * (출몰과 정산은 서버만 한다 — `raid`는 서버 소유 필드다).
 *
 * ────────────────────────────────────────────────────────────────
 * 출몰은 「봤다」는 신고에 맡기지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 출몰을 클라이언트가 「알림을 띄웠다」고 알려 올 때로 잡으면, 알리지 않는 클라이언트는
 * 영원히 약탈당하지 않는다. 그래서 출몰은 **서버가 계정을 내려 주는 순간**이고
 * (`syncRaid(…, { spawn: true })`), 그 문은 로그인(`GET /profile`)과 **출정의 문 둘**
 * (AI 참가비 · 온라인 대기열)이다 — 출정하려면 반드시 지나야 하는 곳에 걸었다.
 */

import { RAID } from '@samchess/data';
import { GUARD_SIDE, banditRoster, raidMode } from '@samchess/rules';
import type { BattleConfig, OfficerId, Side } from '@samchess/rules';
import { applyInjuries, buildingLevel } from './city.ts';
import { fallenAfterShield } from './market.ts';
import { grantBattleRewards } from './rewards.ts';
import { toRosterEntries } from './roster.ts';
import type { MetaResult, PlayerProfile, RaidState, RosterPick } from './types.ts';

const MS_PER_MIN = 60_000;

/** 출몰부터 자동 항복까지 — 10분 */
export const RAID_RESPONSE_MS = RAID.responseMinutes * MS_PER_MIN;
/** 마감 전 이만큼 남으면 알림을 한 번 더 띄운다 — 1분 */
export const RAID_LAST_CALL_MS = RAID.lastCallMinutes * MS_PER_MIN;
/** [지금 전투] 뒤 결과가 이만큼 안 오면 항복으로 정산한다 — 60분 */
export const RAID_ABANDON_MS = RAID.abandonMinutes * MS_PER_MIN;
export const RAID_LOOT_PCT = RAID.lootPctPerBandit;

const DAY_OFFSET_MS = RAID.dayUtcOffsetHours * 3_600_000;

const no = (reason: string, code: string, params?: Record<string, number>): MetaResult =>
  ({ ok: false, reason, code, ...(params ? { params } : {}) });

// ── 날짜 · 상태 ───────────────────────────────────────────────

/**
 * 「오늘」— KST 날짜 `YYYY-MM-DD`. **시각을 받는다** — `new Date(ms)`는 시계를 읽지 않는다.
 * 계정마다 경계가 다르면 서버가 날짜를 둘 다 계산해야 해서 하나로 둔다.
 */
export const raidDay = (nowMs: number): string => new Date(nowMs + DAY_OFFSET_MS).toISOString().slice(0, 10);

/** 아직 끝나지 않은 도적떼 — 출정이 막히고 메인에 [전투하기]가 뜨는 동안 */
export const raidActive = (raid: RaidState | undefined): boolean =>
  raid?.status === 'pending' || raid?.status === 'fighting';

/** 자동 항복 시각 */
export const raidDeadline = (raid: RaidState): number => raid.spawnedAt + RAID_RESPONSE_MS;

/** 남은 시간(ms) — 0 밑으로 안 내려간다. 화면의 카운트다운이 읽는다 */
export const raidRemainingMs = (raid: RaidState, nowMs: number): number =>
  Math.max(0, raidDeadline(raid) - nowMs);

/** 마지막 알림을 띄울 때인가 — 남은 1분 */
export const raidLastCall = (raid: RaidState, nowMs: number): boolean =>
  raid.status === 'pending' && raidRemainingMs(raid, nowMs) <= RAID_LAST_CALL_MS && raidRemainingMs(raid, nowMs) > 0;

/**
 * 약탈량 — `min(지금 군량, floor(출몰 시 군량 × 도적 수 × 10%))`.
 *
 * **기준은 출몰 순간의 군량이다** — 10분 동안 참가비로 써 버려 약탈을 줄이는 길을
 * 막는다. 그 사이 더 찬 군량은 안 잃는다. 지금 가진 것보다 많이 빼앗을 수는 없다.
 */
export function raidLoot(raid: RaidState, grainNow: number, bandits: number): number {
  const n = Math.max(0, Math.min(bandits, raid.bandits));
  return Math.max(0, Math.min(grainNow, Math.floor((raid.grainAtSpawn * n * RAID_LOOT_PCT) / 100)));
}

/** 도적떼가 출정을 막는가 — 막으면 병영 [출정하기]·AI 참가비·온라인 대기열이 거절한다 */
export function raidBlocksSortie(profile: PlayerProfile): MetaResult {
  if (!raidActive(profile.raid)) return { ok: true };
  return no('도적떼가 농지를 노리고 있다 — 농지 전투를 먼저 치러야 한다', 'raid.blocksSortie');
}

// ── 파수꾼 ───────────────────────────────────────────────────

/** 파수꾼 칸 = 농지 레벨. 0이면 농지가 없다 */
export const guardSlots = (profile: PlayerProfile): number => buildingLevel(profile, 'farm');

/** 저장된 부대(10개 중 어디든)에 속한 장수들 */
function squadOfficers(profile: PlayerProfile): Set<OfficerId> {
  return new Set(profile.squads.flatMap((s) => s.picks.map((p) => p.officer)));
}

/**
 * 장수가 무엇에 묶여 있는가 — **판정하는 자리는 여기 하나다** (GDD §5.11).
 *
 * 병영과 농지가 각자 판정하면 한쪽만 어긋나도 화면에는 아무 표시가 없다. 앞으로
 * 출장(다른 도시)이 붙으면 여기에 한 갈래가 더 생긴다. **부대가 먼저다** — 부대에
 * 든 장수는 파수꾼 칸에 남아 있어도(옛 데이터) 파수꾼으로 서지 않는다(`guardsOf`).
 */
export type OfficerDuty = 'squad' | 'guard';

export function officerDuty(profile: PlayerProfile, officer: OfficerId): OfficerDuty | null {
  if (squadOfficers(profile).has(officer)) return 'squad';
  if ((profile.farmGuards ?? []).some((g) => g.officer === officer)) return 'guard';
  return null;
}

/**
 * **실제로 설 수 있는** 파수꾼 — 읽는 자리는 여기 하나다.
 *
 * 없는 장수 · 부대에 든 장수 · 겹친 기물·장수 · 칸(농지 레벨)을 넘친 것을 거른다.
 * 저장된 칸을 믿지 않는 이유는 농지 밖에서도 바뀌기 때문이다 — 부대 편성은 파수꾼을
 * 빼 가고(`releaseGuards`), 장수는 계정에서 빠질 수 있다.
 */
export function guardsOf(profile: PlayerProfile): RosterPick[] {
  const inSquad = squadOfficers(profile);
  const slots = guardSlots(profile);
  const pieces = new Set<string>();
  const officers = new Set<string>();
  const out: RosterPick[] = [];
  for (const g of profile.farmGuards ?? []) {
    if (out.length >= slots) break;
    if (!profile.roster[g.officer] || inSquad.has(g.officer)) continue;
    if (pieces.has(g.piece) || officers.has(g.officer)) continue;
    pieces.add(g.piece);
    officers.add(g.officer);
    out.push({ piece: g.piece, officer: g.officer });
  }
  return out;
}

/**
 * 파수꾼 편성이 성립하는가. **비우는 것은 언제나 된다**(빈 배열).
 *
 * - 농지가 있어야 하고, 칸은 농지 레벨만큼이다 — **다 채우지 않아도 된다**
 * - King은 언제나 있어야 한다(Lv1은 칸이 하나라 저절로 King 고정이다)
 * - 기물은 종류당 하나 · 장수도 한 번씩
 * - 보유한 장수이고, 저장된 부대에 속하지 않았다
 */
export function validateGuards(profile: PlayerProfile, picks: readonly RosterPick[]): MetaResult {
  if (picks.length === 0) return { ok: true };
  const slots = guardSlots(profile);
  if (slots === 0) return no('농지를 먼저 지어야 한다', 'raid.noFarm');
  if (picks.length > slots) return no(`파수꾼은 ${slots}명까지다 — 농지를 올리면 늘어난다`, 'raid.tooMany', { n: slots });
  if (!picks.some((p) => p.piece === 'King')) return no('파수꾼에는 King이 있어야 한다', 'raid.needKing');
  if (new Set(picks.map((p) => p.piece)).size !== picks.length) return no('기물은 종류당 하나다', 'raid.dupPiece');
  if (new Set(picks.map((p) => p.officer)).size !== picks.length) return no('같은 장수를 두 번 세울 수 없다', 'raid.dupOfficer');
  const inSquad = squadOfficers(profile);
  for (const p of picks) {
    if (!profile.roster[p.officer]) return no('보유하지 않은 장수다', 'raid.notOwned');
    if (inSquad.has(p.officer)) return no('부대에 편성된 장수는 파수꾼이 될 수 없다', 'raid.inSquad');
  }
  return { ok: true };
}

export function setGuards(profile: PlayerProfile, picks: readonly RosterPick[]): PlayerProfile {
  const check = validateGuards(profile, picks);
  if (!check.ok) throw new Error(check.reason);
  return { ...profile, farmGuards: picks.map((p) => ({ piece: p.piece, officer: p.officer })) };
}

/**
 * 부대 편성이 파수꾼을 데려간다 — **병영 쪽의 편의다** (GDD §5.11).
 *
 * 반대 방향(농지가 부대 장수를 빼 오는 것)은 없다. 부대는 인원이 모자라면 성립하지
 * 않으므로 빼 가면 부대가 깨지기 때문이다. 확인창은 화면의 일이고, 여기는 빼기만 한다.
 */
export function releaseGuards(profile: PlayerProfile, officers: readonly OfficerId[]): PlayerProfile {
  const drop = new Set(officers);
  const guards = profile.farmGuards ?? [];
  if (!guards.some((g) => drop.has(g.officer))) return profile;
  return { ...profile, farmGuards: guards.filter((g) => !drop.has(g.officer)) };
}

/** 이 구성을 부대로 저장하면 농지에서 빠질 장수들 — 화면이 확인창을 띄울지 정한다 */
export const guardsTakenBy = (profile: PlayerProfile, picks: readonly RosterPick[]): OfficerId[] =>
  picks.map((p) => p.officer).filter((id) => officerDuty(profile, id) === 'guard');

// ── 출몰 · 마감 (서버) ─────────────────────────────────────────

/**
 * 도적떼의 시계를 민다 — **서버가 계정을 읽을 때마다** 부른다.
 *
 * 1. 살아 있는 도적떼의 마감이 지났으면 **항복으로 정산한다** — 10분을 넘긴 `pending`,
 *    결과 없이 60분을 넘긴 `fighting`. 앱을 꺼 두어도 다음 조회 때 정산된다.
 * 2. `spawn`이면 오늘 아직 안 왔고 농지가 있으면 **출몰시킨다.**
 *
 * 정산이 먼저다 — 어제 23:58에 와서 오늘 00:30에 들어오면, 어제 것을 항복으로 끝내고
 * 오늘 것이 새로 온다. **바뀐 것이 없으면 같은 객체를 돌려준다**(`syncCity()`와 같은 규약).
 *
 * 군량은 이미 정산된 계정을 받는다고 본다(`syncCity()` 뒤에 부른다) — 약탈의 「지금
 * 군량」과 출몰의 기준 군량이 둘 다 그 값이다.
 */
export function syncRaid(profile: PlayerProfile, nowMs: number, opts: { spawn: boolean }): PlayerProfile {
  const now = Math.floor(nowMs);
  if (!Number.isFinite(now) || now <= 0) return profile;
  let next = profile;

  const raid = next.raid;
  if (raid?.status === 'pending' && now >= raidDeadline(raid)) {
    next = surrender(next, raid, raidDeadline(raid));
  } else if (raid?.status === 'fighting' && raid.battle && now >= raid.battle.startedAt + RAID_ABANDON_MS) {
    // 지는 판을 끊어도 이득이 없게 — 항복 약탈 ≥ 패배 약탈 (GDD §5.11)
    next = surrender(next, raid, raid.battle.startedAt + RAID_ABANDON_MS);
  }

  if (opts.spawn && !raidActive(next.raid) && next.raid?.day !== raidDay(now) && guardSlots(next) > 0) {
    next = {
      ...next,
      raid: { day: raidDay(now), bandits: guardSlots(next), spawnedAt: now, grainAtSpawn: next.grain, status: 'pending' },
    };
  }
  return next;
}

function surrender(profile: PlayerProfile, raid: RaidState, at: number): PlayerProfile {
  const loot = raidLoot(raid, profile.grain, raid.bandits);
  return {
    ...profile,
    grain: profile.grain - loot,
    raid: { ...raid, status: 'surrendered', loot, settledAt: at },
  };
}

/** [항복] — 출몰한 도적 수만큼 약탈당한다. 전투 중이어도 된다(전투 화면의 항복) */
export function surrenderRaid(profile: PlayerProfile, nowMs: number): PlayerProfile {
  const raid = profile.raid;
  if (!raid || !raidActive(raid)) throw new Error('항복할 도적떼가 없다');
  return surrender(profile, raid, Math.floor(nowMs));
}

// ── 전투 (서버) ─────────────────────────────────────────────

/** [지금 전투]를 누를 수 있는가 */
export function canStartRaid(profile: PlayerProfile, nowMs: number): MetaResult {
  const raid = profile.raid;
  if (!raid || !raidActive(raid)) return no('오늘은 도적떼가 없다', 'raid.none');
  if (raid.status === 'fighting') return no('이미 전투가 시작됐다', 'raid.started');
  if (nowMs >= raidDeadline(raid)) return no('시간이 지났다 — 항복으로 처리된다', 'raid.expired');
  const guards = guardsOf(profile);
  if (guards.length === 0) return no('농지에 파수꾼이 없다 — 파수꾼을 세워야 싸울 수 있다', 'raid.noGuards');
  if (!guards.some((g) => g.piece === 'King')) return no('파수꾼에 King이 없다', 'raid.needKing');
  return { ok: true };
}

/**
 * 전투를 시작한다 — **시드는 서버가 준다.** 이 순간 그날의 도적떼를 써 버린다.
 *
 * 시드를 클라이언트가 고르면 로컬에서 여러 시드로 싸워 보고 이긴 판만 낼 수 있다.
 * 하루 한 번에 참가비도 없어 AI 대전보다 유인이 크다. 파수꾼도 여기서 굳힌다 —
 * 전투 중에 농지 화면에서 바꿔도 재생 검증은 시작할 때의 편성으로 판을 다시 만든다.
 */
export function startRaid(profile: PlayerProfile, nowMs: number, seed: number): PlayerProfile {
  const check = canStartRaid(profile, nowMs);
  if (!check.ok) throw new Error(check.reason);
  const raid = profile.raid!;
  return {
    ...profile,
    raid: { ...raid, status: 'fighting', battle: { seed: seed >>> 0, startedAt: Math.floor(nowMs), guards: guardsOf(profile) } },
  };
}

/**
 * 판의 설정 — 클라이언트(로컬 전투)와 서버(재생 검증)가 **같은 함수로** 만든다.
 *
 * 도적은 농지 레벨이 아니라 **출몰 순간에 굳은 수**(`raid.bandits`)에서 나온다. 부상은
 * 전투를 시작한 시각 기준이다 — 재생할 때 「지금」을 넣으면 그새 나은 장수가 온전하게
 * 서서 다른 판이 된다.
 */
export function raidBattleConfig(profile: PlayerProfile): BattleConfig & { humanSide: Side } {
  const raid = profile.raid;
  if (raid?.status !== 'fighting' || !raid.battle) throw new Error('진행 중인 도적떼 전투가 없다');
  const { seed, startedAt, guards } = raid.battle;
  return {
    matchId: `raid-${raid.day}-${seed}`,
    seed,
    mode: raidMode(guards.length),
    scenario: 'raid',
    rosters: { P1: toRosterEntries(profile, guards, startedAt), P2: banditRoster(raid.bandits) },
    humanSide: GUARD_SIDE,
  };
}

export interface RaidBattleEnd {
  /** 이긴 진영. `null`이면 무승부(시간 상한에서 HP 합까지 같음) */
  winner: Side | null;
  /** 판이 끝났을 때 살아 있는 도적 수 */
  banditsAlive: number;
  /** HP 0으로 퇴각한 파수꾼 — 부상이 된다 */
  fallen: readonly OfficerId[];
}

/**
 * 끝난 판을 정산한다. **전적에는 안 센다** — 상대가 사람이 고른 것이 아니라 도시가 받은
 * 것이다(GDD §5.11).
 *
 * | 결말 | |
 * |---|---|
 * | 승리 | AI 대전 승리와 같은 보상 (`grantBattleRewards` — 보상 식을 두 벌 적지 않는다) |
 * | 패배 | 살아 있는 도적 × 10% 약탈. 패배 카드는 없다 |
 * | 무승부 | 없음 |
 */
export function settleRaid(profile: PlayerProfile, end: RaidBattleEnd, nowMs: number): PlayerProfile {
  const raid = profile.raid;
  if (raid?.status !== 'fighting' || !raid.battle) throw new Error('진행 중인 도적떼 전투가 없다');
  const at = Math.floor(nowMs);
  // 청낭서를 들고 나간 파수꾼은 빠진다 (2026-09-23, GDD §6.5)
  const hurt = fallenAfterShield(profile, end.fallen);
  let next = hurt.length ? applyInjuries(profile, hurt, at) : profile;

  if (end.winner === GUARD_SIDE) {
    const { profile: rewarded, rewards } = grantBattleRewards(next, 'win', raidMode(raid.battle.guards.length), raid.battle.seed);
    return { ...rewarded, raid: { ...raid, status: 'won', loot: 0, rewards, settledAt: at } };
  }
  if (end.winner === null) {
    return { ...next, raid: { ...raid, status: 'drawn', loot: 0, settledAt: at } };
  }
  const loot = raidLoot(raid, next.grain, end.banditsAlive);
  next = { ...next, grain: next.grain - loot };
  return { ...next, raid: { ...raid, status: 'lost', loot, settledAt: at } };
}
