/**
 * 야전 — 선전포고 (2026-10-28, GDD §8.8 단계 4)
 *
 * 접속 중인 도시에는 공성전 대신 **선전포고**를 건다. 한 장의 선전포고가 지나는 걸음:
 *
 * ```
 * sent       건 쪽이 [선전포고] — 상대의 다음 접속 핑에 실려 간다(최대 PRESENCE_PING_MS)
 * delivered  상대 화면에 떴다 — **이때부터** 응답 30초(WAR_REPLY_MS, 기획자 확정)
 * replied    상대가 그 모드의 제 부대 하나로 [응전] — 건 쪽이 그 부대를 보고 30초 안에 [수락]
 * accepted   건 쪽이 [수락] — 두 사람이 WAR_JOIN_MS 안에 대전 방(`BattleRoom`)에 들어온다
 * started    방이 열렸다 — 그다음은 온라인 대전 그대로(참가비 · 이탈 표 · 환불 · 정산)
 * declined · cancelled · expired   끝 — 같은 상대에게는 WAR_COOLDOWN_MS 동안 다시 못 건다
 * ```
 *
 * **만료는 저장하지 않고 읽을 때 낸다**(`warStatusAt`) — 시간으로 넘어가는 걸음을 누가 「적어 줘야」 하면 아무도 안 들르는
 * 선전포고가 영원히 열려 있다. 서버는 쓸 때만 그 결과를 적는다. meta는 시계를 안 읽는다 — 시각은 서버 시계를 받는다.
 *
 * **보여 주는 부대와 싸우는 부대가 같다** — 명단 · 배치는 클라이언트가 대지 않는다. 서버가 계정의 부대 id에서
 * 낸다(`warSquadView` · `warEnlist`). 건 쪽은 남군(P1), 받는 쪽은 북군(P2)이다(공성전의 수비군이 북군인 것과 같다).
 */

import type { BattleMode, RosterEntry, Side, UnitId, Vec2 } from '@samchess/rules';
import { fightingAi } from './aiBattle.ts';
import { canStartMatch } from './match.ts';
import { battlePower } from './power.ts';
import { toRosterEntries, validateRoster } from './roster.ts';
import { PRESENCE_ONLINE_MS, PRESENCE_PING_MS } from './siege.ts';
import { squadById, squadDeployment } from './squads.ts';
import { sortieGate } from './tutorial.ts';
import type { MetaResult, PlayerProfile } from './types.ts';

/** 상대 화면에 뜬 순간부터 [응전] · [거절]까지 */
export const WAR_REPLY_MS = 30_000;
/** 상대의 회신(부대)이 건 쪽 화면에 닿은 뒤 [수락]까지 — 건 쪽은 걸어 둔 채 기다리고 있었다(5초마다 묻는다) */
export const WAR_ACCEPT_MS = 30_000;
/** [수락] 뒤 두 사람이 대전 방에 들어오기까지 — 안 오면 방이 접히고 참가비는 안 나간다 */
export const WAR_JOIN_MS = 30_000;
/** 거절 · 시간 초과 · 취소 뒤 **같은 상대에게** 다시 걸기까지 (기획자 확정 5분) */
export const WAR_COOLDOWN_MS = 5 * 60_000;
/** 선전포고가 걸려 있는 동안 두 화면이 서버에 묻는 간격 */
export const WAR_POLL_MS = 5_000;
/** 상대에게 전해지기를 기다리는 한도 — 그 안에 핑이 안 오면 상대는 이미 미접속이다 */
export const WAR_DELIVER_MS = PRESENCE_ONLINE_MS;

/** 값들의 관계가 규칙이다 — 회귀가 고정한다 */
export const WAR_INVARIANTS = [
  ['전해지기 전에 상대의 핑이 적어도 한 번은 온다', PRESENCE_PING_MS < WAR_DELIVER_MS],
  ['응답을 기다리는 동안 건 쪽이 여러 번 묻는다', WAR_POLL_MS * 3 <= WAR_REPLY_MS],
  ['수락을 기다리는 동안 받은 쪽이 여러 번 묻는다', WAR_POLL_MS * 3 <= WAR_ACCEPT_MS],
  ['방에 들어오는 사이 두 화면이 수락을 알아챈다', WAR_POLL_MS * 2 <= WAR_JOIN_MS],
] as const;

export type WarStatus = 'sent' | 'delivered' | 'replied' | 'accepted' | 'started' | 'declined' | 'cancelled' | 'expired';

/** 아직 끝나지 않은 걸음 — 한 사람은 이런 선전포고를 **하나만** 걸고, **하나만** 받는다 */
export const isWarOpen = (s: WarStatus): boolean => s === 'sent' || s === 'delivered' || s === 'replied' || s === 'accepted';

/** 쿨다운이 붙는 끝 — 판이 선 것(`started`)은 아니다 */
export const isWarRefused = (s: WarStatus): boolean => s === 'declined' || s === 'cancelled' || s === 'expired';

/** 서로에게 보여 주는 부대 — 명단 · 전투력은 시각 없이(목록 · 공성전 상세와 같은 눈금) */
export interface WarSquadView {
  squadId: string;
  squadName: string;
  power: number;
  entries: RosterEntry[];
}

/** 도시 — 이름이 공개 식별자다(랭킹 · 도시 목록과 같다) */
export interface WarCity {
  uid: string;
  cityName: string;
  cityLevel: number;
}

/** 선전포고 한 장 — 서버의 `wars` 표 한 줄 */
export interface WarRecord {
  id: string;
  mode: BattleMode;
  attacker: WarCity;
  defender: WarCity;
  attackerSquad: WarSquadView;
  defenderSquad: WarSquadView | null;
  /** 적힌 걸음 — 시간으로 넘어간 것은 `warStatusAt`이 낸다 */
  status: WarStatus;
  createdAt: number;
  deliveredAt: number | null;
  repliedAt: number | null;
  acceptedAt: number | null;
  endedAt: number | null;
}

/** 지금의 걸음 — 적힌 걸음에 시간을 대 본다 */
export function warStatusAt(w: WarRecord, nowMs: number): WarStatus {
  if (w.status === 'sent' && nowMs - w.createdAt >= WAR_DELIVER_MS) return 'expired';
  if (w.status === 'delivered' && nowMs - (w.deliveredAt ?? w.createdAt) >= WAR_REPLY_MS) return 'expired';
  if (w.status === 'replied' && nowMs - (w.repliedAt ?? w.createdAt) >= WAR_ACCEPT_MS) return 'expired';
  if (w.status === 'accepted' && nowMs - (w.acceptedAt ?? w.createdAt) >= WAR_JOIN_MS) return 'expired';
  return w.status;
}

/** 지금 걸음이 끝나기까지(ms) — 시간 제한이 없는 걸음이면 `null` */
export function warRemainingMs(w: WarRecord, nowMs: number): number | null {
  const status = warStatusAt(w, nowMs);
  const from = status === 'sent' ? [w.createdAt, WAR_DELIVER_MS]
    : status === 'delivered' ? [w.deliveredAt ?? w.createdAt, WAR_REPLY_MS]
    : status === 'replied' ? [w.repliedAt ?? w.createdAt, WAR_ACCEPT_MS]
    : status === 'accepted' ? [w.acceptedAt ?? w.createdAt, WAR_JOIN_MS]
    : null;
  return from ? Math.max(0, from[0]! + from[1]! - nowMs) : null;
}

/** 끝난 시각 — 적힌 것이 없으면 시간 제한이 끝난 순간 */
export function warEndedAt(w: WarRecord, nowMs: number): number | null {
  if (w.endedAt !== null) return w.endedAt;
  return warStatusAt(w, nowMs) === 'expired' ? expiredAt(w) : null;
}

/** 시간 제한이 끝나는 순간 — 열린 걸음에만 뜻이 있다 */
const expiredAt = (w: WarRecord): number =>
  w.status === 'sent' ? w.createdAt + WAR_DELIVER_MS
    : w.status === 'delivered' ? (w.deliveredAt ?? w.createdAt) + WAR_REPLY_MS
    : w.status === 'replied' ? (w.repliedAt ?? w.createdAt) + WAR_ACCEPT_MS
    : (w.acceptedAt ?? w.createdAt) + WAR_JOIN_MS;

/** 한 사람이 보는 선전포고 — 화면이 그리는 것 전부 */
export interface WarView {
  id: string;
  /** 내가 건 쪽인가 받은 쪽인가 */
  role: 'attacker' | 'defender';
  mode: BattleMode;
  status: WarStatus;
  /** 지금 걸음이 끝나기까지(ms) — 절대시각이 아니라 남은 값(시계 어긋남, 전투 전선과 같은 규약) */
  remainingMs: number | null;
  attacker: WarCity;
  defender: WarCity;
  attackerSquad: WarSquadView;
  defenderSquad: WarSquadView | null;
}

export function viewWar(w: WarRecord, uid: string, nowMs: number): WarView {
  return {
    id: w.id, role: w.attacker.uid === uid ? 'attacker' : 'defender', mode: w.mode,
    status: warStatusAt(w, nowMs), remainingMs: warRemainingMs(w, nowMs),
    attacker: w.attacker, defender: w.defender, attackerSquad: w.attackerSquad, defenderSquad: w.defenderSquad,
  };
}

const no = (code: string, reason: string): MetaResult => ({ ok: false, code, reason });

/** 그 모드의 부대가 지금 성립하는가 — 성립하면 보여 줄 모양 */
export function warSquadView(profile: PlayerProfile, squadId: string, mode: BattleMode): WarSquadView | null {
  const squad = squadById(profile, squadId);
  if (!squad || squad.mode !== mode || !validateRoster(profile, mode, squad.picks, false).ok) return null;
  const entries = toRosterEntries(profile, squad.picks);
  return { squadId: squad.id, squadName: squad.name, power: battlePower(mode, entries), entries };
}

/**
 * 판에 서는 명단 — **방이 열리는 순간의 시각으로** 낸다(부상 · 태학 개량 · 컬렉션, AI 대전의 시작과 같다).
 * 배치는 그 진영의 프리셋, 어긋나면 `null`(기본 배치). 부대가 그새 성립하지 않으면 `null` — 방을 안 연다.
 */
export function warEnlist(profile: PlayerProfile, squadId: string, mode: BattleMode, side: Side, nowMs: number): {
  entries: RosterEntry[]; squadName: string; power: number; deploy: { unit: UnitId; pos: Vec2 }[] | null;
} | null {
  const squad = squadById(profile, squadId);
  if (!squad || squad.mode !== mode || !validateRoster(profile, mode, squad.picks, false).ok) return null;
  const entries = toRosterEntries(profile, squad.picks, nowMs);
  return { entries, squadName: squad.name, power: battlePower(mode, entries), deploy: squadDeployment(profile, squad, side) };
}

/** 출전할 수 있는 사람인가 — 걸 때 · 응전할 때 · 수락할 때 같은 것을 본다. 참가비는 방이 열릴 때 낸다 */
export function warReadyGate(profile: PlayerProfile, mode: BattleMode): MetaResult {
  const gate = sortieGate(profile);
  if (!gate.ok) return gate;
  if (fightingAi(profile)) return no('ai.inProgress', '끝나지 않은 AI 대전이 있다');
  const grain = canStartMatch(profile, mode);
  if (!grain.ok) return { ...grain, code: 'war.noGrain' };
  return { ok: true };
}

/** 선전포고를 걸 수 있는가 — 서버가 그 순간의 값을 모아 부른다 */
export interface DeclareFacts {
  attacker: PlayerProfile;
  defenderCityLevel: number;
  mode: BattleMode;
  /** 상대가 지금 접속 중인가 · 전투 중인가(핑이 실어 온 값) */
  defenderOnline: boolean;
  defenderBusy: boolean;
  /** 내가 건 · 상대가 받은 열린 선전포고가 있는가 */
  attackerOpen: boolean;
  defenderOpen: boolean;
  /** 이 상대에게 건 선전포고가 마지막으로 거절 · 취소 · 만료된 시각 */
  lastRefusedAt: number | null;
  nowMs: number;
}

export function declareGate(f: DeclareFacts): MetaResult {
  if (f.defenderCityLevel < Math.floor(f.attacker.cityLevel)) return no('siege.lowerCity', '도시 레벨이 낮은 도시는 칠 수 없다');
  if (!f.defenderOnline) return no('war.offline', '그 도시는 방금 접속을 끊었다');
  if (f.defenderBusy) return no('war.busy', '그 도시는 지금 전투 중이다');
  if (f.attackerOpen) return no('war.pending', '걸어 둔 선전포고가 이미 있다');
  if (f.defenderOpen) return no('war.engaged', '그 도시는 다른 선전포고를 받고 있다');
  if (f.lastRefusedAt !== null && f.nowMs - f.lastRefusedAt < WAR_COOLDOWN_MS) {
    return { ok: false, code: 'war.cooldown', reason: '같은 도시에는 잠시 뒤 다시 걸 수 있다',
      params: { sec: Math.ceil((WAR_COOLDOWN_MS - (f.nowMs - f.lastRefusedAt)) / 1000) } };
  }
  return warReadyGate(f.attacker, f.mode);
}
