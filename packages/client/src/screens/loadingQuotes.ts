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
/**
 * 넘어가는 시간 — 왼쪽에서 오른쪽으로 쓸고 지나가는 경계를 따라 옛 글이 지워지고
 * 새 글이 입혀진다(기획자 지정, 2026-10-12 — 「2~3초」 중 2초). 두 글의 경계가 **같은
 * 자리**를 지나므로 지워진 자리에 곧바로 새 글이 선다.
 */
export const QUOTE_WIPE_MS = 2_000;
/** 한 바퀴 — 쓸어 넘기는 2초 + 머무는 5초 */
export const QUOTE_MS = QUOTE_WIPE_MS + QUOTE_HOLD_MS;
/**
 * 첫 문장이 입혀지기 시작하는 때 — 두루마리가 다 펴진 뒤(`style.css`의 `.srl-full`이
 * 0.6초에 켜진다. 펴는 시간표는 CSS가 쥐므로 이 값은 그 짝이다)
 */
export const QUOTE_FIRST_DELAY_MS = 600;
/** 첫 문장이 바뀌기까지 — 펴질 때까지 기다리고, 입혀지고, 5초 머문다 */
export const QUOTE_FIRST_MS = QUOTE_FIRST_DELAY_MS + QUOTE_MS;

/**
 * `start`에서 시작해 `step`번 넘긴 뒤의 문장. 목록이 비면 `null`.
 *
 * 시작점을 밖에서 받는 이유 — 매번 같은 첫 문장이면 대기를 몇 번 겪은 사람은 첫
 * 몇 초를 늘 같은 글로 보낸다. 화면이 한 번 굴려 넣는다(판정이 아니라 연출이라
 * 룰 엔진의 「난수 금지」와 무관하다).
 */
export function quoteAt(quotes: readonly LoadingQuote[], start: number, step: number): LoadingQuote | null {
  if (quotes.length === 0) return null;
  const i = ((start + step) % quotes.length + quotes.length) % quotes.length;
  return quotes[i]!;
}
