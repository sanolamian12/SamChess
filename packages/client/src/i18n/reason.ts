/**
 * 규칙이 거부한 이유를 화면 언어로 (2026-09-18).
 *
 * `MetaResult`의 실패는 한국어 문장(`reason`)을 싣고, 번역할 수 있는 것은 `code`·`params`를
 * 함께 싣는다. 코드가 있으면 `reason.{code}` 문구로, 없으면 원문 그대로다 — 서버가 400으로
 * 돌려준 이유처럼 코드가 없는 것은 원문이 뜬다.
 */

import { t } from './index.ts';
import type { StringKey } from './index.ts';

export function reasonText(r: { reason: string; code?: string; params?: Record<string, number> }): string {
  return r.code ? t(`reason.${r.code}` as StringKey, r.params) : r.reason;
}
