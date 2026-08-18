/**
 * 배경음악 — 화면마다 한 곡 (2026-08-14 기획자 지정).
 *
 * | 곡 | 언제 |
 * |---|---|
 * | `main` | 첫 화면 · 메인 · 장수 관리 — **아래 넷이 아닌 모든 화면** |
 * | `roster` | 3:3/5:5 를 고른 뒤 기물·장수를 고르는 화면 |
 * | `prep` | 전투 화면의 **배치·정찰** 단계 |
 * | `battle` | 전투 |
 * | `result` | 전투 종료 후 보상 화면 |
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

export type BgmTrack = 'main' | 'roster' | 'prep' | 'battle' | 'result' | 'credits';

/**
 * 메타 화면 → 곡. **전투(`battle`)는 `null`이다** — 그 안에서 배치·정찰과 전투가
 * 갈리는데 화면 이름으로는 그 경계를 알 수 없다(`trackForPhase` 참조).
 *
 * **모르는 화면은 「메인」이다.** 기획자 지정이 「아래 넷이 아닌 화면」이라,
 * 앞으로 화면이 늘어도 저절로 메인곡이 나와야 그 말이 지켜진다.
 */
export function trackForScreen(screen: string): BgmTrack | null {
  if (screen === 'battle') return null;
  // 출전 길(구성·부대 고르기·매칭)이 예전 편성 화면의 자리다 — 곡은 그대로 `roster`다
  if (screen === 'sortie' || screen === 'match') return 'roster';
  if (screen === 'result') return 'result';
  return 'main';
}

/** 전투 안의 단계 → 곡. 배치·정찰만 따로 한 곡이다. */
export function trackForPhase(phase: string): BgmTrack {
  return phase === 'deploying' || phase === 'scouting' ? 'prep' : 'battle';
}

/** 곡 사이를 넘어가는 시간(ms). 뚝 끊으면 화면 전환보다 소리가 먼저 튄다. */
const FADE_MS = 700;

/** 기본 음량. 배경이므로 앞에 나서지 않는 세기다. */
const VOLUME = 0.55;

/** 음소거를 기억하는 자리. 새로고침해도 남는다 (`M` 키로 켜고 끈다). */
const MUTE_KEY = 'samchess.bgm.muted';

const players = new Map<BgmTrack, HTMLAudioElement>();
let current: BgmTrack | null = null;
/** 브라우저가 막아서 아직 못 튼 곡. 첫 조작 때 이걸 튼다. */
let blocked: BgmTrack | null = null;
let muted = false;
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
function fade(el: HTMLAudioElement, to: number, done?: () => void): void {
  const old = fades.get(el);
  if (old) clearInterval(old);
  const step = 40;
  const from = el.volume;
  let t = 0;
  const timer = setInterval(() => {
    t += step;
    const k = Math.min(1, t / FADE_MS);
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
 */
export function playBgm(track: BgmTrack | null): void {
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
  el.volume = 0;
  const playing = el.play();
  if (playing) {
    playing.then(
      () => { blocked = null; fade(el, muted ? 0 : VOLUME); },
      // 아직 아무도 화면을 건드리지 않았다 — 첫 조작 때 다시 튼다
      () => { blocked = track; },
    );
  }
}

/** 지금 틀고 있는 곡. 스모크가 읽는다. */
export const currentBgm = (): BgmTrack | null => current;

/** 음소거 상태. 화면에 표시할 일이 생기면 이걸 본다. */
export const bgmMuted = (): boolean => muted;

export function setBgmMuted(next: boolean): void {
  muted = next;
  try { localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* 저장 못해도 소리는 난다 */ }
  for (const [track, el] of players) {
    if (track !== current) continue;
    fade(el, next ? 0 : VOLUME);
  }
}

/**
 * 한 번만 하는 준비 — 음소거 기억을 읽고, **첫 조작**을 기다린다.
 *
 * 자동재생이 막히는 것은 오류가 아니라 규칙이다. 사용자가 화면을 처음 건드리는
 * 순간이 유일한 기회라 그때 물고 있던 곡을 튼다.
 */
function start(): void {
  started = true;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { muted = false; }

  // 확인용 통로. **소리가 실제로 났는지는 볼 수 없으므로**(브라우저가 막을 수도 있다)
  // 「지금 어느 곡을 틀기로 했는가」를 본다 — 화면과 곡이 맞는지는 그것으로 충분하다.
  (window as unknown as Record<string, unknown>).__bgm = {
    get track() { return current; },
    get muted() { return muted; },
    get blocked() { return blocked; },
  };

  const unlock = (): void => {
    if (blocked === null) return;
    const track = blocked;
    blocked = null;
    if (track !== current) return;      // 그새 화면이 바뀌었으면 지금 곡을 따른다
    const el = audioOf(track);
    void el.play().then(() => fade(el, muted ? 0 : VOLUME), () => { /* 그래도 막히면 포기 */ });
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // **`M`으로 끄고 켠다.** 화면에 단추를 두지 않은 것은 기획자가 지정한 자리가 아직
  // 없어서다 — 판을 여러 판 돌려 보는 동안 소리를 끌 길은 있어야 한다.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.metaKey || e.ctrlKey || e.altKey) return;
    setBgmMuted(!muted);
  });
}
