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
 * 화면은 그대로 재사용하고(`RankingScreen`), 「뒤로」가 어디서 왔는지만
 * (`ranking.from`) 구분해 되돌아간다.
 *
 * **랭킹이 [도시 전적] 하나에서 [도시/부대/장수] 세 탭으로 늘었다** (pptx 46~49쪽,
 * 2026-08-26). 예전 `CityRecordsScreen`의 내용은 `RankingScreen`의 도시 탭 하단
 * "내 도시" 패널로 그대로 옮겨졌다 — 화면 이름만 바뀌었을 뿐 진입 경로(메인의
 * 랭킹 자리 · 궁궐의 [도시 전적 보기])는 그대로다.
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
import {
  ACADEMY_RESEARCH_MS, applyAckResearch,
  RAID_RESPONSE_MS, addSquad, buildingLevel, guardsTakenBy, raidBlocksSortie, raidDay, raidLastCall,
  raidRemainingMs, removeSquad, squadById, syncCity, updateSquad,
} from '@samchess/meta';
import { officerById } from '@samchess/data';
import { playBgm, trackForResult, trackForScreen } from '../audio/bgm.ts';
import { playSfx } from '../audio/sfx.ts';
import { installButtonSfx } from '../audio/buttonSfx.ts';
import { loadDubLang, loadLang, t } from '../i18n/index.ts';
import { deleteProfileOnServer, isOffline, loadProfile, pendingSave, saveProfile } from '../meta/storage.ts';
import { getAccessToken } from '../meta/auth.ts';
import type { ExtBuildingId, PlaceId } from './backdrop.ts';
import { TitleScreen } from './TitleScreen.tsx';
import { NewGameScreen } from './NewGameScreen.tsx';
import { MainScreen } from './MainScreen.tsx';
import { PlaceScreen } from './PlaceScreen.tsx';
import { BuildingScreen } from './BuildingScreen.tsx';
import { CityScreen } from './CityScreen.tsx';
import { BuildingsScreen } from './BuildingsScreen.tsx';
import { RankingScreen } from './RankingScreen.tsx';
import { CityRankingScreen } from './CityRankingScreen.tsx';
import { SquadRankingScreen } from './SquadRankingScreen.tsx';
import { OfficerRankingScreen } from './OfficerRankingScreen.tsx';
import { MarketScreen } from './MarketScreen.tsx';
import { OfficerListScreen } from './OfficerListScreen.tsx';
import { OfficerDetailScreen } from './OfficerDetailScreen.tsx';
import { LevelUpScreen } from './LevelUpScreen.tsx';
import { RecordsScreen } from './RecordsScreen.tsx';
import { SortieScreen } from './SortieScreen.tsx';
import { MatchScreen } from './MatchScreen.tsx';
import { SquadListScreen } from './SquadListScreen.tsx';
import { SquadNameScreen } from './SquadNameScreen.tsx';
import { SquadMembersScreen, emptySquad } from './SquadMembersScreen.tsx';
import { SquadViewScreen } from './SquadViewScreen.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import type { BattleTransport } from '../battle/transport.ts';
import { ResultScreen } from './ResultScreen.tsx';
import { RaidBattleScreen, RaidResultScreen } from './RaidBattleScreen.tsx';
import { RaidAlert } from './RaidAlert.tsx';
import { AcademyNotice } from './AcademyNotice.tsx';
import { ackResearchOnServer } from '../meta/city.ts';
import type { RaidAlertKind } from './RaidAlert.tsx';
import { RaidRequestFailed, startRaidOnServer, surrenderRaidOnServer } from '../meta/raid.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import { useFrameFit } from './useFrameFit.ts';

export type Screen =
  | { name: 'title' }
  | { name: 'newgame' }
  | { name: 'main'; view?: 'core' | 'ext' }
  | { name: 'place'; place: PlaceId }
  /** 확장 도시(산 너머) 건물 넷의 내부 — 안 지었어도 간다 (트랙 11h).
      **뒤로는 산 너머로 돌아간다** — `main`의 성 안/산 너머 구분은
      `MainScreen`의 내부 상태라, 돌아갈 때 `view: 'ext'`로 되살려 준다. */
  | { name: 'building'; building: ExtBuildingId }
  | { name: 'city' }
  /** 짓기·증축 — 도시 관리(현황판)에서 갈라져 나왔다 (2026-09-04 두 번째 손질) */
  | { name: 'buildings' }
  /** 「전적 보기」는 이제 궁궐 갈래(도시 관리)와 메인(랭킹 자리) 둘에서 온다 —
      `from`이 없으면 「뒤로」가 어디로 갈지 모른다 (2026-08-25 세 번째 리디자인).
      pptx 50~52쪽(2026-08-26 디자인 심화)부터 궁궐·병영처럼 「메뉴 → 그 안의 화면」
      한 걸음이라 넷으로 갈렸다 — `ranking`이 메뉴, 나머지 셋이 각 판이다. 메뉴의
      「뒤로」만 `from`을 본다 — 판 셋의 「뒤로」는 늘 메뉴로 돌아간다. */
  | { name: 'ranking'; from: 'city' | 'main' }
  | { name: 'rankingCity'; from: 'city' | 'main' }
  | { name: 'rankingSquad'; from: 'city' | 'main' }
  | { name: 'rankingOfficer'; from: 'city' | 'main' }
  | { name: 'market' }
  | { name: 'officers' }
  | { name: 'officer'; officer: OfficerId }
  | { name: 'levelup'; officer: OfficerId }
  | { name: 'records'; officer: OfficerId }
  | { name: 'squads' }
  /** 새 부대의 첫 걸음. `initial` — 부대원 걸음에서 [뒤로 가기]로 돌아왔을 때 이름·모드 */
  | { name: 'squadNew'; initial?: { name: string; mode: BattleMode } }
  /** 부대 현황 — 읽기 전용 (67쪽). 목록의 줄이 여기로 온다 */
  | { name: 'squadView'; id: string }
  /**
   * 부대원 고르기 → 배치 확인 → 저장 (68·69·71·72쪽). **`base`가 `null`이면 신규다** —
   * 새 부대와 고치는 부대가 **같은 걸음**을 지난다(2026-09-17 기획자 확정).
   */
  | { name: 'squadEdit'; draft: Squad; base: Squad | null }
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
  }
  /** 도적떼 방어전 (GDD §5.11) — 판은 서버가 굳혀 둔 `raid.battle`로 만든다 */
  | { name: 'raidBattle' }
  | { name: 'raidResult'; banditsLeft: number; error: string | null };

/** 도적떼 시계 — 카운트다운이 초 단위다. 판정엔 안 쓴다(마감은 서버가 정한다) */
const RAID_TICK_MS = 1_000;

/**
 * 「이 도적떼의 자동 항복 알림을 봤다」 — **브라우저마다의 편의**라 `localStorage`에 둔다
 * (새로고침마다 같은 알림이 다시 뜨지 않게). 못 읽으면 한 번 더 뜰 뿐이다.
 */
const RAID_SEEN_KEY = 'samchess.raidSettledSeen';
const readSeen = (): number => {
  try { return Number(localStorage.getItem(RAID_SEEN_KEY) ?? 0) || 0; } catch { return 0; }
};
const writeSeen = (spawnedAt: number): void => {
  try { localStorage.setItem(RAID_SEEN_KEY, String(spawnedAt)); } catch { /* 없어도 된다 */ }
};

/** 알림이 뜨면 안 되는 화면 — 판 안 · 매칭 중 · 계정이 서기 전 */
const NO_ALERT: readonly Screen['name'][] = ['title', 'newgame', 'battle', 'raidBattle', 'match'];

/** 저장된 언어를 읽는 것은 화면이 처음 그려지기 **전**이어야 한다 — 한국어로 한 번 깜빡이지 않게. */
loadLang();
/** 저장된 더빙 선택도 같은 이유로 먼저 읽는다 — 없으면 `dubLangFor`가 자동 매칭으로 돈다. */
loadDubLang();

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
   * **채우는 것은 군량만이 아니다** (2026-09-04) — 나은 부상과 지난 병원 room도
   * 여기서 정리된다. 셋을 각각 정산 함수로 두면 화면이 셋 다 부르기를 기대하게
   * 되고, 하나를 잊으면 조용히 낡은 값이 남는다. 그래서 **`syncCity()` 하나**다.
   *
   * **`syncCity()`는 바뀐 게 없으면 같은 객체를 돌려준다.** 그래서 아무 일도 없는
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
      const next = syncCity(now, Date.now());
      if (next !== now) saveProfile(next);
      return next;
    });
    tick();
    const id = setInterval(tick, GRAIN_TICK_MS);
    return () => clearInterval(id);
  }, [Boolean(profile)]);

  /*
   * ── 도적떼 (GDD §5.11) ─────────────────────────────────────────────
   *
   * **출몰도 마감도 서버가 정한다.** 화면이 하는 일은 셋이다 — 알리고, 세고, 날이 바뀌었으면
   * 계정을 다시 읽어 서버에게 「출몰의 문」을 지나게 하는 것(`GET /profile`이 그 문이다).
   * 마감을 넘기면 서버가 이미 항복으로 정산했으므로 **다시 읽기만** 한다 — 화면이 약탈을
   * 계산하지 않는다.
   */
  const [raidNow, setRaidNow] = useState(() => Date.now());
  const [raidAlert, setRaidAlert] = useState<RaidAlertKind | null>(null);
  const [raidBusy, setRaidBusy] = useState(false);
  const [raidError, setRaidError] = useState<string | null>(null);
  /** 이 도적떼(`spawnedAt`)에 대해 이미 닫은 알림 — 메모리에만 둔다 */
  const raidAck = useRef<{ first: number; lastCall: number }>({ first: 0, lastCall: 0 });
  /** 시작 요청이 가는 중 — 같은 렌더 안의 두 번째 클릭까지 막는다 */
  const raidInFlight = useRef(false);
  /** 비동기 응답이 「지금 어느 화면인가」를 묻는 자리 — 클로저의 `screen`은 누른 순간의 값이다 */
  const screenRef = useRef(screen.name);
  screenRef.current = screen.name;
  /** 부대에 넣으려는데 파수꾼이 끼어 있다 — 확인을 기다리는 저장 */
  const [guardConfirm, setGuardConfirm] = useState<{ names: string; go: () => void } | null>(null);
  const raid = profile?.raid;
  const raidLive = raid?.status === 'pending' || raid?.status === 'fighting';

  useEffect(() => {
    if (!raidLive) return;
    const id = setInterval(() => setRaidNow(Date.now()), RAID_TICK_MS);
    return () => clearInterval(id);
  }, [raidLive]);

  // 날이 바뀌었으면 메인·자리에 들어올 때 다시 읽는다 — 앱을 켠 채 자정을 넘긴 사람도 온다
  const dayChecked = useRef('');
  useEffect(() => {
    if (!profile || (screen.name !== 'main' && screen.name !== 'place')) return;
    if (buildingLevel(profile, 'farm') <= 0) return;
    const today = raidDay(Date.now());
    if (profile.raid?.day === today || dayChecked.current === today) return;
    dayChecked.current = today;
    void loadProfile().then((p) => { if (p) setProfileState(p); });
  }, [screen.name, profile]);

  // 마감이 지났다 — 서버가 항복으로 정산했을 것이다. 한 번만 다시 읽는다
  const deadlineChecked = useRef(0);
  useEffect(() => {
    if (raid?.status !== 'pending' || raidRemainingMs(raid, raidNow) > 0) return;
    if (deadlineChecked.current === raid.spawnedAt) return;
    deadlineChecked.current = raid.spawnedAt;
    void loadProfile().then((p) => { if (p) setProfileState(p); });
  }, [raid, raidNow]);

  // 어떤 알림을 띄울까 — 이미 떠 있으면 그대로 둔다
  useEffect(() => {
    // 판 안으로 들어왔는데 알림이 남아 있다(늦게 도착한 실패가 열었다 등) — 거둔다
    if (NO_ALERT.includes(screen.name)) {
      if (raidAlert && raidAlert !== 'settled') setRaidAlert(null);
      return;
    }
    if (!raid) return;
    if (raidAlert) {
      // 떠 있던 알림의 사건이 끝났다(다른 탭에서 싸웠다 등) — 거둔다
      if (raidAlert !== 'settled' && raid.status !== 'pending') setRaidAlert(null);
      return;
    }
    if (raid.status === 'pending') {
      if (raidLastCall(raid, raidNow) && raidAck.current.lastCall !== raid.spawnedAt) setRaidAlert('lastCall');
      else if (screen.name === 'main' && raidAck.current.first !== raid.spawnedAt) setRaidAlert('first');
      return;
    }
    // 자동 항복(정산 시각 = 마감)만 알린다 — 사람이 누른 항복은 그 자리에서 이미 알렸다
    if (raid.status === 'surrendered' && raid.settledAt === raid.spawnedAt + RAID_RESPONSE_MS && readSeen() !== raid.spawnedAt) {
      setRaidAlert('settled');
    }
  }, [raid, raidNow, screen.name, raidAlert]);

  const closeRaidAlert = (): void => {
    if (raid) {
      if (raidAlert === 'first') raidAck.current.first = raid.spawnedAt;
      if (raidAlert === 'lastCall') raidAck.current.lastCall = raid.spawnedAt;
      if (raidAlert === 'settled') writeSeen(raid.spawnedAt);
    }
    setRaidError(null);
    setRaidAlert(null);
  };

  /** [지금 전투] · [전투하기] — 서버가 시드를 내고 나서야 판을 만든다 */
  const fightRaid = (): void => {
    // **한 번만 보낸다** — 두 번 누르면 둘째 요청이 「이미 전투가 시작됐다」로 거부되고, 그 실패가
    // 이미 들어간 방어전 위에 알림을 띄웠다(2026-09-21). `raidBusy`는 다음 렌더에야 단추를 막는다
    if (raidInFlight.current) return;
    raidInFlight.current = true;
    setRaidBusy(true);
    setRaidError(null);
    void startRaidOnServer().then((next) => {
      setProfileState(next);
      setRaidAlert(null);
      setScreen({ name: 'raidBattle' });
    }, (e: unknown) => {
      // 그사이 판 안으로 들어갔으면 말할 자리가 없다 — 판이 이미 서 있다
      if (NO_ALERT.includes(screenRef.current)) return;
      setRaidError(e instanceof RaidRequestFailed ? e.message : String(e));
      // 메인·농지의 단추로 왔으면 알림이 없다 — 이유를 말할 자리로 연다
      setRaidAlert((k) => k ?? 'first');
    }).finally(() => { raidInFlight.current = false; setRaidBusy(false); });
  };

  const surrenderRaid = (): void => {
    setRaidBusy(true);
    setRaidError(null);
    void surrenderRaidOnServer().then((next) => {
      setProfileState(next);
      setRaidAlert('settled');
    }, (e: unknown) => {
      setRaidError(e instanceof RaidRequestFailed ? e.message : String(e));
    }).finally(() => setRaidBusy(false));
  };

  /*
   * ── 태학 연구 완료 (GDD §5.12, 2026-09-22) ─────────────────────────
   *
   * 끝나는 순간에 맞춰 한 번 더 정산한다 — 1분 시계(`GRAIN_TICK_MS`)만 믿으면 축하 팝업이
   * 최대 1분 늦는다. 정산 자체는 여전히 `syncCity()` 하나다(시각을 넣는 자리는 여기).
   */
  const research = profile?.academy?.research;
  useEffect(() => {
    if (!research) return;
    const left = Math.max(0, research.startedAt + ACADEMY_RESEARCH_MS - Date.now());
    const id = setTimeout(() => setProfileState((p) => (p ? syncCity(p, Date.now()) : p)), left + 300);
    return () => clearTimeout(id);
  }, [research?.startedAt, research?.tactic]);

  const [noticeBusy, setNoticeBusy] = useState(false);
  const academyNotice = (profile?.academy?.notice?.length ?? 0) > 0;
  /** [확인] — 서버의 `notice`를 비운다. 못 닿으면 **화면에서만** 비운다(다음 접속에 한 번 더 뜬다) */
  const ackNotice = (): void => {
    if (!profile) return;
    setNoticeBusy(true);
    void ackResearchOnServer().then((next) => {
      setProfileState(next ?? applyAckResearch(profile));
    }, () => setProfileState(applyAckResearch(profile))).finally(() => setNoticeBusy(false));
  };

  /** 부대를 저장하기 전 — 파수꾼이 끼어 있으면 묻는다 (병영 쪽의 편의, GDD §5.11) */
  const confirmGuards = (picks: RosterPick[], go: () => void): void => {
    if (!profile) return;
    const taken = guardsTakenBy(profile, picks);
    if (taken.length === 0) { go(); return; }
    const names = taken.map((id) => pickOfficerNameById(id, officerById.get(id)?.name ?? id)).join(', ');
    setGuardConfirm({ names, go });
  };

  return (
    <div id="frame" ref={frameRef} className={screen.name === 'battle' || screen.name === 'raidBattle' ? 'battle' : 'meta'}>
      {booting ? null : screen.name === 'title' ? (
        <TitleScreen onSignedIn={afterSignIn} />
      ) : screen.name === 'newgame' || !profile ? (
        // 계정이 없으면 어느 화면을 향했든 여기부터다 — 도시 이름이 있어야 나머지가 성립한다
        <NewGameScreen onStart={(p) => { setProfile(p); playSfx('enter_city'); setScreen({ name: 'main' }); }} />
      ) : screen.name === 'main' ? (
        <MainScreen
          profile={profile}
          initialView={screen.view}
          onGo={(place) => setScreen({ name: 'place', place })}
          onBuilding={(building) => setScreen({ name: 'building', building })}
          onRanking={() => setScreen({ name: 'ranking', from: 'main' })}
          raid={raidLive && raid ? {
            status: raid.status === 'fighting' ? 'fighting' : 'pending',
            remainingMs: raidRemainingMs(raid, raidNow),
            busy: raidBusy,
            onFight: fightRaid,
            onSurrender: surrenderRaid,
          } : null}
          onReset={() => { setProfileState(null); setScreen({ name: 'title' }); }}
          onDeleteCity={() => {
            // **실패를 무시하지 않는다** (2026-09-04). 예전에는 결과와 상관없이
            // 새 도시 화면으로 넘어갔는데, 서버 행이 남아 있으면 거기서 만든 도시가
            // **옛 계정 위에 얹힌다**(`saveProfile`이 서버 소유 필드를 지키므로
            // 건물·자재가 그대로 따라온다). 화면에는 아무 표시도 없었다.
            void deleteProfileOnServer().then((ok) => {
              if (!ok) {
                window.alert(t('main.deleteCityFailed'));
                return;
              }
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
          onChange={setProfile}
          sortieBlocked={raidBlocksSortie(profile)}
          onSortie={() => setScreen({ name: 'sortie' })}
          onSquads={() => setScreen({ name: 'squads' })}
          onOfficers={() => setScreen({ name: 'officers' })}
          onCity={() => setScreen({ name: 'city' })}
          onMarket={() => setScreen({ name: 'market' })}
        />
      ) : screen.name === 'building' ? (
        <BuildingScreen
          profile={profile}
          building={screen.building}
          onBack={() => setScreen({ name: 'main', view: 'ext' })}
          onChange={setProfile}
          onRaidFight={fightRaid}
          raidBusy={raidBusy}
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
          onBuildings={() => setScreen({ name: 'buildings' })}
        />
      ) : screen.name === 'buildings' ? (
        <BuildingsScreen
          profile={profile}
          onBack={() => setScreen({ name: 'city' })}
          onChange={setProfile}
        />
      ) : screen.name === 'ranking' ? (
        <RankingScreen
          profile={profile}
          from={screen.from}
          onBack={() => setScreen(screen.from === 'main' ? { name: 'main' } : { name: 'city' })}
          onCity={() => setScreen({ name: 'rankingCity', from: screen.from })}
          onSquad={() => setScreen({ name: 'rankingSquad', from: screen.from })}
          onOfficer={() => setScreen({ name: 'rankingOfficer', from: screen.from })}
        />
      ) : screen.name === 'rankingCity' ? (
        <CityRankingScreen
          profile={profile}
          onBack={() => setScreen({ name: 'ranking', from: screen.from })}
        />
      ) : screen.name === 'rankingSquad' ? (
        <SquadRankingScreen
          profile={profile}
          onBack={() => setScreen({ name: 'ranking', from: screen.from })}
        />
      ) : screen.name === 'rankingOfficer' ? (
        <OfficerRankingScreen
          profile={profile}
          onBack={() => setScreen({ name: 'ranking', from: screen.from })}
        />
      ) : screen.name === 'officers' ? (
        <OfficerListScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'palace' })}
          onChange={setProfile}
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
          onOpen={(id) => setScreen({ name: 'squadView', id })}
        />
      ) : screen.name === 'squadNew' ? (
        <SquadNameScreen
          profile={profile}
          {...(screen.initial ? { initial: screen.initial } : {})}
          onBack={() => setScreen({ name: 'squads' })}
          // 아직 저장하지 않는다 — 구성이 없는 부대는 성립하지 않는다(`validateSquad`)
          onNext={(name, mode) => setScreen({
            name: 'squadEdit', draft: emptySquad(`sq${profile.squadSeq}`, name, mode), base: null,
          })}
        />
      ) : screen.name === 'squadView' ? (
        (() => {
          // 부대를 id로 들고 와 **매번 프로필에서 다시 찾는다** — 값으로 들고 있으면
          // 레벨업·치료가 끝난 뒤에도 옛 줄을 보여 준다. 없어졌으면 목록으로.
          const squad = squadById(profile, screen.id);
          if (!squad) return <SquadListScreen profile={profile} onBack={() => setScreen({ name: 'place', place: 'barracks' })} onNew={() => setScreen({ name: 'squadNew' })} onOpen={(id) => setScreen({ name: 'squadView', id })} />;
          return (
            <SquadViewScreen
              profile={profile}
              squad={squad}
              onBack={() => setScreen({ name: 'squads' })}
              onManage={() => setScreen({ name: 'squadEdit', draft: squad, base: squad })}
              /* 지우는 자리도 **저장과 같은 결**이다 — 규칙이 지우고(`removeSquad`)
                 화면은 목록으로 돌아간다. */
              onDelete={(id) => {
                setProfile(removeSquad(profile, id));
                setScreen({ name: 'squads' });
              }}
            />
          );
        })()
      ) : screen.name === 'squadEdit' ? (
        <SquadMembersScreen
          // 새 부대와 고치는 부대가 같은 컴포넌트라 **id로 갈라 다시 세운다** —
          // 안 가르면 한쪽의 고르던 상태가 다른 쪽으로 새어 든다
          key={screen.draft.id}
          profile={profile}
          draft={screen.draft}
          base={screen.base}
          onChange={setProfile}
          onBack={(draft) => setScreen(screen.base
            ? { name: 'squadView', id: screen.base.id }
            : { name: 'squadNew', initial: { name: draft.name, mode: draft.mode } })}
          onSave={(squad) => confirmGuards(squad.picks, () => {
            // **만들기와 고치기의 갈림은 `base` 하나다.** 만든 시각은 화면이 넣는다
            // (meta는 시계를 안 읽는다) — 병영 현황판의 「최근 부대」가 이것을 본다.
            // 파수꾼이 끼어 있었다면 규칙(`addSquad`·`updateSquad`)이 농지에서 뺀다
            if (screen.base) {
              setProfile(updateSquad(profile, squad.id, squad));
              setScreen({ name: 'squadView', id: squad.id });
            } else {
              const made = addSquad(profile, squad, Date.now());
              setProfile(made.profile);
              setScreen({ name: 'squadView', id: made.squad.id });
            }
          })}
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
      ) : screen.name === 'raidBattle' ? (
        <RaidBattleScreen
          profile={profile}
          // 서버가 정산한 계정이다 — `PUT`으로 되올릴 까닭이 없다
          onDone={(done) => { setProfileState(done.profile); setScreen({ name: 'raidResult', banditsLeft: done.banditsLeft, error: done.error }); }}
        />
      ) : screen.name === 'raidResult' ? (
        <RaidResultScreen
          profile={profile}
          banditsLeft={screen.banditsLeft}
          error={screen.error}
          onHome={() => setScreen({ name: 'main' })}
          onFarm={() => setScreen({ name: 'building', building: 'farm' })}
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

      {raidAlert && profile && !NO_ALERT.includes(screen.name) && (
        <RaidAlert
          kind={raidAlert}
          profile={profile}
          nowMs={raidNow}
          busy={raidBusy}
          error={raidError}
          onFight={fightRaid}
          onPrepare={closeRaidAlert}
          onSurrender={surrenderRaid}
          onToFarm={() => { closeRaidAlert(); setScreen({ name: 'building', building: 'farm' }); }}
          onClose={closeRaidAlert}
        />
      )}

      {/* 도적떼 알림이 떠 있으면 기다린다 — 둘이 겹치면 어느 [확인]이 무엇인지 모른다 */}
      {academyNotice && profile && !raidAlert && !NO_ALERT.includes(screen.name) && (
        <AcademyNotice profile={profile} busy={noticeBusy} onOk={ackNotice} />
      )}

      {guardConfirm && (
        <div className="modal-back" data-modal="guardConfirm">
          <div className="modal frg-confirm">
            <p className="modal-ttl">{t('squad.guardConfirm.title')}</p>
            <p className="frg-confirm-body">{t('squad.guardConfirm.body', { names: guardConfirm.names })}</p>
            <div className="frg-confirm-acts">
              <button className="btn primary wide" data-action="guardConfirmOk" onClick={() => { const go = guardConfirm.go; setGuardConfirm(null); go(); }}>
                {t('squad.guardConfirm.ok')}
              </button>
              <button className="btn wide" data-action="guardConfirmCancel" onClick={() => setGuardConfirm(null)}>
                {t('squad.guardConfirm.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
