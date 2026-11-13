/**
 * 배경음악 회귀 — 「어느 화면에서 어느 곡이 나오는가」를 못 박는다
 * (2026-08-14 지정, 2026-08-25 상점·결과 분기 추가).
 *
 * 기획자 지정은 다섯 줄이었다.
 *
 * ```
 * 첫 화면, 및 아래가 아닌 화면          → 배경곡_1_메인
 * 3v3·5v5 선택 후 기물·장수 선택 화면  → 배경곡_2_장군선택
 * 기물 배치와 적군 정탐 화면            → 배경곡_3_배치정탐
 * 전투화면                              → 배경곡_4_전투
 * 장터(상점) 화면                       → 배경곡_상점
 * 전투 종료 후 보상 화면                → 배경곡_5_전투종료 / 배경곡_전투_비김 / 배경곡_전투_패배
 * ```
 *
 * **소리로는 검증할 수 없다.** 헤드리스에는 출력 장치가 없고, 브라우저는 사용자가
 * 화면을 건드리기 전까지 재생을 막는다. 스모크(`smoke:meta`)가 「지금 어느 곡을
 * 틀기로 했는가」를 화면마다 확인하지만 **보상 화면까지는 못 간다**(전투가 끝나야
 * 열린다). 그래서 고르는 규칙만 순수 함수로 떼어 여기서 다섯 줄을 그대로 고정한다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { trackForPhase, trackForRaid, trackForResult, trackForScreen } from '../src/audio/bgm.ts';
import type { BattleTheme } from '../src/audio/bgm.ts';

test('메타 화면 — 기물·장수 고르기·상점만 따로, 나머지는 메인', () => {
  assert.equal(trackForScreen('main'), 'main');
  assert.equal(trackForScreen('officers'), 'main');
  // 병영은 들어서는 순간부터 · 출전까지 `roster`, [대전상대 찾기] 뒤는 배치곡을 앞당긴다 (2026-11-13)
  assert.equal(trackForScreen('place', 'barracks'), 'roster');
  assert.equal(trackForScreen('place', 'palace'), 'main', '병영 밖의 자리는 메인곡');
  for (const s of ['sortie', 'squads', 'squadNew', 'squadView', 'squadEdit', 'garrisonPolicy', 'tutorials']) {
    assert.equal(trackForScreen(s), 'roster', `병영 안의 ${s} 가 병영곡이 아니다`);
  }
  assert.equal(trackForScreen('siege'), 'prep');
  assert.equal(trackForScreen('match'), 'prep');
  assert.equal(trackForPhase('deploying'), trackForScreen('match'), '매칭에서 배치 단계로 곡이 끊기지 않는다');
  assert.equal(trackForScreen('market'), 'shop');
  assert.equal(trackForScreen('newgame'), 'createCity');
  assert.equal(trackForScreen('tutorialResult'), 'result', '튜토리얼 승리는 승리곡');
});

test('결과 화면은 화면 이름으로 정하지 않는다 — 승/무/패로 갈린다', () => {
  assert.equal(trackForScreen('result'), null);
});

test('앞으로 생길 화면도 메인곡이다 — 지정이 「위가 아닌 화면」이었다', () => {
  // 랭킹·크레딧… 화면이 늘 때마다 이 파일을 고쳐야 한다면 지정을 어긴 것이다
  for (const screen of ['ranking', 'settings', '']) {
    assert.equal(trackForScreen(screen), 'main', `${screen} 이 메인곡이 아니다`);
  }
});

test('전투 화면은 화면 이름으로 정하지 않는다 — 안에서 두 곡이 갈린다', () => {
  assert.equal(trackForScreen('battle'), null);
});

test('결과 화면 — 승/무/패로 다른 곡이다', () => {
  assert.equal(trackForResult('win', false), 'result');
  assert.equal(trackForResult('draw', false), 'resultDraw');
  assert.equal(trackForResult('lose', false), 'resultLose');
});

test('성립하지 않은 판은 승/무/패가 의미가 없다 — 늘 원래 곡으로 물러난다', () => {
  assert.equal(trackForResult('win', true), 'result');
  assert.equal(trackForResult('draw', true), 'result');
  assert.equal(trackForResult('lose', true), 'result');
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

test('도적떼 방어전 결과 — 대전 결과와 같은 세 곡, 항복은 패배 곡 (2026-10-14)', () => {
  assert.equal(trackForScreen('raidResult'), null);
  assert.equal(trackForRaid('won'), 'result');
  assert.equal(trackForRaid('drawn'), 'resultDraw');
  assert.equal(trackForRaid('lost'), 'resultLose');
  assert.equal(trackForRaid('surrendered'), 'resultLose');
});

test('판 전용 곡 — 공성전 · 도적떼 · 튜토리얼은 배치 · 전투를 함께 대신한다 (2026-11-11)', () => {
  const themes: BattleTheme[] = ['siege', 'raid', 'tutorial', 'tutorialS'];
  for (const theme of themes) {
    for (const phase of ['deploying', 'scouting', 'advancing', 'awaitingInput', 'aiThinking', 'finished']) {
      assert.equal(trackForPhase(phase, undefined, theme), theme, `${theme} 판의 ${phase} 가 판 곡이 아니다`);
    }
    // 대결은 판 곡 위에 선다
    assert.equal(trackForPhase('dueling', 'duel', theme), 'duel');
    assert.equal(trackForPhase('answering', 'debate', theme), 'debate');
  }
  // 대전(판 곡 없음)은 그대로
  assert.equal(trackForPhase('deploying', undefined, null), 'prep');
  assert.equal(trackForPhase('awaitingInput', undefined, null), 'battle');
});
