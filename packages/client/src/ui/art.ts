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
 * 수묵화 → 초상화 → 숨김 순으로 물러난다.
 * `onerror`를 갈아 끼우며 한 단계씩 내려가므로 무한 반복이 되지 않는다.
 */
export function setOfficerArt(img: HTMLImageElement, officerId: string): void {
  img.onerror = () => {
    img.onerror = () => { img.onerror = null; img.classList.add('no-art'); };
    img.src = portraitUrl(officerId);
  };
  img.src = battleArtUrl(officerId);
}
