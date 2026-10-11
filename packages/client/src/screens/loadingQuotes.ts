/**
 * 긴 로딩 화면에 돌려 보여 줄 격언 (pptx 74쪽, 2026-09-18)
 *
 * 정본은 `docs/격언.xlsx`(2026-10-11) → `tools/extract_data.py` →
 * `packages/data/generated/quotes.json`이다. 기획자가 『정관정요』 독서 노트에서
 * **출전을 찾을 수 있는 문장만** 골랐다 — 여기서 문장을 더하거나 고치지 않는다.
 * **화면(`QuoteScroll`)은 이 모양(`{text, source}`)만 안다.**
 *
 * 언어는 장비 해설과 같은 규약이다 — 그 언어 번역이 없으면 한국어로 물러난다.
 * 본문과 출전은 함께 번역되므로(추출기가 검증) 한쪽만 외국어로 뜨는 일은 없다.
 */

import { QUOTES } from '@samchess/data';
import type { StoryLang } from '@samchess/data';

export interface LoadingQuote {
  /** 본문 — 화면 언어로 */
  text: string;
  /** 출전 — 「주역, 몽괘」처럼 책과 편. 앞의 줄표는 화면이 붙인다 */
  source: string;
}

/** 화면 언어로 고른 격언 목록 — 엑셀 번호 순서 그대로 */
export function loadingQuotes(lang: StoryLang): LoadingQuote[] {
  return QUOTES.map((q) => ({
    text: q.textI18n?.[lang] ?? q.text,
    source: q.sourceI18n?.[lang] ?? q.source,
  }));
}

/** 한 문장이 온전히 머무는 시간 — 5초(기획자 지정, 2026-10-12. 전에는 8초 안에 페이드가 들었다) */
export const QUOTE_HOLD_MS = 5_000;
/** 넘어가는 시간 — 지금 문장이 사라지고 다음 문장이 나타나는 1초가 **겹친다**(크로스페이드) */
export const QUOTE_FADE_MS = 1_000;
/** 한 바퀴 — 머무는 5초 + 넘어가는 1초. 넘어가는 순간 다음 문장의 5초가 시작된다 */
export const QUOTE_MS = QUOTE_HOLD_MS + QUOTE_FADE_MS;

/**
 * `start`에서 시작해 `step`번 넘긴 뒤의 문장. 목록이 비면 `null`.
 *
 * 시작점을 밖에서 받는 이유 — 매번 같은 첫 문장이면 대기를 몇 번 겪은 사람은 첫
 * 8초를 늘 같은 글로 보낸다. 화면이 한 번 굴려 넣는다(판정이 아니라 연출이라
 * 룰 엔진의 「난수 금지」와 무관하다).
 */
export function quoteAt(quotes: readonly LoadingQuote[], start: number, step: number): LoadingQuote | null {
  if (quotes.length === 0) return null;
  const i = ((start + step) % quotes.length + quotes.length) % quotes.length;
  return quotes[i]!;
}
