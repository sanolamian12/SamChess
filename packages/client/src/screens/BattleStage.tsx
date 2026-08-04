/**
 * 전투 화면의 DOM 자리.
 *
 * 전투 UI(HUD·대화창·제어 패널·팝업)는 DOM을 직접 다루고 **id로 자리를 찾는다.**
 * 그래서 React가 하는 일은 이 자리를 그려 주는 것뿐이고, 붙는 것은 `bootBattle`이 한다.
 * 전투 UI를 React로 다시 쓰지 않는 이유는 이미 돌고 있고, 중요한 계약
 * (「버튼 활성 여부는 validate()에 묻는다」)이 프레임워크와 무관하기 때문이다.
 *
 * 실전(`BattleScreen`)과 데모(`DemoBattle`)가 같은 자리를 쓰므로 여기 한 곳에 둔다.
 */

export function BattleStage(): React.JSX.Element {
  return (
    <>
      <header id="top">
        <div id="hud" />
        <div id="log" title="눌러서 전체 기록 보기" />
      </header>
      <main id="board">
        <div id="app" />
        <div id="fx" />       {/* 고유기술 발동 연출 (pptx 24쪽) */}
        <div id="dialog" />   {/* 고유기술 발동 물음 (pptx 23쪽) */}
        <div id="inspect" />  {/* 기물 정보 팝업 (pptx 25쪽) */}
        <div id="tip" />      {/* 버프/디버프 설명 */}
        <div id="history" />  {/* 시스템 대화 전체 기록 */}
      </main>
      <footer id="bottom">
        <div id="control" />
      </footer>
    </>
  );
}
