/**
 * 장수 카드 — pptx 105쪽 (2026-10-09 기획자 확정, 97 · 98쪽의 글자 카드를 갈음한다)
 *
 * ```
 *   (엠블럼)(엠블럼)(엠블럼)(엠블럼)(엠블럼)(엠블럼)   ← 위 테에 박힌 걸린 상태. 6개 넘으면 1 · 6번이 ← · →
 *  ┌──────────────────────────────────────┐
 *  │ ┌────────┐        감녕                │
 *  │ │ 초상    │   [룩] (S)  Lv1            │   ← 기물 · 등급 그림
 *  │ └────────┘                            │
 *  │ (칼)   91   │ HP [■■■■■■■ 10/10]      │   ← 무 · 지 · 통은 그림, HP · MP는 막대
 *  │ (책)   54   │ MP [■■■■■■■  5/5]       │
 *  │ (투구) 84   │ AT            2-4       │   ← 평타-크리티컬 (28쪽 표기, 엔진의 `attackRange`)
 *  │ [ 고유기술 라벨 (네온) ]       SP 6     │   ← 눌러서 고유기술 팝업(영상 없음). SP 색 = 상태
 *  └──────────────────────────────────────┘
 * ```
 *
 * **글자를 그림으로 바꾼 이유** — 다국어에서 낱말 길이가 달라 줄이 넘치고 칸에 세로 스크롤이 생겼다(기획자).
 * 남은 글자는 이름 · 숫자 · HP/MP/AT · Lv · SP뿐이고 모두 언어에 따라 길이가 안 변한다.
 *
 * **하나를 네 곳에서 쓴다** — 적 차례의 왼쪽 판(지금 차례인 적) · 오른쪽 판(지목된 대상) · 내 차례의 오른쪽 판(지금 차례 장수) ·
 * 판의 장수를 누르면 뜨는 장수 팝업. 그래서 넷이 언제나 같은 꼴이다(2026-10-09 「통일」 지정).
 * 능력치는 부상을 반영한 `officerStats`, AT는 `attackRange`, 고유기술 상태는 `skillStatus` — 화면이 다시 계산하지 않는다.
 *
 * 읽기 전용이다 — 여기서는 아무 의도도 만들지 않는다.
 */

import { attackRange, officerStats, skillStatus } from '@samchess/rules';
import type { BattleState, Side, UnitState } from '@samchess/rules';
import { combatantById, skillById } from '@samchess/data';
import { setOfficerArt, skillArtUrl } from './art.ts';
import { gradeBadge } from './grade.ts';
import { pieceArtUrl } from './pieceIcon.ts';
import { auraKey, statusEntries, type StatusEntry } from './statusChips.ts';
import type { StatusPopup } from './statusPopup.ts';
import { currentLang, t } from '../i18n/index.ts';
import { pickOfficerName, pickSkillName } from '../i18n/story.ts';

/** 엠블럼 자리 수 — 넘치면 1 · 6번 자리가 화살표가 되고 가운데 넷이 한 쪽이다 (105쪽) */
const SLOTS = 6;
const PER_PAGE = SLOTS - 2;

/**
 * 카드가 판 밖의 것을 알아야 하는 둘 — 씬이 한 번 정한다.
 *  · `humanSide` — 기물 그림의 아군/적군 색
 *  · `openSkill` — 고유기술 라벨을 누르면 여는 고유기술 팝업(발동 영상 없음, 배치 화면의 라벨과 같은 창)
 * 네 곳의 생성자로 하나씩 실어 나르면 한 곳만 빠져도 조용히 다르게 그린다 — 그래서 여기 한 곳에 둔다.
 */
let viewer: Side | null = 'P1';
let openSkill: ((skillId: string) => void) | null = null;
export function configureOfficerCard(opts: { humanSide: Side | null; openSkill: (skillId: string) => void }): void {
  viewer = opts.humanSide;
  openSkill = opts.openSkill;
}

/** 장수마다 보고 있는 엠블럼 쪽 — 카드가 다시 그려져도(HP가 바뀌어도) 넘겨 둔 쪽이 유지된다 */
const pageOf = new Map<string, number>();

/** 카드가 바뀌었는가를 가르는 열쇠 — 판들이 매 프레임 DOM을 갈아엎지 않게 */
export function officerCardKey(state: BattleState, unit: UnitState): string {
  return `${unit.id}|${unit.hp}|${unit.maxHp}|${unit.mp}|${unit.maxMp}|${unit.at}|${unit.alive}`
    + `|${unit.statuses.map((s) => `${s.status}:${s.expiresAt ?? ''}:${s.charges ?? ''}`).join(',')}`
    + `|${unit.control ? `${unit.control.by}:${unit.control.uses}` : ''}`
    + `|${skillStatus(state, unit.id)}|${auraKey(state, unit)}|${currentLang()}`;
}

export function renderOfficerCard(state: BattleState, unit: UnitState, tip: StatusPopup): HTMLElement {
  const officer = combatantById.get(unit.officer)!;
  const card = el('div', 'oc');
  card.dataset.unit = unit.id;      // 스모크가 이것으로 「누구의 카드인가」를 본다
  card.dataset.side = unit.side;

  // ── 위 테의 엠블럼 ──
  const emblems = el('div', 'oc-emblems');
  paintEmblems(emblems, unit.id, statusEntries(state, unit), tip);

  // ── 초상(금빛 밧줄 액자) + 이름 · [기물] [등급] Lv ──
  const top = el('div', 'oc-top');
  const frame = el('div', 'oc-frame');
  const img = document.createElement('img');
  img.className = 'oc-portrait';
  img.alt = pickOfficerName(officer);
  setOfficerArt(img, unit.officer);
  frame.append(img);
  const id = el('div', 'oc-id');
  const head = el('div', 'oc-head');
  const piece = document.createElement('img');
  piece.className = 'oc-piece';
  piece.dataset.piece = unit.piece;
  piece.alt = unit.piece;
  piece.title = unit.piece;
  piece.src = pieceArtUrl(unit.piece, viewer === null ? unit.side === 'P1' : unit.side === viewer);
  head.append(piece, gradeBadge(officer.grade), text('span', 'oc-lv', `Lv${unit.level}`));
  id.append(text('div', 'oc-name', pickOfficerName(officer)), head);
  top.append(frame, id);

  // ── 무 · 지 · 통(그림) | HP · MP 막대 · AT ──
  const s = officerStats(unit);
  const base = el('div', 'oc-base');
  base.append(
    icon('might', t('oc.might'), s.might), icon('intellect', t('oc.intellect'), s.intellect),
    icon('leadership', t('oc.leadership'), s.leadership),
  );
  const at = attackRange(state, unit.id);
  const vitals = el('div', 'oc-vitals');
  vitals.append(
    bar('hp', 'HP', unit.hp, unit.maxHp),
    bar('mp', 'MP', unit.mp, unit.maxMp),
    stat('at', 'AT', `${at.min}-${at.max}`),
  );
  const mid = el('div', 'oc-mid');
  mid.append(base, vitals);

  // 속 상자 — 여백 · 간격을 카드 폭(`cqw`)으로 잡으려면 카드(크기 기준 상자) **안쪽**에 있어야 한다(자기 여백의 cqw는 바깥 기준을 본다)
  const inner = el('div', 'oc-in');
  inner.append(top, mid, skillRow(state, unit));
  card.append(emblems, inner);
  return card;
}

/**
 * 엠블럼 줄 — 여섯 자리. 넘치면 1번 · 6번이 ← · →(`btn-backarrow.png`, →는 뒤집은 것)이고 가운데 넷이 한 쪽이다.
 * 끝 쪽에서는 그쪽 화살표가 흐려진다. 누르면 줄만 다시 그린다 — 카드 전체를 다시 그리면 말풍선이 닫힌다.
 */
function paintEmblems(host: HTMLElement, unitId: string, entries: StatusEntry[], tip: StatusPopup): void {
  const pages = entries.length > SLOTS ? Math.ceil(entries.length / PER_PAGE) : 1;
  const page = Math.min(pageOf.get(unitId) ?? 0, pages - 1);
  const shown = pages === 1 ? entries : entries.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  host.dataset.count = String(entries.length);
  host.dataset.page = `${page + 1}/${pages}`;
  const arrow = (dir: -1 | 1): HTMLElement => {
    const b = document.createElement('button');
    b.className = `em-arrow ${dir < 0 ? 'prev' : 'next'}`;
    b.dataset.action = dir < 0 ? 'emblemPrev' : 'emblemNext';
    b.disabled = dir < 0 ? page === 0 : page === pages - 1;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pageOf.set(unitId, page + dir);
      paintEmblems(host, unitId, entries, tip);
    });
    return b;
  };
  const items = shown.map((entry) => {
    const b = document.createElement('button');
    b.className = `em ${entry.kind}`;
    b.dataset.status = entry.key;
    b.dataset.kind = entry.kind;
    b.title = entry.label;
    if (entry.icon) {
      b.style.backgroundImage = `url(${entry.icon})`;
    } else {
      // 임시 엠블럼 — 버프 금테 · 디버프 보라테 안에 건 장수의 초상 (그림을 받으면 `EMBLEM`에 더한다)
      b.classList.add('em-temp');
      if (entry.portrait) {
        const face = document.createElement('img');
        face.alt = '';
        setOfficerArt(face, entry.portrait as never);
        b.append(face);
      }
    }
    b.addEventListener('click', (e) => { e.stopPropagation(); entry.explain(tip); });
    return b;
  });
  host.replaceChildren(...(pages === 1 ? items : [arrow(-1), ...items, arrow(1)]));
}

/** 고유기술 라벨 + SP — 상태 = 엔진의 `skillStatus`. 라벨의 네온은 순서 판과 같은 규칙, SP 글자색은 105쪽 */
function skillRow(state: BattleState, unit: UnitState): HTMLElement {
  const officer = combatantById.get(unit.officer)!;
  const skill = officer.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
  if (!skill) {
    // 고유기술이 없는 장수(C · D급 · 도적) — 자리는 남겨 카드 높이가 장수마다 흔들리지 않게 한다
    const none = el('div', 'oc-skill oc-noskill');
    none.dataset.state = 'none';
    none.textContent = '—';
    return none;
  }
  const status = skillStatus(state, unit.id);
  const row = el('div', 'oc-skill');
  row.dataset.state = status;
  row.dataset.skill = skill.id;
  row.dataset.tier = skill.tier;
  const label = document.createElement('button');
  label.className = 'oc-label';
  label.title = `「${pickSkillName(skill)}」`;
  const art = document.createElement('img');
  art.alt = pickSkillName(skill);
  art.src = skillArtUrl(skill.id);
  // 라벨 그림이 없으면 기술 이름 글자로 물러난다(배치 화면의 고유기술 패널과 같은 규약)
  art.addEventListener('error', () => { label.dataset.noart = ''; label.textContent = `「${pickSkillName(skill)}」`; });
  label.append(art);
  label.addEventListener('click', (e) => { e.stopPropagation(); openSkill?.(skill.id); });
  row.append(label, text('span', 'oc-sp', `SP ${skill.spCost}`));
  return row;
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

function stat(kind: string, label: string, value: string): HTMLElement {
  const wrap = el('div', `oc-stat ${kind}`);
  wrap.append(text('i', '', label), text('b', '', value));
  return wrap;
}

/** HP · MP — 막대 위에 「지금/최대」. 빈 쪽 색(HP 빨강 · MP 회색)이 깎인 양이다 (105쪽) */
function bar(kind: 'hp' | 'mp', label: string, now: number, max: number): HTMLElement {
  const wrap = stat(kind, label, `${now}/${max}`);
  const track = el('span', 'oc-bar');
  const fill = el('span', 'oc-fill');
  fill.style.width = `${max > 0 ? Math.max(0, Math.min(1, now / max)) * 100 : 0}%`;
  track.append(fill);
  wrap.querySelector('b')!.before(track);
  track.append(wrap.querySelector('b')!);
  return wrap;
}

/** 무 · 지 · 통 — 낱말 대신 그림(`icons/stat-*.png`, 장수 일람과 같은 것). 이름은 툴팁 */
function icon(kind: 'might' | 'intellect' | 'leadership', name: string, value: number): HTMLElement {
  const wrap = el('div', `oc-ab ${kind}`);
  wrap.title = name;
  const img = document.createElement('img');
  img.src = `icons/stat-${kind}.png`;
  img.alt = name;
  wrap.append(img, text('b', '', String(value)));
  return wrap;
}
