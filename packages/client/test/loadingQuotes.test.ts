/**
 * 로딩 격언 — 도는 차례 (pptx 74쪽)
 *
 * 8초에 한 번 넘기는 것은 화면에서 **몇 분을 기다려야** 한 바퀴가 보인다. 차례를
 * 정하는 함수만 떼어 여기서 굴린다.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { QUOTES } from '@samchess/data';
import { QUOTE_FADE_MS, QUOTE_HOLD_MS, QUOTE_MS, loadingQuotes, quoteAt } from '../src/screens/loadingQuotes.ts';
import type { LoadingQuote } from '../src/screens/loadingQuotes.ts';

const Q: LoadingQuote[] = [
  { text: 'a', source: 'A' }, { text: 'b', source: 'B' }, { text: 'c', source: 'C' },
];

test('시작점에서 한 칸씩 넘기고, 끝에서 처음으로 돈다', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => quoteAt(Q, 1, s)!.text), ['b', 'c', 'a', 'b', 'c']);
});

test('목록이 비면 아무것도 안 준다 — 두루마리는 빈 종이로 선다', () => {
  assert.equal(quoteAt([], 0, 5), null);
});

test('한 문장은 5초 머물고 1초 동안 다음 문장과 겹쳐 넘어간다 (기획자 지정)', () => {
  assert.equal(QUOTE_HOLD_MS, 5_000);
  assert.equal(QUOTE_FADE_MS, 1_000);
  assert.equal(QUOTE_MS, 6_000);
});

test('엑셀의 격언이 실려 오고, 문장마다 본문과 출전이 다 있다', () => {
  // 0개면 두루마리가 빈 종이로 서고 아래 검사는 아무것도 안 본다
  assert.ok(QUOTES.length >= 2, `격언이 ${QUOTES.length}개뿐이다 — 돌지 않는다`);
  for (const q of loadingQuotes('ko')) {
    assert.ok(q.text.trim().length > 0, '본문이 비었다');
    assert.ok(q.source.trim().length > 0, `출전이 비었다 — 「${q.text}」`);
  }
});

test('번역이 없는 언어는 한국어로 물러나고, 있는 언어는 본문·출전을 함께 바꾼다', () => {
  const ko = loadingQuotes('ko');
  const en = loadingQuotes('en');
  assert.equal(en.length, ko.length);
  QUOTES.forEach((q, i) => {
    assert.equal(en[i]!.text, q.textI18n?.en ?? q.text);
    assert.equal(en[i]!.source, q.sourceI18n?.en ?? q.source);
  });
  // 번역이 하나도 없는 지금 이 검사가 「기본값과 같은 값」만 보지 않게 가짜 행으로 갈래를 연다
  const fake = { no: 1, text: '가', source: '나', textI18n: { en: 'A' }, sourceI18n: { en: 'B' } };
  QUOTES.unshift(fake);
  try {
    assert.deepEqual(loadingQuotes('en')[0], { text: 'A', source: 'B' });
    assert.deepEqual(loadingQuotes('ja')[0], { text: '가', source: '나' });
  } finally {
    QUOTES.shift();
  }
});
