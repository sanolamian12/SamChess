/**
 * 장수 정보 팝업 — 보드에서 기물을 누르면 뜬다 (GDD §3.9 「정찰」, 기획 pptx 25쪽)
 *
 * **내 차례든 아니든, 아군이든 적군이든 볼 수 있다.** 타일 배지는 버프·디버프 개수만
 * 점으로 알려 주므로(상태가 22종이라 셀에 이름이 안 들어간다), "저 적에게 뭐가 걸렸나"를
 * 확인할 통로가 따로 필요하다. 하단 제어 패널은 제어권을 쥔 유닛만 보여 준다.
 *
 * **체스판 영역 안에 뜬다** (pptx 25쪽) — 화면이 세로로 긴 모바일 기준이라 판 바깥에는
 * 이만한 것을 놓을 자리가 없다. 판을 잠깐 가리는 편이 낫다고 보고 그렇게 정했다.
 *
 * 읽기 전용이다 — 여기서는 아무 의도도 만들지 않는다. 공격·책략 대상 지정은
 * 제어 패널의 조준 흐름이 맡는다.
 */

import type { BattleState, UnitId, UnitState } from '@samchess/rules';
import { officerById, skillById, tacticById } from '@samchess/data';
import { setOfficerArt } from './art.ts';
import { renderStatusChips } from './statusChips.ts';
import type { StatusPopup } from './statusPopup.ts';

export class InspectPanel {
  private unitId: UnitId | null = null;
  private lastKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tip: StatusPopup,
    onClose: () => void,
  ) {
    root.replaceChildren();
    root.classList.add('hidden');
    // 바깥 클릭으로도 닫히지만(씬이 빈 칸 클릭을 알려 준다) 닫기 단추가 있어야 헤매지 않는다
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.action === 'closeInspect') onClose();
    });
    // Esc는 제어 모달의 「취소」와 겹치는데, 팝업이 열려 있을 때는 이쪽이 먼저 닫힌다.
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
      + `|${unit.control ? `${unit.control.by}:${unit.control.uses}` : ''}|${state.time}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.classList.remove('hidden');
    this.root.replaceChildren(...this.build(state, unit));
  }

  private build(state: BattleState, unit: UnitState): HTMLElement[] {
    const officer = officerById.get(unit.officer)!;
    const out: HTMLElement[] = [];

    // ── 머리 — 초상화 + 이름 + 급/레벨 ──
    const head = el('div', 'ins-head');
    head.dataset.side = unit.side;
    const img = document.createElement('img');
    img.alt = officer.name;
    img.className = 'ins-portrait';
    // 수묵화 → 타일 초상화 → 빈자리 순으로 물러난다. 그림은 리포에 없다(기획자 방침).
    setOfficerArt(img, unit.officer);
    const title = el('div', 'ins-title');
    title.append(
      spanOf('nm', `${officer.name} [${unit.piece}]`),
      spanOf('grade', `${officer.grade}${unit.level}`),
      spanOf('side', unit.side === 'P1' ? '아군' : '적군'),
    );
    const close = document.createElement('button');
    close.className = 'ins-close';
    close.textContent = '×';
    close.dataset.action = 'closeInspect';
    close.title = '닫기 (Esc)';
    head.append(img, title, close);
    out.push(head);

    // ── 능력치 ──
    const stats = el('div', 'ins-stats');
    stats.append(
      statOf('HP', `${unit.hp}/${unit.maxHp}`, 'hp'),
      statOf('MP', `${unit.mp}/${unit.maxMp}`, 'mp'),
      statOf('AT', String(unit.at), 'at'),
      statOf('무력', String(officer.might)),
      statOf('지력', String(officer.intellect)),
      statOf('통솔', String(officer.leadership)),
      statOf('WT', `${unit.wt}/${unit.wtBase}`),
    );
    out.push(stats);

    // ── 고유기술 ──
    const skill = officer.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
    if (skill) {
      const box = el('div', 'ins-skill');
      box.dataset.state = unit.uniqueSkillUses > 0 ? 'ready' : 'used';
      const line = el('div', 'sk-head');
      line.append(
        spanOf('nm', `「${skill.name}」`),
        spanOf('sp', `SP ${skill.spCost}`),
        spanOf('mark', unit.uniqueSkillUses > 0 ? '사용 가능' : '사용함'),
      );
      box.append(line, elText('div', 'sk-text', skill.text));
      out.push(box);
    }

    // ── 습득 책략 ──
    if (unit.tactics.length > 0) {
      const box = el('div', 'ins-tactics');
      box.append(elText('div', 'cap', `책략 ${unit.tactics.length}종`));
      const row = el('div', 'row');
      for (const id of unit.tactics) {
        const def = tacticById.get(id);
        if (!def) continue;
        const chip = elText('span', `chip ${def.school}`, def.name);
        chip.title = `Lv${def.level} · MP ${def.mpCost} — ${def.text}`;
        row.append(chip);
      }
      box.append(row);
      out.push(box);
    }

    // ── 걸려 있는 상태 — 누르면 뜻을 설명한다 (제어 패널 넷째 줄과 같은 배지다) ──
    const statuses = el('div', 'ins-status');
    renderStatusChips(statuses, state, unit, this.tip);
    out.push(statuses);

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
