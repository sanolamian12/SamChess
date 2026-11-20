/**
 * 규칙이 거절한 것을 **코드째로** 던지고 받는 자리 (2026-11-20).
 *
 * `apply*`는 판정(`can*`)이 실패하면 던진다. 예전에는 `throw new Error(check.reason)`이라
 * 한국어 문장만 남고 `code`가 사라져, 서버가 400으로 돌려준 거절이 **열 언어 화면 전부에서 한국어**로 떴다
 * (번역 문구 `reason.{code}`가 있어도). 던지는 쪽은 `rejectWith(check)`, 받는 쪽은 `rejection(e)` 하나씩이다.
 */
import type { ReasonParams } from './types.ts';

export interface Rejection { reason: string; code?: string; params?: ReasonParams }

export class RuleRejected extends Error {
  readonly code: string | undefined;
  readonly params: ReasonParams | undefined;
  constructor(r: Rejection) {
    super(r.reason);
    this.name = 'RuleRejected';
    this.code = r.code;
    this.params = r.params;
  }
}

/** 실패한 판정을 그대로 던진다 — 문장 · 코드 · 값을 함께 */
export function rejectWith(check: Rejection): never {
  throw new RuleRejected(check);
}

/** 잡은 오류를 거절 모양으로 — 규칙의 거절이면 코드까지, 그 밖의 오류는 문장만 */
export function rejection(e: unknown, fallback = 'invalid action'): Rejection {
  if (e instanceof RuleRejected) {
    return { reason: e.message, ...(e.code ? { code: e.code } : {}), ...(e.params ? { params: e.params } : {}) };
  }
  return { reason: e instanceof Error ? e.message : fallback };
}
