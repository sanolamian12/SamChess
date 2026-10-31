/**
 * 밸런스 도구의 명단 — 시드에서 결정적으로 편성을 뽑는다.
 *
 * `npm run balance`(야전)와 `npm run balance:siege`(수성전)가 **같은 명단**을 써야 두 표를 나란히 읽을 수 있어
 * 한 곳에 둔다. 뽑는 순서를 바꾸면 `balance`의 기준선(HANDOFF §7의 5000판 실측)과 비교가 끊기므로
 * 해시의 소금값까지 그대로 둔다 — 옮길 때 `balance` 출력이 글자까지 같은 것을 확인했다(2026-10-31).
 */

import { OFFICERS, TACTICS, type OfficerData } from '@samchess/data';
import { hash32 } from '@samchess/rules';
import type { OfficerId, PieceType, RosterEntry, TacticId } from '@samchess/rules';

export const PIECES: PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen', 'Pawn'];
/** 능력 선택 3종 (GDD §4.2) — HP +5 / MP +2 / AT +1 */
export const STATS = ['hp', 'mp', 'at'] as const;
export type StatPick = (typeof STATS)[number];

export interface RosterOptions {
  perSide: number;
  level: number;
  /**
   * 능력 선택 정책. **모든 장수에게 똑같이 적용**하므로 등급 비교에서는 상쇄된다.
   * `mix`가 기본인 이유: `hp`로 몰면 전원이 튼튼해져 **무력 차이가 묻힌다**.
   */
  statMode: StatPick | 'mix';
}

/** 레벨별로 고를 수 있는 책략 (GDD §3.7). 레벨업마다 한 종을 택한다 */
const TACTICS_BY_LEVEL = new Map<number, TacticId[]>();
for (const t of TACTICS) {
  const list = TACTICS_BY_LEVEL.get(t.level) ?? [];
  list.push(t.id as TacticId);
  TACTICS_BY_LEVEL.set(t.level, list.sort());
}

/** Lv2~`level`의 성장. 능력은 정책대로, 책략은 그 레벨의 선택지 중 시드로 하나. */
function growth(opts: RosterOptions, seed: number, salt: number): { statPicks: StatPick[]; tactics: TacticId[] } {
  const statPicks: StatPick[] = [];
  const tactics: TacticId[] = [];
  for (let lv = 2; lv <= opts.level; lv++) {
    const i = lv - 2;
    statPicks.push(opts.statMode === 'mix' ? STATS[i % STATS.length]! : opts.statMode);
    const choices = TACTICS_BY_LEVEL.get(lv) ?? [];
    if (choices.length > 0) tactics.push(choices[hash32(seed, salt * 331 + lv) % choices.length]!);
  }
  return { statPicks, tactics };
}

/**
 * 시드에서 결정적으로 편성을 뽑는다. King은 반드시 포함하고,
 * 나머지 기물은 매번 다르게 골라 **기물별 통계가 한쪽으로 쏠리지 않게** 한다.
 */
export function roster(opts: RosterOptions, seed: number, salt: number): RosterEntry[] {
  const rest = PIECES.filter((p) => p !== 'King');
  // Fisher–Yates를 해시로 돌린다 (Math.random 금지)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = hash32(seed, salt * 7717 + i) % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const pieces: PieceType[] = ['King', ...rest.slice(0, opts.perSide - 1)];
  const used = new Set<string>();
  return pieces.map((piece, i) => {
    let officer: OfficerData;
    let n = 0;
    do {
      officer = OFFICERS[hash32(seed, salt * 1000 + i * 37 + n++) % OFFICERS.length]!;
    } while (used.has(officer.id));   // 한 진영에 같은 장수를 두 번 넣을 수 없다
    used.add(officer.id);
    const g = growth(opts, seed, salt * 100 + i);
    return {
      officer: officer.id as OfficerId, piece, level: opts.level,
      statPicks: g.statPicks, tactics: g.tactics,
    };
  });
}
