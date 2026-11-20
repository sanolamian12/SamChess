/**
 * 규칙이 거부한 이유를 화면 언어로 (2026-09-18).
 *
 * `MetaResult`의 실패는 한국어 문장(`reason`)을 싣고, 번역할 수 있는 것은 `code`·`params`를
 * 함께 싣는다. 코드가 있으면 `reason.{code}` 문구로, 없으면 원문 그대로다.
 *
 * **서버가 400으로 돌려준 거절도 코드를 싣는다** (2026-11-20) — 예전에는 서버가 문장만 보내
 * 번역 문구가 있어도 열 언어 전부에서 한국어가 떴다. 받는 자리는 `client/src/meta/city.ts`의 `post()`다.
 * **이름은 id로 온다** — `officer` · `equipment` · `marketItem` 값을 그 언어 이름으로 바꿔 `{name}`에 끼운다.
 */

import { equipmentById, marketItemById } from '@samchess/data';
import { RuleRejected } from '@samchess/meta';
import type { ReasonParams } from '@samchess/meta';
import { t } from './index.ts';
import type { StringKey } from './index.ts';
import { pickEquipName, pickMarketItemName, pickOfficerNameById } from './story.ts';

/** id로 온 이름을 그 언어 이름으로 — 문구는 `{name}` 하나로 받는다 */
function withNames(params: ReasonParams | undefined): ReasonParams | undefined {
  if (!params) return params;
  const id = (k: string): string | undefined => (typeof params[k] === 'string' ? params[k] as string : undefined);
  const officer = id('officer');
  const equipment = id('equipment');
  const marketItem = id('marketItem');
  const name = officer !== undefined ? pickOfficerNameById(officer, officer)
    : equipment !== undefined ? (() => { const e = equipmentById.get(equipment); return e ? pickEquipName(e) : equipment; })()
    : marketItem !== undefined ? (() => { const m = marketItemById.get(marketItem); return m ? pickMarketItemName(m) : marketItem; })()
    : undefined;
  return name === undefined ? params : { ...params, name };
}

export function reasonText(r: { reason: string; code?: string | undefined; params?: ReasonParams | undefined }): string {
  return r.code ? t(`reason.${r.code}` as StringKey, withNames(r.params)) : r.reason;
}

/** 잡은 오류를 화면 글로 — 규칙의 거절(`RuleRejected`, 서버에 못 닿아 로컬로 계산한 길)은 번역, 그 밖은 메시지 그대로 */
export function errorText(e: unknown): string {
  if (e instanceof RuleRejected) return reasonText({ reason: e.message, code: e.code, params: e.params });
  return e instanceof Error ? e.message : String(e);
}
