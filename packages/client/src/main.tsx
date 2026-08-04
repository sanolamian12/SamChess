/**
 * 클라이언트 진입점.
 *
 * 메타 화면은 React, 전투는 Phaser다. 두 층을 잇는 것은 `screens/App.tsx`이고
 * 여기서는 React를 붙이기만 한다.
 *
 * 전투만 바로 보고 싶을 때를 위한 통로는 그대로 남겨 뒀다 — URL에 `?demo=1`을 붙이면
 * 계정·편성을 건너뛰고 예전처럼 데모 편성으로 한 판이 뜬다.
 * 화면 회귀 확인(`smoke:ui` · `shot`)이 이 길을 쓴다.
 *
 *   ?demo=1&seed=42&mode=5v5&side=P2   조작할 진영
 *   ?demo=1&auto=1                     양쪽 다 AI (관전)
 *   ?demo=1&sp=15                      시작 SP — 고유기술을 기다리지 않고 확인
 */

import { createRoot } from 'react-dom/client';
import { App } from './screens/App.tsx';
import { DemoBattle } from './screens/DemoBattle.tsx';
import './style.css';

const params = new URLSearchParams(location.search);

/*
 * StrictMode를 쓰지 않는다. 개발 모드에서 effect를 두 번 실행하는데, 전투 화면의 effect가
 * Phaser 게임을 띄우는 일이라 캔버스가 둘 생기고 첫 번째가 유령으로 남는다.
 * React 쪽 문제가 아니라 "외부 라이브러리를 effect에서 띄운다"는 구조의 문제다.
 */
createRoot(document.getElementById('root')!).render(
  params.has('demo') ? <DemoBattle params={params} /> : <App />,
);
