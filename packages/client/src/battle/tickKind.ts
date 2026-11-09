import type { BattleEvent, BattleState } from '@samchess/rules';

/** 시간이 깎거나 채운 HP의 갈래 — 화면의 아이콘(`BattleScene.tickPopup`) */
export type TickKind = 'heal' | 'hurt' | 'fire';

/**
 * 시간이 깎거나 채운 HP가 무엇 때문인가 (`tickPopup`) — 시간이 아닌 HP 변화(공격 · 책략 · 고유기술 즉시분)는 `null`.
 * `dot` 이유는 하나라 출처를 이벤트가 안 싣는다(실으면 로그가 바뀌어 황금 재생이 깨진다). 장수에게 남은 상태로 가른다 —
 * 최대 HP 비율로 깎는 것(화소연영)은 불, 정해진 양(식소사번 · 질병 · 탈진)은 즉사 아이콘. 둘 다 걸려 있으면 양으로 가른다.
 */
export function tickKind(state: BattleState, ev: Extract<BattleEvent, { e: 'hpChanged' }>): TickKind | null {
  if (ev.reason === 'terrain:holy') return ev.delta > 0 ? 'heal' : null;
  if (ev.reason === 'terrain:fire') return 'fire';
  if (ev.reason !== 'dot') return null;
  const unit = state.units[ev.unit];
  const dots = unit?.statuses.filter((s) => s.status === 'dot') ?? [];
  const pct = dots.filter((s) => s.magnitudePct !== undefined);
  const flat = dots.filter((s) => s.magnitudePct === undefined);
  const amount = -ev.delta;
  if (pct.length && !flat.length) return 'fire';
  if (flat.length && !pct.length) return 'hurt';
  if (pct.length && flat.length) {
    return pct.some((s) => Math.floor(unit!.maxHp * s.magnitudePct!) === amount) && !flat.some((s) => (s.magnitude ?? 1) === amount)
      ? 'fire' : 'hurt';
  }
  return amount > 1 ? 'fire' : 'hurt';      // 이 통에서 풀린 상태 — 남은 것이 없으면 양으로
}

