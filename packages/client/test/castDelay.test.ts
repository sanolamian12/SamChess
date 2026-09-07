/**
 * 고유기술 팝업의 **발동 시간** 줄 회귀 (2026-09-07 시전 지연, GDD §3.6)
 *
 * 두 가지를 못 박는다.
 *
 * 1. **열 언어에 문구가 다 있는가.** `t()`는 번역이 없으면 **한국어로 조용히
 *    물러난다** — 화면에는 「발동 시간」이 한글로 뜰 뿐 오류가 없어, 빠뜨려도
 *    아무도 모른다. `ko.json`만 `StringKey` 타입으로 보호되고 나머지 아홉은
 *    그 보호가 없으므로 여기서 막는다.
 *
 * 2. **`castDelay` 값과 문구가 맞는가.** 「즉시」를 늘 찍어도 「줄이 있는가」만
 *    보는 검사는 통과한다 — 기본값과 같은 값을 확인하면 아무것도 확인하지
 *    않는 것이다. 지연 13종과 나머지 27종을 **양쪽 다** 본다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { UNIQUE_SKILLS } from '@samchess/data';
import { LANGS, setLang, t, type Lang } from '../src/i18n/index.ts';
import { pickCastDelay } from '../src/i18n/story.ts';

const KEYS = ['skill.castDelay', 'skill.castDelay.instant', 'skill.castDelay.after'] as const;

const delayed = UNIQUE_SKILLS.filter((k) => k.castDelay > 0);
const instant = UNIQUE_SKILLS.filter((k) => k.castDelay <= 0);

test('발동 시간 문구가 열 언어에 모두 있다 — 없으면 한국어로 조용히 샌다', () => {
  const ko = Object.fromEntries(KEYS.map((k) => [k, (setLang('ko'), t(k))]));
  for (const { id } of LANGS) {
    if (id === 'ko') continue;
    setLang(id as Lang);
    for (const key of KEYS) {
      const s = t(key);
      assert.notEqual(s, key, `${id}: '${key}' 가 키 그대로 나온다`);
      assert.notEqual(s, ko[key], `${id}: '${key}' 번역이 없어 한국어로 물러났다`);
    }
  }
  setLang('ko');
});

test('지연 기술은 「0.3일 후」, 나머지는 「즉시」 — 열 언어 모두', () => {
  assert.ok(delayed.length > 0 && instant.length > 0, '양쪽 갈래가 다 있어야 검사가 뜻이 있다');

  for (const { id } of LANGS) {
    setLang(id as Lang);
    const instantWord = t('skill.castDelay.instant');

    for (const k of delayed) {
      const s = pickCastDelay(k);
      // 숫자는 언어와 무관하게 그대로 들어간다 — 「0.3」이 안 보이면 값이 안 실린 것이다
      assert.ok(s.includes((k.castDelay / 100).toFixed(1)),
        `${id} / ${k.name}: castDelay ${k.castDelay}가 문구에 없다 — "${s}"`);
      assert.notEqual(s, instantWord, `${id} / ${k.name}: 지연 기술인데 「즉시」로 나온다`);
    }

    for (const k of instant) {
      assert.equal(pickCastDelay(k), instantWord, `${id} / ${k.name}: 즉시여야 한다`);
    }
  }
  setLang('ko');
});

test('언어를 바꾸면 문구도 바뀐다 — 값이 굳어 있지 않다', () => {
  const sample = delayed[0]!;
  setLang('ko');
  const inKo = pickCastDelay(sample);
  setLang('ja');
  const inJa = pickCastDelay(sample);
  setLang('ko');
  assert.notEqual(inKo, inJa, '한국어와 일본어가 같으면 언어를 안 보고 있는 것이다');
});
