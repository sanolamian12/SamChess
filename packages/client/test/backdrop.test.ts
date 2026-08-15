/**
 * 배경 회귀 — 시간대 경계와 자리 그림 (pptx 33~36쪽)
 *
 * 눈으로는 확인하기 어려운 규칙들이다. 「밤 그림」은 **밤에 접속해야** 보이고,
 * 도시 레벨 5짜리 계정은 만들어야 생긴다. 시각을 넣어 물어보는 것이 유일한 길이다.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  bandForHour, currentBand, mainBackdrop, openBackdrop, placeBackdrop, placeTier, PLACES,
} from '../src/screens/backdrop.ts';
import { LANGS, BASE_LANG, t, currentLang, setLang } from '../src/i18n/index.ts';

test('시간대 경계 — 7시 · 16시 · 20시 (기획자 지정)', () => {
  // 07:00 ~ 15:59 낮
  assert.equal(bandForHour(7), 'day');
  assert.equal(bandForHour(12), 'day');
  assert.equal(bandForHour(15), 'day');
  // 16:00 ~ 19:59 황혼
  assert.equal(bandForHour(16), 'dusk');
  assert.equal(bandForHour(19), 'dusk');
  // 20:00 ~ 다음날 06:59 밤
  assert.equal(bandForHour(20), 'night');
  assert.equal(bandForHour(23), 'night');
});

test('밤은 자정을 넘어 이어진다 — 새벽도 밤이다', () => {
  // 「20 <= h < 7」로 적으면 언제나 거짓이 되어 밤 그림이 영영 안 나온다
  for (const h of [0, 1, 3, 5, 6]) assert.equal(bandForHour(h), 'night', `${h}시`);
});

test('하루 24시간이 빠짐없이 셋 중 하나에 든다', () => {
  const seen = new Set<string>();
  for (let h = 0; h < 24; h++) seen.add(bandForHour(h));
  assert.deepEqual([...seen].sort(), ['day', 'dusk', 'night']);
});

test('지금 시각도 셋 중 하나다 — 시계를 밖에서 넣는다', () => {
  assert.equal(currentBand(new Date(2026, 7, 15, 9, 30)), 'day');
  assert.equal(currentBand(new Date(2026, 7, 15, 18, 0)), 'dusk');
  assert.equal(currentBand(new Date(2026, 7, 15, 2, 0)), 'night');
  assert.ok(['day', 'dusk', 'night'].includes(currentBand()));
});

test('도시 레벨 → 자리 그림 (1~4는 첫째, 5 이상은 둘째)', () => {
  for (const lv of [1, 2, 3, 4]) assert.equal(placeTier(lv), 1, `Lv${lv}`);
  for (const lv of [5, 6, 7, 8, 9]) assert.equal(placeTier(lv), 2, `Lv${lv}`);
});

test('그림 경로는 도구가 굽는 이름과 같다', () => {
  // `tools/build_backgrounds.py`의 STRIPS 가 이 이름으로 굽는다. 한쪽만 바꾸면 404다.
  // 확장자도 마찬가지다 — 고해상도 원본을 쓰면서 PNG → JPG 로 함께 바뀌었다(2026-08-15).
  assert.equal(openBackdrop('night'), 'backgrounds/open-night.jpg');
  assert.equal(mainBackdrop('day'), 'backgrounds/main-day.jpg');
  assert.equal(placeBackdrop('barracks', 1), 'backgrounds/place-1-barracks.jpg');
  assert.equal(placeBackdrop('barracks', 7), 'backgrounds/place-2-barracks.jpg');
});

test('도시의 자리는 궁궐·병영·장터 셋이다', () => {
  // 넷째 칸(`extra`)은 연결점이 정해지지 않아 화면에 아직 없다
  assert.deepEqual([...PLACES], ['palace', 'barracks', 'market']);
});

test('다국어 — 번역이 없으면 한국어로 물러난다', () => {
  assert.equal(currentLang(), BASE_LANG);
  assert.equal(t('game.title'), '만민의 삼국지');
  setLang('en');
  // 영어 문구는 별도 세션에서 온다. 그때까지 한국어가 뜬다 — 키가 그대로 뜨면 안 된다
  assert.equal(t('game.title'), '만민의 삼국지');
  setLang(BASE_LANG);
});

test('다국어 — 다섯 언어, 자리는 `{n}`으로 채운다', () => {
  assert.deepEqual(LANGS.map((l) => l.id), ['ko', 'en', 'pt', 'ja', 'zh']);
  // 숫자를 이어 붙이지 않는 이유는 언어마다 자리가 다르기 때문이다
  assert.equal(t('barracks.needGrain', { n: 3 }), '군량 3');
  assert.equal(t('barracks.shortGrain', { n: 5, have: 2 }), '군량 5 — 2밖에 없다');
});
