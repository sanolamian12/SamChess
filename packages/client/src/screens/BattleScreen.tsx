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
  GRADE_SCORE, applyBattleResult, battlePower, makeAiPicks, newInstance, toRosterEntries,
} from '@samchess/meta';
import type {
  BattleOutcome, BattleResult, BattleRewards, PlayerProfile, RosterPick,
} from '@samchess/meta';
import { bootBattle, countKills } from '../battle/boot.ts';
import { BattleStage } from './BattleStage.tsx';

export interface BattleDone {
  profile: PlayerProfile;
  screen: {
    mode: BattleMode;
    result: BattleResult;
    outcome: string;
    /** 이미 반영된 보상. **무승부는 고르기 전이라 `null`이다** */
    rewards: BattleRewards | null;
    /** 아직 반영하지 않은 결과 — 무승부의 택1을 기다린다 */
    pending: BattleOutcome | null;
    /** 양쪽 전투력. 결과 화면이 「예상 승률 12%를 뒤집었다」를 보여 준다 (§5-23) */
    power: { mine: number; theirs: number };
    seed: number;
  };
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

    // `deploy` 단계로 시작한다 — 배치 → (상대 준비) → 정찰 → 전투 (GDD §3.9).
    // 상대(AI)는 곧바로 준비를 마치므로 「매칭 대기」는 눈에 보이지 않는다.
    const aiEntries = toRosterEntries(aiProfile, aiPicks);
    const initial = createBattle({
      matchId: `ai-${seed}`,
      seed,
      mode,
      rosters: { P1: myEntries, P2: aiEntries },
    });

    // 양쪽 전투력은 **전투가 시작될 때의 값**이다 (D · GDD §7.1). 전적에 그대로 남겨
    // 두면 눈금(`POWER_SCALE`)이 나중에 바뀌어도 그때의 판단이 보존된다(§5-23).
    const power = { mine: battlePower(mode, myEntries), theirs: battlePower(mode, aiEntries) };

    const handle = bootBattle({
      initial,
      humanSide: 'P1',
      onFinish: (state) => {
        // 엔진은 진짜 무승부를 낸다 — `winner: null` (실측 0.02%). 메타 층이 그걸
        // `boolean`으로 뭉개고 있었고, v3에서 세 결말로 폈다
        const result: BattleResult =
          state.winner === 'P1' ? 'win' : state.winner === null ? 'draw' : 'lose';
        const outcome: BattleOutcome = {
          result, mode, opponent: 'ai', picks, kills: countKills(state, 'P1'), power,
          // 시각은 **화면이 넣는다** — meta는 시계를 읽지 않는다 (C2의 군량 충전과 같은 규약)
          at: Date.now(),
          // 상대 id·부대 이름은 온라인(Colyseus)과 E(42·43쪽)가 채운다
          opponentId: null, mySquad: null, theirSquad: null,
        };
        const label = state.winner === null
          ? OUTCOME_LABEL['draw']! : OUTCOME_LABEL[state.outcome ?? ''] ?? '';

        // **무승부는 여기서 반영하지 않는다.** 셋 중 하나를 고르기 전까지 계정은
        // 그대로다 — 「고르는 도중」이라는 상태를 저장하지 않기 위함이다 (GDD §6.4)
        if (result === 'draw') {
          done.current({
            profile,
            screen: { mode, result, outcome: label, rewards: null, pending: outcome, power, seed },
          });
          return;
        }
        const applied = applyBattleResult(profile, outcome, seed);
        done.current({
          profile: applied.profile,
          screen: { mode, result, outcome: label, rewards: applied.rewards, pending: null, power, seed },
        });
      },
    });
    return () => handle.destroy();
    // 전투는 한 번 시작하면 끝까지 간다. 프로필이 바뀌어도 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BattleStage />;
}
