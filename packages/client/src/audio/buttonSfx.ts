/**
 * 버튼 효과음 — 위임 리스너 하나로 전 화면을 건다.
 *
 * 공용 `<Button>` 컴포넌트가 없다(화면마다 직접 `<button className="btn ...">`를
 * 쓴다) — 그래서 호출부마다 손대는 대신, 클릭이 지나가는 지점 하나(`window`)에서
 * `<button>`을 잡는다. 새 화면이 늘어도 이 파일은 건드릴 일이 없다.
 *
 * `.btn.primary`(초록/확정 버튼)는 `select_confirm`, 그 밖의 모든 `<button>`
 * (`.btn.ghost`·`.opt` 언어·음소거 칩 등)은 `select_option`이다. 판 위의 자리
 * 핫스팟(병영·궁궐 등, `MainScreen.tsx`)은 `<button>`이 아니라 SVG `<rect
 * role="button">`이라 여기 안 걸린다 — `enter_barraks`/`enter_palace`처럼 더
 * 구체적인 소리가 그 자리에 따로 있다.
 *
 * **버블 단계가 아니라 캡처 단계에서 잡는다.** 모든 팝업(`SettingsModal`·
 * `CityScreen`의 증축 확인 등 8곳)이 `<div className="modal" onClick={(e) =>
 * e.stopPropagation()}>`로 안쪽 클릭을 감싸고 있다 — 배경(`.modal-back`)까지
 * 버블링되면 팝업이 닫혀 버리기 때문이다. 그런데 `stopPropagation()`은 **버블
 * 단계**를 막는 것이라, 버블 단계에 건 `window` 리스너는 팝업 안의 [확인] 버튼을
 * 눌러도 한 번도 안 울렸다(환경설정 [확인]에서 실제로 이렇게 잡혔다). 캡처
 * 단계는 이벤트가 `window`에서 타깃으로 **내려가는** 길이라 그 안쪽에서 나중에
 * 걸리는 `stopPropagation()`보다 항상 먼저 지나간다.
 */

import { playSfx } from './sfx.ts';

let installed = false;

export function installButtonSfx(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn || btn.disabled) return;
    playSfx(btn.classList.contains('primary') ? 'select_confirm' : 'select_option');
  }, { capture: true });
}
