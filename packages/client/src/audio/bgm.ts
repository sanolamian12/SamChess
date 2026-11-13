/**
 * 배경음악 — 화면마다 한 곡 (2026-08-14 기획자 지정, 2026-08-25 상점·결과 분기 추가).
 *
 * | 곡 | 언제 |
 * |---|---|
 * | `main` | 첫 화면 · 메인 · 장수 관리 — **아래 화면들이 아닌 모든 화면** |
 * | `roster` | 병영에 들어선 순간부터 · 출전 · 부대 관리 · 튜토리얼 목록 (2026-11-13) |
 * | `prep` | [대전상대 찾기] 뒤(공성전 도시 고르기 · 매칭)부터 전투 화면의 **배치·정찰**까지 (2026-11-13) |
 * | `battle` | 전투 |
 * | `shop` | 장터(상점) 화면 |
 * | `result` | 전투 종료 후 보상 화면 — **승리했을 때** |
 * | `resultDraw` | 전투 종료 후 보상 화면 — **무승부** |
 * | `resultLose` | 전투 종료 후 보상 화면 — **패배** |
 * | `createCity` | 도시 이름 짓기 · 가입 오프닝 — 새 계정이 하늘에서 흰 전환으로 넘어오는 순간부터 (2026-10-20) |
 * | `siege` | 공성전 판 전체(배치 · 정찰 포함) · 방어 기록 리플레이 (2026-11-11) |
 * | `raid` | 도적떼 방어전 판 전체 (2026-11-11) |
 * | `tutorial` | 기본 튜토리얼 1 · 2 · 3 판 (2026-11-11) |
 * | `tutorialS` | S급 튜토리얼 판 (2026-11-11) |
 *
 * 판 전용 곡(`BattleTheme`)은 그 판의 **배치곡 · 전투곡을 함께 대신한다** — 일기토 · 설전만 그 위에 선다.
 *
 * **성립하지 않은 판**(배치 중 이탈 등, `screen.voided`)은 승/무/패가 의미가 없다
 * (GDD §3.9) — `trackForResult`가 그때는 늘 `result`(원래 하나였던 곡)로 물러난다.
 *
 * 원본은 `assets/Audio/bgm/배경곡_*.mp3` 이고 `tools/build_audio.py`(`npm run audio`)가
 * `public/bgm/{id}.mp3` 로 옮긴다. **한글 이름과 id 를 잇는 자리는 그 도구 하나뿐이다.**
 *
 * ────────────────────────────────────────────────────────────────
 * 브라우저는 사용자가 건드리기 전에는 소리를 내주지 않는다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 첫 화면은 아직 아무도 누르지 않은 상태라 `play()`가 **거부된다.** 그래서 거부되면
 * 곡을 물고 있다가 **첫 클릭·첫 키**에 다시 튼다. 이걸 모르면 「첫 화면만 소리가
 * 안 난다」가 되는데, 원인이 코드에 없어서 한참 헤매게 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 이 파일은 화면을 모른다
 * ────────────────────────────────────────────────────────────────
 *
 * 「지금 무슨 곡을 틀 것인가」는 부르는 쪽이 정한다 — 메타 화면은 `screens/App.tsx`가,
 * 전투 안의 배치↔전투 전환은 `BattleScene`이 단계(`playback.phase`)를 보고 부른다.
 * 여기서 화면 이름을 알면 `?demo=1`(전투만 띄우는 길)에서 곡이 갈린다.
 */

import { onVolumeChange, volumeScale } from './volume.ts';

export type BgmTrack =
  | 'main' | 'roster' | 'prep' | 'battle' | 'shop'
  | 'result' | 'resultDraw' | 'resultLose' | 'credits' | 'createCity'
  /** 일기토 · 설전 화면 (2026-11-05) — 합이 열려 있는 동안 */
  | 'duel' | 'debate'
  | BattleTheme;

/**
 * 판 전용 곡 (2026-11-11 기획자 지정) — 판을 띄우는 화면이 `bootBattle({ bgm })`으로 싣는다.
 * 대전(AI · 야전)은 싣지 않아 배치곡 · 전투곡 그대로다.
 */
export type BattleTheme = 'siege' | 'raid' | 'tutorial' | 'tutorialS';

/**
 * 메타 화면 → 곡. **전투(`battle`)는 `null`이다** — 그 안에서 배치·정찰과 전투가
 * 갈리는데 화면 이름으로는 그 경계를 알 수 없다(`trackForPhase` 참조).
 *
 * **결과 화면(`result`)은 여기서 안 정한다** — 승/무/패로 갈리는데 이 함수는
 * 화면 이름만 받는다. `trackForResult`를 대신 부른다.
 *
 * **모르는 화면은 「메인」이다.** 기획자 지정이 「아래가 아닌 화면」이라,
 * 앞으로 화면이 늘어도 저절로 메인곡이 나와야 그 말이 지켜진다.
 */
/** 병영에서 들어가는 화면 — 병영의 곡(`roster`)을 그대로 잇는다 (2026-11-13 기획자) */
const BARRACKS_SCREENS = new Set(['sortie', 'squads', 'squadNew', 'squadView', 'squadEdit', 'garrisonPolicy', 'tutorials']);

export function trackForScreen(screen: string, place?: string): BgmTrack | null {
  if (screen === 'battle' || screen === 'result' || screen === 'raidResult') return null;
  // 병영은 들어서는 순간부터 `roster` — 장터가 들어서자마자 곡이 바뀌는 것과 같다 (2026-11-13 기획자).
  // 출전(구성 · 부대 고르기)도 병영 안이라 그대로 이어진다
  // 병영 안의 화면 — 부대 관리(현황 · 새 편성 · 고치기 · 수비군 방침) · 튜토리얼 목록(기본 · S급 탭)도 같은 곡이다
  if ((screen === 'place' && place === 'barracks') || BARRACKS_SCREENS.has(screen)) return 'roster';
  // [대전상대 찾기]부터는 배치 · 정탐 곡을 앞당겨 튼다 — 판의 배치 단계까지 끊기지 않고 이어진다 (2026-11-13 기획자)
  if (screen === 'siege' || screen === 'match') return 'prep';
  if (screen === 'market') return 'shop';
  if (screen === 'newgame') return 'createCity';
  // 튜토리얼 승리 두루마리 — 대전 승리와 같은 곡 (2026-11-11). 튜토리얼은 이긴 판만 이 화면에 온다
  if (screen === 'tutorialResult') return 'result';
  return 'main';
}

/**
 * 전투 안의 단계 → 곡. 배치·정찰만 따로 한 곡이다.
 * 판 전용 곡(`theme`)이 있으면 배치 · 전투 둘 다 그 곡이다 — 대결 곡만 그 위에 선다.
 */
export function trackForPhase(phase: string, duel?: 'duel' | 'debate', theme?: BattleTheme | null): BgmTrack {
  // 대결 동안은 그 대결의 곡 — 합이 열려 있는 걸음(`dueling`)과 답할 차례(`answering`)
  if (duel && (phase === 'dueling' || phase === 'answering')) return duel;
  if (theme) return theme;
  return phase === 'deploying' || phase === 'scouting' ? 'prep' : 'battle';
}

/**
 * 결과 화면 → 곡. **성립하지 않은 판**(`voided`)은 승/무/패가 실제 승부를 뜻하지
 * 않으므로(GDD §3.9, `BattleScreen.tsx`가 그때 `result: 'draw'`를 임의로 채운다)
 * 그때는 언제나 원래 곡(`result`)으로 물러난다.
 */
export function trackForResult(result: 'win' | 'draw' | 'lose', voided: boolean): BgmTrack {
  if (voided) return 'result';
  if (result === 'draw') return 'resultDraw';
  if (result === 'lose') return 'resultLose';
  return 'result';
}

/**
 * 도적떼 방어전 결과 → 곡 (2026-10-14 기획자 지정) — 대전 결과와 같은 세 곡이다.
 * 항복도 패배 곡이다(대전에서 항복이 곧 패배인 것과 같다).
 */
export function trackForRaid(status: string | undefined): BgmTrack {
  if (status === 'drawn') return 'resultDraw';
  if (status === 'lost' || status === 'surrendered') return 'resultLose';
  return 'result';
}

/** 곡 사이를 넘어가는 시간(ms). 뚝 끊으면 화면 전환보다 소리가 먼저 튄다. */
const FADE_MS = 700;

/** 기본 음량. 배경이므로 앞에 나서지 않는 세기다. */
const VOLUME = 0.55;


const players = new Map<BgmTrack, HTMLAudioElement>();
let current: BgmTrack | null = null;
/** 브라우저가 막아서 아직 못 튼 곡. 첫 조작 때 이걸 튼다. */
let blocked: BgmTrack | null = null;
let started = false;

/** 페이드 중인 타이머. 곡이 연달아 바뀔 때 이전 페이드를 끊는다. */
const fades = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();

function audioOf(track: BgmTrack): HTMLAudioElement {
  let el = players.get(track);
  if (!el) {
    // **필요할 때 만든다.** 여섯 곡이 17MB라 처음에 다 받으면 첫 화면이 그만큼 늦다.
    el = new Audio(`bgm/${track}.mp3`);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    players.set(track, el);
  }
  return el;
}

/** 소리를 `to`까지 서서히 옮긴다. 다 끝나면 `done`. */
function fade(el: HTMLAudioElement, to: number, done?: () => void, ms = FADE_MS): void {
  const old = fades.get(el);
  if (old) clearInterval(old);
  const step = 40;
  const from = el.volume;
  let t = 0;
  const timer = setInterval(() => {
    t += step;
    const k = Math.min(1, t / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) return;
    clearInterval(timer);
    fades.delete(el);
    done?.();
  }, step);
  fades.set(el, timer);
}

/**
 * 이 곡을 튼다. 이미 같은 곡이면 아무 일도 하지 않는다 —
 * **화면이 다시 그려질 때마다 처음부터 되감기면 안 된다.**
 *
 * `null`이면 지금 곡을 끈다.
 *
 * 다른 곡에서 넘어오면 **그 곡이 멈춘 자리부터** 이어서 튼다. `fromStart`면 곡 머리로 되감는다 —
 * 도시 이름 짓기는 들어올 때마다 처음부터다(2026-10-21 기획자 지정). 같은 곡이면 그때도 되감지 않는다.
 */
export function playBgm(track: BgmTrack | null, opts: { fromStart?: boolean } = {}): void {
  if (!started) start();
  if (track === current) return;

  const before = current;
  current = track;
  if (before) {
    const el = audioOf(before);
    fade(el, 0, () => { el.pause(); });
  }
  if (!track) return;

  const el = audioOf(track);
  if (opts.fromStart) el.currentTime = 0;

  // 붙들린 동안 곡이 바뀌면 이름만 기억해 두고, 풀릴 때 그 곡을 튼다
  if (held) return;

  el.volume = 0;
  const playing = el.play();
  if (playing) {
    playing.then(
      () => { blocked = null; fade(el, level()); },
      // 아직 아무도 화면을 건드리지 않았다 — 첫 조작 때 다시 튼다
      () => { blocked = track; },
    );
  }
}

/** 고유기술 연출이 배경음악을 붙들고 있는가 (`holdBgm`) */
let held = false;
/** 붙들 때·풀 때의 페이드. 곡 넘김(700ms)보다 짧아야 시작 효과음과 덜 겹친다 */
const HOLD_FADE_MS = 250;

/**
 * 배경음악을 **잠깐 멈췄다가 다시 튼다** (2026-09-16 기획자 지정). 고유기술 연출이
 * 시작 효과음 → 성우 대사를 차례로 트는 동안 곡이 깔리면 대사가 묻힌다.
 *
 * 곡을 끄는 것(`playBgm(null)`)과 다르다 — **같은 곡을 멈춘 자리에서 이어서** 튼다.
 * 되감으면 8초마다 곡 머리가 반복돼 거슬린다. 붙들린 동안 `playBgm`으로 곡이
 * 바뀌면 이름만 바꿔 두고, 풀릴 때 새 곡을 처음부터 튼다.
 */
export function holdBgm(on: boolean): void {
  if (on === held) return;
  held = on;
  if (!current) return;
  const el = audioOf(current);
  if (on) {
    fade(el, 0, () => { if (held) el.pause(); }, HOLD_FADE_MS);
    return;
  }
  void el.play().then(
    () => { blocked = null; fade(el, level(), undefined, HOLD_FADE_MS); },
    () => { blocked = current; },
  );
}

/** 지금 틀고 있는 곡. 스모크가 읽는다. */
export const currentBgm = (): BgmTrack | null => current;

/**
 * 기본 세기를 끝까지 올린 곡 — 일기토 · 설전 곡은 앞부분이 요점이라 준비 15초 동안만 `VOLUME` 대신 1이다(2026-11-11 기획자).
 * **사용자 설정은 안 건드린다** — 세기는 여전히 × 환경설정의 배경 음악 칸이다(끄면 꺼진 채). 곡에 묶어 두므로 곡이 바뀌면
 * (대결 도중 판을 떠나도) 저절로 풀린다 — 「올린 채 남는」 길이 없다.
 */
let boosted: BgmTrack | null = null;
/** 올린 세기로 · 원래 세기로 옮겨 가는 길이 — 갑자기 튀지 않게 */
const BOOST_FADE_MS = 400;

/** 이 곡의 기본 세기를 끝까지 올린다(`null`이면 푼다). 매 프레임 불러도 된다 — 바뀔 때만 옮긴다 */
export function boostBgm(track: BgmTrack | null): void {
  if (track === boosted) return;
  boosted = track;
  if (!current || held) return;
  const el = audioOf(current);
  if (!el.paused) fade(el, level(), undefined, BOOST_FADE_MS);
}

/** 지금 곡의 기본 세기를 끝까지 올렸는가 — 스모크 · 도구가 읽는다 */
export const bgmBoosted = (): boolean => !!current && boosted === current;

/**
 * 지금 곡의 세기 — 기본 세기 × 환경설정의 배경 음악 칸(`volume.ts`, 2026-10-23 — 옛 끔 · 켬 스위치를 다섯 칸으로 갈았다).
 * 칸이 바뀌면 지금 곡을 그 세기로 옮긴다(붙들려 있으면 풀릴 때 따른다).
 */
const level = (): number => (current && boosted === current ? 1 : VOLUME) * volumeScale('bgm');
onVolumeChange(() => {
  if (!current || held) return;
  const el = audioOf(current);
  if (!el.paused) fade(el, level(), undefined, HOLD_FADE_MS);
});

/**
 * 한 번만 하는 준비 — **첫 조작**을 기다린다.
 *
 * 자동재생이 막히는 것은 오류가 아니라 규칙이다. 사용자가 화면을 처음 건드리는
 * 순간이 유일한 기회라 그때 물고 있던 곡을 튼다.
 */
function start(): void {
  started = true;

  // 확인용 통로. **소리가 실제로 났는지는 볼 수 없으므로**(브라우저가 막을 수도 있다)
  // 「지금 어느 곡을 틀기로 했는가」를 본다 — 화면과 곡이 맞는지는 그것으로 충분하다.
  (window as unknown as Record<string, unknown>).__bgm = {
    get track() { return current; },
    get volume() { return volumeScale('bgm'); },
    get blocked() { return blocked; },
    get boosted() { return bgmBoosted(); },
  };

  const unlock = (): void => {
    if (blocked === null) return;
    const track = blocked;
    blocked = null;
    if (track !== current) return;      // 그새 화면이 바뀌었으면 지금 곡을 따른다
    const el = audioOf(track);
    void el.play().then(() => fade(el, level()), () => { /* 그래도 막히면 포기 */ });
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // **키보드 단축키는 두지 않는다** (2026-08-26 기획자 지정 — 모바일과 동등한
  // 조작만 남긴다, 키보드를 띄워 놓고 휴대폰으로 게임할 사람은 없다). 예전에는
  // `M`으로 끄고 켰지만, 지금은 환경설정 팝업의 배경음악 켬/끔 단추
  // (`SettingsModal.tsx`)가 그 자리를 대신한다 — 터치로도 되는 유일한 통로다.
}
