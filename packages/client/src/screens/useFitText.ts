/**
 * 한 줄로 있어야 할 글자가 번역이 길어 두 줄로 접힐 때, 줄바꿈 대신 글자를
 * 줄여 한 줄에 맞춘다(2026-08-25 여섯 번째 피드백 — 명패 제목·ID 상태·언어
 * 이름이 포르투갈어·몽골어·스페인어에서 두 줄이 됐다). `dep`이 바뀔 때마다
 * (그 안의 글자가 바뀔 때) 다시 잰다.
 *
 * **`SettingsModal.tsx` 안에 있던 것을 2026-09-11에 꺼냈다** — 간판의 언어·크레딧·
 * 입장 팝업이 같은 청동 명패(`.modal-ttl`)를 쓰게 되면서, 같은 자리가 넷이 됐다.
 * 짝인 CSS는 `.modal.mod-plank .fit`이고 **거기서는 「줄바꿈 금지」만** 정한다 —
 * 실제로 재서 줄이는 것은 여기다.
 */

import { useLayoutEffect, useRef } from 'react';

export function useFitText<T extends HTMLElement>(dep: unknown): React.RefObject<T | null> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize) || 16;
      // `.fit`(CSS)가 이미 `white-space: nowrap; overflow: hidden`이라, 줄바꿈
      // 없이 쟀을 때의 실제 폭(`scrollWidth`)과 눈에 보이는 자리(`clientWidth`)를
      // 그대로 비교할 수 있다.
      const natural = el.scrollWidth;
      const avail = el.clientWidth;
      if (natural > avail && avail > 0) {
        el.style.fontSize = `${base * (avail / natural)}px`;
      }
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => { /* 못 재도 첫 값으로 돈다 */ });
    // **`ResizeObserver`를 안 단다** — 글자 크기를 줄이면 줄 높이가 바뀌어 `el`
    // 자신의 세로 크기가 변하고, 그걸 스스로 관찰하면 끝없이 돈다
    // (`SettingsModal`의 `useTwoChipSize` 주석에 같은 이야기가 있다).
  }, [dep]);

  return ref;
}
