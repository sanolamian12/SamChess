/**
 * 튜토리얼에서 사람이 말할 때의 장 나누기 (`src/screens/tutorialSpeech.ts`, 2026-11-13) — 이어진 문장 장을 두 문장까지 묶고,
 * 대사 · 판때기를 비추는 장은 홀로 두며, 묶은 장의 열쇠는 마지막 문장의 열쇠다(스모크가 판의 끝을 그것으로 안다).
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isSay, lineKey } from '@samchess/meta';
import type { GuideLine } from '@samchess/meta';
import { sentenceCount, speechPages, speechText } from '../src/screens/tutorialSpeech.ts';
import ko from '../src/i18n/strings/ko.json' with { type: 'json' };

const tr = (k: string): string => (ko as Record<string, string>)[k] ?? k;

test('문장 수 — 끝맺음 부호로 센다', () => {
  assert.equal(sentenceCount('잘했습니다!'), 1);
  assert.equal(sentenceCount('장수마다 체스 기물 하나의 움직임을 맡습니다. 손견과 여섯 기물을 익혀 봅시다.'), 2);
  assert.equal(sentenceCount('King — 8방향으로 한 칸'), 1);
});

test('기물 여섯 첫 판 — 두 문장까지 묶이고, 끝 열쇠 · 글이 맞다', () => {
  const keys: GuideLine[] = ['tut.b1.welcome', 'tut.b1.welcome2', 'tut.b1.board', 'tut.b1.board2', 'tut.b1.King.move', 'tut.b1.King.rule', 'tut.go.move'];
  const pages = speechPages(keys, tr);
  // 한 장의 문장 수는 둘을 넘지 않는다(한 줄이 이미 둘이면 홀로)
  for (const p of pages) assert.ok(sentenceCount(speechText(p, tr).replace(/\n/g, ' ')) <= 2, speechText(p, tr));
  assert.ok(pages.length < keys.length, '하나도 안 묶였다');
  // 순서 · 끝 열쇠 그대로
  assert.equal(lineKey(pages.at(-1)!), 'tut.go.move');
  assert.deepEqual(pages.map((p) => speechText(p, tr)).join('\n').split('\n'), keys.map((k) => tr(k as string)));
});

test('대사 · 비추는 장은 홀로 선다', () => {
  const note: GuideLine = { note: 'tut.b3.time', spots: ['order'] };
  const say: GuideLine = { say: 'x', by: 'son-gyeon' as never };
  const pages = speechPages(['tut.b2.item', note, 'tut.b2.item2', say, 'tut.go.move'], tr);
  assert.equal(pages.length, 5);
  assert.equal(pages[1], note);
  assert.ok(isSay(pages[3]!));
});
