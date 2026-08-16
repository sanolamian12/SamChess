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
import {
  DRIFT_MS, DRIFT_PATH, DRIFT_ZOOM, driftPose, driftTransform,
} from '../src/screens/backdropMotion.ts';
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

/* ── 배경의 움직임 (2026-08-15) ────────────────────────────────
   눈으로 잡기 가장 어려운 것이 「어쩌다 한 자세에서만 끝에 띠가 보인다」이다.
   여덟 자세를 전부 계산해 두는 편이 확실하다. */

test('움직임 — 밀어내는 거리가 확대 여백을 넘지 않는다 ★', () => {
  // `transform: scale(s) translate(x%, y%)` 에서
  //   · 확대로 한쪽에 생기는 여유 = (s − 1) / 2
  //   · 실제로 밀리는 거리      = s × x / 100   (scale 을 먼저 적었으므로 함께 커진다)
  // 뒤가 앞을 넘으면 반대쪽에 바탕색 띠가 드러난다.
  for (const [i, p] of DRIFT_PATH.entries()) {
    const s = DRIFT_ZOOM * p.z;
    const room = (s - 1) / 2;
    assert.ok(s > 1, `${i}번 자세: 확대가 1보다 커야 여백이 생긴다`);
    assert.ok((s * Math.abs(p.x)) / 100 < room, `${i}번 자세: 가로로 넘쳤다`);
    assert.ok((s * Math.abs(p.y)) / 100 < room, `${i}번 자세: 세로로 넘쳤다`);
  }
});

test('움직임 — 걸음은 계속 늘어나고 자세만 감긴다', () => {
  // 걸음 수를 0으로 되돌리면 그 한 번만 이동 거리가 커져 그림이 튄다
  const n = DRIFT_PATH.length;
  assert.deepEqual(driftPose(0), driftPose(n));
  assert.deepEqual(driftPose(3), driftPose(3 + n * 5));
  assert.deepEqual(driftPose(-1), driftPose(n - 1));   // 음수도 안전하게 감긴다
});

test('움직임 — 한 걸음이 「약간」이다', () => {
  // 기획자 지정은 「2~3초 간격으로 약간씩」. 이웃한 자세 사이가 벌어지면
  // 「살아 있다」가 아니라 「미끄러진다」로 보인다.
  assert.ok(DRIFT_MS >= 2000 && DRIFT_MS <= 3000, `${DRIFT_MS}ms`);
  for (let i = 0; i < DRIFT_PATH.length; i++) {
    const a = DRIFT_PATH[i]!;
    const b = DRIFT_PATH[(i + 1) % DRIFT_PATH.length]!;   // 마지막 → 처음도 한 걸음이다
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(d > 0 && d < 2, `${i}→${i + 1} 걸음이 ${d.toFixed(2)}%`);
  }
});

test('움직임 — transform 문자열은 scale 이 먼저다', () => {
  // 순서를 뒤집으면 밀리는 거리가 배율만큼 달라져 위의 여백 계산이 어긋난다
  assert.equal(driftTransform(0), 'scale(1.0600) translate(0%, 0%)');
  assert.match(driftTransform(3), /^scale\([\d.]+\) translate\(/);
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
