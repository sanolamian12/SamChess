/**
 * 공성전의 도시 목록 (2026-10-27, GDD §8.8 단계 2)
 *
 * [출정하기]에서 공격 부대를 고르면 칠 수 있는 도시들이 뜬다. 줄 하나가 **한 도시의 그 모드 수비군**이다
 * (`defenses` 표의 한 줄 — 서버의 `siege.ts`가 읽는다). 이 파일은 **무엇이 어느 탭에 들고 어떤 순서로 서는가**만
 * 정한다 — 서버가 표에서 넉넉히 읽은 뒤 이 함수로 고르고 세운다(규칙을 SQL에 적으면 회귀가 못 본다).
 *
 * | 탭 | 규칙 |
 * |---|---|
 * | **추천** | 내 도시 레벨과 **같은** 도시 — 수비군 전투력 높은 순 |
 * | **상위 도전** | 내 도시 레벨보다 **높은** 도시 — 제한 없음. 가까운 레벨부터, 그 안에서 전투력 높은 순. 보상은 늘지 않는다(§6.4) |
 * | (없음) | 낮은 도시는 어느 탭에도 없다 — `matchSiege`도 같은 판정으로 거절한다 |
 *
 * **접속 표시**(2026-10-28, 단계 3) — 탭을 따로 두지 않고 줄마다 점을 단다(`online`). 같은 레벨 묶음 안에서는 **접속 중인 도시가
 * 위**이고 그다음이 전투력 순이다. 접속 중인 도시는 공성전으로 칠 수 없다(단계 4의 선전포고 자리) — 서버의 `/siege/match`가
 * 그 순간의 접속을 다시 보고 거절한다(목록은 낡을 수 있다).
 *
 * **도시 점수**(대자보의 승점, §7)는 **보여 주기만** 한다 — 정렬 기준이 아니다(기획자 확정).
 * 「약한 상대 — 보상이 줄어듭니다」는 화면이 `rewardTier()`로 줄마다 띄운다(목록이 안 깎으면 「보상이 왜 이래」가 된다).
 *
 * meta는 시계 · 난수를 안 읽는다.
 */

import type { BattleMode, RosterEntry } from '@samchess/rules';
import { cityRankRow } from './ranking.ts';
import type { PlayerProfile } from './types.ts';

export type SiegeTab = 'recommended' | 'upper';
export const SIEGE_TABS: readonly SiegeTab[] = ['recommended', 'upper'];

/** 한 번에 보여 주는 도시 수 — 넘치면 위에서부터 자른다 */
export const SIEGE_LIST_LIMIT = 30;

/**
 * 접속 상태 핑 (2026-10-28, GDD §8.8 단계 3) — 화면이 보이는 동안 `PRESENCE_PING_MS`마다 서버에 「여기 있다」를 보내고,
 * 마지막 핑이 `PRESENCE_ONLINE_MS` 안이면 **접속 중**이다. 핑을 보내는 쪽(클라)과 판정하는 쪽(서버)이 다르므로 값은 여기 하나다.
 */
export const PRESENCE_PING_MS = 30_000;
export const PRESENCE_ONLINE_MS = 120_000;

/** 두 값의 관계가 규칙이다 — 핑이 한두 번 늦어도(탭 전환 · 느린 망) 「접속 중」이 깜빡이지 않는다. 회귀가 고정한다 */
export const PRESENCE_INVARIANTS = [
  ['핑 간격의 세 배 안에 판정이 끝나지 않는다', PRESENCE_PING_MS * 3 <= PRESENCE_ONLINE_MS],
] as const;

/** 마지막 핑 시각(없으면 `null`)으로 「지금 접속 중인가」 — 시각은 밖(서버 시계)에서 받는다 */
export function isPresent(lastSeenMs: number | null, nowMs: number): boolean {
  return lastSeenMs !== null && nowMs - lastSeenMs < PRESENCE_ONLINE_MS;
}

/** 목록의 한 줄 — 화면이 그리는 것 전부. 이메일 · 계정 정보는 없다(도시 이름이 공개 식별자다 — 랭킹과 같다) */
export interface SiegeListRow {
  /** 지키는 계정 — 공격을 걸 때 이 값을 보낸다. 서버가 표에서 다시 읽으므로 자칭할 수 없다 */
  defenderId: string;
  cityName: string;
  cityLevel: number;
  mode: BattleMode;
  squadName: string;
  /** 수비군 전투력 — 시각 없는 값(매칭과 같은 눈금) */
  power: number;
  /** 명단 — 레벨 · 능력 선택까지 실린 그대로(상대 수비군 상세가 그린다) */
  entries: RosterEntry[];
  /** 도시 점수 — 대자보의 승점 합(`cityScore`). 표시만 */
  score: number;
  /** 지금 접속 중인가(`isPresent`) — 줄의 점 · 같은 레벨 안에서 위로 · 공성전 불가 */
  online: boolean;
}

/** 이 도시 레벨이 그 탭에 드는가 */
export function inSiegeTab(tab: SiegeTab, myLevel: number, theirLevel: number): boolean {
  const mine = Math.floor(myLevel);
  return tab === 'recommended' ? theirLevel === mine : theirLevel > mine;
}

/** 탭에 드는 줄만 골라 세우고 자른다 — 서버가 표에서 읽은 줄들에 부른다 */
export function pickSiegeRows(rows: readonly SiegeListRow[], tab: SiegeTab, myLevel: number): SiegeListRow[] {
  return rows
    .filter((r) => inSiegeTab(tab, myLevel, r.cityLevel))
    .sort((a, b) => (tab === 'upper' ? a.cityLevel - b.cityLevel : 0) || Number(b.online) - Number(a.online)
      || b.power - a.power || a.cityName.localeCompare(b.cityName))
    .slice(0, SIEGE_LIST_LIMIT);
}

/** 도시 점수 — 대자보 도시 랭킹의 「종합」과 같은 값(승점 합, §7) */
export const cityScore = (profile: PlayerProfile): number => cityRankRow(profile, 'all').total;
