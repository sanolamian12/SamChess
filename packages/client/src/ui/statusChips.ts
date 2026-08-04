/**
 * 걸려 있는 버프·디버프를 **누를 수 있는 배지**로 그린다 (기획 pptx 22쪽 「내가 걸린 버프, 디버프들」).
 *
 * 하단 제어 패널의 넷째 줄과 기물 정보 팝업이 같은 것을 보여주므로 여기 한 곳에 둔다.
 * 배지에는 이름과 남은 길이만 적고, 누르면 `StatusPopup`이 뜻을 설명한다.
 *
 * **「조종」은 `statuses` 배열이 아니라 `UnitState.control`에 들어간다.** 배지에서 빠뜨리기
 * 딱 좋은 자리라 여기서 함께 세어 준다 — 디버프 하나로 친다.
 */

import { STATUS_META } from '@samchess/rules';
import type { BattleState, UnitState } from '@samchess/rules';
import { officerById } from '@samchess/data';
import type { StatusPopup } from './statusPopup.ts';

export function renderStatusChips(
  host: HTMLElement,
  state: BattleState,
  unit: UnitState,
  tip: StatusPopup,
): number {
  host.replaceChildren();
  let count = 0;

  for (const s of unit.statuses) {
    const meta = STATUS_META[s.status];
    // 탈진·질병은 해제 전까지 영구다 (GDD §3.7) — 남은 시간이 아니라 ∞로 적는다
    const tail = s.expiresAt !== undefined ? String(Math.max(0, s.expiresAt - state.time))
      : s.charges !== undefined ? `${s.charges}회`
      : '∞';

    const el = document.createElement('button');
    el.className = `st ${meta.kind}`;
    el.dataset.status = s.status;
    el.append(spanOf('t', meta.label), spanOf('d', tail));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const detail = s.expiresAt !== undefined ? `남은 시간 ${Math.max(0, s.expiresAt - state.time)}`
        : s.charges !== undefined ? `남은 횟수 ${s.charges}`
        : '해제되기 전까지 계속된다';
      tip.show(s.status, detail);
    });
    host.appendChild(el);
    count++;
  }

  if (unit.control) {
    const by = officerById.get(state.units[unit.control.by]?.officer ?? '')?.name ?? '?';
    const permanent = unit.control.uses === null;
    const label = unit.control.mode === 'moveOnly' ? '조종 — 이동만' : '조종';
    const el = document.createElement('button');
    el.className = 'st debuff';
    el.dataset.status = 'control';
    el.append(spanOf('t', label), spanOf('d', permanent ? '영구' : `${unit.control.uses}턴`));
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      tip.showRaw('debuff', label,
        unit.control!.mode === 'moveOnly'
          ? '적의 지시대로 움직인다. 이동만 할 수 있고 공격·책략·명상·고유기술은 쓸 수 없다.'
          : '적의 지시대로 움직인다. 이동과 공격을 적이 고르며, 제 편을 공격하게 된다.',
        permanent ? `${by}에게 게임이 끝날 때까지 조종당한다` : `${by} · 남은 ${unit.control!.uses}턴`);
    });
    host.appendChild(el);
    count++;
  }

  if (count === 0) {
    const none = document.createElement('span');
    none.className = 'none';
    none.textContent = '걸린 상태 없음';
    host.appendChild(none);
  }
  return count;
}

function spanOf(className: string, text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
