/**
 * 화면 전환 — 메타(React)와 전투(Phaser)를 한 프레임 안에서 오간다.
 *
 * ```
 * [새 계정] → [메인] ─┬─ [장수 관리] ──┐
 *                     └─ [편성] → [전투] → [결과] ─┘
 * ```
 *
 * **프레임(1:2)은 여기 한 곳에서만 그린다.** 메타 화면이든 전투든 같은 틀 안에 들어가야
 * 화면이 바뀔 때 크기가 튀지 않는다. 전투 화면이 쓰는 DOM 자리(`#hud`·`#board`·`#control` …)도
 * 이 프레임 안에서 만들어진다 — 전투 UI는 id로 그 자리를 찾는다.
 */

import { useRef, useState } from 'react';
import type { BattleMode } from '@samchess/rules';
import type { BattleRewards, PlayerProfile, RosterPick } from '@samchess/meta';
import { loadProfile, saveProfile } from '../meta/storage.ts';
import { NewGameScreen } from './NewGameScreen.tsx';
import { MainScreen } from './MainScreen.tsx';
import { OfficerScreen } from './OfficerScreen.tsx';
import { RosterScreen } from './RosterScreen.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import { ResultScreen } from './ResultScreen.tsx';
import { useFrameFit } from './useFrameFit.ts';

export type Screen =
  | { name: 'main' }
  | { name: 'officers' }
  | { name: 'roster'; mode: BattleMode }
  | { name: 'battle'; mode: BattleMode; picks: RosterPick[]; seed: number }
  | { name: 'result'; won: boolean; outcome: string; rewards: BattleRewards; mode: BattleMode };

export function App(): React.JSX.Element {
  const [profile, setProfileState] = useState<PlayerProfile | null>(() => loadProfile());
  const [screen, setScreen] = useState<Screen>({ name: 'main' });
  const frameRef = useRef<HTMLDivElement>(null);

  /** 프로필이 바뀌면 곧바로 저장한다 — 나가기 버튼 같은 걸 두지 않기 위함이다 */
  const setProfile = (next: PlayerProfile): void => {
    setProfileState(next);
    saveProfile(next);
  };

  useFrameFit(frameRef);

  return (
    <div id="frame" ref={frameRef} className={screen.name === 'battle' ? 'battle' : 'meta'}>
      {!profile ? (
        <NewGameScreen onStart={setProfile} />
      ) : screen.name === 'main' ? (
        <MainScreen profile={profile} onGo={setScreen} onReset={() => setProfileState(null)} />
      ) : screen.name === 'officers' ? (
        <OfficerScreen profile={profile} onChange={setProfile} onBack={() => setScreen({ name: 'main' })} />
      ) : screen.name === 'roster' ? (
        <RosterScreen
          profile={profile}
          mode={screen.mode}
          onBack={() => setScreen({ name: 'main' })}
          onStart={(picks, seed, spent) => { setProfile(spent); setScreen({ name: 'battle', mode: screen.mode, picks, seed }); }}
        />
      ) : screen.name === 'battle' ? (
        <BattleScreen
          profile={profile}
          mode={screen.mode}
          picks={screen.picks}
          seed={screen.seed}
          onDone={(result) => { setProfile(result.profile); setScreen({ name: 'result', ...result.screen }); }}
        />
      ) : (
        <ResultScreen
          won={screen.won}
          outcome={screen.outcome}
          rewards={screen.rewards}
          onAgain={() => setScreen({ name: 'roster', mode: screen.mode })}
          onHome={() => setScreen({ name: 'main' })}
        />
      )}
    </div>
  );
}
