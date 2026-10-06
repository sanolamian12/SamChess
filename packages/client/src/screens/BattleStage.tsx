/**
 * 전투 화면의 DOM 자리.
 *
 * 전투 UI(HUD·대화창·커맨드 패널·팝업)는 DOM을 직접 다루고 **id로 자리를 찾는다.**
 * 그래서 React가 하는 일은 이 자리를 그려 주는 것뿐이고, 붙는 것은 `bootBattle`이 한다.
 * 전투 UI를 React로 다시 쓰지 않는 이유는 이미 돌고 있고, 중요한 계약
 * (「버튼 활성 여부는 validate()에 묻는다」)이 프레임워크와 무관하기 때문이다.
 *
 * 실전(`BattleScreen`)과 데모(`DemoBattle`)가 같은 자리를 쓰므로 여기 한 곳에 둔다.
 *
 * **세 칸 무대** (전투 UI 개편, pptx 89~98쪽 — `docs/전투UI개편/설계.md` §0 · §3).
 * 판 위아래의 카드 줄과 판 위에 떠서 판을 가리던 판들을 걷고, 위 · 판 · 아래로 갈랐다.
 *
 * ```
 * ┌──────────────────────────────────┐
 * │ #top    ┌#order 순서 판─┐┌#gameinfo┐   │
 * ├──────────────────────────────────┤
 * │ #board  판 + #log · #unitpop · #fx …     │  정사각 — 가리는 판이 없다
 * ├──────────────────────────────────┤
 * │ #bottom ┌#cmd 명령 판─┐┌#ctx 맥락 판─┐  │
 * └──────────────────────────────────┘
 * ```
 *
 * 2단계가 옛 판들을 칸에 **임시로** 담았고, `#hud` → `#gameinfo`(3단계) · `#control` · `#dialog` → `#cmd` · `#ctx-flow`(4단계) ·
 * `#prep` → `#cmd`의 고유기술 목록 + `#ctx-prep`(5단계)로 갈음했다. 임시 자리는 이제 없다.
 */

export function BattleStage(): React.JSX.Element {
  return (
    <>
      <header id="top">
        <div id="order" />    {/* 순서 판 (pptx 90·92쪽, `ui/orderPanel.ts`) */}
        <div id="gameinfo" /> {/* 게임 정보 (pptx 93쪽, `ui/gameInfo.ts`) — 배치 중엔 숨는다 */}
      </header>
      <main id="board">
        <div id="app" />
        <div id="log" />      {/* 시스템 메시지 — 판 왼쪽 위 3줄 + [...] (pptx 98쪽, `ui/systemLog.ts`) */}
        <div id="focus" />    {/* 자동 포커싱 토글 — 판 왼쪽 아래 (6단계에서 메시지와 자리를 맞바꿨다) */}
        <div id="unitpop" />  {/* 장수 팝업 — 판 오른쪽 가운데 (pptx 98쪽, `ui/unitPopup.ts`) */}
        <div id="fx" />       {/* 고유기술 발동 연출 (pptx 24쪽) */}
        <div id="burst" />    {/* 일회성 시각 효과 — 판 영역 한가운데 4프레임 */}
        <div id="dice" />     {/* 동점 추첨 주사위 — 배치 화면이 열릴 때 한 번 (pptx 90쪽) */}
        <div id="intel" />    {/* 적 책략 팝업 — 배치 판의 [책략 확인] (pptx 91쪽, `ui/deployPanel.ts`) */}
        <div id="tip" />      {/* 버프/디버프·책략 설명 */}
        <div id="history" />  {/* 전투 기록 — [...]로 연다 (설계 확정 7) */}
      </main>
      <footer id="bottom">
        <div id="cmd" />      {/* 명령 판 (pptx 94~97쪽, `ui/commandPanel.ts`) */}
        <div id="ctx">        {/* 맥락 판 (pptx 90·94~97쪽) */}
          <div id="ctx-flow" /> {/* 전투 — 물음 · 조준 · 확인 · 대상 카드 (`ui/contextPanel.ts`) */}
          <div id="ctx-prep" /> {/* 배치 · 정찰 — 배치 N초 · [준비완료] · [책략 확인] (`ui/deployPanel.ts`) */}
        </div>
      </footer>
    </>
  );
}
