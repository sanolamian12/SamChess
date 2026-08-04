/**
 * 걸려 있는 버프·디버프를 **누를 수 있는 배지**로 그린다 (기획 pptx 22쪽 「내가 걸린 버프, 디버프들」).
 *
 * 하단 제어 패널의 넷째 줄과 기물 정보 팝업이 같은 것을 보여주므로 여기 한 곳에 둔다.
 * 배지에는 이름과 남은 길이만 적고, **누르면** `StatusPopup`이 뜻을 설명한다.
 * 마우스에서는 올리기만 해도 보이도록 `title`도 함께 단다 — 휴대폰에는 호버가 없어
 * 누르는 쪽이 본체이고, 호버는 덤이다.
 *
 * 배지의 출처는 셋이다.
 *  1. `unit.statuses` — 보통의 상태이상
 *  2. `unit.control`  — **조종**. 상태이상 배열이 아니라 별도 필드라 빠뜨리기 딱 좋다
 *  3. **오라** — 아예 이 유닛에 흔적이 없다. 시전자에게만 표식이 있고 거리를 그때그때
 *     재기 때문이다(GDD §12 A1). 엔진의 `aurasOn()`에 물어서 채운다.
 */

import { STATUS_META, aurasOn } from '@samchess/rules';
import type { ActiveAura, BattleState, UnitState } from '@samchess/rules';
import { officerById, skillById } from '@samchess/data';
import type { StatusPopup } from './statusPopup.ts';

/**
 * 오라가 **영향받는 쪽**에 무엇을 하는지.
 *
 * `STATUS_META`의 설명은 시전자 기준이다("반경 안의 적이 주는 데미지가 절반이 된다").
 * 여기서는 당하는 쪽 기준으로 다시 적는다 — 「내 공격력이 왜 절반이지?」에 답해야 하므로.
 */
const AURA_TEXT: Record<string, string> = {
  auraOutgoingHalf: '공격력이 절반이 됩니다.',
  auraIncomingHalf: '받는 피해가 절반이 됩니다.',
};

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
    const detail = s.expiresAt !== undefined ? `남은 시간 ${Math.max(0, s.expiresAt - state.time)}`
      : s.charges !== undefined ? `남은 횟수 ${s.charges}`
      : '해제되기 전까지 계속된다';

    const el = chip(host, `st ${meta.kind}`, meta.label, tail);
    el.dataset.status = s.status;
    el.title = `${meta.label} — ${meta.desc}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); tip.show(s.status, detail); });
    count++;
  }

  // ── 오라 — 이 유닛에는 흔적이 없다. 엔진에 물어서 채운다 ──
  for (const aura of aurasOn(state, unit.id)) {
    const info = auraInfo(state, aura);
    const el = chip(host, `st ${aura.kind} aura`, info.owner, `${aura.radius}칸`);
    el.dataset.status = `aura:${aura.status}`;
    el.dataset.source = aura.source;
    el.title = info.text;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      tip.showRaw(aura.kind, `${info.owner} — 오라`, info.text,
        `${info.owner}에게서 8방향 ${aura.radius}칸 안에 있는 동안 적용된다. 벗어나면 곧바로 풀린다.`);
    });
    count++;
  }

  if (unit.control) {
    const by = officerById.get(state.units[unit.control.by]?.officer ?? '')?.name ?? '?';
    const permanent = unit.control.uses === null;
    const label = unit.control.mode === 'moveOnly' ? '조종 — 이동만' : '조종';
    const desc = unit.control.mode === 'moveOnly'
      ? '적의 지시대로 움직인다. 이동만 할 수 있고 공격·책략·명상·고유기술은 쓸 수 없다.'
      : '적의 지시대로 움직인다. 이동과 공격을 적이 고르며, 제 편을 공격하게 된다.';

    const el = chip(host, 'st debuff', label, permanent ? '영구' : `${unit.control.uses}턴`);
    el.dataset.status = 'control';
    el.title = `${label} — ${desc}`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      tip.showRaw('debuff', label, desc,
        permanent ? `${by}에게 게임이 끝날 때까지 조종당한다` : `${by} · 남은 ${unit.control!.uses}턴`);
    });
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

/**
 * 화면 갱신 판단용 지문.
 *
 * 오라는 **다른 유닛이 움직이면** 붙었다 떨어졌다 한다 — 이 유닛의 상태는 하나도 안 바뀌는데
 * 표시는 바뀌어야 한다. 갱신 캐시 키에 이걸 섞지 않으면 배지가 늦게 따라온다.
 */
export const auraKey = (state: BattleState, unit: UnitState): string =>
  aurasOn(state, unit.id).map((a) => `${a.source}:${a.status}`).join(',');

/** 오라를 켠 장수 이름과, 당하는 쪽 기준의 설명문 */
function auraInfo(state: BattleState, aura: ActiveAura): { owner: string; text: string } {
  const source = state.units[aura.source];
  const officer = source ? officerById.get(source.officer) : undefined;
  const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
  const owner = officer?.name ?? '?';
  const effect = AURA_TEXT[aura.status] ?? STATUS_META[aura.status].desc;
  return {
    owner,
    text: skill ? `「${skill.name}」 효과로 ${effect}` : effect,
  };
}

function chip(host: HTMLElement, className: string, label: string, tail: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = className;
  el.append(spanOf('t', label), spanOf('d', tail));
  host.appendChild(el);
  return el;
}

function spanOf(className: string, text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
