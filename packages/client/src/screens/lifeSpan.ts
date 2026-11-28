/**
 * 장수의 생몰년 — 펼친 열전 판의 제목 옆 「(155 ~ 220 AD)」 (2026-11-28 기획자).
 *
 * 둘 다 알면 「(155 ~ 220 AD)」, 한쪽만 알면 모르는 쪽을 「?」로(「(? ~ 220 AD)」), 둘 다 모르면 「(Unknown)」 — 언어마다 그 말만 바뀐다
 * (`ranking.card.lifeUnknown`). 데이터는 `OfficerData.life`(정사로 확인되는 해만, `tools/officer_life.json`).
 */

export interface LifeYears {
  born: number | null;
  died: number | null;
}

/** 괄호까지 붙인 글 — `unknown`은 둘 다 모를 때 쓰는 그 언어의 말 */
export function lifeSpanText(life: LifeYears | undefined, unknown: string): string {
  const born = life?.born ?? null;
  const died = life?.died ?? null;
  if (born === null && died === null) return `(${unknown})`;
  return `(${born ?? '?'} ~ ${died ?? '?'} AD)`;
}
