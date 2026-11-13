/**
 * 안내 내관 문구 — **모든 안내에 「사용 안내」 제목이 있다** (2026-11-13). 다시 듣기 목록(`Steward`의 `guideTitle`)이 `guide.title.{id}`를 읽는데,
 * 안내를 더하며 제목을 빠뜨리면 목록에 열쇠 글자가 그대로 뜬다 — 타입 검사는 템플릿 열쇠를 못 본다(실제로 넷이 빠져 있었다).
 * 마디 문구는 `guideLines()`가 `t('guide.…')`를 글자 그대로 부르므로 타입 검사가 잡는다. 대사는 아직 한국어뿐이라 한국어 표만 본다.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { GUIDE_IDS } from '@samchess/meta';

const ko = JSON.parse(readFileSync(new URL('../src/i18n/strings/ko.json', import.meta.url), 'utf8')) as Record<string, string>;

test('안내마다 다시 듣기 목록의 제목이 있다', () => {
  const missing = GUIDE_IDS.filter((id) => !ko[`guide.title.${id}`]);
  assert.deepEqual(missing, [], `제목이 없는 안내: ${missing.join(', ')}`);
});
