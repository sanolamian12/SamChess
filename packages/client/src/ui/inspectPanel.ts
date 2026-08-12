/**
 * 상태 팝업 — 기물이나 카드를 누르면 뜬다 (기획 pptx 28쪽)
 *
 * ```
 *  ┌──────────────────────────┐   커맨드 패널의 **좌우 대칭 자리**에 선다.
 *  │ ┌──────┐  [S]         [×] │   자리는 `ui/panelSlot.ts`가 정한다.
 *  │ │ 사진  │  Rock  아군      │
 *  │ │ 절반  │  감녕  Lv1       │   ← 사진은 패널 너비의 **절반인 정사각**이고
 *  │ └──────┘                  │      오른쪽 세 줄이 그 높이를 나눠 쓴다
 *  │ 무력 91 · 지력 54 · 통솔 84 │   ← 한 줄을 다 쓴다
 *  ├──────────────────────────┤
 *  │ HP 50/50        AT 2      │
 *  │ MP  5/5         WT 90     │
 *  ├──────────────────────────┤
 *  │ 「백보천양」 (6)             │ ← 누르면 설명. SP는 숫자만
 *  ├──────────────────────────┤
 *  │ 공포 200  침묵 120           │ ← 걸려 있는 버프/디버프
 *  ├──────────────────────────┤
 *  │ 습득 책략 …                 │ ← **우리편 카드에서만** (28쪽)
 *  └──────────────────────────┘
 * ```
 *
 * **등급은 맨 위 왼쪽에 오고 색으로 구분한다** (2026-08-12 기획자 지정) —
 * `S 보라 · A 빨강 · B 파랑 · C 초록 · D 회색 · E 황금`. 색의 단일 출처는
 * `style.css`의 `--grade-*`이고 카드 스트립·커맨드 패널·메타 화면이 같은 값을 쓴다 —
 * 같은 등급이 화면마다 다른 색이면 색으로 구분하는 의미가 없다.
 *
 * **적의 보유 책략은 보여주지 않는다 (전략적 목적, 28쪽).** 무슨 환술을 쥐고 있는지가
 * 그대로 보이면 대응이 뻔해진다. 고유기술은 그대로 보인다 — 그건 편성 단계에서 이미
 * 서로 아는 정보이고, 카드 스트립에도 이름이 떠 있다.
 *
 * **설명은 눌러야 뜬다** (28쪽 「클릭을 하면 설명 보여줌」). 고유기술도 책략도 이름만
 * 적고, 뜻은 `StatusPopup`이 맡는다 — 좁은 패널에 설명문을 다 펼치면 아무것도 안 읽힌다.
 *
 * 읽기 전용이다 — 여기서는 아무 의도도 만들지 않는다. 공격·책략 대상 지정은
 * 커맨드 패널의 조준 흐름이 맡는다.
 */

import type { BattleState, Side, UnitId, UnitState } from '@samchess/rules';
import { officerById, skillById, tacticById } from '@samchess/data';
import { setOfficerArt } from './art.ts';
import { auraKey, renderStatusChips } from './statusChips.ts';
import { applySlot, type Slot } from './panelSlot.ts';
import type { StatusPopup } from './statusPopup.ts';

export class InspectPanel {
  private unitId: UnitId | null = null;
  private lastKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tip: StatusPopup,
    /** 사람이 조작하는 진영. 「아군/적군」과 책략 공개 여부가 이걸로 갈린다 */
    private readonly humanSide: Side | null,
    onClose: () => void,
  ) {
    root.replaceChildren();
    root.classList.add('panel', 'hidden');
    // 바깥 클릭으로도 닫히지만(씬이 빈 칸 클릭을 알려 준다) 닫기 단추가 있어야 헤매지 않는다
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.action === 'closeInspect') onClose();
    });
    // Esc는 커맨드 패널의 「취소」와 겹치는데, 팝업이 열려 있을 때는 이쪽이 먼저 닫힌다.
    // 조준 중에 정보를 열어 봤다가 Esc를 누르면 조준까지 풀리는 게 더 놀랍기 때문이다.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.unitId) { e.stopImmediatePropagation(); onClose(); }
    }, true);
  }

  get shown(): UnitId | null { return this.unitId; }

  show(unitId: UnitId | null): void {
    if (this.unitId === unitId) return;
    this.unitId = unitId;
    this.lastKey = '';
  }

  /** 패널이 설 사분면. 커맨드 패널의 좌우 대칭 자리를 씬이 넘겨 준다. */
  place(slot: Slot): void {
    applySlot(this.root, slot);
  }

  /** 매 프레임 불린다. 열려 있는 동안 HP·상태가 실시간으로 따라간다. */
  refresh(state: BattleState): void {
    const unit = this.unitId ? state.units[this.unitId] : undefined;
    if (!unit || !unit.alive) {
      if (this.unitId) { this.unitId = null; this.lastKey = ''; }
      this.root.classList.add('hidden');
      return;
    }

    // 상태가 실제로 바뀔 때만 다시 그린다 (매 프레임 DOM을 갈아엎지 않는다)
    const key = `${unit.id}|${unit.hp}|${unit.mp}|${unit.at}|${unit.uniqueSkillUses}`
      + `|${unit.statuses.map((s) => `${s.status}:${s.expiresAt ?? ''}:${s.charges ?? ''}`).join(',')}`
      + `|${unit.control ? `${unit.control.by}:${unit.control.uses}` : ''}|${state.time}`
      // 오라는 이 유닛에 흔적이 없다 — 다른 유닛이 다가오면 표시가 늘어난다
      + `|${auraKey(state, unit)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.classList.remove('hidden');
    this.root.replaceChildren(...this.build(state, unit));
  }

  private build(state: BattleState, unit: UnitState): HTMLElement[] {
    const officer = officerById.get(unit.officer)!;
    // 관전(양쪽 AI)이면 「아군」이랄 것이 없다. 그때는 진영 이름을 그대로 적는다.
    const ours = this.humanSide !== null && unit.side === this.humanSide;
    const out: HTMLElement[] = [];

    // ── 머리 — 왼쪽에 정사각 사진, 오른쪽에 세 줄 (2026-08-12 기획자 지정 순서) ──
    const head = el('div', 'ins-head');
    head.dataset.side = unit.side;
    const img = document.createElement('img');
    img.alt = officer.name;
    img.className = 'ins-portrait';
    // 수묵화 → 타일 초상화 → 빈자리 순으로 물러난다. 그림은 리포에 없다(기획자 방침).
    setOfficerArt(img, unit.officer);

    const title = el('div', 'ins-title');
    // 1줄 — 등급(색으로 구분) + 닫기
    const line1 = el('div', 'row');
    const grade = elText('span', 'grade', officer.grade);
    grade.dataset.grade = officer.grade;
    const close = document.createElement('button');
    close.className = 'ins-close';
    close.textContent = '×';
    close.dataset.action = 'closeInspect';
    close.title = '닫기 (Esc)';
    line1.append(grade, close);
    // 2줄 — 기물명 + 아군/적군. 관전(양쪽 AI)이면 「아군」이랄 것이 없어 진영 이름을 쓴다
    const line2 = el('div', 'row');
    line2.append(
      spanOf('pc', unit.piece),
      spanOf('side', this.humanSide === null ? (unit.side === 'P2' ? '북군' : '남군') : ours ? '아군' : '적군'),
    );
    // 3줄 — 장수명 + 레벨
    const line3 = el('div', 'row');
    line3.append(spanOf('nm', officer.name), spanOf('lv', `Lv${unit.level}`));
    title.append(line1, line2, line3);

    head.append(img, title);
    out.push(head);
    // 무력·지력·통솔은 사진 아래에서 **한 줄을 다 쓴다**
    out.push(elText('div', 'ins-base',
      `무력 ${officer.might} · 지력 ${officer.intellect} · 통솔 ${officer.leadership}`));

    // ── 지금 상태 — 28쪽의 2×2 (HP·AT / MP·WT) ──
    const stats = el('div', 'ins-stats');
    stats.append(
      statOf('HP', `${unit.hp}/${unit.maxHp}`, 'hp'),
      statOf('AT', String(unit.at), 'at'),
      statOf('MP', `${unit.mp}/${unit.maxMp}`, 'mp'),
      statOf('WT', `${unit.wt}/${unit.wtBase}`),
    );
    out.push(stats);

    // ── 고유기술 — 이름과 SP만. 설명은 눌러야 뜬다 (28쪽) ──
    const skill = officer.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
    if (skill) {
      const box = document.createElement('button');
      box.className = 'ins-skill';
      box.dataset.state = unit.uniqueSkillUses > 0 ? 'ready' : 'used';
      box.dataset.skill = skill.id;
      // SP는 숫자만 (2026-08-12 기획자 지정) — 카드의 「고유기술명(6)」과 같은 표기다
      box.append(spanOf('nm', `${skill.name} (${skill.spCost})`));
      if (unit.uniqueSkillUses <= 0) box.append(spanOf('mark', '사용함'));
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        this.tip.showRaw('skill', `「${skill.name}」`, skill.text,
          `${skill.hanja} · SP ${skill.spCost}` + (unit.uniqueSkillUses > 0 ? '' : ' · 이미 사용함'));
      });
      out.push(box);
    }

    // ── 걸려 있는 상태 — 누르면 뜻을 설명한다 ──
    const statuses = el('div', 'ins-status');
    renderStatusChips(statuses, state, unit, this.tip);
    out.push(statuses);

    // ── 습득 책략 — **우리편 카드에서만** (28쪽, 전략적 목적) ──
    if (ours && unit.tactics.length > 0) {
      const box = el('div', 'ins-tactics');
      box.append(elText('div', 'cap', `책략 ${unit.tactics.length}종`));
      const row = el('div', 'row');
      for (const id of unit.tactics) {
        const def = tacticById.get(id);
        if (!def) continue;
        const chip = document.createElement('button');
        chip.className = `chip ${def.school}`;
        chip.dataset.tactic = id;
        chip.textContent = def.name;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          this.tip.showRaw('tactic', def.name, def.text, `Lv${def.level} · MP ${def.mpCost}`);
        });
        row.append(chip);
      }
      box.append(row);
      out.push(box);
    } else if (!ours) {
      out.push(elText('div', 'ins-hidden', '상대의 보유 책략은 보이지 않는다'));
    }

    return out;
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function elText(tag: string, className: string, text: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = text;
  return node;
}

const spanOf = (className: string, text: string): HTMLElement => elText('span', className, text);

function statOf(label: string, value: string, kind?: string): HTMLElement {
  const wrap = el('span', kind ? `stat ${kind}` : 'stat');
  wrap.append(elText('i', '', label), elText('b', '', value));
  return wrap;
}
