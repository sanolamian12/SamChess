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

import { officerById } from '@samchess/data';
import type { BattleEvent, BattleState } from './types.ts';
import type { EffectContext } from './effects.ts';
import { unitsOf } from './state.ts';

export type SkillScript = (state: BattleState, ctx: EffectContext, events: BattleEvent[]) => void;

/** scriptId → 핸들러. `uniqueSkills.json`의 `scriptId`와 키가 일치해야 한다. */
export const SKILL_SCRIPTS: Record<string, SkillScript> = {
  /**
   * 태사자 「소패왕전」 — 지정한 적과 **서로만** 공격할 수 있다.
   *
   * `applyStatus`는 `sourceUnit`을 언제나 시전자로 넣으므로, **대상 쪽 표식만** DSL로 걸 수 있다
   * (그 선언이 곧 "적 1명을 겨눈다"는 조준 규약이 된다). 상대를 가리켜야 하는
   * **시전자 쪽 표식**은 여기서 건다.
   * 둘 중 하나가 죽으면 남은 쪽의 표식도 의미를 잃는데,
   * `legalTargetsFor`가 죽은 대상을 후보에서 빼므로 자연히 풀린다.
   */
  duel(state, ctx, events) {
    const target = ctx.targetUnit;
    if (!target) throw new Error('소패왕전: 대상이 없다');
    // 대상 쪽 표식은 이미 DSL이 걸었다(sourceUnit = 시전자). 여기서는 시전자 쪽만.
    ctx.caster.statuses = ctx.caster.statuses.filter((s) => s.status !== 'mustTarget');
    ctx.caster.statuses.push({ status: 'mustTarget', sourceUnit: target.id });
    events.push({ e: 'statusApplied', unit: ctx.caster.id, status: 'mustTarget' });
  },

  /**
   * 제갈량 「차동풍」 — **이미 써버린** 아군의 고유기술을 다시 쓸 수 있게 한다 (GDD §12 B3).
   *
   * 안 쓴 스킬을 2회로 만드는 게 아니다. 그리고 제갈량 본인은 이 대가로
   * **게임이 끝날 때까지 비활성화**된다 — 자기 자신은 복구 대상에서 뺀다.
   */
  restoreAllyUniqueSkills(state, ctx, events) {
    for (const ally of unitsOf(state, ctx.caster.side)) {
      if (!ally.alive || ally.id === ctx.caster.id) continue;
      if (ally.uniqueSkillUses > 0) continue;              // 아직 안 쓴 유닛은 그대로
      if (!officerById.get(ally.officer)?.uniqueSkill) continue;  // C·D급은 스킬이 없다
      ally.uniqueSkillUses = 1;
      events.push({ e: 'uniqueSkillRestored', unit: ally.id });
    }
    ctx.caster.uniqueSkillUses = 0;
  },
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
