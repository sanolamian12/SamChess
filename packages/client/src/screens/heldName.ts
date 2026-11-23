/**
 * [아이템] 단추 가운데에 쓰는 지닌 것의 이름 (2026-11-23 기획자).
 *
 * 단추는 한 줄이다 — 이름이 길어 접히는 언어 · 아이템만 `SHORT`에 더 짧고 쉬운 말을 둔다. 없으면 본래 이름
 * (`pickMarketItemName` · `pickEquipName`, 원본은 엑셀). 어느 것이 접히는지는 `tools/held_label_ux.ts`가 열 언어 × 전부를 재서 말한다 —
 * 이름이 바뀌거나 아이템이 늘면 다시 돌린다.
 */
import { equipmentById, marketItemById } from '@samchess/data';
import { currentLang } from '../i18n/index.ts';
import type { Lang } from '../i18n/index.ts';
import { pickEquipName, pickMarketItemName } from '../i18n/story.ts';

const SHORT: Partial<Record<Lang, Record<string, string>>> = {};

export function heldButtonName(id: string): string {
  const short = SHORT[currentLang()]?.[id];
  if (short) return short;
  const item = marketItemById.get(id);
  if (item) return pickMarketItemName(item);
  const equip = equipmentById.get(id);
  return equip ? pickEquipName(equip) : id;
}
