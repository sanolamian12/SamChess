/**
 * 로딩 격언 — 도는 차례 (pptx 74쪽)
 *
 * 8초에 한 번 넘기는 것은 화면에서 **몇 분을 기다려야** 한 바퀴가 보인다. 차례를
 * 정하는 함수만 떼어 여기서 굴린다.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { LOADING_QUOTES, QUOTE_MS, quoteAt } from '../src/screens/loadingQuotes.ts';
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

test('한 문장이 머무는 시간은 8초다 (기획자 지정)', () => {
  assert.equal(QUOTE_MS, 8_000);
});

test('임시 목록의 문장마다 본문과 출전이 다 있다', () => {
  for (const q of LOADING_QUOTES) {
    assert.ok(q.text.trim().length > 0, '본문이 비었다');
    assert.ok(q.source.trim().length > 0, `출전이 비었다 — 「${q.text}」`);
  }
});
