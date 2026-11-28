/**
 * 아이템 한 개의 이름 · 효과 · 해설 · 그림 (2026-11-28 대장간 연구 개편).
 *
 * 장터 품목과 대장간 병기가 한 꼴(`ItemData`)이 되어 보관함 · 들려 보내기 · 장수 상세가 둘을 가리지 않는다. 글은 둘 다
 * `nameI18n?.[lang] ?? name` 규약이고, 다른 것은 그림 폴더(`market-items/` · `blacksmith/`)와 섬광(`itemBlink` · `equipBlink`)뿐이다.
 * 화면이 `source`를 직접 보고 갈래를 짓지 않게 이 파일 하나가 가른다.
 */
import type { ItemData } from '@samchess/data';
import { pickEquipLore, pickEquipName, pickEquipText, pickMarketItemLore, pickMarketItemName, pickMarketItemText } from '../i18n/story.ts';

export const isForged = (item: ItemData): boolean => item.source === 'forge';

export const itemName = (item: ItemData): string => (isForged(item) ? pickEquipName(item) : pickMarketItemName(item));
export const itemText = (item: ItemData): string => (isForged(item) ? pickEquipText(item) : pickMarketItemText(item));
export const itemLore = (item: ItemData): string => (isForged(item) ? pickEquipLore(item) : pickMarketItemLore(item));

/** 정사각 그림 — 보관함 · 장수 상세 · 부대의 칸 */
export const itemImage = (item: ItemData): string =>
  isForged(item) ? `blacksmith/${item.id}.png` : `market-items/${item.id}.png`;

/**
 * 날짜 `YY.MM.DD` — 언어와 무관한 꼴(보관함의 구매일 · 우편의 보낸 날). 없으면 「—」(지어낸 날을 적지 않는다).
 * 옛 대장간 화면(`ForgeScreen`의 제작일)에서 옮겨 왔다.
 */
export function formatMade(ms: number | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}
