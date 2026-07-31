/**
 * 서사형 고유기술 스크립트 핸들러 (GDD §4.4)
 *
 * Effect DSL로 접히지 않는 S급 스킬만 여기 온다 — 「화용도」(사망 후 부활),
 * 「삼고초려」(3회 피격 시 아군화)처럼 **전투 중 다른 시점에 다시 개입해야 하는** 것들이다.
 * 그 외에는 전부 데이터(`SKILL_EFFECTS`)로 적고 `effects.ts`가 해석한다.
 *
 * 핸들러는 시전 순간에 한 번 불린다. 나중에 다시 개입해야 하면
 * 유닛에 표식(상태이상 등)을 남겨 두고, 실제 개입은 그 표식을 보는 쪽에서 한다.
 */

import type { BattleEvent, BattleState } from './types.ts';
import type { EffectContext } from './effects.ts';

export type SkillScript = (state: BattleState, ctx: EffectContext, events: BattleEvent[]) => void;

/** scriptId → 핸들러. `uniqueSkills.json`의 `scriptId`와 키가 일치해야 한다. */
export const SKILL_SCRIPTS: Record<string, SkillScript> = {
  // S급 30종은 다음 단계에서 채운다 (HANDOFF §7 4번).
};

export const hasSkillScript = (scriptId: string): boolean => scriptId in SKILL_SCRIPTS;

export function runSkillScript(
  state: BattleState,
  scriptId: string,
  ctx: EffectContext,
  events: BattleEvent[],
): void {
  const script = SKILL_SCRIPTS[scriptId];
  if (!script) throw new Error(`구현되지 않은 스킬 스크립트: ${scriptId}`);
  script(state, ctx, events);
}
