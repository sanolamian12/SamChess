/**
 * 버튼 효과음 — 위임 리스너 하나로 전 화면을 건다.
 *
 * 공용 `<Button>` 컴포넌트가 없다(화면마다 직접 `<button className="btn ...">`를
 * 쓴다) — 그래서 호출부마다 손대는 대신, 클릭이 지나가는 지점 하나(`window`)에서
 * `<button>`을 잡는다. 새 화면이 늘어도 이 파일은 건드릴 일이 없다.
 *
 * 소리는 **전투 안/밖**으로 먼저 갈린다 — `#frame`의 클래스(`battle`/`meta`,
 * `App.tsx`·`DemoBattle.tsx`가 매긴다)로 판단한다.
 *
 * 전투 밖(hall):
 * - `.btn.primary`(초록/확정 버튼) → `select_confirm`
 * - `.opt`(환경설정 언어·더빙·음소거 칩, 정렬·필터 칩, 레벨업 스탯/문파 선택 등
 *   "이미 열린 화면 안에서 값을 고르는" 버튼) → `select_option`
 * - 그 밖의 모든 `<button>`(`.btn.ghost` 등 — 매뉴 이동·패널 열기) → `hall_click`
 *
 * 판 위의 자리 핫스팟(병영·궁궐 등, `MainScreen.tsx`)은 `<button>`이 아니라 SVG
 * `<rect role="button">`이라 여기 안 걸린다 — `enter_barraks`/`enter_palace`처럼
 * 더 구체적인 소리가 그 자리에 따로 있다.
 *
 * 전투 안(battle):
 * - 명령 판 · 맥락 판(`#cmd` · `#ctx-flow` — `ui/commandPanel.ts` · `ui/contextPanel.ts`, 전투 UI 개편
 *   4단계)의 버튼은 기물에 명령을 내리는 행위이므로 `battle_command_click`이다. 다만 그 안의
 *   **장수 카드**(`.oc` — 상태 칩)와 고유기술 배너(`skillInfo` — 설명 팝업), 배치 중의 고유기술 목록(`.sk-row`)은 정보 확인이라
 *   `battle_info_click`이다. (「턴 넘기기」는 2026-10-06에 게임 정보의 [턴 가져오기]로 옮겨 가
 *   아래 「그 밖」에 든다.)
 * - 그 밖의 전투 UI(`#gameinfo`의 항복·턴 가져오기·전투기록 · `#ctx-prep`의 준비 완료 · 책략 확인 · `#intel`의 책략 칩 · `#inspect`의 상태
 *   상세 · `#tip`의 설명 팝업 닫기 · `#history`/`#log`의 로그·항복 · `#focus`의
 *   자동 포커싱)는 전부 정보 확인·창 닫기·게임 운영이라 `battle_info_click`이다.
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

import { playSfx, type SfxId } from './sfx.ts';

let installed = false;

export function installButtonSfx(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('button');
    if (!btn || btn.disabled) return;
    playSfx(sfxFor(btn));
  }, { capture: true });
}

function sfxFor(btn: Element): SfxId {
  const inBattle = document.getElementById('frame')?.classList.contains('battle') === true;
  if (inBattle) {
    if (btn.closest('#cmd') || btn.closest('#ctx-flow')) {
      const info = btn.closest('.oc') || btn.closest('.sk-row') || (btn as HTMLElement).dataset.action === 'skillInfo';
      return info ? 'battle_info_click' : 'battle_command_click';
    }
    return 'battle_info_click';
  }
  if (btn.classList.contains('primary')) return 'select_confirm';
  if (btn.classList.contains('opt')) return 'select_option';
  return 'hall_click';
}
