/**
 * 걸려 있는 버프·디버프의 목록 — 장수 패널이 **엠블럼**으로 그린다 (pptx 22쪽 → 105쪽, 2026-10-09에 글자 배지에서 바꿨다).
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
import type { ActiveAura, ActiveStatus, BattleState, UnitState } from '@samchess/rules';
import { combatantById, skillById } from '@samchess/data';
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

/**
 * 걸린 것 하나 — 장수 패널 위 테의 엠블럼 한 개 (pptx 105쪽, 2026-10-09).
 * `icon`이 있으면 책략 엠블럼 그림(`icons/emblem-{책략id}.png`), 없으면 **임시 엠블럼** — 등급 테 안에 건 장수의 초상
 * (`portrait`). 고유기술이 거는 상태 17종은 아직 그림이 없다(프롬프트를 드렸다).
 */
export interface StatusEntry {
  /** 스모크가 읽는다 — 상태 id · `aura:{상태}` · `control` */
  key: string;
  kind: 'buff' | 'debuff';
  label: string;
  icon?: string | undefined;
  portrait?: string | undefined;
  /** 누르면 말풍선 — 효과 설명과 남은 시간 */
  explain(tip: StatusPopup): void;
}

/**
 * 상태 → 그 상태를 거는 책략의 엠블럼. **상태 단위**로 고른다 — 같은 상태를 고유기술이 걸어도 같은 그림이다
 * (「공포」를 책략이 걸든 고유기술이 걸든 받는 쪽에게는 같은 일이다). 지속 피해는 주기로 탈진(200) · 질병(100)을 가른다.
 */
const EMBLEM: Partial<Record<string, string>> = {
  outgoingDamageHalf: 'gong-po', silence: 'chim-muk',
  critical100: 'jeung-pok', incomingDamageHalf: 'ban-gam', illusionImmune: 'gyeol-gye',
};
export const emblemUrl = (tacticId: string): string => `icons/emblem-${tacticId}.png`;

function emblemFor(s: ActiveStatus): string | undefined {
  if (s.status === 'dot') return s.magnitudePct === undefined ? (s.period === 100 ? 'jil-byeong' : 'tal-jin') : undefined;
  return EMBLEM[s.status];
}

export function statusEntries(state: BattleState, unit: UnitState): StatusEntry[] {
  const out: StatusEntry[] = [];

  for (const s of unit.statuses) {
    const label = statusLabel(s.status);
    const remain = s.expiresAt !== undefined ? Math.max(0, s.expiresAt - state.time) : 0;
    // 탈진·질병은 해제 전까지 영구다 (GDD §3.7) — 남은 시간이 아니라 「풀릴 때까지」로 적는다
    const detail = s.expiresAt !== undefined ? t('chip.remainTime', { n: remain })
      : s.charges !== undefined ? t('chip.remainUses', { n: s.charges })
      : t('chip.untilCleansed');
    const icon = emblemFor(s);
    out.push({
      key: s.status, kind: statusKind(s.status), label,
      icon: icon ? emblemUrl(icon) : undefined,
      portrait: icon ? undefined : state.units[s.sourceUnit ?? unit.id]?.officer ?? unit.officer,
      explain: (tip) => tip.show(s.status, detail),
    });
  }

  // ── 오라 — 이 유닛에는 흔적이 없다. 엔진에 물어서 채운다. 그림은 오라를 켠 장수 ──
  for (const aura of aurasOn(state, unit.id)) {
    const info = auraInfo(state, aura);
    out.push({
      key: `aura:${aura.status}`, kind: aura.kind, label: info.owner,
      portrait: state.units[aura.source]?.officer,
      explain: (tip) => tip.showRaw(aura.kind, t('chip.aura.title', { who: info.owner }), info.text,
        t('chip.aura.detail', { who: info.owner, n: aura.radius })),
    });
  }

  if (unit.control) {
    const control = unit.control;
    const byOfficer = combatantById.get(state.units[control.by]?.officer ?? '');
    const by = byOfficer ? pickOfficerName(byOfficer) : '?';
    const permanent = control.uses === null;
    const moveOnly = control.mode === 'moveOnly';
    const label = t(moveOnly ? 'chip.control.moveOnly' : 'chip.control');
    const desc = t(moveOnly ? 'chip.control.desc.moveOnly' : 'chip.control.desc.moveAndAttack');
    out.push({
      key: 'control', kind: 'debuff', label,
      // 「유인」 · 「초선」은 책략 그림, 영구 조종(유비 「삼고초려」)은 건 장수의 초상
      icon: permanent ? undefined : emblemUrl(moveOnly ? 'yu-in' : 'cho-seon'),
      portrait: permanent ? state.units[control.by]?.officer : undefined,
      explain: (tip) => tip.showRaw('debuff', label, desc,
        permanent ? t('chip.control.byPermanent', { who: by })
          : t('chip.control.byTurns', { who: by, n: control.uses! })),
    });
  }
  return out;
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
  const officer = source ? combatantById.get(source.officer) : undefined;
  const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
  const owner = officer ? pickOfficerName(officer) : '?';
  const effect = auraText(aura.status) ?? statusDesc(aura.status);
  return {
    owner,
    text: skill ? t('chip.aura.bySkill', { skill: pickSkillName(skill), effect }) : effect,
  };
}
