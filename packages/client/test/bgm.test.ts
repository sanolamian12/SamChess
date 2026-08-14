/**
 * 배경음악 회귀 — 「어느 화면에서 어느 곡이 나오는가」를 못 박는다 (2026-08-14).
 *
 * 기획자 지정은 다섯 줄이었다.
 *
 * ```
 * 첫 화면, 및 아래 4가지가 아닌 화면   → 배경곡_1_메인
 * 3v3·5v5 선택 후 기물·장수 선택 화면  → 배경곡_2_장군선택
 * 기물 배치와 적군 정탐 화면            → 배경곡_3_배치정탐
 * 전투화면                              → 배경곡_4_전투
 * 전투 종료 후 보상 화면                → 배경곡_5_전투종료
 * ```
 *
 * **소리로는 검증할 수 없다.** 헤드리스에는 출력 장치가 없고, 브라우저는 사용자가
 * 화면을 건드리기 전까지 재생을 막는다. 스모크(`smoke:meta`)가 「지금 어느 곡을
 * 틀기로 했는가」를 화면마다 확인하지만 **보상 화면까지는 못 간다**(전투가 끝나야
 * 열린다). 그래서 고르는 규칙만 순수 함수로 떼어 여기서 다섯 줄을 그대로 고정한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { trackForPhase, trackForScreen } from '../src/audio/bgm.ts';

test('메타 화면 — 기물·장수 고르기와 보상 화면만 따로, 나머지는 메인', () => {
  assert.equal(trackForScreen('main'), 'main');
  assert.equal(trackForScreen('officers'), 'main');
  assert.equal(trackForScreen('roster'), 'roster');
  assert.equal(trackForScreen('result'), 'result');
});

test('앞으로 생길 화면도 메인곡이다 — 지정이 「넷이 아닌 화면」이었다', () => {
  // 상점·랭킹·크레딧… 화면이 늘 때마다 이 파일을 고쳐야 한다면 지정을 어긴 것이다
  for (const screen of ['shop', 'ranking', 'settings', '']) {
    assert.equal(trackForScreen(screen), 'main', `${screen} 이 메인곡이 아니다`);
  }
});

test('전투 화면은 화면 이름으로 정하지 않는다 — 안에서 두 곡이 갈린다', () => {
  assert.equal(trackForScreen('battle'), null);
});

test('배치·정찰은 전투와 다른 곡이다', () => {
  assert.equal(trackForPhase('deploying'), 'prep');
  assert.equal(trackForPhase('scouting'), 'prep');
});

test('그 밖의 모든 단계는 전투곡 — 승부가 난 뒤에도 보상 화면까지는 전투곡이다', () => {
  // `finished`는 전투 화면에 남아 마지막 한 방을 보여주는 구간이다.
  // 보상곡은 화면이 바뀐 뒤에 나온다.
  for (const phase of ['advancing', 'awaitingInput', 'aiThinking', 'finished']) {
    assert.equal(trackForPhase(phase), 'battle', `${phase} 가 전투곡이 아니다`);
  }
});
