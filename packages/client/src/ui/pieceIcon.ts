/**
 * 기물 아이콘 — 순서 판의 「기물」 열 (전투 그래픽 마감, pptx 100쪽 · 2026-10-07)
 *
 * 영어 이름(`King` · `Rock` …) 대신 그림으로 보인다. 아군 · 적군 **두 벌**이다 —
 * 순서 판이 진영을 줄의 왼쪽 띠 색으로도 말하지만, 아이콘만 보고도 갈려야 한다.
 *
 * **그림은 `tools/build_ui.py`가 `assets/icons/pieces_sheet.png`(6×2)를 잘라 `public/ui/pieces/{기물}-{mine|foe}.png`로 굽는다**
 * (`docs/PROMPT.md` 「전투 화면 — 기물 아이콘 12장」, 2026-10-07 받음). 아군은 청동 · 적군은 붉은 구리이고 폰은 궁수다.
 * `PIECE_ART`를 끄면 체스 글리프(♚ ♛ ♜ ♝ ♞ ♟)를 진영 색으로 칠한다 — 그림이 없는 자리(새 체크아웃)에서 켜 두면
 * 매 판 404가 콘솔을 채우고 스모크가 그 오류를 잡는다(`assets/`는 git 밖이다 — 에셋 방침).
 */

import type { PieceType } from '@samchess/data';

/** `public/ui/pieces/`에 열두 장이 들어왔는가 */
const PIECE_ART = true;

/** 텍스트 표기 강제(U+FE0E) — ♟는 이모지 목록에도 있어 안 붙이면 휴대폰에서 컬러 그림으로 뜬다 */
const GLYPH: Record<PieceType, string> = {
  King: '♚︎', Queen: '♛︎', Rock: '♜︎',
  Bishop: '♝︎', Knight: '♞︎', Pawn: '♟︎',
};

export const pieceArtUrl = (piece: PieceType, mine: boolean): string =>
  `ui/pieces/${piece.toLowerCase()}-${mine ? 'mine' : 'foe'}.png`;

/** 아이콘 하나. 진영 색은 CSS가 `data-side`로 칠한다(`.pc-icon`) */
export function pieceIcon(piece: PieceType, mine: boolean): HTMLElement {
  const box = document.createElement('span');
  box.className = 'pc-icon';
  box.dataset.piece = piece;
  box.dataset.side = mine ? 'mine' : 'foe';
  box.title = piece;
  if (PIECE_ART) {
    const img = document.createElement('img');
    img.alt = piece;
    img.src = pieceArtUrl(piece, mine);
    box.append(img);
  } else {
    box.textContent = GLYPH[piece];
  }
  return box;
}
