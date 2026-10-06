/**
 * 장수 카드 — pptx 97 · 98쪽 (전투 UI 개편 4단계, 2026-10-06)
 *
 * ```
 *  ┌─────────────────────────────┐
 *  │ [Rock] [S] 감녕 Lv3          │
 *  │ ┌──────┐  HP  50/50          │
 *  │ │ 초상  │  AT  2-4            │   ← 평타-크리티컬 (28쪽 표기, 엔진의 `attackRange`)
 *  │ └──────┘  MP   5/5           │
 *  │ 무 91 · 지 54 · 통 84         │
 *  │ [공포 200] [침묵 120]          │   ← 걸린 상태. 누르면 설명
 *  └─────────────────────────────┘
 * ```
 *
 * **하나를 세 곳에서 쓴다** — 적 차례의 왼쪽 판(지금 차례인 적) · 오른쪽 판(지목된 대상) · 고유기술 물음 중의
 * 왼쪽 판(내 장수). 6단계의 장수 팝업(`ui/unitPopup.ts` — 판의 장수를 누르면)도 이것에 두 줄을 붙여 쓴다 — 옛 살펴보기
 * (`InspectPanel`)는 그때 걷었다. 속은 그 살펴보기의 그리기를 옮겨 왔다(능력치는 부상을 반영한 `officerStats`, AT는 `attackRange`).
 *
 * 읽기 전용이다 — 여기서는 아무 의도도 만들지 않는다.
 */

import { attackRange, officerStats } from '@samchess/rules';
import type { BattleState, UnitState } from '@samchess/rules';
import { combatantById } from '@samchess/data';
import { setOfficerArt } from './art.ts';
import { gradeBadge } from './grade.ts';
import { auraKey, renderStatusChips } from './statusChips.ts';
import type { StatusPopup } from './statusPopup.ts';
import { currentLang, t } from '../i18n/index.ts';
import { pickOfficerName } from '../i18n/story.ts';

/** 카드가 바뀌었는가를 가르는 열쇠 — 판들이 매 프레임 DOM을 갈아엎지 않게 */
export function officerCardKey(state: BattleState, unit: UnitState): string {
  return `${unit.id}|${unit.hp}|${unit.maxHp}|${unit.mp}|${unit.at}|${unit.alive}`
    + `|${unit.statuses.map((s) => `${s.status}:${s.expiresAt ?? ''}:${s.charges ?? ''}`).join(',')}`
    + `|${unit.control ? `${unit.control.by}:${unit.control.uses}` : ''}`
    + `|${auraKey(state, unit)}|${currentLang()}`;
}

export function renderOfficerCard(state: BattleState, unit: UnitState, tip: StatusPopup): HTMLElement {
  const officer = combatantById.get(unit.officer)!;
  const card = el('div', 'oc');
  card.dataset.unit = unit.id;      // 스모크가 이것으로 「누구의 카드인가」를 본다
  card.dataset.side = unit.side;

  // ── 1줄 — [기물] [등급] [이름 Lv] ──
  const head = el('div', 'oc-head');
  head.append(
    text('span', 'oc-piece', unit.piece),
    gradeBadge(officer.grade),
    text('span', 'oc-name', pickOfficerName(officer)),
    text('span', 'oc-lv', `Lv${unit.level}`),
  );

  // ── 초상 + HP/AT/MP ──
  const body = el('div', 'oc-body');
  const img = document.createElement('img');
  img.className = 'oc-portrait';
  img.alt = pickOfficerName(officer);
  setOfficerArt(img, unit.officer);
  const at = attackRange(state, unit.id);
  const stats = el('div', 'oc-stats');
  stats.append(
    stat('HP', `${unit.hp}/${unit.maxHp}`, 'hp'),
    stat('AT', `${at.min}-${at.max}`, 'at'),
    stat('MP', `${unit.mp}/${unit.maxMp}`, 'mp'),
  );
  body.append(img, stats);

  // ── 무 · 지 · 통 — 부상을 반영한 값(엔진이 쓰는 것과 같다) ──
  const s = officerStats(unit);
  const base = el('div', 'oc-base');
  base.append(
    stat(t('oc.might'), String(s.might)), stat(t('oc.intellect'), String(s.intellect)),
    stat(t('oc.leadership'), String(s.leadership)),
  );

  card.append(head, body, base);
  const chips = el('div', 'oc-status');
  if (renderStatusChips(chips, state, unit, tip) > 0) card.append(chips);
  return card;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function stat(label: string, value: string, kind?: string): HTMLElement {
  const wrap = el('span', kind ? `oc-stat ${kind}` : 'oc-stat');
  wrap.append(text('i', '', label), text('b', '', value));
  return wrap;
}
