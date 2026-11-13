/**
 * 안내 내관의 목소리 — 내관이 화면에 **들어올 때** 군주를 부르는 한마디 (2026-10-22 기획자 지정).
 *
 * 원본은 `assets/Audio/voice/city/{더빙}/호칭_{더빙}.mp3`이고 `tools/build_audio.py`(`npm run audio`)가
 * `public/cityvoice/{단}.{더빙}.mp3`로 옮긴다. 단은 `meta/guide.ts`의 `guideHonor()` — 도시 레벨 둘씩
 * (Lv1~2 주공 · 3~4 장군 · 5~6 대장군 · 7~8 승상 · 9~ 전하). 헌제를 거느려도 그대로다(2026-10-23 — 군주가 황제가 되는 것이 아니다).
 *
 * 더빙은 `currentDubLang()`, 크기는 효과음(음성) 칸(`volume.ts`) — `turnVoice.ts`와 같다.
 * 파일이 없으면(에셋 없이 빌드) 조용히 넘어간다.
 *
 * 내관 대신 선 인물 중 제 목소리가 있는 병사 · 대장장이는 `cityvoice/{인물}-{단}.{더빙}.mp3`(2026-11-13) — 누가 서는지는
 * `screens/guideScript.ts`의 `GUIDE_SPEAKER`.
 */

import type { GuideHonor } from '@samchess/meta';

import { volumeScale } from './volume.ts';
import { currentDubLang } from '../i18n/index.ts';

/** 지금 나오는 목소리 — 안내가 곧바로 이어지면(인사 → 레벨) 앞의 것을 끊는다 */
let playing: HTMLAudioElement | null = null;

export const stewardVoiceUrl = (honor: GuideHonor, dub: string, prefix = ''): string =>
  `cityvoice/${prefix ? `${prefix}-` : ''}${honor}.${dub}.mp3`;

/** `prefix` — 제 목소리가 있는 인물(`guideVoicePrefix`). 비면 내관 */
export function playStewardVoice(honor: GuideHonor, prefix = ''): void {
  if (volumeScale('fx') === 0) return;
  playing?.pause();
  const el = new Audio(stewardVoiceUrl(honor, currentDubLang(), prefix));
  el.volume = volumeScale('fx');
  playing = el;
  void el.play().catch(() => { /* 자동재생이 막혔거나 파일이 없다 */ });
}
