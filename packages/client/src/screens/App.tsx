/**
 * 화면 전환 — 메타(React)와 전투(Phaser)를 한 프레임 안에서 오간다.
 *
 * ```
 * [간판·로그인] → [새 계정] → [메인·도시] ─┬─ 궁궐 ─┬ [장수 일람] → [상세] ┬ [레벨/스킬 관리]
 *                                          │        │                       └ [전적 보기]
 *                                          │        └ [도시 관리] → [도시 전적]
 *                                          ├─ 병영 → [편성] → [전투] → [결과]
 *                                          └─ 장터 (아직 없다)
 * ```
 *
 * **궁궐 갈래가 셋으로 늘었다** (pptx 37·38쪽, 2026-08-17). 예전 「장수 관리」 한 화면이
 * 일람·상세·레벨업으로 갈렸다. 상세가 어느 장수인지는 **화면 상태가 들고 있다** —
 * 프로필에 「지금 보는 장수」를 넣으면 저장 형식이 화면 사정에 끌려간다.
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
import type { BattleMode, OfficerId } from '@samchess/rules';
import type {
  BattleOutcome, BattleResult, BattleRewards, PlayerProfile, RosterPick,
} from '@samchess/meta';
import { syncGrain } from '@samchess/meta';
import { playBgm, trackForScreen } from '../audio/bgm.ts';
import { loadLang } from '../i18n/index.ts';
import { loadProfile, saveProfile } from '../meta/storage.ts';
import type { PlaceId } from './backdrop.ts';
import { TitleScreen } from './TitleScreen.tsx';
import { NewGameScreen } from './NewGameScreen.tsx';
import { MainScreen } from './MainScreen.tsx';
import { PlaceScreen } from './PlaceScreen.tsx';
import { CityScreen } from './CityScreen.tsx';
import { CityRecordsScreen } from './CityRecordsScreen.tsx';
import { OfficerListScreen } from './OfficerListScreen.tsx';
import { OfficerDetailScreen } from './OfficerDetailScreen.tsx';
import { LevelUpScreen } from './LevelUpScreen.tsx';
import { RecordsScreen } from './RecordsScreen.tsx';
import { RosterScreen } from './RosterScreen.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import { ResultScreen } from './ResultScreen.tsx';
import { useFrameFit } from './useFrameFit.ts';

export type Screen =
  | { name: 'title' }
  | { name: 'newgame' }
  | { name: 'main' }
  | { name: 'place'; place: PlaceId }
  | { name: 'city' }
  | { name: 'cityRecords' }
  | { name: 'officers' }
  | { name: 'officer'; officer: OfficerId }
  | { name: 'levelup'; officer: OfficerId }
  | { name: 'records'; officer: OfficerId }
  | { name: 'roster'; mode: BattleMode }
  | { name: 'battle'; mode: BattleMode; picks: RosterPick[]; seed: number }
  | {
    name: 'result'; mode: BattleMode; result: BattleResult; outcome: string;
    /** 무승부는 고르기 전이라 `null`이다 — 그때만 `pending`이 들어 있다 (GDD §6.4) */
    rewards: BattleRewards | null;
    pending: BattleOutcome | null;
    power: { mine: number; theirs: number };
    seed: number;
  };

/** 저장된 언어를 읽는 것은 화면이 처음 그려지기 **전**이어야 한다 — 한국어로 한 번 깜빡이지 않게. */
loadLang();

/**
 * 군량을 다시 세어 보는 간격.
 *
 * **충전량과는 무관하다** — `syncGrain()`이 지난 시각으로 계산하므로 이 값은
 * 「화면의 숫자가 얼마나 늦게 따라오는가」만 정한다. 가장 빠른 Lv9도 9분에 하나라
 * 1분이면 눈에 띄게 늦지 않고, 탭을 오래 열어 두는 사람에게도 부담이 없다.
 */
const GRAIN_TICK_MS = 60_000;

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
   * 군량 시간 충전 — **지금 시각을 넣는 자리는 여기 하나다** ★ (C2 · GDD §5)
   *
   * `@samchess/meta`는 `Date.now()`를 부르지 않는다 — 「세 시간 뒤에 셋 찬다」를
   * 세 시간 기다려 확인할 수는 없어서다(`backdrop.ts`의 `bandForHour()`와 같은 규약).
   * 그 대신 화면이 시계를 넣는데, **도시 화면에서만 채우면 안 된다** — 군량을 읽는
   * 자리가 넷(메인의 통계·병영의 잠금·편성의 참가비·도시)이라 도시를 안 들르면
   * 나머지가 낡은 값을 본다. 그래서 앱이 열릴 때 한 번, 그 뒤 1분마다 여기서 채운다.
   *
   * **`syncGrain()`은 바뀐 게 없으면 같은 객체를 돌려준다.** 그래서 아무 일도 없는
   * 계정을 분마다 디스크에 쓰지 않는다.
   */
  useEffect(() => {
    const tick = (): void => setProfileState((now) => {
      if (!now) return now;
      const next = syncGrain(now, Date.now());
      if (next !== now) saveProfile(next);
      return next;
    });
    tick();
    const id = setInterval(tick, GRAIN_TICK_MS);
    return () => clearInterval(id);
  }, []);

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
          onCity={() => setScreen({ name: 'city' })}
        />
      ) : screen.name === 'city' ? (
        <CityScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'palace' })}
          onChange={setProfile}
          onRecords={() => setScreen({ name: 'cityRecords' })}
        />
      ) : screen.name === 'cityRecords' ? (
        <CityRecordsScreen profile={profile} onBack={() => setScreen({ name: 'city' })} />
      ) : screen.name === 'officers' ? (
        <OfficerListScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'palace' })}
          onOpen={(officer) => setScreen({ name: 'officer', officer })}
        />
      ) : screen.name === 'officer' ? (
        <OfficerDetailScreen
          profile={profile}
          officer={screen.officer}
          onList={() => setScreen({ name: 'officers' })}
          onLevels={() => setScreen({ name: 'levelup', officer: screen.officer })}
          onRecords={() => setScreen({ name: 'records', officer: screen.officer })}
        />
      ) : screen.name === 'levelup' ? (
        <LevelUpScreen
          profile={profile}
          officer={screen.officer}
          onChange={setProfile}
          onBack={() => setScreen({ name: 'officer', officer: screen.officer })}
          onRecords={() => setScreen({ name: 'records', officer: screen.officer })}
        />
      ) : screen.name === 'records' ? (
        <RecordsScreen
          profile={profile}
          officer={screen.officer}
          onList={() => setScreen({ name: 'officers' })}
          onDetail={() => setScreen({ name: 'officer', officer: screen.officer })}
          onLevels={() => setScreen({ name: 'levelup', officer: screen.officer })}
        />
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
          profile={profile}
          result={screen.result}
          outcome={screen.outcome}
          rewards={screen.rewards}
          pending={screen.pending}
          power={screen.power}
          seed={screen.seed}
          onChange={setProfile}
          onAgain={() => setScreen({ name: 'roster', mode: screen.mode })}
          onHome={() => setScreen({ name: 'main' })}
        />
      )}
    </div>
  );
}
