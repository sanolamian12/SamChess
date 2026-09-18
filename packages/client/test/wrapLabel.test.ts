/**
 * 도시 지도 이름표의 줄 나누기 — 15자를 넘으면 단어 단위로 (2026-09-18)
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { labelWrapWidth, wrapLabel } from '../src/screens/wrapLabel.ts';

test('줄 나누기 — 15자 이하는 그대로 한 줄', () => {
  assert.deepEqual(wrapLabel('군량 생산량을 늘린다.'), ['군량 생산량을 늘린다.']);
  assert.deepEqual(wrapLabel('a'.repeat(15)), ['a'.repeat(15)]);
});

test('줄 나누기 — 넘으면 단어 단위로 끊고, 단어를 자르지 않는다', () => {
  assert.deepEqual(wrapLabel('장수의 몸과 정신을 단련한다.'), ['장수의 몸과 정신을', '단련한다.']);
  assert.deepEqual(
    wrapLabel('Тэжээлийн үйлдвэрлэлийг нэмэгдүүлнэ.'),
    ['Тэжээлийн', 'үйлдвэрлэлийг', 'нэмэгдүүлнэ.'],
  );
  for (const line of wrapLabel('Trains the bodies and minds of your officers.')) {
    assert.ok(line.length <= 15, line);
  }
});

test('줄 나누기 — 띄어쓰기 없는 긴 말은 글자 수로 자른다', () => {
  const s = '一二三四五六七八九十一二三四五六七';
  assert.deepEqual(wrapLabel(s), ['一二三四五六七八九十一二三四五', '六七']);
});

test('줄 나누기 — 로마자 언어는 20자, 몽골어·한중일은 15자', () => {
  assert.equal(labelWrapWidth('en'), 20);
  assert.equal(labelWrapWidth('pt_PT'), 20);
  assert.equal(labelWrapWidth('mn'), 15);
  assert.equal(labelWrapWidth('ko'), 15);
  assert.equal(labelWrapWidth('zh_Hant'), 15);
});
