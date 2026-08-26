/**
 * 장수 열전(자·인물 서사) 언어 고르기 — `OfficerData.courtesyName`/`story`가
 * `@samchess/data`에서 언어별 맵(`Partial<Record<StoryLang, string>>`)으로
 * 오므로(2026-08-27, 열 언어 배선), 화면에 실제로 찍을 한 줄을 고르는 자리가
 * 하나 있어야 한다. `t()`가 번역 없는 키를 한국어로 물러나는 것과 같은
 * 규약 — **여기서만** 현재 UI 언어를 안다(`@samchess/data`는 클라이언트를
 * 모르므로 맵을 그대로 낼 뿐 언어를 못 고른다).
 */

import type { StoryLang } from '@samchess/data';
import { currentLang } from './index.ts';

export function pickStory(map: Partial<Record<StoryLang, string>> | undefined): string | undefined {
  if (!map) return undefined;
  return map[currentLang()] ?? map.ko;
}
