/**
 * 전투 로그 문구 회귀 — `describeEvents()` (2026-09-11)
 *
 * **이 검사는 다국어 작업보다 먼저 생겼다.** 그전까지 `describeEvents()`를 부르는
 * 검사가 **0건**이라, 문구를 옮기다 빠뜨려도 아무도 안 잡았다 — 실제로 「성지가
 * 생겼다」를 고칠 때 **같은 문구가 두 자리**(본문 `describeEvents`, 시전 요약
 * `collectEffects`)에 있는 것을 놓쳤다가 한국어 리터럴을 세다 우연히 발견했다
 * (2026-09-10). 그래서 옮기기 **전에** 지금 나오는 줄을 통째로 못 박아 두고,
 * 옮긴 뒤에도 한국어가 **한 글자도 안 바뀌는 것**을 이 파일이 지킨다.
 *
 * 세 가지를 본다.
 *
 * 1. **한국어 문구가 그대로인가** — 줄 순서·말투·`tone`까지 통째로 비교한다.
 *    이벤트 종류마다 한 줄씩 넣어 `describeEvents()`의 `case`를 전부 지난다.
 * 2. **언어를 바꿔도 줄 수와 `tone`이 같은가** — 문장을 통째로 키 하나에 담았으니
 *    구조는 언어에 흔들리면 안 된다. 흔들리면 조각을 잘못 나눈 것이다.
 * 3. **영어에 한글이 안 남았는가** — `t()`는 번역이 없으면 **한국어로 조용히
 *    물러난다**(오류가 없다). 장수·기술·책략 이름은 영어 표기가 데이터에 다 있으므로
 *    (`nameI18n`), 영어 출력에 한글이 한 글자라도 있으면 **옮기다 빠뜨린 자리**다.
 *    `castDelay.test.ts`가 키 셋을 하나씩 확인하던 것의 자동판이다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBattle } from '@samchess/rules';
import type { BattleEvent, BattleState, UnitId } from '@samchess/rules';
import { officerById } from '@samchess/data';
import { LANGS, setLang, type Lang } from '../src/i18n/index.ts';
import { describeEvents } from '../src/ui/eventText.ts';

/** rules의 픽스처와 같은 편성 — 유비·관우·조식 vs 조조·장합·헌제 */
const state: BattleState = createBattle({
  matchId: 'test',
  seed: 1,
  mode: '3v3',
  rosters: {
    P1: [
      { officer: 'yu-bi', piece: 'King', level: 1, statPicks: [], tactics: [] },
      { officer: 'gwan-u', piece: 'Rock', level: 1, statPicks: [], tactics: [] },
      { officer: 'jo-sik', piece: 'Pawn', level: 1, statPicks: [], tactics: [] },
    ],
    P2: [
      { officer: 'jo-jo', piece: 'King', level: 1, statPicks: [], tactics: [] },
      { officer: 'jang-hap', piece: 'Bishop', level: 1, statPicks: [], tactics: [] },
      { officer: 'heon-je', piece: 'Queen', level: 1, statPicks: [], tactics: [] },
    ],
  },
} as never);

const U = (id: string): UnitId => id as UnitId;
const ev = (x: unknown): BattleEvent => x as BattleEvent;
/** 유비의 고유기술 — 「삼고초려」. **지연이 걸린 기술**이라 「시전하기 시작했다」 갈래를 지난다. */
const SKILL = officerById.get('yu-bi')!.uniqueSkill!;

/**
 * `describeEvents()`의 `case`를 전부 지나는 한 벌.
 *
 * 책략 성공 줄은 **뒤따르는 이벤트를 훑어** 요약을 만들므로(`collectEffects`),
 * 걸리는 것 여섯 가지를 붙여 「외 N건」까지 지나게 한다. 지형 두 칸은 **잇달아
 * 같은 지형**이라 한 줄로 접히는 갈래다.
 */
const EVENTS: BattleEvent[] = [
  ev({ e: 'moved', unit: U('P1-Rock'), from: { x: 0, y: 2 }, to: { x: 4, y: 2 } }),
  ev({ e: 'attacked', unit: U('P1-Rock'), target: U('P2-Queen'), damage: 3, critical: false }),
  ev({ e: 'attacked', unit: U('P1-Rock'), target: U('P2-Queen'), damage: 6, critical: true }),
  // ── 책략 성공 + 요약 여섯 ──
  ev({ e: 'tacticCast', unit: U('P1-Pawn'), tactic: 'hwa-gye', resisted: false }),
  ev({ e: 'statusApplied', unit: U('P2-Bishop'), status: 'outgoingDamageHalf', expiresAt: 300 }),
  ev({ e: 'statusExpired', unit: U('P2-Bishop'), status: 'silence' }),
  ev({ e: 'hpChanged', unit: U('P2-Bishop'), delta: -4, reason: 'tactic' }),
  ev({ e: 'wtChanged', unit: U('P2-Bishop'), to: 190, reason: 'tactic' }),
  ev({ e: 'terrainChanged', pos: { x: 4, y: 4 }, terrain: 'fire' }),
  ev({ e: 'controlChanged', unit: U('P2-King'), by: U('P1-Pawn'), mode: 'moveOnly' }),
  // ── 책략 실패 ──
  ev({ e: 'tacticCast', unit: U('P1-Pawn'), tactic: 'hwa-gye', resisted: true }),
  ev({ e: 'turnEnded', unit: U('P1-Pawn') }),
  // ── 고유기술 — 시전(지연) · 발동 · 무산 · 재활성 ──
  ev({ e: 'uniqueSkillCast', unit: U('P1-King'), skill: SKILL }),
  ev({ e: 'uniqueSkillResolved', unit: U('P1-King'), skill: SKILL }),
  ev({ e: 'uniqueSkillFizzled', unit: U('P1-King'), skill: SKILL }),
  ev({ e: 'uniqueSkillRestored', unit: U('P1-King') }),
  // ── 생사 ──
  ev({ e: 'unitDied', unit: U('P2-Queen') }),
  ev({ e: 'unitRevived', unit: U('P2-Queen'), at: { x: 2, y: 1 }, from: { x: 4, y: 2 } }),
  // ── 조종 — 시작 · 영구 · 해제 ──
  ev({ e: 'controlChanged', unit: U('P2-Bishop'), by: U('P1-Rock'), mode: 'moveOnly' }),
  ev({ e: 'controlChanged', unit: U('P2-Bishop'), by: U('P1-Rock'), permanent: true }),
  ev({ e: 'controlChanged', unit: U('P2-Bishop'), by: null }),
  // ── 지속·지형 피해와 회복. `meditate`는 HP 줄을 안 내고 MP 줄만 낸다 ──
  ev({ e: 'hpChanged', unit: U('P2-Bishop'), delta: -2, reason: 'dot' }),
  ev({ e: 'hpChanged', unit: U('P2-Bishop'), delta: -1, reason: 'terrain:fire' }),
  ev({ e: 'hpChanged', unit: U('P2-Bishop'), delta: 1, reason: 'terrain:holy' }),
  ev({ e: 'hpChanged', unit: U('P2-Bishop'), delta: 3, reason: 'meditate' }),
  ev({ e: 'mpChanged', unit: U('P1-Rock'), delta: 2, reason: 'meditate' }),
  // ── 지형 — 잇달아 같은 지형은 한 줄로 접힌다(중심 한 칸만 말한다) ──
  ev({ e: 'terrainChanged', pos: { x: 4, y: 4 }, terrain: 'holy' }),
  ev({ e: 'terrainChanged', pos: { x: 5, y: 4 }, terrain: 'holy' }),
  ev({ e: 'terrainChanged', pos: { x: 4, y: 4 }, terrain: null }),
  // ── 결말 ──
  ev({ e: 'battleEnded', winner: 'P1', outcome: 'kingDown' }),
  ev({ e: 'battleEnded', winner: null, outcome: 'draw' }),
  // ── 대화창에 안 적는 것들. 여기 있어도 줄이 늘면 안 된다 ──
  ev({ e: 'timeAdvanced', to: 120 }),
  ev({ e: 'spChanged', side: 'P1', to: 3 }),
  ev({ e: 'controlGranted', unit: U('P1-Rock') }),
];

/**
 * 한국어 정본. **여기 있는 문장이 곧 사양이다** — 고칠 때는 「의도한 변경인가」를
 * 먼저 확인한다(`packages/rules/test/data.test.ts`가 수치에 대해 하는 일과 같다).
 */
const KO: readonly (readonly [string, string])[] = [
  ['plain', '관우가 이동했다. (A3 → E3)'],
  ['plain', '관우가 공격했다. (헌제 −3)'],
  ['good', '관우가 공격했다. (헌제 −6 크리티컬!)'],
  ['plain', '조식이 「화계」를 시전했다. (장합)'],
  ['good', '책략이 성공했다! (장합 공포, 장합 침묵 해제 외 4건)'],
  ['plain', 'E5에 화계가 생겼다.'],
  ['bad', '조조가 조식에게 조종당한다.'],
  ['plain', '조식이 「화계」를 시전했다.'],
  ['bad', '책략이 실패했다.'],
  ['skill', '유비가 고유기술을 시전하기 시작했다!'],
  ['skill', '「삼고초려」 시전 후, 4.9일 안에 유비에게 3번 공격을 받은 적군은 우리편이 됨'],
  ['skill', '시전에 0.3일이 걸린다.'],
  ['skill', '유비의 「삼고초려」가 발동했다!'],
  ['bad', '유비가 쓰러져 「삼고초려」가 무산됐다.'],
  ['good', '유비의 고유기술이 다시 활성화됐다.'],
  ['bad', '헌제가 퇴각했다.'],
  ['good', '헌제가 C2에서 되살아났다!'],
  ['bad', '장합이 관우에게 조종당한다.'],
  ['bad', '장합이 관우에게 조종당한다. (영구)'],
  ['plain', '장합이 정신을 차렸다.'],
  ['bad', '장합이 지속 피해로 2 피해를 입었다.'],
  ['bad', '장합이 화계로 1 피해를 입었다.'],
  ['good', '장합이 성지로 1 회복했다.'],
  ['plain', '관우가 명상했다. (MP +2)'],
  ['plain', 'E5에 성지가 생겼다.'],
  ['plain', 'E5의 지형이 사라졌다.'],
  ['good', '남군 승리 — 군주 격파'],
  ['plain', '무승부 — 무승부'],
];

const lines = (lang: Lang): { text: string; tone: string }[] => {
  setLang(lang);
  return describeEvents(state, EVENTS);
};

test('한국어 전투 로그 — 이벤트 한 벌이 그대로 이 줄들이 된다', () => {
  const out = lines('ko');
  setLang('ko');
  assert.deepEqual(out.map((l) => [l.tone, l.text]), KO.map(([tone, text]) => [tone, text]));
});

test('언어를 바꿔도 줄 수와 tone은 같다 — 구조는 언어에 안 흔들린다', () => {
  const ko = lines('ko');
  for (const { id } of LANGS) {
    const out = lines(id);
    assert.equal(out.length, ko.length, `${id}: 줄 수가 다르다`);
    assert.deepEqual(out.map((l) => l.tone), ko.map((l) => l.tone), `${id}: tone이 다르다`);
  }
  setLang('ko');
});

test('영어 로그에 한글이 한 글자도 없다 — 있으면 옮기다 빠뜨린 자리다', () => {
  const out = lines('en');
  setLang('ko');
  const hangul = /[가-힣]/;
  for (const line of out) {
    assert.ok(!hangul.test(line.text), `영어인데 한글이 남았다 — "${line.text}"`);
  }
});

test('영어와 한국어가 실제로 다르다 — 언어를 안 보고 있으면 이게 걸린다', () => {
  const ko = lines('ko').map((l) => l.text);
  const en = lines('en').map((l) => l.text);
  setLang('ko');
  assert.notDeepEqual(en, ko);
});
