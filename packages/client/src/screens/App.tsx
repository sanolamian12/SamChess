/**
 * 화면 전환 — 메타(React)와 전투(Phaser)를 한 프레임 안에서 오간다.
 *
 * ```
 * [간판·로그인] → [새 계정] → [메인·도시] ─┬─ 궁궐 → [장수 관리] ────────┐
 *                                          ├─ 병영 → [편성] → [전투] → [결과]
 *                                          └─ 장터 (아직 없다)
 * ```
 *
 * **첫 화면이 「간판」으로 바뀌었다** (pptx 33쪽, 2026-08-15). 계정이 있어도 먼저
 * 간판을 지난다 — 게임 URL로 들어왔을 때 가장 먼저 보이는 화면이라는 것이 기획이다.
 * 로그인·계정 생성의 실제 구현은 별도 세션이고, 지금 「입장」은 곧바로 들어간다.
 *
 * **프레임(1:2)은 여기 한 곳에서만 그린다.** 메타 화면이든 전투든 같은 틀 안에 들어가야
 * 화면이 바뀔 때 크기가 튀지 않는다. 전투 화면이 쓰는 DOM 자리(`#hud`·`#board`·`#control` …)도
 * 이 프레임 안에서 만들어진다 — 전투 UI는 id로 그 자리를 찾는다.
 */

import { useEffect, useRef, useState } from 'react';
import type { BattleMode } from '@samchess/rules';
import type { BattleRewards, PlayerProfile, RosterPick } from '@samchess/meta';
import { playBgm, trackForScreen } from '../audio/bgm.ts';
import { loadLang } from '../i18n/index.ts';
import { loadProfile, saveProfile } from '../meta/storage.ts';
import type { PlaceId } from './backdrop.ts';
import { TitleScreen } from './TitleScreen.tsx';
import { NewGameScreen } from './NewGameScreen.tsx';
import { MainScreen } from './MainScreen.tsx';
import { PlaceScreen } from './PlaceScreen.tsx';
import { OfficerScreen } from './OfficerScreen.tsx';
import { RosterScreen } from './RosterScreen.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import { ResultScreen } from './ResultScreen.tsx';
import { useFrameFit } from './useFrameFit.ts';

export type Screen =
  | { name: 'title' }
  | { name: 'newgame' }
  | { name: 'main' }
  | { name: 'place'; place: PlaceId }
  | { name: 'officers' }
  | { name: 'roster'; mode: BattleMode }
  | { name: 'battle'; mode: BattleMode; picks: RosterPick[]; seed: number }
  | { name: 'result'; won: boolean; outcome: string; rewards: BattleRewards; mode: BattleMode };

/** 저장된 언어를 읽는 것은 화면이 처음 그려지기 **전**이어야 한다 — 한국어로 한 번 깜빡이지 않게. */
loadLang();

export function App(): React.JSX.Element {
  const [profile, setProfileState] = useState<PlayerProfile | null>(() => loadProfile());
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  const frameRef = useRef<HTMLDivElement>(null);

  /** 프로필이 바뀌면 곧바로 저장한다 — 나가기 버튼 같은 걸 두지 않기 위함이다 */
  const setProfile = (next: PlayerProfile): void => {
    setProfileState(next);
    saveProfile(next);
  };

  useFrameFit(frameRef);

  /*
   * 화면마다 배경음악 한 곡 (2026-08-14 기획자 지정).
   *
   * **전투 화면은 여기서 정하지 않는다.** 안에서 배치·정찰(`prep`)과 전투(`battle`)가
   * 갈리는데 그 경계를 아는 것은 `Playback.phase`뿐이라 `BattleScene`이 부른다.
   * 여기서 `battle`을 틀면 배치 단계에 전투곡이 먼저 나온다.
   *
   * 나머지는 전부 「메인」이다 — 기획자 지정이 「아래 넷이 아닌 화면」이라,
   * 앞으로 화면이 늘어도 여기 손대지 않아야 그 말이 지켜진다.
   */
  useEffect(() => {
    const track = trackForScreen(screen.name);
    if (track) playBgm(track);
  }, [screen.name]);

  /*
   * 「입장」과 「계정 생성」이 지금은 같은 곳으로 간다 — 계정이 없으면 도시 이름부터
   * 정해야 하기 때문이다. 로그인이 붙는 세션에서 여기가 갈린다.
   */
  const enter = (): void => setScreen(profile ? { name: 'main' } : { name: 'newgame' });

  return (
    <div id="frame" ref={frameRef} className={screen.name === 'battle' ? 'battle' : 'meta'}>
      {screen.name === 'title' ? (
        <TitleScreen onEnter={enter} onSignUp={enter} />
      ) : screen.name === 'newgame' || !profile ? (
        // 계정이 없으면 어느 화면을 향했든 여기부터다 — 도시 이름이 있어야 나머지가 성립한다
        <NewGameScreen onStart={(p) => { setProfile(p); setScreen({ name: 'main' }); }} />
      ) : screen.name === 'main' ? (
        <MainScreen
          profile={profile}
          onGo={(place) => setScreen({ name: 'place', place })}
          onReset={() => { setProfileState(null); setScreen({ name: 'title' }); }}
        />
      ) : screen.name === 'place' ? (
        <PlaceScreen
          profile={profile}
          place={screen.place}
          onBack={() => setScreen({ name: 'main' })}
          onRoster={(mode) => setScreen({ name: 'roster', mode })}
          onOfficers={() => setScreen({ name: 'officers' })}
        />
      ) : screen.name === 'officers' ? (
        <OfficerScreen profile={profile} onChange={setProfile} onBack={() => setScreen({ name: 'place', place: 'palace' })} />
      ) : screen.name === 'roster' ? (
        <RosterScreen
          profile={profile}
          mode={screen.mode}
          onBack={() => setScreen({ name: 'place', place: 'barracks' })}
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
