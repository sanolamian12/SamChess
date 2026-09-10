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

import { aurasOn } from '@samchess/rules';
import type { ActiveAura, BattleState, UnitState } from '@samchess/rules';
import { officerById, skillById } from '@samchess/data';
import type { StatusPopup } from './statusPopup.ts';
import { t } from '../i18n/index.ts';
import { statusDesc, statusKind, statusLabel } from '../i18n/engineLabel.ts';
import { pickOfficerName, pickSkillName } from '../i18n/story.ts';

/**
 * 오라가 **영향받는 쪽**에 무엇을 하는지.
 *
 * 상태이상의 설명은 시전자 기준이다("반경 안의 적이 주는 데미지가 절반이 된다").
 * 여기서는 당하는 쪽 기준으로 다시 적는다 — 「내 공격력이 왜 절반이지?」에 답해야 하므로.
 */
function auraText(status: string): string | undefined {
  if (status === 'auraOutgoingHalf') return t('chip.aura.outgoingHalf');
  if (status === 'auraIncomingHalf') return t('chip.aura.incomingHalf');
  return undefined;
}

export function renderStatusChips(
  host: HTMLElement,
  state: BattleState,
  unit: UnitState,
  tip: StatusPopup,
): number {
  host.replaceChildren();
  let count = 0;

  for (const s of unit.statuses) {
    const label = statusLabel(s.status);
    const remain = s.expiresAt !== undefined ? Math.max(0, s.expiresAt - state.time) : 0;
    // 탈진·질병은 해제 전까지 영구다 (GDD §3.7) — 남은 시간이 아니라 ∞로 적는다
    const tail = s.expiresAt !== undefined ? String(remain)
      : s.charges !== undefined ? t('chip.charges', { n: s.charges })
      : t('chip.forever');
    const detail = s.expiresAt !== undefined ? t('chip.remainTime', { n: remain })
      : s.charges !== undefined ? t('chip.remainUses', { n: s.charges })
      : t('chip.untilCleansed');

    const el = chip(host, `st ${statusKind(s.status)}`, label, tail);
    el.dataset.status = s.status;
    el.title = t('chip.title', { label, desc: statusDesc(s.status) });
    el.addEventListener('click', (e) => { e.stopPropagation(); tip.show(s.status, detail); });
    count++;
  }

  // ── 오라 — 이 유닛에는 흔적이 없다. 엔진에 물어서 채운다 ──
  for (const aura of aurasOn(state, unit.id)) {
    const info = auraInfo(state, aura);
    const el = chip(host, `st ${aura.kind} aura`, info.owner, t('chip.aura.range', { n: aura.radius }));
    el.dataset.status = `aura:${aura.status}`;
    el.dataset.source = aura.source;
    el.title = info.text;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      tip.showRaw(aura.kind, t('chip.aura.title', { who: info.owner }), info.text,
        t('chip.aura.detail', { who: info.owner, n: aura.radius }));
    });
    count++;
  }

  if (unit.control) {
    const byOfficer = officerById.get(state.units[unit.control.by]?.officer ?? '');
    const by = byOfficer ? pickOfficerName(byOfficer) : '?';
    const permanent = unit.control.uses === null;
    const moveOnly = unit.control.mode === 'moveOnly';
    const label = t(moveOnly ? 'chip.control.moveOnly' : 'chip.control');
    const desc = t(moveOnly ? 'chip.control.desc.moveOnly' : 'chip.control.desc.moveAndAttack');

    const el = chip(host, 'st debuff', label,
      permanent ? t('chip.control.permanent') : t('chip.control.turns', { n: unit.control.uses! }));
    el.dataset.status = 'control';
    el.title = t('chip.title', { label, desc });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      tip.showRaw('debuff', label, desc,
        permanent ? t('chip.control.byPermanent', { who: by })
          : t('chip.control.byTurns', { who: by, n: unit.control!.uses! }));
    });
    count++;
  }

  // **없으면 아무것도 적지 않는다** (2026-08-13 기획자 지정). 「걸린 상태 없음」 한 줄이
  // 패널 아래 빈 공간을 붙들고 있었다 — 배지가 없으면 그만큼 패널이 줄어드는 편이 맞다.
  // 호출한 쪽이 개수를 보고 줄 자체를 접는다.
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
  const owner = officer ? pickOfficerName(officer) : '?';
  const effect = auraText(aura.status) ?? statusDesc(aura.status);
  return {
    owner,
    text: skill ? t('chip.aura.bySkill', { skill: pickSkillName(skill), effect }) : effect,
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
