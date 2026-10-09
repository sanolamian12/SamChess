/**
 * 장수 팝업 — 판의 장수를 누르면 뜬다 (pptx 98쪽 · 전투 UI 개편 6단계, 2026-10-06)
 *
 * ```
 *  ┌──────── #board ──────────────────────┐
 *  │ [...]                                 │
 *  │                     ┌───────────────┐ │
 *  │      (그 장수)       │ [Rock][S] 감녕 │ │ ← 장수 카드(`officerCard.ts`) 그대로
 *  │   ← 카메라가 장수를   │ 초상 HP/AT/MP  │ │
 *  │     왼쪽 가운데로     │ 무 · 지 · 통    │ │
 *  │                     │ [공포][침묵]    │ │
 *  │                     │ 「백보천양」 SP 6 │ │ ← 고유기술 한 줄 — 누르면 설명
 *  │                     │ 책략 3종 [..]   │ │ ← 아군 · 척후기가 있으면 적도. 아니면 「가려짐」
 *  │                     └───────────────┘ │
 *  └───────────────────────────────────────┘
 * ```
 *
 * **판 오른쪽 가운데에 선다**(6단계 확정 2). 카메라가 그 장수를 왼쪽 가운데로 옮기므로 가리지 않는다 —
 * 다만 카메라는 판 밖으로 안 나가서 판 오른쪽 끝의 장수는 못 민다. 그때(그리고 고르는 중이라 카메라가 판 전체일 때)
 * 장수가 화면 오른쪽 절반에 있으면 팝업이 **왼쪽 가운데**로 비켜 선다 — 그 판단은 씬이 한다(`place()`).
 *
 * **닫는 길은 판을 누르는 것 하나다**(98쪽 「전투 맵 아무 데나 클릭하면 닫기」) — × 단추가 없다.
 * 판 클릭은 씬이 받으므로 이 판은 그 결과(`show(null)`)만 받는다.
 *
 * 옛 살펴보기(`InspectPanel`, 28쪽 — 사분면 · 끌기 · ×)를 갈음했다. 속은 4단계의 장수 카드 하나라
 * 같은 내용을 두 벌 그리던 것이 없어졌다(카드 아래 두 줄만 이 팝업의 것). 고유기술 상태도 이제
 * 엔진의 `skillStatus()`다 — 옛 살펴보기는 제 계산이라 「SP 부족」이 없었다(1단계가 남긴 것).
 *
 * 읽기 전용이다 — 여기서는 아무 의도도 만들지 않는다.
 */

import type { BattleState, UnitId } from '@samchess/rules';
import { officerCardKey, renderOfficerCard } from './officerCard.ts';
import type { StatusPopup } from './statusPopup.ts';
import { playSfx } from '../audio/sfx.ts';

/** 팝업이 서는 쪽 — 판의 세로 가운데. `center`는 배치 화면의 고유기술 패널에서 열었을 때(pptx 100쪽) */
export type PopupSide = 'right' | 'left' | 'center';

export class UnitPopup {
  private unitId: UnitId | null = null;
  private lastKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tip: StatusPopup,
  ) {
    root.replaceChildren();
    root.classList.add('hidden');
    root.dataset.pos = 'right';
  }

  get shown(): UnitId | null { return this.unitId; }

  show(unitId: UnitId | null): void {
    if (this.unitId === unitId) return;
    // 열리거나 다른 장수로 넘어갈 때만 소리 — 닫히는 것은 「정보가 열렸다」가 아니다
    if (unitId !== null) playSfx('paper');
    this.unitId = unitId;
    this.lastKey = '';
  }

  /** 서는 쪽. 씬이 장수의 화면 위치를 보고 정한다 */
  place(side: PopupSide): void {
    if (this.root.dataset.pos !== side) this.root.dataset.pos = side;
  }

  /** 매 프레임 불린다. 열려 있는 동안 HP·상태가 실시간으로 따라간다. */
  refresh(state: BattleState): void {
    const unit = this.unitId ? state.units[this.unitId] : undefined;
    if (!unit || !unit.alive) {
      if (this.unitId) { this.unitId = null; this.lastKey = ''; }
      this.root.classList.add('hidden');
      return;
    }
    const key = officerCardKey(state, unit);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.dataset.unit = unit.id;
    this.root.classList.remove('hidden');
    this.root.replaceChildren(renderOfficerCard(state, unit, this.tip));
  }
}
