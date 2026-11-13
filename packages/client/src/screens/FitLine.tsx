/**
 * 완료 팝업의 한 줄 글 — 제목(「증 축 완 료」)과 큰 글씨(「도시 Lv2」 · 「대장간 Lv1」) (2026-11-13 기획자). 도시 증축 완료(`CityScreen`)와
 * 건물 짓기 · 증축 완료(`BuildingsScreen`)가 함께 쓴다.
 *
 * **언제나 한 줄 — 넘치면 그 글만 줄인다.** 판의 안쪽 폭에 이 글이 한 줄로 드는 가장 큰 배율(`--fit-scale`, 최대 1)을 건다. 글씨 크기의 기준은
 * CSS가 정하고(`.cty-done .modal-ttl` · `.cty-done .cty-done-lv`) 여기서는 배율만 낸다. 언어마다 한 크기로 묶었더니(가장 긴 건물 이름에 맞춤)
 * 몽골어 「Хот Lv2」가 절반 크기로 줄어(가장 긴 이름이 「Тариалангийн талбай」) 글마다로 바꿨다 — 짧은 글은 그대로 크다.
 * 숫자를 언어별 표로 적지 않는다 — 번역이 바뀌면 표가 조용히 낡는다. 확인은 `tools/done_lang_ux.ts`(열 언어 · 올 수 있는 글 전부).
 */

import { useLayoutEffect, useRef } from 'react';

export function FitLine({ text, className, field }: { text: string; className: string; field: string }): React.JSX.Element {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      el.style.setProperty('--fit-scale', '1');
      const cs = getComputedStyle(el);
      // 판 안의 같은 글꼴로 한 줄 폭을 잰다 — 보이지 않는 줄 하나를 잠깐 세운다.
      // `offsetWidth`(레이아웃 폭) — 큰 글씨는 떠오르는 애니메이션(`scale(.55)` → 1) 중이라 `getBoundingClientRect`는 줄어든 폭을 준다
      const probe = document.createElement('span');
      Object.assign(probe.style, {
        position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', left: '0', top: '0',
        font: cs.font, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
      });
      probe.textContent = el.textContent ?? '';
      el.appendChild(probe);
      const need = probe.offsetWidth;
      probe.remove();
      // 남는 폭은 **판의** 안쪽 폭이다 — 이 칸의 폭은 글을 따라 자랄 수 있다
      const host = el.parentElement ?? el;
      const hs = getComputedStyle(host);
      const room = host.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight);
      const scale = need > room && need > 0 ? Math.floor((room / need) * 100) / 100 : 1;
      el.style.setProperty('--fit-scale', String(scale));
      el.dataset.fitScale = String(scale);
    };
    fit();
    // 판 폭이 바뀔 때만 다시 잰다 — 배율이 높이를 바꾸므로 높이까지 따라가면 잼 → 높이 변화 → 잼이 돌 수 있다
    const host = el.parentElement ?? el;
    let width = host.clientWidth;
    const ro = new ResizeObserver(() => { if (host.clientWidth !== width) { width = host.clientWidth; fit(); } });
    ro.observe(host);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [text]);
  return <p ref={ref} className={className} data-field={field}>{text}</p>;
}
