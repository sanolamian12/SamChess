/**
 * 아이콘 말풍선 — 누르면 그 아이콘의 이름이 잠깐 뜬다 (2026-11-23 기획자)
 *
 * 아이콘의 뜻은 `title`(마우스를 올리면 뜨는 글)로만 붙어 있었는데 **휴대폰에는 마우스 올리기가 없다** — 도시 관리의 요건 칸
 * (보유 장수 · S·A급 · 승리 · 자재)이 무엇인지 손가락으로는 알 길이 없었다. 그래서 그 아이콘을 누르면 위에 작은 말풍선이 떠서
 * 이름을 보여 주고, **2초 뒤나 다른 곳을 누르면** 사라진다. PC에서도 같다(마우스를 올리면 뜨는 글은 그대로 둔다).
 *
 * 문서 전체에 손가락 하나(`pointerdown`, 붙잡는 단계)를 걸어 **한 벌**로 처리한다 — 아이콘마다 손을 달면 빠지는 자리가 생긴다.
 * 모양은 일기토 · 설전의 가시 풍선 그림(`duel/bubble-turn.png` ← `assets/duel/bubble/말풍선2.jpg`)이다(같은 날 기획자).
 * 이름은 이미 번역된 `title`(또는 `data-tip`)을 그대로 쓴다 — 열 언어가 공짜로 따라온다.
 *
 * **누르면 다른 일이 되는 것은 건드리지 않는다** — 단추 · 링크 · `data-action` 안의 아이콘(컬렉션 인장, [보기] 같은 것)은
 * 그 일이 우선이고 뜻은 단추가 말한다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 말풍선을 띄우는 아이콘 — 앞의 것이 먼저다(안 지은 건물의 배지 칸은 안쪽 배지의 「Lv1」보다 칸의 「없음」이 맞다) */
const TIP_SELECTORS = [
  '[data-tip]',
  '.cty-peek-lv[title], .cty-bld .lv[title]',
  '.gic[title], .cty-peek-badge[title], .tac-icon[title], .bld-badge[title], .lv-badge[title]',
];
/** 이 안의 아이콘은 누르면 다른 일이 된다 — 말풍선을 안 띄운다 */
const ACTIVE = 'button, a, input, select, textarea, label, [role="button"], [data-action]';
/** 떠 있는 시간 */
export const TAP_TIP_MS = 2000;

interface Tip { text: string; x: number; top: number; bottom: number; key: number }

function tipTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  for (const sel of TIP_SELECTORS) {
    const el = target.closest<HTMLElement>(sel);
    if (el) return el.closest(ACTIVE) ? null : el;
  }
  return null;
}

export function TapTip(): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState<{ dx: number; below: boolean }>({ dx: 0, below: false });

  useEffect(() => {
    let timer = 0;
    let key = 0;
    const hide = (): void => { window.clearTimeout(timer); setTip(null); };
    const onDown = (e: PointerEvent): void => {
      const el = tipTarget(e.target);
      const text = el ? (el.dataset['tip'] ?? el.getAttribute('title') ?? '').trim() : '';
      if (!el || !text) { hide(); return; }
      const r = el.getBoundingClientRect();
      window.clearTimeout(timer);
      setTip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom, key: ++key });
      timer = window.setTimeout(() => setTip(null), TAP_TIP_MS);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  // 프레임 밖으로 나가지 않게 옆으로 밀고, 위에 자리가 없으면 아래에 선다
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!tip || !box) return;
    const frame = document.getElementById('frame')?.getBoundingClientRect()
      ?? { left: 0, right: window.innerWidth, top: 0 };
    const w = box.offsetWidth;
    const pad = 6;
    const left = tip.x - w / 2;
    const dx = left < frame.left + pad ? frame.left + pad - left
      : left + w > frame.right - pad ? frame.right - pad - (left + w) : 0;
    setShift({ dx, below: tip.top - box.offsetHeight - 10 < frame.top });
  }, [tip]);

  if (!tip) return null;
  const style: React.CSSProperties = {
    left: tip.x + shift.dx,
    top: shift.below ? tip.bottom + 8 : tip.top - 8,
  };
  return createPortal(
    <div ref={boxRef} key={tip.key} className="tap-tip" data-below={shift.below ? '1' : '0'} style={style} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}
