/**
 * 등급 배지 — 이름 앞뒤에 적던 등급 글자(`S`·`[A]`)를 **그림 한 장**으로 바꾼다 (2026-09-22).
 *
 * 그림은 `assets/icons/Grade.png`(D·C·B·A·S·E 가로 묶음)를 `tools/build_ui.py`가 갈라
 * `icons/grade-{d,c,b,a,s,e}.png`로 굽는다. 에셋은 리포에 없어(기획자 방침) 받기 전에는
 * 404다 — 그때는 **예전의 색 글자 배지로 물러난다**(`data-fallback`, `style.css`의
 * 「등급 아이콘」절). 배지가 통째로 사라지면 등급을 읽을 길이 없어진다.
 *
 * 등급 값은 언제나 요소의 `data-grade`에 있다 — 검사는 글자가 아니라 이것을 읽는다
 * (화면 글자는 그림이 되며 사라졌다). 전투 UI(DOM)는 `gradeBadge()`, 메타 화면(React)은
 * `screens/GradeBadge.tsx`가 같은 마크업을 낸다.
 */

export const gradeIconUrl = (grade: string): string => `icons/grade-${grade.toLowerCase()}.png`;

/** 그림이 안 오면 배지를 글자로 되돌린다 — React 쪽(`GradeBadge`)은 같은 모양을 상태로 낸다. */
function fallBackToText(badge: HTMLElement, grade: string): void {
  badge.dataset.fallback = '1';
  badge.textContent = grade;
}

export function gradeBadge(grade: string, className = 'gr'): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = className;
  badge.dataset.grade = grade;
  badge.title = grade;
  const img = document.createElement('img');
  img.src = gradeIconUrl(grade);
  img.alt = grade;
  img.draggable = false;
  img.addEventListener('error', () => fallBackToText(badge, grade), { once: true });
  badge.appendChild(img);
  return badge;
}
