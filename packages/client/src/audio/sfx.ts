/**
 * 효과음 — 한 번 재생하고 끝나는 짧은 소리들.
 *
 * 원본은 `assets/Audio/effects/*.mp3`이고 `tools/build_audio.py`(`npm run audio`)가
 * `public/effects/{id}.mp3`로 그대로 옮긴다 — 파일명이 이미 영문이라 `bgm.ts`의
 * 한글→id 표 같은 것이 따로 없다, 파일 이름 자체가 id다.
 *
 * `bgm.ts`와 같은 두 가지를 그대로 따른다 — 브라우저가 첫 조작 전 자동재생을
 * 막아도 오류가 아니고(여기서는 그냥 그 한 번을 놓친다, 배경음악처럼 물고 있다가
 * 다시 틀지 않는다 — 효과음 하나 놓치는 것은 무음보다 훨씬 가볍다), 음소거는
 * 배경음악과 **같은 스위치**를 쓴다(`bgmMuted()`) — 환경설정의 소리 켬/끔이
 * 하나뿐이라 효과음만 따로 나면 "껐는데 왜 나지"가 된다.
 *
 * 같은 소리가 겹쳐 날 수 있어(같은 틱에 유닛 여럿이 움직이는 등) 캐시된 엘리먼트를
 * 그대로 재생하지 않고 **틀 때마다 복제**한다 — 하나를 재사용하면 뒤에 온 소리가
 * 앞선 소리를 끊는다.
 */

import { bgmMuted } from './bgm.ts';

export type SfxId =
  | 'battle_attack' | 'battle_moving' | 'battle_dead' | 'battle_spell'
  | 'enter_barraks' | 'enter_city' | 'enter_palace' | 'build_city'
  | 'select_confirm' | 'select_option'
  | 'paper' | 'ring' | 'roar2';

const VOLUME = 0.8;

const templates = new Map<SfxId, HTMLAudioElement>();

function templateOf(id: SfxId): HTMLAudioElement {
  let el = templates.get(id);
  if (!el) {
    el = new Audio(`effects/${id}.mp3`);
    el.preload = 'auto';
    templates.set(id, el);
  }
  return el;
}

/** 효과음 하나를 튼다. 음소거 중이거나(파일이 없어) 재생이 막히면 조용히 넘어간다. */
export function playSfx(id: SfxId): void {
  if (bgmMuted()) return;
  const el = templateOf(id).cloneNode(true) as HTMLAudioElement;
  el.volume = VOLUME;
  void el.play().catch(() => { /* 자동재생이 막혔거나 파일이 없다 */ });
}
