/**
 * 소리 크기 — **두 갈래 · 다섯 칸** (2026-10-23 기획자 지정)
 *
 * ```
 * 배경 음악      bgm   bgm.ts의 곡
 * 효과음         fx    sfx.ts의 효과음 · 고유기술 대사 · 차례 음성 · 안내 내관 목소리
 * ```
 *
 * 칸은 1~5이고 한 칸이 20%다(환경설정의 과녁 다섯 — `screens/VolumeRange.tsx`). **끄는 것은 칸이 아니라 갈래마다의 음소거**다
 * (활을 누른다, 2026-10-23 기획자) — 꺼도 칸은 남아 있어 다시 켜면 그 크기로 돌아온다. 과녁을 쏘면 켜진다.
 * 옛 「배경음악 끔 · 켬」 스위치로 꺼 둔 기기는 **두 갈래 다 음소거**로 옮긴다.
 *
 * 각 재생 자리는 저마다의 기본 세기(배경 0.55 · 효과음 0.8 · 목소리 1)에 `volumeScale(갈래)`를 곱한다 —
 * 기본 세기는 「무엇이 앞에 나서나」의 비율이라 그대로 두고, 사람이 고르는 것은 전체 크기다.
 *
 * React를 모른다 — 화면은 `onVolumeChange`를 `useSyncExternalStore`로 듣는다(`VolumeRange.tsx`).
 */

export type VolumeChannel = 'bgm' | 'fx';
export const VOLUME_CHANNELS: readonly VolumeChannel[] = ['bgm', 'fx'];
export const VOLUME_STEPS = 5;
/** 처음 기기 — 가장 큰 칸. 옛 「켬」과 같은 크기다 */
const DEFAULT_LEVEL = VOLUME_STEPS;

const KEY: Record<VolumeChannel, string> = { bgm: 'samchess.volume.bgm', fx: 'samchess.volume.fx' };
const MUTE_KEY: Record<VolumeChannel, string> = { bgm: 'samchess.volume.bgm.muted', fx: 'samchess.volume.fx.muted' };
/** 옛 끔 · 켬 스위치(`bgm.ts`) — 읽고 지운다 */
const OLD_MUTE_KEY = 'samchess.bgm.muted';

const levels: Record<VolumeChannel, number> = { bgm: DEFAULT_LEVEL, fx: DEFAULT_LEVEL };
const muted: Record<VolumeChannel, boolean> = { bgm: false, fx: false };
const listeners = new Set<() => void>();
let loaded = false;

const clampLevel = (n: number): number => Math.min(VOLUME_STEPS, Math.max(1, Math.round(n)));

function load(): void {
  loaded = true;
  try {
    if (localStorage.getItem(OLD_MUTE_KEY) === '1') {
      for (const ch of VOLUME_CHANNELS) localStorage.setItem(MUTE_KEY[ch], '1');
    }
    localStorage.removeItem(OLD_MUTE_KEY);
    for (const ch of VOLUME_CHANNELS) {
      const v = Number(localStorage.getItem(KEY[ch]));
      if (Number.isFinite(v) && v >= 1) levels[ch] = clampLevel(v);
      muted[ch] = localStorage.getItem(MUTE_KEY[ch]) === '1';
    }
  } catch { /* 저장소를 못 읽어도 기본 크기로 난다 */ }
}

/** 지금 칸(1~5) */
export function volumeLevel(ch: VolumeChannel): number {
  if (!loaded) load();
  return levels[ch];
}

/** 음소거인가 — 활을 눌러 끈 갈래 */
export function volumeMuted(ch: VolumeChannel): boolean {
  if (!loaded) load();
  return muted[ch];
}

/** 곱할 비율(0.2~1, 음소거면 0) */
export const volumeScale = (ch: VolumeChannel): number => (volumeMuted(ch) ? 0 : volumeLevel(ch) / VOLUME_STEPS);

/** 음소거를 켜고 끈다 — 칸은 그대로 둔다 */
export function setVolumeMuted(ch: VolumeChannel, on: boolean): void {
  if (!loaded) load();
  if (muted[ch] === on) return;
  muted[ch] = on;
  try { localStorage.setItem(MUTE_KEY[ch], on ? '1' : '0'); } catch { /* 못 저장해도 이번 판은 바뀐다 */ }
  for (const fn of listeners) fn();
}

/** 칸을 바꾼다 — **음소거도 풀린다**(과녁을 쐈다는 것은 들으려는 것이다). 저장하고 듣는 쪽(배경 음악의 지금 곡 · 화면)에 알린다 */
export function setVolumeLevel(ch: VolumeChannel, level: number): void {
  if (!loaded) load();
  const next = clampLevel(level);
  if (levels[ch] === next && !muted[ch]) return;
  levels[ch] = next;
  muted[ch] = false;
  try {
    localStorage.setItem(KEY[ch], String(next));
    localStorage.setItem(MUTE_KEY[ch], '0');
  } catch { /* 못 저장해도 이번 판은 바뀐다 */ }
  for (const fn of listeners) fn();
}

export function onVolumeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
