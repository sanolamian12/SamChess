/**
 * 장수 열전의 첫머리(`loreTeaser`) — 접힌 판에 싣는 「첫 문장」 (2026-11-27 기획자)
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { OFFICERS } from '@samchess/data';
import { TEASER_MAX, loreTeaser } from '../src/screens/loreTeaser.ts';

const WIDE = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯＀-￯]/;
const width = (s: string): number => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);

test('첫머리 — 첫 문장이 짧으면 그대로', () => {
  assert.equal(loreTeaser('오의 대도독. 무인에 지나지 않던 그가 책을 들었다.'), '오의 대도독.');
  assert.equal(loreTeaser('The Grand Commander of Wu. He read books.'), 'The Grand Commander of Wu.');
  assert.equal(loreTeaser('吴国大都督。他读书。'), '吴国大都督。');
});

test('첫머리 — 괄호 속 풀이는 뺀다(펼친 판에만 있다)', () => {
  assert.equal(loreTeaser('조조의 참모(작전을 짜 주는 신하). 앞일을 꿰뚫어 보았다.'), '조조의 참모.');
  assert.equal(loreTeaser('촉한의 승상（나라를 다스리는 신하）。他读书。'), '촉한의 승상。');
});

test('첫머리 — 한국어 열전은 자르지 않고 첫 문장 그대로 든다(쉬운 말, 2026-11-28)', () => {
  for (const o of OFFICERS) {
    const ko = o.story?.ko;
    if (!ko) continue;
    assert.ok(!loreTeaser(ko).endsWith('…'), `${o.id}: ${loreTeaser(ko)}`);
  }
});

test('첫머리 — 숫자 속 마침표에서 자르지 않는다', () => {
  assert.equal(loreTeaser('Born in 3.5 era. Then left.', 40), 'Born in 3.5 era.');
});

test('첫머리 — 긴 첫 문장은 쉼표까지, 그래도 길면 낱말 경계에서 「…」', () => {
  const long = 'Once a mere soldier, he took up books at the urging of Sun Quan and within days became someone to be seen anew.';
  assert.equal(loreTeaser(long), 'Once a mere soldier…');
  const noComma = 'Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm.';
  const got = loreTeaser(noComma);
  assert.ok(got.endsWith('…'));
  assert.ok(!/\s…$/.test(got), got);
  assert.ok(width(got) <= TEASER_MAX + 1, got);
});

test('첫머리 — 260명 × 열 언어 전부 비지 않고 상한 안에 든다', () => {
  let n = 0;
  for (const o of OFFICERS) {
    for (const story of Object.values(o.story ?? {})) {
      if (!story?.trim()) continue;
      const got = loreTeaser(story);
      assert.ok(got.length > 0, `${o.id}: 빈 첫머리`);
      assert.ok(width(got) <= TEASER_MAX + 1, `${o.id}: ${got} (${width(got)})`);
      n++;
    }
  }
  assert.ok(n > 2000, `열전 ${n}개 — 데이터가 안 읽혔다`);
});
