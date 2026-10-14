/**
 * 컬렉션의 글을 지금 언어로 (2026-10-14, 컬렉션 다국어).
 *
 * - **제목 · 설명 · 상세 설명 · 간체 한자**는 엑셀 「다국어」 시트의 번역(`*I18n`)을 고르고, 없으면 한국어로 물러난다
 *   (`pickStory`와 같은 규약 — 언어를 아는 자리는 클라이언트뿐이다).
 * - **시대 이름**은 문구 키(`collection.era.{n}`)다 — 여덟 개뿐이라 데이터에 언어 열을 달 까닭이 없다.
 * - **효과 글은 번역하지 않고 `effect`에서 조립한다.** 꼴이 넷(능력치 · 고유기술 SP · 진영 SP · 도시)뿐이라 틀 문장만
 *   언어마다 두고, 장수 · 고유기술 이름은 이미 있는 다국어 이름을 끼운다. 117 × 9문장을 따로 번역하면 수치를 고칠 때
 *   아홉 언어가 한꺼번에 낡는다. 엑셀의 「효과 (읽는 글)」은 한국어 정본으로 남고, **조립한 한국어가 그 글과 같은지**
 *   `test/collectionText.test.ts`가 117개 전부 본다 — 둘이 갈라지면 테스트가 깨진다.
 */

import { officerById, skillById } from '@samchess/data';
import type { CollectionCondition, CollectionData, CollectionStat } from '@samchess/data';
import { RAID_LOOT_PCT } from '@samchess/meta';
import { currentLang, t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { pickOfficerName, pickSkillName, pickStory } from '../i18n/story.ts';

export const collectionTitle = (c: CollectionData): string => pickStory(c.displayTitleI18n) ?? c.displayTitle;
export const collectionDesc = (c: CollectionData): string => pickStory(c.descI18n) ?? c.desc;
export const collectionLore = (c: CollectionData): string => pickStory(c.loreI18n) ?? c.lore;
export const collectionHanja = (c: CollectionData): string => c.hanjaI18n?.[currentLang()] ?? c.hanja;

/** 「황건 · 반동탁 (184~192)」 — 연도가 없는 장(열전)은 이름만 */
export function eraText(c: CollectionData): string {
  const name = t(`collection.era.${c.era}` as StringKey);
  return c.eraYears ? t('collection.eraYears', { name, years: c.eraYears }) : name;
}

const STAT_KEY: Record<CollectionStat, StringKey> = {
  might: 'collection.fx.stat.might',
  intellect: 'collection.fx.stat.intellect',
  leadership: 'collection.fx.stat.leadership',
  hp: 'collection.fx.stat.hp',
  mp: 'collection.fx.stat.mp',
  at: 'collection.fx.stat.at',
};

const names = (ids: readonly string[]): string =>
  ids.map((id) => { const o = officerById.get(id); return o ? pickOfficerName(o) : id; }).join(t('collection.fx.join'));

/** 조건 한 마디 — 「유비 함께 참전 시」 · 「적진에 여포 시」 · 둘 다 · 「… 중 3명 이상」. 조건이 없으면 `null` */
function condition(c: CollectionCondition): string | null {
  if (c.with && c.vs) return t('collection.fx.cond.withVs', { with: names(c.with), vs: names(c.vs) });
  if (c.with && c.min) return t('collection.fx.cond.withMin', { with: names(c.with), n: c.min });
  if (c.with) return t('collection.fx.cond.with', { with: names(c.with) });
  if (c.vs) return t('collection.fx.cond.vs', { vs: names(c.vs) });
  return null;
}

export function effectLine(c: CollectionData): string {
  const e = c.effect;
  switch (e.kind) {
    case 'stat': {
      const vars = { who: names(e.who), stat: t(STAT_KEY[e.stat]), v: e.value };
      const cond = condition(e);
      return cond ? t('collection.fx.statIf', { ...vars, cond }) : t('collection.fx.stat', vars);
    }
    case 'skillSp': {
      const sk = skillById.get(e.skill);
      const from = sk?.spCost ?? 0;
      return t('collection.fx.skillSp', {
        who: names(e.who), skill: sk ? pickSkillName(sk) : e.skill, from, to: from + e.delta,
      });
    }
    case 'teamSp':
      return t('collection.fx.teamSp', { cond: condition(e) ?? '', v: e.value });
    case 'city': {
      // 「도적 1명당 10% → 9%」의 10은 계산(`raidLootPct()`)이 빼기 시작하는 바로 그 상수다
      const base = RAID_LOOT_PCT;
      return t(`collection.fx.city.${e.key}` as StringKey, { v: e.value, from: base, to: base - e.value });
    }
  }
}
