/**
 * 튜토리얼 소개 패널의 글 — 한 줄 이야기 · 클리어 목표 · 패배 조건 (2026-10-26 기획자).
 *
 * 목표는 **판의 데이터에서 읽는다**(`tutorialStages(id)`의 `config.setup.goals`) — 패널에 목표를 따로 적으면 판을 고칠 때
 * 한쪽만 낡는다. 목표의 장수는 `UnitId`(`P2-Queen`)라 그 판 편성에서 이름을 찾는다. 시각은 100 = 1일이다.
 * 줄은 짧게 — 「조조 격파」 · 「장비 퇴각」 · 「2.8일 버티기」(기획자 2026-10-26). 기본 셋은 대본이 끝나면 끝나는 판이라 목표 한 줄을 문구로 둔다.
 * 이야기는 S급이면 그 판의 첫 안내(`tut.s.{id}.intro` — 장소 · 상황 한 줄), 기본이면 `tut.{id}.story`.
 */

import { BASIC_TUTORIALS, tutorialStages } from '@samchess/meta';
import type { TutorialId } from '@samchess/meta';
import type { BattleConfig, LoseGoal, UnitId, WinGoal } from '@samchess/rules';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import type { GameIconName } from '../ui/gameIcon.ts';

export interface IntroLine { icon: GameIconName; text: string }
export interface TutorialIntro { story: string; win: IntroLine[]; lose: IntroLine[] }

const days = (time: number): string => String(Number((time / 100).toFixed(1)));

/** 기본 셋의 목표 그림 — 기본 1 · 2는 도적을 여럿 치고, 기본 3은 도적 두목 하나 */
const BASIC_ICON: Record<string, GameIconName> = { 'basic-1': 'goal-killcount', 'basic-2': 'goal-killcount', 'basic-3': 'goal-killtarget' };

export function tutorialIntro(id: TutorialId): TutorialIntro {
  if ((BASIC_TUTORIALS as readonly string[]).includes(id)) {
    return {
      story: t(`tut.${id}.story` as StringKey),
      win: [{ icon: BASIC_ICON[id]!, text: t(`tut.${id}.goal` as StringKey) }],
      lose: [],
    };
  }
  const officer = id.slice(2);
  const config = tutorialStages(id)[0]?.config;
  const name = (unit: UnitId): string => {
    const [side, piece] = unit.split('-') as [keyof BattleConfig['rosters'], string];
    const who = config?.rosters[side]?.find((e) => e.piece === piece)?.officer;
    return who ? pickOfficerNameById(who, who) : piece;
  };
  const goals = config?.setup?.goals;
  // **목표는 대전 승패 위에 얹힌다** — 적 King 격파 · 내 King 퇴각도 늘 살아 있다(rules `ScenarioGoals`, 조건끼리는 「하나라도」).
  // 패배는 빠뜨리면 모르고 지므로 내 King 퇴각을 함께 적고(같은 장수면 한 줄), 비면 전멸을 적는다 — S급 판은 승리 · 패배 조건이 늘 둘 다 선다
  const kingOf = (side: 'P1' | 'P2'): UnitId | null => (config?.rosters[side]?.some((e) => e.piece === 'King') ? `${side}-King` as UnitId : null);
  // 승리는 **판의 목표만** 적는다(기획자 2026-10-26 — 「핵심 한 가지」). 적 King 격파는 늘 덤으로 이기는 길이라 안 적어도
  // 잘못 알려 주는 것이 없다. 목표가 없는 판만 적 King 격파(없으면 전멸)를 적는다
  const foeKing = kingOf('P2');
  const winGoals: WinGoal[] = goals?.win?.length ? [...goals.win] : foeKing ? [{ kind: 'killTarget', unit: foeKing }] : [];
  const loseGoals: LoseGoal[] = [...(goals?.lose ?? [])];
  const myKing = kingOf('P1');
  if (myKing && !loseGoals.some((g) => g.kind === 'unitLost' && g.unit === myKing)) loseGoals.push({ kind: 'unitLost', unit: myKing });
  const win = winGoals.map((g) => winLine(g, name));
  const lose = loseGoals.map((g) => loseLine(g, name));
  return {
    story: t(`tut.s.${officer}.intro` as StringKey),
    win: win.length ? win : [{ icon: 'out-wipe', text: t('tut.goal.wipe') }],
    lose: lose.length ? lose : [{ icon: 'goal-unitlost', text: t('tut.lose.wipe') }],
  };
}

function winLine(g: WinGoal, name: (u: UnitId) => string): IntroLine {
  switch (g.kind) {
    case 'killTarget': return { icon: 'goal-killtarget', text: t('tut.goal.killTarget', { name: name(g.unit) }) };
    case 'killCount': return { icon: 'goal-killcount', text: t('tut.goal.killCount', { n: g.count }) };
    case 'reach': return { icon: 'goal-reach', text: t('tut.goal.reach', { name: name(g.unit) }) };
    case 'survive': return { icon: 'goal-survive', text: t('tut.goal.survive', { d: days(g.until) }) };
    case 'convert': return { icon: 'goal-convert', text: t('tut.goal.convert', { name: name(g.unit) }) };
    case 'hpBelow': return { icon: 'goal-hpbelow', text: t('tut.goal.hpBelow', { name: name(g.unit), pct: g.pct }) };
  }
}

function loseLine(g: LoseGoal, name: (u: UnitId) => string): IntroLine {
  switch (g.kind) {
    case 'unitLost': return { icon: 'goal-unitlost', text: t('tut.lose.unitLost', { name: name(g.unit) }) };
    case 'timeUp': return { icon: 'goal-timeup', text: t('tut.lose.timeUp', { d: days(g.at) }) };
  }
}
