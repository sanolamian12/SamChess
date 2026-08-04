/**
 * 전투 화면 — React가 자리를 만들고 Phaser가 그 안에서 돈다.
 *
 * 전투 UI(HUD·대화창·제어 패널·팝업)는 DOM을 직접 다루고 id로 자리를 찾는다.
 * 그래서 여기서는 **그 자리들을 그려 주기만** 하고, 붙는 것은 `bootBattle`이 한다.
 * 전투 UI를 React로 다시 쓰지 않는 이유는 이미 잘 돌고 있고, 중요한 계약
 * (「버튼 활성 여부는 validate()에 묻는다」)은 프레임워크와 무관하기 때문이다.
 *
 * 상대(AI) 편성은 **내 팀의 등급 점수에 맞춰** 뽑는다 — 아무나 뽑으면 S급 셋이 D급 셋을
 * 만나 대전이 성립하지 않는다.
 */

import { useEffect, useRef } from 'react';
import { officerById } from '@samchess/data';
import { createBattle } from '@samchess/rules';
import type { BattleMode, BattleState, OfficerId } from '@samchess/rules';
import {
  GRADE_SCORE, applyBattleResult, makeAiPicks, newInstance, toRosterEntries,
} from '@samchess/meta';
import type { BattleRewards, PlayerProfile, RosterPick } from '@samchess/meta';
import { bootBattle, countKills } from '../battle/boot.ts';
import { BattleStage } from './BattleStage.tsx';

export interface BattleDone {
  profile: PlayerProfile;
  screen: { won: boolean; outcome: string; rewards: BattleRewards; mode: BattleMode };
}

const OUTCOME_LABEL: Record<string, string> = {
  kingDown: '군주 격파', wipeOut: '전멸', surrender: '항복', timeLimit: '판정승', draw: '무승부',
};

export function BattleScreen({ profile, mode, picks, seed, onDone }: {
  profile: PlayerProfile;
  mode: BattleMode;
  picks: RosterPick[];
  seed: number;
  onDone: (result: BattleDone) => void;
}): React.JSX.Element {
  // 최신 콜백을 담아 둔다 — Phaser는 한 번만 띄우고 다시 만들지 않는다
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const myEntries = toRosterEntries(profile, picks);
    const myScore = picks.reduce((n, p) => n + GRADE_SCORE[officerById.get(p.officer)!.grade], 0);

    // 상대는 전체 장수에서 뽑는다. 내 계정과 무관하므로 임시 인스턴스를 만들어 쓴다.
    const aiPicks = makeAiPicks(
      mode, myScore, seed,
      (id) => GRADE_SCORE[officerById.get(id)?.grade ?? 'D'],
      [...officerById.keys()].filter((id) => !picks.some((p) => p.officer === id)) as OfficerId[],
    );
    const aiProfile: PlayerProfile = {
      ...profile,
      roster: Object.fromEntries(aiPicks.map((p) => [p.officer, newInstance(p.officer)])),
    };

    const initial = createBattle({
      matchId: `ai-${seed}`,
      seed,
      mode,
      rosters: { P1: myEntries, P2: toRosterEntries(aiProfile, aiPicks) },
    });
    // 배치·정찰 단계는 아직 화면이 없다 — 기본 배치 그대로 전투부터 시작한다
    const started: BattleState = { ...initial, phase: 'running', ready: { P1: true, P2: true } };

    const handle = bootBattle({
      initial: started,
      humanSide: 'P1',
      onFinish: (state) => {
        const won = state.winner === 'P1';
        const result = applyBattleResult(
          profile,
          { won, mode, opponent: 'ai', picks, kills: countKills(state, 'P1') },
          seed,
        );
        done.current({
          profile: result.profile,
          screen: {
            won,
            outcome: state.winner === null ? '무승부' : OUTCOME_LABEL[state.outcome ?? ''] ?? '',
            rewards: result.rewards,
            mode,
          },
        });
      },
    });
    return () => handle.destroy();
    // 전투는 한 번 시작하면 끝까지 간다. 프로필이 바뀌어도 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BattleStage />;
}
