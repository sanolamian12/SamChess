/**
 * 화면 전환 — 메타(React)와 전투(Phaser)를 한 프레임 안에서 오간다.
 *
 * ```
 * [간판·로그인] → [새 계정] → [메인·도시] ─┬─ 궁궐 ─┬ [장수 일람] → [상세] ┬ [레벨/스킬 관리]
 *                                          │        │                       └ [전적 보기]
 *                                          │        └ [도시 관리] → [도시 전적] ─┐
 *                                          ├─ 병영 ─┬ [부대 편성] → [이름] → [구성] → [배치]  │
 *                                          │        └ [출정하기] → [구성·부대] → [매칭] → [전투] → [결과]
 *                                          ├─ 장터 (아직 없다)                                │
 *                                          └─ 랭킹 ──────────────────────────────────────────┘
 * ```
 *
 * **「랭킹」이 [도시 전적]으로 바로 간다** (2026-08-25 세 번째 리디자인). 궁궐 →
 * 도시 관리 → 도시 전적으로 세 번 눌러야 닿던 화면을 메인에 자리 하나로 더 뒀다 —
 * 화면은 그대로 재사용하고(`CityRecordsScreen`), 「뒤로」가 어디서 왔는지만
 * (`cityRecords.from`) 구분해 되돌아간다.
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
  BattleOutcome, BattleResult, BattleRewards, MatchOpponent, PlayerProfile, RosterPick, Squad,
} from '@samchess/meta';
import { addSquad, squadById, syncGrain, updateSquad } from '@samchess/meta';
import { playBgm, trackForResult, trackForScreen } from '../audio/bgm.ts';
import { playSfx } from '../audio/sfx.ts';
import { installButtonSfx } from '../audio/buttonSfx.ts';
import { loadLang } from '../i18n/index.ts';
import { deleteProfileOnServer, isOffline, loadProfile, pendingSave, saveProfile } from '../meta/storage.ts';
import { getAccessToken } from '../meta/auth.ts';
import type { PlaceId } from './backdrop.ts';
import { TitleScreen } from './TitleScreen.tsx';
import { NewGameScreen } from './NewGameScreen.tsx';
import { MainScreen } from './MainScreen.tsx';
import { PlaceScreen } from './PlaceScreen.tsx';
import { CityScreen } from './CityScreen.tsx';
import { CityRecordsScreen } from './CityRecordsScreen.tsx';
import { MarketScreen } from './MarketScreen.tsx';
import { OfficerListScreen } from './OfficerListScreen.tsx';
import { OfficerDetailScreen } from './OfficerDetailScreen.tsx';
import { LevelUpScreen } from './LevelUpScreen.tsx';
import { RecordsScreen } from './RecordsScreen.tsx';
import { SortieScreen } from './SortieScreen.tsx';
import { MatchScreen } from './MatchScreen.tsx';
import { SquadListScreen } from './SquadListScreen.tsx';
import { SquadNameScreen } from './SquadNameScreen.tsx';
import { SquadEditScreen, emptySquad } from './SquadEditScreen.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import type { BattleTransport } from '../battle/transport.ts';
import { ResultScreen } from './ResultScreen.tsx';
import { useFrameFit } from './useFrameFit.ts';

export type Screen =
  | { name: 'title' }
  | { name: 'newgame' }
  | { name: 'main' }
  | { name: 'place'; place: PlaceId }
  | { name: 'city' }
  /** 「전적 보기」는 이제 궁궐 갈래(도시 관리)와 메인(랭킹 자리) 둘에서 온다 —
      `from`이 없으면 「뒤로」가 어디로 갈지 모른다 (2026-08-25 세 번째 리디자인). */
  | { name: 'cityRecords'; from: 'city' | 'main' }
  | { name: 'market' }
  | { name: 'officers' }
  | { name: 'officer'; officer: OfficerId }
  | { name: 'levelup'; officer: OfficerId }
  | { name: 'records'; officer: OfficerId }
  | { name: 'squads' }
  | { name: 'squadNew' }
  /** 만들기와 고치기가 **같은 화면**이다 — 목록에 없으면 신규다 (42·43쪽) */
  | { name: 'squadEdit'; draft: Squad }
  /** 출전 — 「구성을 선택해주세요.」 → 「부대를 선택해주세요.」 (45쪽 · F) */
  | { name: 'sortie' }
  /** 매칭 세 상태. **참가비는 여기의 [전투준비]에서 나간다** (§5-16) */
  | { name: 'match'; mode: BattleMode; squad: Squad; seed: number }
  | {
    name: 'battle'; mode: BattleMode; picks: RosterPick[]; seed: number;
    /** 출전한 부대. 이력의 `mySquad`와 배치 프리셋이 여기서 따라간다 (E) */
    squad: Squad | null;
    /** 매칭이 정한 상대 — 화면이 보여 준 그 상대와 **같은 값**이다 (F) */
    opponent: MatchOpponent;
    /** 온라인이면 **이미 방에 붙은** 판정 주체. AI면 `null` (H2) */
    online: BattleTransport | null;
  }
  | {
    name: 'result'; mode: BattleMode; result: BattleResult; outcome: string;
    /** 무승부는 고르기 전이라 `null`이다 — 그때만 `pending`이 들어 있다 (GDD §6.4) */
    rewards: BattleRewards | null;
    pending: BattleOutcome | null;
    power: { mine: number; theirs: number };
    seed: number;
    /** **성립하지 않은 판** — 환불만 있고 전적도 보상도 없다 (GDD §3.9 · H2) */
    voided: { reason: 'left' | 'idle'; refunded: boolean } | null;
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

/**
 * 전투 시드 — **부대의 구성에서 만든다.**
 *
 * 같은 부대로 다시 출전하면 같은 판이 나온다(재현). 매칭이 거절될 때마다
 * `MatchScreen`이 여기에 라운드를 더해 **다른 상대**를 뽑으므로, 시드가 고정이어도
 * 「다시 찾기」는 실제로 다른 얼굴을 물어 온다.
 */
function squadSeed(squad: Squad): number {
  let seed = squad.picks.length;
  for (const p of squad.picks) {
    for (const ch of p.officer + p.piece) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return seed || 1;
}

export function App(): React.JSX.Element {
  const [profile, setProfileState] = useState<PlayerProfile | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  /** 세션·프로필을 아직 확인하는 중 — 로그인이 되어 있는데도 간판이 잠깐 보이지 않게 한다 */
  const [booting, setBooting] = useState(true);
  const frameRef = useRef<HTMLDivElement>(null);

  /** 프로필이 바뀌면 곧바로 저장한다 — 나가기 버튼 같은 걸 두지 않기 위함이다.
   *  **실패해도 화면은 안 멈춘다**(`saveProfile`이 던지지 않는다, §5-61) */
  const setProfile = (next: PlayerProfile): void => {
    setProfileState(next);
    void saveProfile(next);
  };

  /** 로그인(또는 저장된 세션 확인) 직후 — 서버 프로필의 있고 없음으로 다음 화면을 정한다 */
  const afterSignIn = (): void => {
    void loadProfile().then((p) => {
      setProfileState(p);
      // **간판에서 실제로 메인으로 들어갈 때만** 튼다 — 계정이 없어 도시 이름
      // 짓기로 가면 그 화면을 나갈 때(아래 `onStart`) 대신 튼다.
      if (p) { playSfx('enter_city'); setScreen({ name: 'main' }); } else { setScreen({ name: 'newgame' }); }
    });
  };

  /** 저장된 세션이 있으면 간판을 건너뛴다 — 없으면(또는 만료돼 갱신도 실패하면) 간판에 머문다 */
  useEffect(() => {
    void getAccessToken().then((token) => {
      if (!token) { setBooting(false); return; }
      void loadProfile().then((p) => {
        setProfileState(p);
        if (p) setScreen({ name: 'main' }); else setScreen({ name: 'newgame' });
        setBooting(false);
      });
    });
  }, []);

  /*
   * 확인용 통로 — `audio/bgm.ts`의 `window.__bgm`, `battle/boot.ts`의 `window.__battle`과
   * 같은 결이다. **저장은 이제 비동기다** — 화면이 그리는 `profile`(React 상태)이
   * 실제로 서버에 반영됐는지는 스모크가 직접 `PUT`이 끝나는 통을 기다려야 알 수 있고,
   * 여기서는 그전에 "화면이 지금 무엇을 보여 주고 있는가"를 그대로 읽게 해 준다 —
   * `localStorage`를 다시 파싱해 재구성하는 것보다 항상 화면과 같은 값이다.
   */
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__profile = {
      get current() { return profile; },
      get offline() { return isOffline(); },
      /** 지금까지의 저장이 실제로 서버에 닿을 때까지 기다린다 — 스모크의 새로고침용 */
      flush: () => pendingSave(),
    };
  }, [profile]);

  useFrameFit(frameRef);

  /*
   * 화면마다 배경음악 한 곡 (2026-08-14 기획자 지정, 2026-08-25 상점·결과 분기 추가).
   *
   * **전투 화면은 여기서 정하지 않는다.** 안에서 배치·정찰(`prep`)과 전투(`battle`)가
   * 갈리는데 그 경계를 아는 것은 `Playback.phase`뿐이라 `BattleScene`이 부른다.
   * 여기서 `battle`을 틀면 배치 단계에 전투곡이 먼저 나온다.
   *
   * **결과 화면도 여기서 안 정한다** — 승/무/패로 갈리는데 `trackForScreen`은 화면
   * 이름만 안다. 그래서 `screen.name === 'result'`일 때만 `trackForResult`를 대신 부른다.
   *
   * 나머지는 전부 「메인」이다 — 기획자 지정이 「위가 아닌 화면」이라,
   * 앞으로 화면이 늘어도 여기 손대지 않아야 그 말이 지켜진다.
   *
   * 의존성은 `screen.name`이 아니라 `screen` 전체다 — 같은 이름의 결과 화면이라도
   * 승/무/패(`screen.result`)가 다르면 다른 곡을 틀어야 하는데, `setScreen`은
   * 언제나 새 객체라 참조 비교로도 충분하다.
   */
  useEffect(() => {
    const track = screen.name === 'result'
      ? trackForResult(screen.result, screen.voided !== null)
      : trackForScreen(screen.name);
    if (track) playBgm(track);
  }, [screen]);

  /** 버튼 효과음 위임 리스너 — 한 번만 건다 (`audio/buttonSfx.ts` 참조) */
  useEffect(() => { installButtonSfx(); }, []);

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
   *
   * **이제 화면의 시계는 정본이 아니다** (H3d) — `server-api`의 `GET /profile`이
   * 서버 자신의 시계로 다시 정산하고, `PUT /profile`은 클라이언트가 실은 `grain`을
   * 아예 안 믿는다. 여기서 매기는 값은 다음 서버 왕복까지의 **화면 표시용 미리보기**일
   * 뿐이다 — 서버 시계와 어긋나 봐야 다음 저장·새로고침에서 조용히 정정된다.
   *
   * **저장이 서버로 옮겨가며(H3a) `profile`이 더는 마운트 시점에 바로 있지 않다** —
   * `loadProfile()`이 비동기라 로그인 직후 첫 렌더에는 아직 `null`이다. 의존성을
   * `[]`로 두면 마운트 때 딱 한 번 도는 `tick()`이 그 `null`에 대고 아무 일도
   * 안 하고 끝나 버리고, 그다음은 1분 뒤에나 다시 온다 — 그사이 도시 화면에 들어가면
   * 「군량이 안 찬다」로 보인다. **프로필이 처음 채워지는 순간에도 한 번 더 돈다.**
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
  }, [Boolean(profile)]);

  return (
    <div id="frame" ref={frameRef} className={screen.name === 'battle' ? 'battle' : 'meta'}>
      {booting ? null : screen.name === 'title' ? (
        <TitleScreen onSignedIn={afterSignIn} />
      ) : screen.name === 'newgame' || !profile ? (
        // 계정이 없으면 어느 화면을 향했든 여기부터다 — 도시 이름이 있어야 나머지가 성립한다
        <NewGameScreen onStart={(p) => { setProfile(p); playSfx('enter_city'); setScreen({ name: 'main' }); }} />
      ) : screen.name === 'main' ? (
        <MainScreen
          profile={profile}
          onGo={(place) => setScreen({ name: 'place', place })}
          onRanking={() => setScreen({ name: 'cityRecords', from: 'main' })}
          onReset={() => { setProfileState(null); setScreen({ name: 'title' }); }}
          onDeleteCity={() => {
            void deleteProfileOnServer().then(() => {
              setProfileState(null);
              setScreen({ name: 'newgame' });
            });
          }}
        />
      ) : screen.name === 'place' ? (
        <PlaceScreen
          profile={profile}
          place={screen.place}
          onBack={() => setScreen({ name: 'main' })}
          onSortie={() => setScreen({ name: 'sortie' })}
          onSquads={() => setScreen({ name: 'squads' })}
          onOfficers={() => setScreen({ name: 'officers' })}
          onCity={() => setScreen({ name: 'city' })}
          onMarket={() => setScreen({ name: 'market' })}
        />
      ) : screen.name === 'market' ? (
        <MarketScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'market' })}
          onChange={setProfile}
        />
      ) : screen.name === 'city' ? (
        <CityScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'palace' })}
          onChange={setProfile}
          onRecords={() => setScreen({ name: 'cityRecords', from: 'city' })}
        />
      ) : screen.name === 'cityRecords' ? (
        <CityRecordsScreen
          profile={profile}
          from={screen.from}
          onBack={() => setScreen(screen.from === 'main' ? { name: 'main' } : { name: 'city' })}
        />
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
      ) : screen.name === 'squads' ? (
        <SquadListScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'barracks' })}
          onNew={() => setScreen({ name: 'squadNew' })}
          onOpen={(id) => {
            const squad = squadById(profile, id);
            if (squad) setScreen({ name: 'squadEdit', draft: squad });
          }}
          onChange={setProfile}
        />
      ) : screen.name === 'squadNew' ? (
        <SquadNameScreen
          profile={profile}
          onBack={() => setScreen({ name: 'squads' })}
          // 아직 저장하지 않는다 — 구성이 없는 부대는 성립하지 않는다(`validateSquad`)
          onNext={(name, mode) => setScreen({
            name: 'squadEdit', draft: emptySquad(`sq${profile.squadSeq}`, name, mode),
          })}
        />
      ) : screen.name === 'squadEdit' ? (
        <SquadEditScreen
          profile={profile}
          draft={screen.draft}
          onBack={() => setScreen({ name: 'squads' })}
          onSave={(squad) => {
            // **만들기와 고치기의 갈림은 「목록에 있는가」 하나다** — 화면이 자기가
            // 신규인지 기억하지 않는다. 저장 뒤에는 어느 쪽이든 목록으로 돌아간다.
            setProfile(squadById(profile, squad.id)
              ? updateSquad(profile, squad.id, squad)
              : addSquad(profile, squad).profile);
            setScreen({ name: 'squads' });
          }}
        />
      ) : screen.name === 'sortie' ? (
        <SortieScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'barracks' })}
          // 「직접 편성 루트」 — 부대가 없으면 여기서 만들고 온다 (2026-08-18 확정)
          onNewSquad={() => setScreen({ name: 'squadNew' })}
          onSeek={(mode, squad) => setScreen({ name: 'match', mode, squad, seed: squadSeed(squad) })}
        />
      ) : screen.name === 'match' ? (
        <MatchScreen
          profile={profile}
          mode={screen.mode}
          squad={screen.squad}
          seed={screen.seed}
          // 뒤로 가도 **참가비는 안 나갔다** — 낸 것은 거절 −1뿐이고 그건 이미 저장됐다
          onBack={() => setScreen({ name: 'sortie' })}
          onChange={setProfile}
          onReady={(spent, opponent, online) => {
            setProfile(spent);
            setScreen({
              name: 'battle', mode: screen.mode, picks: screen.squad.picks,
              seed: screen.seed, squad: screen.squad, opponent, online,
            });
          }}
        />
      ) : screen.name === 'battle' ? (
        <BattleScreen
          profile={profile}
          mode={screen.mode}
          picks={screen.picks}
          seed={screen.seed}
          squad={screen.squad}
          opponent={screen.opponent}
          online={screen.online}
          onDone={(result) => { setProfile(result.profile); setScreen({ name: 'result', ...result.screen }); }}
        />
      ) : (
        <ResultScreen
          profile={profile}
          mode={screen.mode}
          result={screen.result}
          outcome={screen.outcome}
          rewards={screen.rewards}
          pending={screen.pending}
          power={screen.power}
          seed={screen.seed}
          voided={screen.voided}
          onChange={setProfile}
          onAgain={() => setScreen({ name: 'sortie' })}
          onHome={() => setScreen({ name: 'main' })}
        />
      )}
    </div>
  );
}
