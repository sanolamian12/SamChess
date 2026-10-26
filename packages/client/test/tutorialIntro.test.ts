/**
 * 튜토리얼 소개 패널의 글 (2026-10-26 기획자) — S급 판은 **승리 조건 · 패배 조건이 늘 둘 다** 서고, 글에 빈 자리표시가 없다.
 *
 * 조건은 판의 데이터(`goals`)와 대전 승패(적 King 격파 · 내 King 퇴각)에서 만든다(`screens/tutorialIntro.ts`). 판을 고치다 King을
 * 빼고 목표도 안 적으면 한쪽이 비는데 화면은 아무 말도 안 한다 — 그때는 전멸 줄로 물러나는지까지 여기서 본다.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { ALL_TUTORIALS, BASIC_TUTORIALS, tutorialReady } from '@samchess/meta';
import { tutorialIntro } from '../src/screens/tutorialIntro.ts';

const ready = ALL_TUTORIALS.filter(tutorialReady);
const sReady = ready.filter((id) => !(BASIC_TUTORIALS as readonly string[]).includes(id));

test('S급 판은 승리 조건과 패배 조건이 둘 다 있다', () => {
  assert.ok(sReady.length >= 2, `판이 선 S급이 ${sReady.length}개 — 목록을 제대로 읽었는가`);
  const empty = sReady.filter((id) => { const i = tutorialIntro(id); return i.win.length === 0 || i.lose.length === 0; });
  assert.deepEqual(empty, []);
});

test('소개 글에 채워지지 않은 자리표시({…})나 열쇠 글자(tut.)가 없다', () => {
  const bad: string[] = [];
  for (const id of ready) {
    const i = tutorialIntro(id);
    for (const s of [i.story, ...i.win.map((l) => l.text), ...i.lose.map((l) => l.text)]) {
      if (/[{}]|^tut\./.test(s)) bad.push(`${id}: ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});
