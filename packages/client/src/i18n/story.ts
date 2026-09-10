/**
 * 장수 열전(자·인물 서사) 언어 고르기 — `OfficerData.courtesyName`/`story`가
 * `@samchess/data`에서 언어별 맵(`Partial<Record<StoryLang, string>>`)으로
 * 오므로(2026-08-27, 열 언어 배선), 화면에 실제로 찍을 한 줄을 고르는 자리가
 * 하나 있어야 한다. `t()`가 번역 없는 키를 한국어로 물러나는 것과 같은
 * 규약 — **여기서만** 현재 UI 언어를 안다(`@samchess/data`는 클라이언트를
 * 모르므로 맵을 그대로 낼 뿐 언어를 못 고른다).
 */

import type { EquipmentData, OfficerData, StoryLang, TacticData, UniqueSkillData } from '@samchess/data';
import { officerById, tacticById } from '@samchess/data';
import { currentLang, t } from './index.ts';

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
 * 고유기술 **발동 시간** — 「즉시」인가 「0.3일 후」인가 (2026-09-07 시전 지연).
 *
 * 위의 `pick*`들과 달리 데이터에 번역 문장이 없다 — `castDelay`는 **숫자**라
 * 문장을 여기서 짓는다. 그래서 `t()`(화면 문구 표)를 쓰는 유일한 `story.ts`
 * 함수다. 다른 형제들처럼 **언어를 아는 자리는 여기 하나**라는 규약은 그대로다.
 *
 * 일(日) 환산은 데이터 쪽과 같은 규약이다 — `time 100 = 1일`
 * (`tools/extract_data.py`의 `to_days()`가 효과 서술에 쓰는 것과 같은 눈금).
 * **화면이 이 계산을 다시 적지 않는다** — 눈금이 바뀌면 조용히 어긋난다.
 */
export function pickCastDelay(skill: Pick<UniqueSkillData, 'castDelay'>): string {
  if (skill.castDelay <= 0) return t('skill.castDelay.instant');
  return t('skill.castDelay.after', { d: (skill.castDelay / 100).toFixed(1) });
}

/**
 * 같은 것의 **한 줄 형태** — 「발동 시간 0.3일 후」.
 *
 * 팝업(`SkillModal`)은 라벨과 값을 각각 다른 칸에 그리지만, 전투 화면의 세 자리는
 * `·`로 이어 붙인 한 줄이라(살펴보기 툴팁 · 못 쓰는 기술 툴팁 · 시전 확인창)
 * 합성을 여기 한 번만 적는다. 셋에 따로 적으면 언젠가 한 곳만 낡는다.
 */
export function castDelayNote(skill: Pick<UniqueSkillData, 'castDelay'>): string {
  return `${t('skill.castDelay')} ${pickCastDelay(skill)}`;
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

/**
 * 책략명·효과를 **id로** 고르는 자리 — `pickOfficerNameById`와 완전히 같은
 * 사정이다. `@samchess/meta`의 행 타입(`OfficerRankRow.tactics`)이 화면 만들
 * 때 뽑아 둔 **평평한 `{name, text}`**를 들고 있어(meta가 언어를 알면 안
 * 되므로 맵째 복제하지 않는다), 화면이 `tacticById`로 다시 찾아 고른다.
 *
 * 이게 없어서 장수 카드의 책략 칩만 다른 언어 화면에서 **혼자 한국어**로
 * 떠 있었다(2026-09-03) — 나머지 자리는 전부 `tacticById`를 직접 들고 있어
 * `pickTacticName`을 이미 부르고 있었다.
 */
export function pickTacticNameById(id: string, fallback: string): string {
  const x = tacticById.get(id);
  return x ? pickTacticName(x) : fallback;
}

/** 위와 같은 규약의 효과 서술(칩의 `title`) */
export function pickTacticTextById(id: string, fallback: string): string {
  const x = tacticById.get(id);
  return x ? pickTacticText(x) : fallback;
}

/**
 * 대장간 장비의 효과 한 줄 — `pickTacticText`와 완전히 같은 규약이다 (2026-09-10).
 *
 * **부르는 자리가 셋이라 함수로 둔다** — 대장간 상세 패널 · 장수 카드
 * (`OfficerCardModal`) · 장수 상세(`OfficerDetailScreen`). 셋이 각자
 * `textI18n?.[lang] ?? text`를 다시 적으면 한 군데만 빠뜨렸을 때 **그 화면에서만**
 * 한국어로 남는데, 그건 책략 칩이 실제로 밟았던 지뢰다(위 `pickTacticNameById` 참조).
 */
export function pickEquipText(item: Pick<EquipmentData, 'text' | 'textI18n'>): string {
  return item.textI18n?.[currentLang()] ?? item.text;
}

/**
 * 대장간 장비의 이름 — 위와 같은 규약. **부르는 자리가 여섯이다**(대장간의
 * `equipLabel`·목록 카드·상세 명패, 장수 카드, 장수 상세, 지급 표의 「병기」 칸).
 */
export function pickEquipName(item: Pick<EquipmentData, 'name' | 'nameI18n'>): string {
  return item.nameI18n?.[currentLang()] ?? item.name;
}

/** 장비의 유래 해설 — 위와 같은 규약(원본만 엑셀의 `해설_{lang}` 열이다) */
export function pickEquipLore(item: Pick<EquipmentData, 'lore' | 'loreI18n'>): string {
  return item.loreI18n?.[currentLang()] ?? item.lore;
}
