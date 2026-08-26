/**
 * 그림 경로와 대체 규칙.
 *
 * 화면에 쓰는 그림은 세 종류이고 전부 `tools/build_portraits.py`가 만든다.
 *
 * | 쓰임 | 경로 | 원본 |
 * |---|---|---|
 * | 보드 타일 | `portraits/{장수id}.png` 96×120 **투명 배경** | `assets/Chars/` 260장 |
 * | 하단 패널·정보 팝업 | `battle/{장수id}.jpg` 200² 수묵화 | `assets/CharsInBattle/` 260장 |
 * | 고유기술 연출 | `skills/{기술id}.jpg` 배너 | `assets/SpecialSkills/` 40장 |
 *
 * **보드 타일은 알파를 가진다 (2026-08-07).** `assets/Chars/`가 배경을 지운 그림으로
 * 교체되어 타일 뒤로 판이 그대로 비친다 — 유닛이 판 위에 서 있는 것처럼 보이고, 진영
 * 칸의 색이 그대로 살아난다. 타일 뒤에 불투명한 판을 깔면 이 효과가 사라지니 주의할 것.
 * 발밑의 풀밭·자갈은 원본이 의도적으로 남긴 것이다(배경이 아니라 캐릭터의 받침).
 *
 * **수묵화도 260명 전부에게 있다 (2026-08-07).** 그전에는 일부만 있었다.
 * 아래 `setOfficerArt`의 물러나기는 그대로 둔다 — 에셋은 리포에 없어서(기획자 방침)
 * 받아 오기 전에는 셋 다 404다. 그림이 없다고 화면이 무너지지는 않아야 한다.
 */

export const portraitUrl = (officerId: string): string => `portraits/${officerId}.png`;
export const battleArtUrl = (officerId: string): string => `battle/${officerId}.jpg`;
export const skillArtUrl = (skillId: string): string => `skills/${skillId}.jpg`;

/**
 * 화면 장식 그림 (2026-08-14 · `tools/build_frames.py`).
 *
 * | 경로 | 원본 | 쓰는 곳 |
 * |---|---|---|
 * | `ui/chessmap.png` | `assets/map/chessmap.png` | 체스판 아래에 깔리는 지도 (Phaser) |
 * | `ui/card-frame.png` | `assets/map/person.png` | 카드 벽보 액자 — CSS가 9분할로 두른다 |
 * | `ui/backdrop.png` | 〃 (액자 바깥 산수) | 카드 스트립 뒤 배경 — CSS |
 *
 * **셋 다 없어도 화면은 돈다.** 지도가 없으면 판이 예전의 어두운 격자로 물러나고
 * (`BattleScene.drawBoard`), 액자·배경은 CSS에서 그냥 안 그려진다.
 * 액자 그림 경로는 여기와 `style.css` 두 곳에 있다 — CSS가 `url()`을 직접 쓰기 때문이다.
 */
export const BOARD_MAP_URL = 'ui/chessmap.png';

/**
 * 기본은 수묵화 → 초상화 → 숨김 순으로 물러난다. `primary: 'portrait'`를 주면
 * **순서를 뒤집는다** — 장수 카드(pptx 53쪽)는 「체스 게임에 들어갔을 때 기물로
 * 쓰는 이미지」(`assets/Chars/` → `portraits/{id}.png`, 알파 있는 타일)를 요구해서
 * (2026-08-27 사용자 지정), 수묵화가 있어도 그쪽을 먼저 보여줘야 한다.
 * `onerror`를 갈아 끼우며 한 단계씩 내려가므로 무한 반복이 되지 않는다.
 */
export function setOfficerArt(
  img: HTMLImageElement, officerId: string, primary: 'battle' | 'portrait' = 'battle',
): void {
  const [first, second] = primary === 'portrait'
    ? [portraitUrl(officerId), battleArtUrl(officerId)]
    : [battleArtUrl(officerId), portraitUrl(officerId)];
  img.onerror = () => {
    img.onerror = () => { img.onerror = null; img.classList.add('no-art'); };
    img.src = second;
  };
  img.src = first;
}
