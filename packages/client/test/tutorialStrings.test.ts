/**
 * 튜토리얼 대본의 문구 열쇠가 전부 있는가 (2026-10-24).
 *
 * 대본(`@samchess/meta`의 `tutorialStages`)은 열쇠를 **문자열로** 들고 있어 타입 검사가 못 본다 — 열쇠를 잘못 적으면
 * 화면에 열쇠 글자가 그대로 뜬다. 판이 선 튜토리얼 전부의 안내 · 끝맺음 열쇠가 한국어 문구에 있는지 본다.
 * (다른 아홉 언어는 아직 번역 전이다 — 없는 키는 `t()`가 한국어로 물러난다.)
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { ALL_TUTORIALS, lineKey, tutorialReady, tutorialStages } from '@samchess/meta';
import ko from '../src/i18n/strings/ko.json' with { type: 'json' };

test('판이 선 튜토리얼의 안내 · 끝맺음 열쇠가 전부 한국어 문구에 있다', () => {
  const missing: string[] = [];
  let seen = 0;
  for (const id of ALL_TUTORIALS.filter(tutorialReady)) {
    for (const stage of tutorialStages(id)) {
      const keys = [...stage.guide.flatMap((t) => t.phases.flatMap((p) => p.lines)), ...stage.outro].map(lineKey);
      for (const k of keys) {
        seen++;
        if (!(k in ko)) missing.push(`${id}: ${k}`);
      }
    }
  }
  assert.ok(seen > 50, `본 열쇠가 ${seen}개 — 대본을 제대로 훑었는가`);
  assert.deepEqual(missing, []);
});

test('안내 한 장은 짧다 — 한두 문장(2026-10-24 기획자: 「한 패널에 길게 담기지 않게」)', () => {
  const long = Object.entries(ko as Record<string, string>)
    .filter(([k, v]) => k.startsWith('tut.') && v.length > 70)
    .map(([k, v]) => `${k} (${v.length}자)`);
  assert.deepEqual(long, []);
});
