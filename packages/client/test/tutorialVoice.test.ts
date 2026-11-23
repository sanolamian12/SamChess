/**
 * 튜토리얼 대사 음성 회귀 — 파일 이름은 대본 키에서 바로 나온다(`tut.s.{판}.say{n}` → `{판}.say{n}`).
 * 녹음(`assets/`)은 git 밖이라 여기서는 못 보고, 지키는 것은 **S급 판의 대사가 전부 이름을 얻고 서로 겹치지 않는가**다 —
 * 키 꼴이 바뀌어 이름이 `null`이 되면 오류 없이 그 판만 조용해진다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ALL_TUTORIALS, isSay, stageLines, tutorialStages } from '@samchess/meta';

import { tutorialVoiceClip } from '../src/audio/tutorialVoice.ts';

test('S급 판의 대사는 전부 녹음 이름을 얻고 겹치지 않는다', () => {
  const seen = new Map<string, string>();
  for (const id of ALL_TUTORIALS.filter((t) => t.startsWith('s-'))) {
    for (const stage of tutorialStages(id)) {
      for (const line of stageLines(stage)) {
        if (!isSay(line)) continue;
        const clip = tutorialVoiceClip(line.say);
        assert.ok(clip, `${id}: ${line.say}`);
        const before = seen.get(clip);
        assert.ok(before === undefined || before === line.say, `${clip}: ${before} · ${line.say}`);
        seen.set(clip, line.say);
      }
    }
  }
  // 더빙 대본(Design/튜토리얼더빙/lines.json)의 152줄과 같은 수
  assert.equal(seen.size, 152);
});

test('S급 판이 아닌 키는 녹음이 없다', () => {
  assert.equal(tutorialVoiceClip('tut.basic-1.p1'), null);
  assert.equal(tutorialVoiceClip('tut.s.ga-hu.say1'), 'ga-hu.say1');
  assert.equal(tutorialVoiceClip('tut.s.ga-hu.sayX'), null);
});
