/**
 * 긴 로딩 화면에 돌려 보여 줄 격언 (pptx 74쪽, 2026-09-18)
 *
 * ────────────────────────────────────────────────────────────────
 * ⚠ **임시 자리다 — 정본은 엑셀로 온다**
 * ────────────────────────────────────────────────────────────────
 *
 * 기획자가 동서양 고전(지혜서)에서 문장을 뽑는 중이고 **엑셀로 넘겨받을 예정**이다.
 * 오면 다른 기획 수치처럼 `docs/*.xlsx` → `tools/extract_data.py` →
 * `packages/data/generated/*.json`으로 들이고, 이 배열은 그 JSON을 읽는 한 줄로
 * 바뀐다 — **화면(`QuoteScroll`)은 이 모양(`{text, source}`)만 안다.**
 *
 * 지금 든 한 줄은 **74쪽 목업에 적힌 예문 그대로**다. 문장을 지어내 채우지 않는다 —
 * 출전을 적는 자리라 지어낸 인용은 틀린 인용이 된다.
 */

export interface LoadingQuote {
  /** 본문 — 화면 언어로 */
  text: string;
  /** 출전 — 「주역, 몽괘」처럼 책과 편. 앞의 줄표는 화면이 붙인다 */
  source: string;
}

export const LOADING_QUOTES: readonly LoadingQuote[] = [
  { text: '몽매함으로 바름을 기른다, 현명한 지혜를 감추고 백성을 다스려야 한다', source: '주역, 몽괘' },
];

/** 한 문장이 머무는 시간 — 8초에 한 번 바뀐다(기획자 지정). 페이드 인·아웃이 이 안에 든다 */
export const QUOTE_MS = 8_000;

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
