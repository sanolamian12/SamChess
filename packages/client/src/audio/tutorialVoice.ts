/**
 * S급 튜토리얼의 대사 음성 — 등장인물의 대사 창(`tut-say`)이 뜰 때 그 줄을 튼다 (2026-11-23 기획자).
 *
 * 원본은 `assets/Audio/voice/tutorial/{더빙}/{판}.say{n}.wav`(← `tools/tutorial_dub_generate.py split`)이고
 * `tools/build_audio.py`(`npm run audio`)가 `public/tutorialvoice/{판}.say{n}.{더빙}.mp3`로 굽는다.
 * 대본 키 `tut.s.{판}.say{n}`(`meta/tutorialS/common.ts`)에서 이름이 바로 나온다 — 표가 따로 없다.
 *
 * - **다음으로 넘기면 곧바로 멈춘다** — 다음 줄이 이어서 나오고, 창이 닫히면 그대로 끊긴다.
 * - 파일이 없으면(에셋 없이 빌드 · 전투 기초 판처럼 녹음이 없는 줄) 조용히 넘어간다.
 *
 * 더빙은 `currentDubLang()`, 크기는 효과음(음성) 칸(`volume.ts`) — `turnVoice.ts`와 같다.
 */

import { volumeScale } from './volume.ts';
import { currentDubLang } from '../i18n/index.ts';

const PREFIX = 'tut.s.';

/** 대본 키 → 파일 이름 부분(`ga-hu.say1`). S급 판의 대사가 아니면 `null` */
export function tutorialVoiceClip(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  const clip = key.slice(PREFIX.length);
  return /^[a-z-]+\.say\d+$/.test(clip) ? clip : null;
}

/** 지금 나오는 대사 */
let playing: HTMLAudioElement | null = null;

/** 대사 창이 그 줄을 띄웠을 때 부른다 — 앞 줄이 아직 나오고 있으면 끊는다 */
export function playTutorialVoice(key: string): void {
  stopTutorialVoice();
  const clip = tutorialVoiceClip(key);
  if (!clip || volumeScale('fx') === 0) return;
  const el = new Audio(`tutorialvoice/${clip}.${currentDubLang()}.mp3`);
  el.volume = volumeScale('fx');
  playing = el;
  void el.play().catch(() => { /* 자동재생이 막혔거나 파일이 없다 */ });
}

/** 다음 줄로 넘어가거나 창이 닫힐 때 — 그 자리에서 끊는다 */
export function stopTutorialVoice(): void {
  if (!playing) return;
  playing.pause();
  playing = null;
}
