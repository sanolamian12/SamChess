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
 * 화면이 바뀔 때 크기가 튀지 않는다. 전투 화면이 쓰는 DOM 자리(`#gameinfo`·`#board`·`#cmd` …)도
 * 이 프레임 안에서 만들어진다 — 전투 UI는 id로 그 자리를 찾는다.
 */

import { useEffect, useRef, useState } from 'react';
import { RECONNECT_GRACE_MS } from '@samchess/rules';
import type { BattleMode, OfficerId } from '@samchess/rules';
import type {
  AiBattleState, BattleOutcome, BattleResult, BattleRewards, GuideChapter, GuideContext, GuideScreen, MatchOpponent, PlayerProfile, RosterPick, Squad, TutorialId, WarView, DefenseReplayData, DefenseUnseen,
} from '@samchess/meta';
import {
  PRESENCE_PING_MS, aiOpponentOf, spendGrain, applyAckResearch, fightingAi, hasEmperor, researchRemainingMs,
  addSquad, raidDeadline, buildingLevel, guardsTakenBy, raidDay, raidLastCall, sortieGate,
  raidAbandonRemainingMs, raidAbandoned, raidRemainingMs, removeSquad, setGarrison, squadById, syncCity, updateSquad, pendingGuide,
} from '@samchess/meta';
import { ScreenGuide } from './useGuide.tsx';
import { HeadToolsLayer } from './HeadTools.tsx';
import { officerById } from '@samchess/data';
import { playBgm, trackForRaid, trackForResult, trackForScreen } from '../audio/bgm.ts';
import { playSfx } from '../audio/sfx.ts';
import { installButtonSfx } from '../audio/buttonSfx.ts';
import { loadDubLang, loadLang, t } from '../i18n/index.ts';
import { clearCache, deleteProfileOnServer, isOffline, loadProfile, pendingSave, saveProfile } from '../meta/storage.ts';
import { currentSession, getAccessToken, signOut } from '../meta/auth.ts';
import { banTerm, clearBan, onBan } from '../meta/ban.ts';
import type { BanNotice } from '../meta/ban.ts';
import { clearOnlineResume, readOnlineResume, saveOnlineResume, touchOnlineResume } from '../meta/onlineResume.ts';
import type { OnlineResume } from '../meta/onlineResume.ts';
import { OnlineTransport, reconnectBattle } from '../battle/online.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { currentBand, mainBackdrop, openBackdrop } from './backdrop.ts';
import type { ExtBuildingId, PlaceId, TimeBand } from './backdrop.ts';
import { EnterSky } from './EnterSky.tsx';
import { TitleScreen } from './TitleScreen.tsx';
import { BoardScreen } from './BoardScreen.tsx';
import { CollectionScreen } from './CollectionScreen.tsx';
import { EnterLoading, type EnterPhase } from './EnterLoading.tsx';
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
import { SortieScreen } from './SortieScreen.tsx';
import { MatchScreen } from './MatchScreen.tsx';
import { SiegeScreen } from './SiegeScreen.tsx';
import { SquadListScreen } from './SquadListScreen.tsx';
import { SquadNameScreen } from './SquadNameScreen.tsx';
import { SquadMembersScreen, emptySquad } from './SquadMembersScreen.tsx';
import { SquadViewScreen } from './SquadViewScreen.tsx';
import { BattleScreen } from './BattleScreen.tsx';
import type { BattleTransport } from '../battle/transport.ts';
import { ResultScreen } from './ResultScreen.tsx';
import { RaidBattleScreen, RaidResultScreen } from './RaidBattleScreen.tsx';
import { TutorialBattleScreen } from './TutorialBattleScreen.tsx';
import { TutorialListScreen } from './TutorialListScreen.tsx';
import { RaidAlert } from './RaidAlert.tsx';
import { AcademyNotice } from './AcademyNotice.tsx';
import { ackResearchOnServer } from '../meta/city.ts';
import { pingPresence } from '../meta/presence.ts';
import { WarInbox } from './WarPanel.tsx';
import { DefenseScreen } from './DefenseScreen.tsx';
import { DefenseReplayScreen } from './DefenseReplayScreen.tsx';
import { fetchDefenseUnseen } from '../meta/defense.ts';
import type { WarBattle } from './WarPanel.tsx';
import type { RaidAlertKind } from './RaidAlert.tsx';
import { RaidRequestFailed, startRaidOnServer, surrenderRaidOnServer } from '../meta/raid.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import { useFrameFit } from './useFrameFit.ts';

/**
 * 지금 화면이 「지난 설명」의 어느 1단인가 (2026-10-23 기획자 — 건물 안에서 열면 그 건물 안내가 펼쳐져 있다).
 * 분류(`GUIDE_PLACE`)와 같은 묶음이다 — 병영은 튜토리얼 · 부대 · 출정까지, 궁궐은 장수 일람 · 도시 관리까지, 대자보는 랭킹 · 컬렉션까지.
 */
function guideChapterOf(screen: Screen): GuideChapter | null {
  switch (screen.name) {
    case 'main': return 'main';
    case 'place': return screen.place === 'palace' ? 'palace' : screen.place === 'barracks' ? 'barracks' : null;
    case 'officers': case 'city': case 'buildings': return 'palace';
    case 'tutorials': case 'squads': case 'squadNew': case 'squadView': case 'squadEdit': case 'sortie': case 'siege': return 'barracks';
    case 'market': return 'market';
    case 'board': case 'collection': case 'defense': case 'ranking': case 'rankingCity': case 'rankingSquad': case 'rankingOfficer': return 'board';
    case 'building': return screen.building;
    default: return null;
  }
}

/**
 * 지금 화면이 안내 내관의 어느 화면인가 — 메인은 `MainScreen`이 따로 세우므로 여기서는 `null`.
 * 결과 화면은 **성립하지 않은 판**(`voided`)이면 안 세운다 — 보상 이야기를 할 판이 아니다.
 */
function guideScreenOf(screen: Screen): { screen: GuideScreen; ctx?: GuideContext; key: string } | null {
  switch (screen.name) {
    case 'place': return screen.place === 'barracks' || screen.place === 'palace' ? { screen: screen.place, key: screen.place } : null;
    case 'market': return { screen: 'market', key: 'market' };
    case 'board': return { screen: 'board', key: 'board' };
    // 산 너머 건물 — 지은 것에 처음 들어갈 때만(강제 입장 없음, 2026-10-23 기획자)
    case 'building': return { screen: 'building', ctx: { building: screen.building }, key: `building-${screen.building}` };
    case 'tutorials': return { screen: 'tutorial', key: 'tutorial' };
    case 'squads': return { screen: 'squads', key: 'squads' };
    case 'sortie': return { screen: 'sortie', key: 'sortie' };
    case 'result': return screen.voided === null ? { screen: 'result', key: 'result' } : null;
    case 'officers': return { screen: 'officers', key: 'officers' };
    default: return null;
  }
}

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
  /** 대자보 — 메인의 게시판 자리. 랭킹 · 컬렉션으로 갈린다(2026-10-13) */
  | { name: 'board' }
  /** 컬렉션 — 대자보의 [컬렉션 보기] (2026-10-13) */
  | { name: 'collection' }
  /** 방어 기록 — 대자보의 [방어 기록 보기] (GDD §8.8 단계 5) */
  | { name: 'defense' }
  /** 방어 기록 리플레이 — 전투 무대를 쓰는 관전. 정산 없이 목록으로 돌아간다 */
  | { name: 'defenseReplay'; data: DefenseReplayData }
  | { name: 'ranking'; from: 'city' | 'main' }
  | { name: 'rankingCity'; from: 'city' | 'main' }
  | { name: 'rankingSquad'; from: 'city' | 'main' }
  | { name: 'rankingOfficer'; from: 'city' | 'main' }
  | { name: 'market' }
  /** `officer`가 있으면 그 장수의 카드를 연 채로 들어온다 — 장터 초심의 서의 [궁궐로 이동] (2026-09-25) */
  | { name: 'officers'; officer?: OfficerId }
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
  /** 공성전 — 칠 도시 고르기 (GDD §8.8 단계 2). [자동 매칭]이 아래 매칭으로 간다 */
  | { name: 'siege'; mode: BattleMode; squad: Squad }
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
    /** 서버가 굳혀 둔 AI 대전 — 끊겨도 이것으로 같은 판에 돌아온다(2026-10-15). 온라인 · 로컬 AI면 없다 */
    ai?: AiBattleState | null;
  }
  | {
    name: 'result'; mode: BattleMode; result: BattleResult; outcome: string; outcomeKind?: string | undefined;
    /** 이미 반영된 보상. 성립하지 않은 판은 `null`이다 */
    rewards: BattleRewards | null;
    /** 판의 기록(출전 · 격파 · 퇴각) — 보여 주기만 한다. 성립하지 않은 판은 `null` */
    record: BattleOutcome | null;
    power: { mine: number; theirs: number };
    seed: number;
    /** **성립하지 않은 판** — 환불만 있고 전적도 보상도 없다 (GDD §3.9 · H2) */
    voided: { reason: 'left' | 'idle'; refunded: boolean } | null;
  }
  /** 튜토리얼 목록 · 판 (G3, 2026-10-22) — 병영의 [튜토리얼]. 계정을 안 건드리고 끝나면 완료만 서버에 적는다 */
  | { name: 'tutorials' }
  | { name: 'tutorialBattle'; id: TutorialId }
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
/** 선전포고를 받지 않는 화면 — 판 · 튜토리얼 · 대기열 검색(핑의 `busy`, GDD §8.8 단계 4) */
const BUSY_SCREENS: readonly Screen['name'][] = ['battle', 'raidBattle', 'tutorialBattle', 'match'];

const NO_ALERT: readonly Screen['name'][] = ['title', 'newgame', 'battle', 'raidBattle', 'tutorialBattle', 'match', 'defenseReplay'];
/** 머리 줄의 우편함 · 사용 안내를 안 세우는 화면 — 알림을 안 띄우는 곳에 결과 둘을 더한다(보상 연출을 가리지 않게) */
const TOOLS_OFF: readonly Screen['name'][] = [...NO_ALERT, 'result', 'raidResult'];

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

/** 흰 전환의 두 걸음(ms) — `style.css`의 `#frame[data-flash]` 애니메이션과 같은 값 */
const WHITE_OUT_MS = 650;
const WHITE_IN_MS = 800;

export function App(): React.JSX.Element {
  const [profile, setProfileState] = useState<PlayerProfile | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  /** 세션·프로필을 아직 확인하는 중 — 로그인이 되어 있는데도 간판이 잠깐 보이지 않게 한다 */
  const [booting, setBooting] = useState(true);
  /** 저장된 세션으로 들어오는 중의 걸음 — 이때도 서버 왕복이 둘이라 입성 로딩 화면을 띄운다 */
  const [bootPhase, setBootPhase] = useState<EnterPhase>('auth');
  /**
   * 입장 하늘(`EnterSky`) — 간판 [입장]의 인증이 끝나면 선다(저장된 세션으로 곧장 들어올 때는 안 선다).
   * `to`는 내려앉을 배경 — 계정을 읽기 전엔 `null`(하늘에서 기다린다), 끊긴 판으로 돌아가면 `'none'`.
   */
  const [sky, setSky] = useState<{ band: TimeBand; to: string | null | 'none' | 'cut' } | null>(null);
  /**
   * 흰 전환 (2026-10-19 기획자 지정) — 지금 화면이 살짝 확대되며 흐려지고, 화면 전체가 흰빛으로 부드럽게 번쩍한 뒤 다음 화면이 떠오른다.
   * 도시 이름 짓기 화면에 들고 날 때 쓴다(그 화면은 노을 한 장뿐이라 하늘 전환을 타면 시간이 지나 보인다).
   * 화면을 바꾸는 것(`swap`)은 흰빛이 가장 짙을 때다. 길이는 `style.css`의 `#frame[data-flash]`와 같은 값이다.
   */
  const [flash, setFlash] = useState<'out' | 'in' | null>(null);
  const whiteCut = (swap: () => void): Promise<void> => new Promise((resolve) => {
    setFlash('out');
    window.setTimeout(() => {
      swap();
      setFlash('in');
      window.setTimeout(() => { setFlash(null); resolve(); }, WHITE_IN_MS);
    }, WHITE_OUT_MS);
  });
  /** 하늘에 닿았을 때 풀리는 약속 — 화면은 그 뒤에 바꾼다(반투명할 때 바꾸면 밑에서 바뀌는 게 비친다) */
  const skyCovered = useRef<(() => void) | null>(null);
  /** 가입 오프닝에서 막 넘어왔다 — 흰 섬광 속에서 크게 뜬 메인이 줄어들며 자리 잡는다(`style.css`의 `#frame[data-arrive]`) */
  const [arrive, setArrive] = useState(false);
  useEffect(() => {
    if (!arrive) return;
    const id = setTimeout(() => setArrive(false), 1000);
    return () => clearTimeout(id);
  }, [arrive]);
  const frameRef = useRef<HTMLDivElement>(null);

  /** 프로필이 바뀌면 곧바로 저장한다 — 나가기 버튼 같은 걸 두지 않기 위함이다.
   *  **실패해도 화면은 안 멈춘다**(`saveProfile`이 던지지 않는다, §5-61) */
  const setProfile = (next: PlayerProfile): void => {
    setProfileState(next);
    void saveProfile(next);
  };

  /**
   * 끊긴 온라인 대전 (2026-10-15) — 서버는 끊긴 쪽을 60초 기다린다. **열쇠는 방에 붙는 순간 기기에 적고**
   * (`onlineResume.ts`), 들어올 때(저장된 세션 · 로그인)나 판 도중 소켓이 끊겼을 때 그 열쇠로 같은 자리에 다시 앉는다.
   * 못 붙으면(유예가 지났다 · 판이 끝나 방이 접혔다) 표를 지우고 「재입장 시간초과」를 알린다 — 그 판은 서버가 이미
   * 정산했으므로 계정을 다시 읽는다.
   */
  const [rejoin, setRejoin] = useState<'busy' | 'failed' | null>(null);

  const enterOnline = (base: Omit<OnlineResume, 'uid' | 'token' | 'side' | 'aliveAt'>, transport: OnlineTransport): void => {
    const uid = currentSession()?.uid;
    if (uid) {
      saveOnlineResume({ ...base, uid, token: transport.reconnectionToken, side: transport.humanSide, aliveAt: Date.now() });
    }
    transport.onDrop(() => rejoinOnline());
    setScreen({ name: 'battle', ...base, online: transport });
  };

  function rejoinOnline(): void {
    const ticket = readOnlineResume();
    if (!ticket) return;
    if (ticket.uid !== currentSession()?.uid) return;
    if (Date.now() - ticket.aliveAt > RECONNECT_GRACE_MS) {
      clearOnlineResume();
      setRejoin('failed');
      return;
    }
    setRejoin('busy');
    setScreen({ name: 'main' });
    reconnectBattle(ticket.token, ticket.side).then((transport) => {
      setRejoin(null);
      const { mode, picks, seed, squad, opponent } = ticket;
      enterOnline({ mode, picks, seed, squad, opponent }, transport);
    }, (e: unknown) => {
      console.warn('[online] 끊긴 대전에 다시 붙지 못했다', e);
      clearOnlineResume();
      setRejoin('failed');
      void loadProfile().then((p) => { if (p) setProfileState(p); });
    });
  }

  /**
   * 끊긴 AI 대전 (2026-10-15, 기획자 확정 — 들어오면 **곧바로 그 판으로**). 판은 서버가 굳혀 두었으므로(`aiBattle`)
   * 기기에 적은 것이 없어도 된다 — 계정을 읽은 직후 진행 중인 판이 있으면 덧붙여 둔 수까지 재생해 그 자리로 간다.
   * 60분이 지나 서버가 패배로 정산한 판은 한 번 알린다(같은 판을 두 번 알리지 않게 시드를 기기에 적는다).
   */
  const [aiAbandoned, setAiAbandoned] = useState<number | null>(null);

  /**
   * 정지된 계정 (2026-10-20) — 계정 API · 로그인 · 대기열 어디서 막혔든 이 팝업 하나다(`meta/ban.ts`).
   * [확인]은 로그아웃이다 — 정지된 세션으로 머물러 봐야 모든 요청이 거절된다. 끝난 판의 하늘 층도 걷는다.
   */
  const [ban, setBan] = useState<BanNotice | null>(null);
  useEffect(() => onBan((n) => { setSky(null); setBan(n); }), []);
  const ackBan = (): void => {
    signOut(); clearCache(); clearBan();
    setBan(null); setProfileState(null); setScreen({ name: 'title' });
  };
  const AI_SEEN_KEY = 'samchess.ai.abandonSeen';
  function resumeAiBattle(p: PlayerProfile): boolean {
    const ai = fightingAi(p);
    if (ai) {
      const squad = (ai.squadId ? p.squads.find((s) => s.id === ai.squadId) : null) ?? null;
      setScreen({
        name: 'battle', mode: ai.mode, picks: ai.picks, seed: ai.seed, squad, opponent: aiOpponentOf(ai), online: null, ai,
      });
      return true;
    }
    if (p.aiBattle?.status === 'abandoned') {
      let seen: string | null = null;
      try { seen = localStorage.getItem(AI_SEEN_KEY); } catch { /* 못 읽으면 알린다 */ }
      if (seen !== String(p.aiBattle.seed)) setAiAbandoned(p.aiBattle.seed);
    }
    return false;
  }
  const ackAiAbandoned = (): void => {
    try { if (aiAbandoned !== null) localStorage.setItem(AI_SEEN_KEY, String(aiAbandoned)); } catch { /* 다음에 한 번 더 뜰 뿐이다 */ }
    setAiAbandoned(null);
  };

  // 판이 살아 있는 동안 표의 「마지막으로 살아 있던 때」를 민다 — 다시 들어왔을 때 유예 안인지 이것으로 잰다
  useEffect(() => {
    if (screen.name !== 'battle' || !screen.online) return undefined;
    touchOnlineResume(Date.now());
    const id = setInterval(() => touchOnlineResume(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [screen]);

  /** 로그인(또는 저장된 세션 확인) 직후 — 서버 프로필의 있고 없음으로 다음 화면을 정한다 */
  const afterSignIn = (): Promise<void> => {
    // 인증이 끝난 지금 하늘로 올라가기 시작한다 — 계정을 읽는 왕복은 하늘에 머무는 동안 끝난다(`EnterSky` 머리말).
    // 기존 계정은 메인에 내려앉고, 새 계정은 하늘에서 흰 전환으로 도시 이름 짓기에 간다
    const band = currentBand();
    const covered = new Promise<void>((resolve) => { skyCovered.current = resolve; });
    setSky({ band, to: null });
    return loadProfile().then((p) => {
      setProfileState(p);
      if (p) {
        // 끊긴 판으로 곧장 돌아가면 메인에 내려앉지 않는다 — 하늘에서 흐려지며 전투를 비춘다
        const resuming = fightingAi(p) !== null || readOnlineResume()?.uid === currentSession()?.uid;
        setSky((s) => s && { ...s, to: resuming ? 'none' : mainBackdrop(band, hasEmperor(p)) });
        return covered.then(() => {
          setScreen({ name: 'main' });
          if (!resumeAiBattle(p)) rejoinOnline();
        });
      }
      // 새 계정 — 하늘에 닿은 뒤(계정 읽기가 더 빨랐어도) 하늘 장면에서 흰 전환으로 도시 이름 짓기에. 하늘 층은 바꾸는 순간 걷는다.
      // 도시 짓기 곡은 흰 전환이 **시작될 때** 바꾼다(화면이 바뀌는 순간까지 기다리면 0.65초 늦는다, 2026-10-20 기획자 지정)
      setSky((s) => s && { ...s, to: 'cut' });
      return covered.then(() => {
        playBgm(trackForScreen('newgame'), { fromStart: true });
        return whiteCut(() => { setSky(null); setScreen({ name: 'newgame' }); });
      });
    }, (e: unknown) => { setSky(null); throw e; });
  };

  /** 저장된 세션이 있으면 간판을 건너뛴다 — 없으면(또는 만료돼 갱신도 실패하면) 간판에 머문다 */
  useEffect(() => {
    void getAccessToken().then((token) => {
      if (!token) { setBooting(false); return; }
      setBootPhase('city');
      void loadProfile().then((p) => {
        setProfileState(p);
        if (p) { setScreen({ name: 'main' }); if (!resumeAiBattle(p)) rejoinOnline(); } else setScreen({ name: 'newgame' });
        setBooting(false);
      }, () => setBooting(false)); // 정지된 계정 — 간판에 머물고 정지 안내가 뜬다(`ban`)
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
    // 방어전 결과는 판정이 계정(`raid.status`)에 있다 — 화면으로 넘어올 때 이미 서버가 정산한 계정으로 바꿔 둔다
    const track = screen.name === 'result'
      ? trackForResult(screen.result, screen.voided !== null)
      : screen.name === 'raidResult'
        ? trackForRaid(profile?.raid?.status)
        : trackForScreen(screen.name);
    // 도시 이름 짓기는 들어올 때마다 곡 머리부터 — 새 계정의 입장은 위(흰 전환 직전)에서 이미 되감아 틀었다
    if (track) playBgm(track, { fromStart: screen.name === 'newgame' });
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

  /**
   * 접속 상태 핑 (GDD §8.8 단계 3, `meta/presence.ts`) — **계정이 있고 화면이 보이는 동안만** `PRESENCE_PING_MS`마다.
   * 다른 탭으로 가거나 앱을 내리면 멈추고(그 도시는 2분 뒤 「미접속」이 된다), 다시 보이는 순간 한 번 바로 보낸다 —
   * 돌아온 사람이 다음 간격까지 「미접속」으로 남아 공성전을 받는 틈을 줄인다. 시계를 읽는 자리라 여기 둔다.
   *
   * **단계 4** — 핑은 「전투 · 튜토리얼 화면이다」(`busy`)를 함께 싣고(그때는 선전포고를 받지 않는다 · 목록의 주황 점),
   * 응답에 실려 온 **받은 선전포고**를 팝업으로 띄운다(`WarInbox`, 어느 화면에서든). 화면이 바뀌어 `busy`가 달라지면 한 번 바로 보낸다.
   */
  const busyNow = BUSY_SCREENS.includes(screen.name);
  const busyRef = useRef(busyNow);
  busyRef.current = busyNow;
  const [incomingWar, setIncomingWar] = useState<WarView | null>(null);
  const pingNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!profile) return;
    const ping = (): void => {
      if (document.visibilityState !== 'visible') return;
      void pingPresence(busyRef.current).then((w) => {
        if (w && w.role === 'defender' && w.status === 'delivered') setIncomingWar((cur) => cur ?? w);
      });
    };
    pingNow.current = ping;
    ping();
    const id = setInterval(ping, PRESENCE_PING_MS);
    document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', ping); pingNow.current = () => {}; };
  }, [Boolean(profile)]);
  useEffect(() => { pingNow.current(); }, [busyNow]);

  /**
   * 방어 기록 (GDD §8.8 단계 5) — **안 본 판**이 있으면 들어올 때 팝업을 한 번(이 세션에서 다시 안 띄운다) · 메인 대자보 자리와
   * 대자보 단추에 표지. 표지는 메인 · 대자보로 돌아올 때마다 다시 묻고, 목록을 열면 지운다(그 화면이 「다 봤다」를 적는다).
   */
  const [defenseUnseen, setDefenseUnseen] = useState<DefenseUnseen | null>(null);
  const [defensePopup, setDefensePopup] = useState<DefenseUnseen | null>(null);
  const defensePopped = useRef(false);
  useEffect(() => {
    if (!profile || (screen.name !== 'main' && screen.name !== 'board')) return;
    let live = true;
    void fetchDefenseUnseen().then((u) => {
      if (!live || !u) return;
      setDefenseUnseen(u);
      if (u.attacks > 0 && !defensePopped.current) { defensePopped.current = true; setDefensePopup(u); }
    });
    return () => { live = false; };
  }, [Boolean(profile), screen.name]);

  /** 선전포고가 수락돼 대전 방에 붙었다 — 양쪽 다 이 길로 야전에 든다. 참가비는 방이 열릴 때 서버가 냈다(화면에는 미리 뺀다) */
  const enterWar: WarBattle = (transport, opponent, squad) => {
    setIncomingWar(null);
    if (profile) { try { setProfileState(spendGrain(profile, squad.mode)); } catch { /* 서버 값이 정본이다 — 정산 뒤 다시 읽는다 */ } }
    enterOnline({ mode: squad.mode, picks: squad.picks, seed: 0, squad, opponent }, transport);
  };

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

  // 마감이 지났다 — 서버가 항복으로 정산했을 것이다. 한 번만 다시 읽는다.
  // 끊긴 판(`fighting`)은 시작 + 60분이 마감이다 (2026-10-15 — 전에는 다시 안 읽어 아무 말 없이 지나갔다)
  const deadlineChecked = useRef(0);
  useEffect(() => {
    if (raid?.status === 'fighting' && !NO_ALERT.includes(screen.name)) {
      if (raidAbandonRemainingMs(raid, raidNow) > 0 || deadlineChecked.current === raid.spawnedAt) return;
      deadlineChecked.current = raid.spawnedAt;
      void loadProfile().then((p) => { if (p) setProfileState(p); });
      return;
    }
    if (raid?.status !== 'pending' || raidRemainingMs(profile!, raid, raidNow) > 0) return;
    if (deadlineChecked.current === raid.spawnedAt) return;
    deadlineChecked.current = raid.spawnedAt;
    void loadProfile().then((p) => { if (p) setProfileState(p); });
  }, [raid, raidNow, screen.name]);

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
      if (profile && raidLastCall(profile, raid, raidNow) && raidAck.current.lastCall !== raid.spawnedAt) setRaidAlert('lastCall');
      else if (screen.name === 'main' && raidAck.current.first !== raid.spawnedAt) setRaidAlert('first');
      return;
    }
    // 자동 항복(정산 시각 = 마감, 또는 끊긴 판의 시작 + 60분)만 알린다 — 사람이 누른 항복은 그 자리에서 이미 알렸다
    if (raid.status === 'surrendered' && profile && (raid.settledAt === raidDeadline(profile, raid) || raidAbandoned(raid))
      && readSeen() !== raid.spawnedAt) {
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

  /**
   * [전투 재개] — 끊긴 판 (2026-10-15). **계정을 다시 읽고 들어간다** — 덧붙여 둔 수(`raid.battle.intents`)는
   * 서버의 것이 정본이고, 그새 60분이 지나 항복으로 정산됐을 수도 있다(그러면 알림이 그것을 말한다).
   */
  const resumeRaid = (): void => {
    if (raidInFlight.current) return;
    raidInFlight.current = true;
    setRaidBusy(true);
    setRaidError(null);
    void loadProfile().then((p) => {
      if (!p) return;
      setProfileState(p);
      if (p.raid?.status === 'fighting') { setRaidAlert(null); setScreen({ name: 'raidBattle' }); }
    }).finally(() => { raidInFlight.current = false; setRaidBusy(false); });
  };

  /** [지금 전투] · [전투하기] — 서버가 시드를 내고 나서야 판을 만든다. 싸우는 중이면 재개다 */
  const fightRaid = (): void => {
    if (raid?.status === 'fighting') { resumeRaid(); return; }
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
    const left = profile ? researchRemainingMs(profile, Date.now()) : 0;
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

  const guideAt = guideScreenOf(screen);

  return (
    <div
      id="frame"
      ref={frameRef}
      className={screen.name === 'battle' || screen.name === 'raidBattle' || screen.name === 'tutorialBattle' || screen.name === 'defenseReplay' ? 'battle' : 'meta'}
      data-arrive={arrive ? '' : undefined}
      data-sky={sky ? '' : undefined}
      data-flash={flash ?? undefined}
    >
      {/* 머리 줄의 우편함 · 사용 안내 — 기어 옆에 늘 떠 있다(2026-10-23 기획자). 목록 · 팝업 · 다시 듣기는 여기 한 벌이고,
          단추는 `ScreenChrome`이 문맥으로 받아 세운다(`HeadTools.tsx`). 전투 · 매칭 · 결과에서는 안 선다 */}
      <HeadToolsLayer profile={booting ? null : profile} onChange={setProfile} on={!booting && !!profile && !TOOLS_OFF.includes(screen.name)} refreshKey={screen.name === 'main' ? 'main' : 'away'} chapter={guideChapterOf(screen)}>
      {booting ? <EnterLoading phase={bootPhase} solo /> : screen.name === 'title' ? (
        <TitleScreen onSignedIn={afterSignIn} />
      ) : screen.name === 'newgame' || !profile ? (
        // 계정이 없으면 어느 화면을 향했든 여기부터다 — 도시 이름이 있어야 나머지가 성립한다
        <NewGameScreen
          // 메인의 로그아웃과 같은 정리 — 세션 · 캐시를 걷고 간판으로
          onBack={() => { void whiteCut(() => { signOut(); clearCache(); setProfileState(null); setScreen({ name: 'title' }); }); }}
          onStart={(p) => { setProfile(p); playSfx('enter_city'); setScreen({ name: 'main' }); setArrive(true); }} />
      ) : screen.name === 'main' ? (
        <MainScreen
          profile={profile}
          onChange={setProfile}
          initialView={screen.view}
          // 장터는 자리 화면을 거치지 않고 곧장 장터 홈이다 (2026-09-24, pptx 76쪽 — 홈이 곧 현황판·명령판)
          onGo={(place) => setScreen(place === 'market' ? { name: 'market' } : { name: 'place', place })}
          onBuilding={(building) => setScreen({ name: 'building', building })}
          onRanking={() => setScreen({ name: 'board' })}
          defenseUnseen={defenseUnseen?.attacks ?? 0}
          raid={raidLive && raid ? {
            status: raid.status === 'fighting' ? 'fighting' : 'pending',
            remainingMs: raid.status === 'fighting' ? raidAbandonRemainingMs(raid, raidNow) : raidRemainingMs(profile, raid, raidNow),
            busy: raidBusy,
            onFight: fightRaid,
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
          sortieBlocked={sortieGate(profile)}
          onSortie={() => setScreen({ name: 'sortie' })}
          onSquads={() => setScreen({ name: 'squads' })}
          onTutorial={() => setScreen({ name: 'tutorials' })}
          onOfficers={() => setScreen({ name: 'officers' })}
          onCity={() => setScreen({ name: 'city' })}
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
          onBack={() => setScreen({ name: 'main' })}
          onChange={setProfile}
          onAcademy={() => setScreen({ name: 'building', building: 'academy' })}
          // 전면 레벨업 화면(`levelup`)이 아니라 장수 일람 + 그 장수의 카드로 (2026-09-25 지정)
          onLevelUp={(officer) => setScreen({ name: 'officers', officer })}
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
      ) : screen.name === 'board' ? (
        <BoardScreen
          profile={profile}
          onBack={() => setScreen({ name: 'main' })}
          onRanking={() => setScreen({ name: 'ranking', from: 'main' })}
          onCollection={() => setScreen({ name: 'collection' })}
          onDefense={() => setScreen({ name: 'defense' })}
          defenseUnseen={defenseUnseen?.attacks ?? 0}
        />
      ) : screen.name === 'defense' ? (
        <DefenseScreen
          profile={profile}
          // 목록을 연 것이 곧 본 것이다 — 돌아가면 표지가 없다
          onBack={() => { setDefenseUnseen({ attacks: 0, held: 0 }); setScreen({ name: 'board' }); }}
          onReplay={(data) => { setDefenseUnseen({ attacks: 0, held: 0 }); setScreen({ name: 'defenseReplay', data }); }}
        />
      ) : screen.name === 'defenseReplay' ? (
        <DefenseReplayScreen key={screen.data.id} data={screen.data} onBack={() => setScreen({ name: 'defense' })} />
      ) : screen.name === 'collection' ? (
        <CollectionScreen
          profile={profile}
          onBack={() => setScreen({ name: 'board' })}
          onChange={setProfile}
        />
      ) : screen.name === 'ranking' ? (
        <RankingScreen
          profile={profile}
          from={screen.from}
          onBack={() => setScreen(screen.from === 'main' ? { name: 'board' } : { name: 'city' })}
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
          {...(screen.officer ? { openOfficer: screen.officer } : {})}
          onBack={() => setScreen({ name: 'place', place: 'palace' })}
          onChange={setProfile}
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
              onGarrison={(id) => setProfile(setGarrison(profile, id))}
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
          onSeek={(mode, squad) => setScreen({ name: 'siege', mode, squad })}
        />
      ) : screen.name === 'siege' ? (
        <SiegeScreen
          profile={profile}
          mode={screen.mode}
          squad={screen.squad}
          onBack={() => setScreen({ name: 'sortie' })}
          onAuto={() => setScreen({ name: 'match', mode: screen.mode, squad: screen.squad, seed: squadSeed(screen.squad) })}
          onReady={(spent, opponent, ai) => {
            // 서버가 시작을 굳힌 판 — 받은 계정이 정본이다(`PUT`으로 되올리지 않는다, 매칭 화면의 AI와 같다)
            setProfileState(spent);
            setScreen({ name: 'battle', mode: screen.mode, picks: screen.squad.picks, seed: ai.seed, squad: screen.squad, opponent, online: null, ai });
          }}
          onWar={enterWar}
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
          onReady={(spent, opponent, online, ai) => {
            // 서버가 시작을 굳힌 판이면 받은 계정이 정본이다 — `PUT`으로 되올리지 않는다
            if (ai) setProfileState(spent); else setProfile(spent);
            const base = { mode: screen.mode, picks: screen.squad.picks, seed: ai?.seed ?? screen.seed, squad: screen.squad, opponent };
            // 온라인이면 다시 붙을 표를 적고 끊김을 듣는다(`enterOnline`)
            if (online instanceof OnlineTransport) { enterOnline(base, online); return; }
            setScreen({ name: 'battle', ...base, online, ai });
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
          ai={screen.ai ?? null}
          onDone={(result) => { clearOnlineResume(); setProfile(result.profile); setScreen({ name: 'result', ...result.screen }); }}
        />
      ) : screen.name === 'tutorials' ? (
        <TutorialListScreen
          profile={profile}
          onBack={() => setScreen({ name: 'place', place: 'barracks' })}
          onPlay={(id) => setScreen({ name: 'tutorialBattle', id })}
        />
      ) : screen.name === 'tutorialBattle' ? (
        <TutorialBattleScreen
          // 같은 판을 다시 열면 새로 띄운다 — 기본 1 → 2로 바로 넘어가지 않고 목록으로 돌아온다
          key={screen.id}
          id={screen.id}
          // 서버가 완료를 적은 계정이다 — `PUT`으로 되올릴 까닭이 없다
          onDone={(next) => { setProfileState(next); setScreen({ name: 'tutorials' }); }}
          onExit={() => setScreen({ name: 'tutorials' })}
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
          onFarm={() => setScreen({ name: 'building', building: 'farm' })}
        />
      ) : (
        <ResultScreen
          profile={profile}
          mode={screen.mode}
          result={screen.result}
          outcome={screen.outcome}
          outcomeKind={screen.outcomeKind}
          rewards={screen.rewards}
          record={screen.record}
          voided={screen.voided}
          onHome={() => setScreen({ name: 'main' })}
        />
      )}
      </HeadToolsLayer>

      {/* 안내 내관 — 메인 밖의 화면들(1차 묶음, 2026-10-22). 메인은 `MainScreen`이 직접 세운다(성 안 · 산 너머 · 다시 듣기) */}
      {profile && !booting && guideAt && (
        <ScreenGuide
          profile={profile}
          onChange={setProfile}
          pending={pendingGuide(profile, guideAt.screen, guideAt.ctx)}
          screenKey={guideAt.key}
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

      {/* 끊긴 AI 대전이 60분을 넘겨 패배로 정산됐다 (2026-10-15) — 제목 · 단추 · 판(`.rejoin-box`)은 온라인의 「재입장 시간초과」와 같다 */}
      {aiAbandoned !== null && (
        <div className="modal-back" data-modal="aiAbandoned">
          <div className="modal frg-confirm rejoin-box">
            <p className="modal-ttl">{t('online.rejoinFailed.title')}</p>
            <p className="frg-confirm-body">{t('online.aiAbandoned.body')}</p>
            <div className="frg-confirm-acts">
              <button className="btn primary wide" data-action="aiAbandonedOk" onClick={ackAiAbandoned}>
                {t('online.rejoinFailed.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 끊긴 온라인 대전 — 다시 붙는 중 · 못 붙었다 (2026-10-15) */}
      {rejoin === 'busy' && <BusyVeil label={t('online.rejoining')} />}
      {/* 자리를 비운 사이 공격받았다 (GDD §8.8 단계 5) — 들어올 때 한 번 */}
      {defensePopup && !raidAlert && !NO_ALERT.includes(screen.name) && (
        <div className="modal-back" data-modal="defenseUnseen">
          <div className="modal frg-confirm rejoin-box">
            <p className="modal-ttl">{t('defense.pop.title')}</p>
            <p className="frg-confirm-body" data-field="defenseUnseen" data-attacks={defensePopup.attacks} data-held={defensePopup.held}>
              {t('defense.pop.body', { n: defensePopup.attacks, m: defensePopup.held })}
            </p>
            <div className="frg-confirm-acts">
              <button className="btn primary wide" data-action="defenseOpen" onClick={() => { setDefensePopup(null); setScreen({ name: 'defense' }); }}>
                {t('defense.pop.open')}
              </button>
              <button className="btn wide" data-action="defenseClose" onClick={() => setDefensePopup(null)}>{t('defense.pop.close')}</button>
            </div>
          </div>
        </div>
      )}
      {profile && incomingWar && (
        <WarInbox key={incomingWar.id} initial={incomingWar} profile={profile} onBattle={enterWar} onClose={() => setIncomingWar(null)} />
      )}
      {rejoin === 'failed' && (
        <div className="modal-back" data-modal="rejoinFailed">
          <div className="modal frg-confirm rejoin-box">
            <p className="modal-ttl">{t('online.rejoinFailed.title')}</p>
            <p className="frg-confirm-body">{t('online.rejoinFailed.body')}</p>
            <div className="frg-confirm-acts">
              <button className="btn primary wide" data-action="rejoinOk" onClick={() => setRejoin(null)}>
                {t('online.rejoinFailed.ok')}
              </button>
            </div>
          </div>
        </div>
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
      {sky && (
        <EnterSky
          band={sky.band}
          from={openBackdrop(sky.band)}
          to={sky.to}
          onCovered={() => skyCovered.current?.()}
          // 성 안으로 들어설 때만 — 도시 이름 짓기는 제 곡(`createCity`)이 맡는다
          onLand={() => { if (sky.to !== 'backgrounds/new-city.jpg') playSfx('enter_city'); }}
          onDone={() => setSky(null)}
        />
      )}
      {/* 정지된 계정 — 맨 위에 선다(하늘 층 · 다른 알림 위) */}
      {ban && (
        <div className="modal-back" data-modal="accountBanned">
          <div className="modal frg-confirm">
            <p className="modal-ttl">{t('ban.title')}</p>
            <p className="frg-confirm-body" data-field="banTerm">{banTermText(ban)}</p>
            {ban.reason && <p className="frg-confirm-body" data-field="banReason">{t('ban.reason', { reason: ban.reason })}</p>}
            <div className="frg-confirm-acts">
              <button className="btn primary wide" data-action="banOk" onClick={ackBan}>{t('ban.ok')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 정지 안내의 기간 줄 — 풀리는 시각 · 영구 · 모름(로그인 · 대기열에서 막혀 기간을 못 받은 경우) */
function banTermText(n: BanNotice): string {
  const term = banTerm(n, Date.now());
  if (term.kind === 'forever') return t('ban.forever');
  if (term.kind === 'until') return t('ban.until', { at: term.at });
  return t('ban.unknown');
}
