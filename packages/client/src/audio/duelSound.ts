/**
 * 일기토 · 설전의 소리 (GDD §3.11, 2026-11-05) — 신청 소리 · 기합.
 *
 * - **신청 소리**(`effects/duel_challenge.mp3`, 12.5초)는 응답 10초보다 길다 — 기다리는 동안 깔고 **답이 오면 끊는다**(기획자 동의).
 *   그래서 한 번 틀고 마는 `playSfx`가 아니라 여기서 쥐고 있는다.
 * - **기합**(`duelvoice/{m,f}-{소리}.mp3`, `npm run audio`) — 일기토에서 우리가 이긴 합은 기합 둘 중 하나, 진 합은 으악,
 *   설전에서 공격권을 쥐고 맞혔을 때는 하하 둘 중 하나(기획자). 목소리는 **우리 장수의 성별**로 고른다.
 *   여성 장수는 축융 · 이명 둘뿐이다(기획자 확인 2026-11-05) — 데이터에 성별 칸이 없어 여기 표 하나로 둔다.
 */

import { volumeScale } from './volume.ts';

/** 여성 장수 — 기획자 확인(2026-11-05). 늘면 여기 한 줄 */
export const FEMALE_OFFICERS: ReadonlySet<string> = new Set(['chuk-yung', 'i-myeong']);

export type DuelVoiceCue = 'shout' | 'ouch' | 'laugh';

const VOLUME = 0.9;
let challenge: HTMLAudioElement | null = null;

/** 신청 소리를 깐다 — 답이 오면 `stopChallengeSound()` */
export function playChallengeSound(): void {
  stopChallengeSound();
  const scale = volumeScale('fx');
  if (scale === 0) return;
  const el = new Audio('effects/duel_challenge.mp3');
  el.volume = Math.min(1, VOLUME * scale);
  challenge = el;
  void el.play().catch(() => { /* 자동재생이 막혔거나 파일이 없다 */ });
}

export function stopChallengeSound(): void {
  if (!challenge) return;
  challenge.pause();
  challenge = null;
}

/**
 * 기합 하나 — `pick`은 「둘 중 하나」를 고르는 값(합 번호 같은 것 — 화면은 난수를 안 쓴다). 으악은 하나뿐이다.
 */
export function playDuelVoice(officer: string, cue: DuelVoiceCue, pick: number): void {
  const scale = volumeScale('fx');
  if (scale === 0) return;
  const who = FEMALE_OFFICERS.has(officer) ? 'f' : 'm';
  const name = cue === 'ouch' ? 'ouch' : `${cue}${(pick % 2) + 1}`;
  const el = new Audio(`duelvoice/${who}-${name}.mp3`);
  el.volume = Math.min(1, VOLUME * scale);
  void el.play().catch(() => { /* 파일이 없으면 조용히 */ });
}
