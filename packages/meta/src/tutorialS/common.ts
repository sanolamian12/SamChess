/**
 * S급 튜토리얼 판의 공통 손 — 판 크기 · 시드 · 편성 · 판 꾸리기 (`tutorialSBattles.ts`가 판을 모은다).
 *
 * 판은 **전부 25 × 15**다(도적떼 판과 같은 크기, 2026-10-22 확정) — 지도(`public/ui/tutorial/{id}.jpg`)가 판마다 따로 그려져 있다.
 * 판 하나는 이 폴더의 파일 하나다(`{장수 id}.ts`) — 판마다 장수 · 자리 · 시작 값 · 목표 · 대본이 다 다르고 엔진으로 따로 맞춘다.
 *
 * 이 폴더는 `tutorialBattles.ts`를 **값으로** import하지 않는다(그쪽이 이쪽을 부른다 — 타입만 빌린다).
 */

import type { BattleConfig, OfficerId, PieceType, RosterEntry, UnitId, Vec2 } from '@samchess/rules';
import type { TutorialStage } from '../tutorialBattles.ts';

export const SEED = 20261024;
export const BOARD: Vec2 = { x: 25, y: 15 };

export const O = (id: string): OfficerId => id as OfficerId;
export const U = (id: string): UnitId => id as UnitId;

/**
 * 편성 한 줄. 성장은 기본이 HP로만 — 레벨은 버티는 힘을 맞추는 손잡이다. 공격 · MP · 책략은 `extra`로 적는다
 * (`statPicks` 길이 = 레벨 − 1, 책략은 `tacticsForLevel` 규칙을 지켜야 `createBattle`이 받는다).
 */
export const entry = (officer: string, piece: PieceType, level = 1, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  officer: O(officer), piece, level,
  statPicks: Array.from({ length: level - 1 }, () => 'hp' as const),
  tactics: [],
  ...extra,
});

export const config = (officer: string, rosters: BattleConfig['rosters'], setup: Omit<NonNullable<BattleConfig['setup']>, 'board'>): BattleConfig => ({
  matchId: `tutorial-s-${officer}`,
  seed: SEED,
  mode: '3v3',
  scenario: 'tutorial',
  rosters,
  setup: { board: BOARD, ...setup },
});

/** 판 하나 — 문구 열쇠의 머리는 `tut.s.{장수}.`, 지도는 그 장수의 것, 적은 기본이 기준 AI */
export const stage = (officer: string, s: Omit<TutorialStage, 'lesson' | 'map' | 'enemy'> & { enemy?: TutorialStage['enemy'] }): TutorialStage[] =>
  [{ lesson: `s.${officer}`, map: officer, enemy: s.enemy ?? 'standard', ...s }];
