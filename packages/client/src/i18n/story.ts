/**
 * 장수 열전(자·인물 서사) 언어 고르기 — `OfficerData.courtesyName`/`story`가
 * `@samchess/data`에서 언어별 맵(`Partial<Record<StoryLang, string>>`)으로
 * 오므로(2026-08-27, 열 언어 배선), 화면에 실제로 찍을 한 줄을 고르는 자리가
 * 하나 있어야 한다. `t()`가 번역 없는 키를 한국어로 물러나는 것과 같은
 * 규약 — **여기서만** 현재 UI 언어를 안다(`@samchess/data`는 클라이언트를
 * 모르므로 맵을 그대로 낼 뿐 언어를 못 고른다).
 */

import type { OfficerData, StoryLang, TacticData, UniqueSkillData } from '@samchess/data';
import { officerById } from '@samchess/data';
import { currentLang } from './index.ts';

export function pickStory(map: Partial<Record<StoryLang, string>> | undefined): string | undefined {
  if (!map) return undefined;
  return map[currentLang()] ?? map.ko;
}

/**
 * 장수 이름 — 지금 UI 언어의 표기(`nameI18n`)가 있으면 그것을, 없으면 한국어
 * (`OfficerData.name`, 기준 언어)를 낸다. `pickStory`와 같은 규약이지만 이쪽은
 * 맵이 아예 없거나 그 언어 키가 없을 때 물러날 곳이 "빈 문자열"이 아니라
 * "한국어 이름 자체"라 함수를 따로 둔다 — 장수 이름은 `courtesyName`/`story`와
 * 달리 화면에 안 뜨는 자리가 없어야 한다(카드 제목·목록·검색 등).
 */
export function pickOfficerName(officer: Pick<OfficerData, 'name' | 'nameI18n'>): string {
  return officer.nameI18n?.[currentLang()] ?? officer.name;
}

/**
 * `pickOfficerName`을 장수 id로 부르는 자리 — `@samchess/meta`의 행 타입
 * (`OfficerRankRow` 등)이 화면 만들 때 뽑아 둔 **평평한 `name: string`**을
 * 들고 있어(그 자리에서 `nameI18n`까지 복제하려면 meta가 언어를 알아야 한다),
 * 화면이 `officerById`로 다시 찾아 고른다. id가 안 걸리면(있을 수 없지만)
 * 그 평평한 이름으로 물러난다.
 */
export function pickOfficerNameById(id: string, fallback: string): string {
  const o = officerById.get(id);
  return o ? pickOfficerName(o) : fallback;
}

/**
 * 고유기술 명 — `pickOfficerName`과 같은 규약. `nameI18n`이 없거나 지금 언어
 * 키가 없으면 한국어(`name`)로 물러난다(기술명도 화면에 안 뜨는 자리가 없어야
 * 한다).
 */
export function pickSkillName(skill: Pick<UniqueSkillData, 'name' | 'nameI18n'>): string {
  return skill.nameI18n?.[currentLang()] ?? skill.name;
}

/**
 * 고유기술 효과 서술 — `pickOfficerName`과 같은 규약(물러날 곳이 「한국어
 * 그 자체」). `origin`(`pickStory`, 없으면 줄째로 사라짐)과 다르게 효과
 * 서술은 항상 뜨는 자리라 함수를 따로 둔다.
 */
export function pickSkillText(skill: Pick<UniqueSkillData, 'text' | 'textI18n'>): string {
  return skill.textI18n?.[currentLang()] ?? skill.text;
}

/**
 * 책략명 — `pickSkillName`과 같은 규약. 원본은 `assets/Languages/sam_tactics.csv`
 * (2026-09-03에 붙었다 — 그전에는 소스가 없어 언제나 한국어로 물러났고, 이
 * 함수는 그때 이미 맞게 쓰여 있어서 **한 줄도 안 고쳤다**).
 */
export function pickTacticName(tactic: Pick<TacticData, 'name' | 'nameI18n'>): string {
  return tactic.nameI18n?.[currentLang()] ?? tactic.name;
}

/** 책략 효과 서술 — `pickTacticName`과 같은 사정 */
export function pickTacticText(tactic: Pick<TacticData, 'text' | 'textI18n'>): string {
  return tactic.textI18n?.[currentLang()] ?? tactic.text;
}
