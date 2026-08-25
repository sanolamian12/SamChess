/**
 * 고유기술 성우 대사 — 시전 순간부터 튼다.
 *
 * 원본은 `assets/Audio/Specialskills/{KR,EN,JP,CA,PT}/`이고 `tools/build_audio.py`가
 * 고유기술 데이터(`uniqueSkills.json`)의 이름과 대조해 `public/skillvoice/{기술id}.{더빙}.{확장자}`로
 * 옮긴다. 어느 더빙을 틀지는 이 파일이 아니라 `i18n`의 `currentDubLang()`이 정한다 —
 * 텍스트 언어 열 가지를 더빙 다섯으로 묶는 자동 매칭에, 환경설정에서 사람이 직접
 * 고른 값이 있으면 그 값이 덮어쓴다.
 *
 * **지금은 40종 중 18종만 녹음돼 있다.** 없으면(404) `ui/art.ts`의 `setOfficerArt`가
 * 그림 없이도 화면이 안 죽게 물러나는 것과 같은 결로 조용히 넘어간다 — 나머지
 * 22종이 채워질 때 이 파일은 손댈 일이 없다.
 *
 * **원본에 확장자가 섞여 있다** — 대부분 `.mp3`인데 `용호상박`의 JP·PT 더빙만
 * `.wav`다(기획자 자산을 다시 인코딩하지 않고 그대로 옮긴 결과). 그래서 `.mp3`를
 * 먼저 시도하고 실패하면 `.wav`로 한 번 더 시도한다.
 */

import { bgmMuted } from './bgm.ts';
import { currentDubLang } from '../i18n/index.ts';

function tryPlay(src: string, onFail?: () => void): void {
  const el = new Audio(src);
  el.volume = 1;
  el.play().catch(() => onFail?.());
}

/** 고유기술 `skillId`가 시전된 순간 부른다. */
export function playSkillVoice(skillId: string): void {
  if (bgmMuted()) return;
  const dub = currentDubLang();
  tryPlay(`skillvoice/${skillId}.${dub}.mp3`, () => {
    tryPlay(`skillvoice/${skillId}.${dub}.wav`);
  });
}
