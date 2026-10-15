/**
 * 「SP」 글자 대신 쓰는 향로 그림 (2026-10-16 기획자 지정) — 장수 카드의 SP 칸 · 배치 때 고유기술 목록.
 * 게임 정보 판은 진영마다 다른 그림(`sp-south` · `sp-north`)을 `gameInfo.ts`가 따로 건다.
 *
 * 그림은 `tools/build_ui.py`의 `CELL_SHEETS` → `public/ui/gi/sp.png`(git 밖, 에셋 방침). 없으면 글자 「SP」로 물러난다 —
 * 숫자만 덩그러니 남으면 무엇의 숫자인지 모른다.
 */
export function spIcon(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'sp-ic';
  img.src = 'ui/gi/sp.png';
  img.alt = 'SP';
  img.title = 'SP';
  img.draggable = false;
  img.addEventListener('error', () => img.replaceWith(document.createTextNode('SP ')));
  return img;
}
