/**
 * 전투 화면의 DOM 자리.
 *
 * 전투 UI(HUD·카드·대화창·커맨드 패널·팝업)는 DOM을 직접 다루고 **id로 자리를 찾는다.**
 * 그래서 React가 하는 일은 이 자리를 그려 주는 것뿐이고, 붙는 것은 `bootBattle`이 한다.
 * 전투 UI를 React로 다시 쓰지 않는 이유는 이미 돌고 있고, 중요한 계약
 * (「버튼 활성 여부는 validate()에 묻는다」)이 프레임워크와 무관하기 때문이다.
 *
 * 실전(`BattleScreen`)과 데모(`DemoBattle`)가 같은 자리를 쓰므로 여기 한 곳에 둔다.
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ #hud    1.3일 내차례 유봉·Bishop 북1 남1 [⋯] │  한 줄 (pptx 27쪽)
 * │ #cards-north   북군 카드 스트립            │
 * ├──────────────────────────────────┤
 * │ #board                                    │  정사각
 * │   ┌#inspect┐   #log말풍선   ┌#control┐   │  3/8 : 1/4 : 3/8 (pptx 29쪽)
 * │   └────────┘                 └────────┘   │
 * ├──────────────────────────────────┤
 * │ #cards-south   남군 카드 스트립            │
 * └──────────────────────────────────┘
 * ```
 *
 * **판 바깥에는 카드 스트립뿐이다** (pptx 27~29쪽). 예전에 하단을 차지하던 제어 패널은
 * 판 안에 뜨는 플로팅 커맨드 패널이 되었고, 그 정보 블록은 카드가 대신한다.
 */

export function BattleStage(): React.JSX.Element {
  return (
    <>
      <header id="top">
        <div id="hud" />
        <div id="cards-north" className="strip" />
      </header>
      <main id="board">
        <div id="app" />
        <div id="log" />      {/* 시스템 대화 — 판 한가운데 말풍선 (pptx 27쪽) */}
        <div id="focus" />    {/* 자동 포커싱 토글 — 판 왼쪽 위 */}
        <div id="prep" />     {/* 배치·정찰 — 커맨드 패널과 같은 자리를 쓴다 */}
        <div id="control" />  {/* 커맨드 패널 (pptx 29쪽) */}
        <div id="inspect" />  {/* 상태 팝업 — 커맨드 패널의 대칭 자리 (pptx 28쪽) */}
        <div id="fx" />       {/* 고유기술 발동 연출 (pptx 24쪽) */}
        <div id="burst" />    {/* 일회성 시각 효과 — 판 영역 한가운데 4프레임 */}
        <div id="dialog" />   {/* 고유기술 발동 물음 (pptx 23쪽) */}
        <div id="tip" />      {/* 버프/디버프·책략 설명 */}
        <div id="history" />  {/* 시스템 대화 전체 기록 + 항복 (pptx 27쪽) */}
      </main>
      <footer id="bottom">
        <div id="cards-south" className="strip" />
      </footer>
    </>
  );
}
