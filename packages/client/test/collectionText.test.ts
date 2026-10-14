/**
 * 컬렉션 효과 글 — 화면은 `effect`에서 조립하고, 엑셀의 「효과 (읽는 글)」은 한국어 정본이다 (2026-10-14).
 * 둘이 갈라지면(엑셀 글만 고쳤거나 틀 문장만 고쳤거나) 이 검사가 깨진다 — 어느 쪽이 맞는지는 사람이 본다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECTIONS } from '@samchess/data';
import { BASE_LANG, LANGS, setLang } from '../src/i18n/index.ts';
import { effectLine, eraText } from '../src/screens/collectionText.ts';

test('조립한 한국어 효과 글이 엑셀의 「효과 (읽는 글)」 117개와 글자까지 같다', () => {
  setLang('ko');
  const off = COLLECTIONS.filter((c) => effectLine(c) !== c.effectText)
    .map((c) => `${c.no} ${c.title}\n  엑셀: ${c.effectText}\n  조립: ${effectLine(c)}`);
  assert.deepEqual(off, []);
});

test('열 언어 모두 — 효과 글 · 시대 이름에 채우지 못한 자리({…})가 안 남는다', () => {
  try {
    for (const { id } of LANGS) {
      setLang(id);
      for (const c of COLLECTIONS) {
        for (const s of [effectLine(c), eraText(c)]) {
          assert.ok(!/\{\w+\}/.test(s), `${id} · ${c.no} ${c.title}: ${s}`);
          assert.ok(!s.includes('collection.'), `${id} · ${c.no} ${c.title}: 키가 그대로 나왔다 — ${s}`);
        }
      }
    }
  } finally {
    setLang(BASE_LANG);
  }
});
