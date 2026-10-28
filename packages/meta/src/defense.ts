/**
 * 방어 기록 (2026-10-28, GDD §8.8 단계 5) — 내 도시가 공성전으로 공격받은 판의 목록 · 합계 · 알림.
 *
 * 기록은 서버의 `defense_log` 표에 공격자의 계정을 쓰는 트랜잭션이 덧붙인다(단계 2). 이 파일은 **한 줄을 어떻게 읽는가**만 정한다 —
 * 결말 · 합계 · 「자리를 비운 사이」 알림의 문장 재료 · 다시 볼 수 있는가(`replayable` — 규칙 버전, `@samchess/rules`의 `REPLAY_VERSION`).
 * 랭킹 점수에는 넣지 않는다(GDD §7 — 많이 공격당한 사람의 점수가 흔들린다).
 *
 * meta는 시계 · 난수를 안 읽는다.
 */

import type { BattleMode } from '@samchess/rules';

/** 한 쪽에 다섯 줄 — 도시 목록 · 출정하기와 같은 셈 */
export const DEFENSE_PAGE_SIZE = 5;
/** 목록에 싣는 최근 판 — 합계는 전부를 센다 */
export const DEFENSE_LIST_LIMIT = 30;

/** 방어자에게서 본 결말 — 막았다 · 뚫렸다 · 비겼다 · 공격자가 자리를 떴다(방어 승) */
export type DefenseResult = 'held' | 'fell' | 'draw' | 'abandoned';

/** 표의 `winner`(엔진 진영, 방어자는 북군 P2) · `reason`에서 */
export function defenseResultOf(winner: 'P1' | 'P2' | null, reason: 'settled' | 'abandoned'): DefenseResult {
  if (reason === 'abandoned') return 'abandoned';
  return winner === 'P2' ? 'held' : winner === 'P1' ? 'fell' : 'draw';
}

/** 막은 판인가 — 이탈도 방어 승이다 */
export const defenseHeld = (r: DefenseResult): boolean => r === 'held' || r === 'abandoned';

/** 목록의 한 줄 — 화면이 그리는 것 전부 */
export interface DefenseRow {
  id: number;
  attackerCity: string;
  mode: BattleMode;
  result: DefenseResult;
  attackerPower: number;
  defenderPower: number;
  /** 그때 막은 수비군의 이름 */
  defenderSquad: string;
  /** 판이 끝난 시각(ms) */
  at: number;
  /** 공격자가 둔 수의 개수 — 「짧게 끝난 판」을 줄에서 알아보게 */
  moves: number;
  /** 지금 다시 볼 수 있는가 — 규칙 버전이 같을 때만 */
  replayable: boolean;
  /** 목록을 연 뒤의 줄인가 — 아직 안 봤으면 줄에 표지 */
  seen: boolean;
}

/** 합계 — 전부를 센다(목록은 최근 `DEFENSE_LIST_LIMIT`판) */
export interface DefenseSummary {
  total: number;
  held: number;
}

/** 방어 승률(0~1) — 판이 없으면 `null`(화면은 「—」) */
export const defenseRate = (s: DefenseSummary): number | null => (s.total === 0 ? null : s.held / s.total);

/** 안 본 판 — 들어올 때 팝업 「자리를 비운 사이 n번 공격받아 m번 막았습니다」 · 대자보의 표지 */
export interface DefenseUnseen {
  attacks: number;
  held: number;
}

/** 다시 보기에 실어 오는 것 — 판 하나 */
export interface DefenseReplayData {
  id: number;
  seed: number;
  mode: BattleMode;
  result: DefenseResult;
  replay: {
    entries: Record<'P1' | 'P2', unknown[]>;
    deploy: Record<'P1' | 'P2', unknown[] | null>;
    intents: unknown[];
  };
}
