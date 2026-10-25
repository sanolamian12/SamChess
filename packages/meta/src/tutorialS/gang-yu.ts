import type { GuideTurn, TutorialStage } from '../tutorialBattles.ts';
import { U, config, entry, say, stage } from './common.ts';

// ── 강유 — 철롱산 (253) ─────────────────────────────────────────

/**
 * 강유가 철롱산에서 사마소를 에워쌌다 — 물길이 끊긴 위군은 목이 말라 지쳐 있다(호위 넷의 HP를 3 · 4 · 5 · 6으로 깎아 둔다).
 * 「구벌중원」(시전 지연 30 → 4.9일 동안 공격할 때마다 공격력 +1, 최대 9번)을 걸고 **약한 적부터 연달아** 베어
 * 제한 시각(6일) 안에 넷을 쓰러뜨린다(`killCount` 4). 판 크기 상한이 진영당 다섯이라 초안의 「6명」을 「호위 넷」으로 줄였다.
 *
 * 사마소는 King이다 — 뒤에 물러나 있고, 쓰러뜨려도 대전 승패(군주 격파)로 이긴다. 강유도 King이라 쓰러지면 진다.
 * 엔진으로 맞췄다 — 강유 Lv5(AT 3 · HP 20)가 공격력 3 → 7로 오르며 넷을 다섯 대에 베고(시각 476) HP 18이 남는다.
 * 기술 없이(AT 3 그대로) 두면 6일 안에 넷째를 못 벤다. 왕평은 옆에서 뒤를 지킨다 — 앞에 두면 강유의 몫을 가로챘다.
 */
const GANG_YU = U('P1-King');
export const gangYu = (): TutorialStage[] => stage('gang-yu', {
  config: config('gang-yu', {
    P1: [entry('gang-yu', 'King', 5, { statPicks: ['at', 'at', 'hp', 'hp'] }), entry('wang-pyeong', 'Pawn', 3)],
    P2: [entry('sa-ma-so', 'King', 3), entry('ha-hu-sang', 'Rock', 3), entry('ha-hu-eun', 'Bishop', 3), entry('ha-hu-ran', 'Knight', 3), entry('jo-sun', 'Pawn', 3)],
  }, {
    positions: {
      P1: [{ x: 12, y: 11 }, { x: 19, y: 13 }],
      P2: [{ x: 12, y: 1 }, { x: 9, y: 7 }, { x: 11, y: 7 }, { x: 15, y: 8 }, { x: 13, y: 9 }],
    },
    overrides: { P1: [{ wt: 0 }], P2: [undefined, { hp: 6 }, { hp: 5 }, { hp: 4 }, { hp: 3 }] },
    startSp: { P1: 6, P2: 0 },
    goals: { win: [{ kind: 'killCount', count: 4 }], lose: [{ kind: 'timeUp', at: 600 }] },
  }),
  guide: [
    { unit: GANG_YU, phases: [
      { lines: ['tut.s.gang-yu.intro', 'tut.s.gang-yu.intro2', say('gang-yu', 1, 'sa-ma-so'), say('gang-yu', 2, 'gang-yu'), 'tut.s.gang-yu.goal', 'tut.s.gang-yu.skill', 'tut.s.gang-yu.skill2'], allow: ['unique'], until: 'skill' },
    ] },
    { unit: GANG_YU, phases: [
      { lines: ['tut.s.gang-yu.ready', say('gang-yu', 3, 'wang-pyeong'), 'tut.s.gang-yu.weak', 'tut.go.move'], allow: ['move'], moveTo: { x: 12, y: 10 }, until: 'moved' },
      { lines: ['tut.s.gang-yu.attack'], allow: ['attack'] },
    ] },
  ] satisfies GuideTurn[],
  outro: [say('gang-yu', 4, 'gang-yu'), 'tut.s.gang-yu.done', 'tut.s.gang-yu.done2'],
});
