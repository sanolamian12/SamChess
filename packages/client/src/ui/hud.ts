/**
 * 상단 HUD — 절대시간 · SP · 고유기술 현황 (GDD §3.10 「상시 표시」)
 *
 * 1차에서는 한 줄짜리 텍스트였다. 그걸로는 **"왜 저 유닛 차례인가"를 판단할 수 없다** —
 * CTB의 핵심 지표인 SP와 WT가 화면에 없었기 때문이다. WT는 유닛 타일이 맡고,
 * 여기서는 진영 단위 정보(시계 · SP · 누가 무슨 고유기술을 쥐고 있나)를 맡는다.
 *
 * DOM으로 두는 이유는 `actionBar.ts`와 같다 — Phaser 텍스트는 카메라 줌에 함께
 * 확대·축소돼 읽을 수 없고, 기술 스택상 UI는 원래 DOM(React) 담당이다.
 *
 * **판정은 하지 않는다.** SP가 모자라는지, 이미 썼는지는 상태를 그대로 읽어 보여줄 뿐이고,
 * 실제로 쓸 수 있는지는 시전 UI를 붙일 때 `validate()`에 묻는다.
 */

import { officerById, skillById } from '@samchess/data';
import type { BattleState, Side, UnitState } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';

const PHASE_LABEL: Record<PlaybackPhase, string> = {
  advancing: '시간 진행',
  awaitingInput: '내 차례',
  aiThinking: '상대 차례',
  finished: '종료',
};

/** 고유기술 한 줄의 상태 — 스타일과 1:1로 대응한다 */
type SkillRowState = 'ready' | 'poor' | 'used' | 'dead';

interface SkillRow {
  unit: UnitState;
  el: HTMLElement;
  stateEl: HTMLElement;
  last: string;
}

export class Hud {
  private clockEl!: HTMLElement;
  private phaseEl!: HTMLElement;
  private whoEl!: HTMLElement;
  private outcomeEl!: HTMLElement;
  private pips: Record<Side, HTMLElement[]> = { P1: [], P2: [] };
  private spNum: Record<Side, HTMLElement> = {} as Record<Side, HTMLElement>;
  private skillRows: SkillRow[] = [];
  private lastTop = '';

  constructor(private readonly root: HTMLElement, state: BattleState, humanSide: Side | null) {
    root.replaceChildren();
    root.appendChild(this.buildTop());
    root.appendChild(this.buildSp(state, humanSide));
    root.appendChild(this.buildSkills(state));
  }

  // ── 골격 ─────────────────────────────────────────────────────

  private buildTop(): HTMLElement {
    const top = el('div', 'hud-top');
    this.clockEl = el('span', 'clock');
    this.phaseEl = el('span', 'phase');
    this.whoEl = el('span', 'who');
    this.outcomeEl = el('span', 'outcome');
    top.append(this.clockEl, this.phaseEl, this.whoEl, this.outcomeEl);
    return top;
  }

  /**
   * SP를 게이지가 아니라 **칸(pip)으로** 그린다. 코스트가 B4/A5/S6/E7로 전부 한 자리라
   * "지금 몇 개 모였고 몇 개 더 필요한가"를 눈으로 세는 편이 훨씬 빠르다.
   */
  private buildSp(state: BattleState, humanSide: Side | null): HTMLElement {
    const wrap = el('div', 'hud-sp');
    for (const side of ['P1', 'P2'] as Side[]) {
      const row = el('div', `sp ${side.toLowerCase()}`);
      if (side === humanSide) row.classList.add('mine');
      row.appendChild(el('span', 'tag', side === humanSide ? `${side} (나)` : side));

      const pips = el('span', 'pips');
      this.pips[side] = Array.from({ length: state.spCap[side] }, () => {
        const pip = el('i', 'pip');
        pips.appendChild(pip);
        return pip;
      });
      row.appendChild(pips);

      this.spNum[side] = el('span', 'num');
      row.appendChild(this.spNum[side]);
      wrap.appendChild(row);
    }
    return wrap;
  }

  /**
   * 고유기술을 가진 유닛만 줄로 세운다 (S/A/B/E급 — C·D급은 애초에 없다).
   * 편성은 전투 중에 바뀌지 않으므로 줄은 한 번만 만들고 상태만 갱신한다.
   */
  private buildSkills(state: BattleState): HTMLElement {
    const wrap = el('div', 'hud-skills');
    for (const side of ['P1', 'P2'] as Side[]) {
      const col = el('div', `side ${side.toLowerCase()}`);
      for (const unit of Object.values(state.units)) {
        if (unit.side !== side) continue;
        const officer = officerById.get(unit.officer);
        const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
        if (!officer || !skill) continue;

        const row = el('div', 'skill');
        row.title = `${skill.name}(${skill.hanja}) — ${skill.text}`;
        row.append(
          el('span', 'cost', String(skill.spCost)),
          el('span', 'name', skill.name),
          el('span', 'owner', `${officer.name}·${unit.piece[0]}`),
        );
        const stateEl = el('span', 'mark');
        row.appendChild(stateEl);
        col.appendChild(row);
        this.skillRows.push({ unit, el: row, stateEl, last: '' });
      }
      if (col.childElementCount > 0) wrap.appendChild(col);
    }
    return wrap;
  }

  // ── 갱신 ─────────────────────────────────────────────────────

  /**
   * 매 프레임 불린다. `displayTime`은 권위 상태의 `time`이 아니라 **화면이 따라잡은 시각**이다
   * (`Playback` 참조) — 시계가 실제로 흐르는 것처럼 보여야 하므로 이쪽을 쓴다.
   */
  refresh(state: BattleState, displayTime: number, phase: PlaybackPhase): void {
    // GDD §3.3 — UI는 0.1일(= time 10) 단위로 증가를 보여준다
    const day = (Math.floor(displayTime / 10) / 10).toFixed(1);
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const who = unit
      ? `${officerById.get(unit.officer)?.name ?? unit.officer} · ${unit.piece}`
      : '—';
    const outcome = state.phase === 'finished'
      ? (state.winner ? `${state.winner} 승 (${state.outcome})` : '무승부')
      : '';

    // 시계는 초당 10번 바뀐다. 실제로 글자가 달라질 때만 DOM을 건드린다.
    const key = `${day}|${phase}|${who}|${outcome}|${state.sp.P1}|${state.sp.P2}`;
    if (key !== this.lastTop) {
      this.lastTop = key;
      this.clockEl.textContent = `${day}일`;
      this.phaseEl.textContent = PHASE_LABEL[phase];
      this.phaseEl.className = `phase ${phase}`;
      this.whoEl.textContent = who;
      this.outcomeEl.textContent = outcome;
      this.root.classList.toggle('over', state.phase === 'finished');
      this.syncSp(state);
    }
    this.syncSkills(state);
  }

  private syncSp(state: BattleState): void {
    for (const side of ['P1', 'P2'] as Side[]) {
      const sp = state.sp[side];
      this.pips[side].forEach((pip, i) => pip.classList.toggle('on', i < sp));
      this.spNum[side]!.textContent = `${sp}/${state.spCap[side]}`;
    }
  }

  private syncSkills(state: BattleState): void {
    for (const row of this.skillRows) {
      // 유닛 객체는 상태가 갱신될 때마다 새로 만들어진다(구조적 복사) — id로 다시 찾는다
      const unit = state.units[row.unit.id]!;
      const officer = officerById.get(unit.officer)!;
      const skill = skillById.get(officer.uniqueSkill!)!;

      const s: SkillRowState = !unit.alive ? 'dead'
        : unit.uniqueSkillUses <= 0 ? 'used'
        : state.sp[unit.side] < skill.spCost ? 'poor'
        : 'ready';
      // 조종당하는 중이라도 스킬 소유는 그대로다 — 여기서는 보유 현황만 보여준다
      const mark = { ready: '●', poor: '○', used: '✔', dead: '✕' }[s];
      const key = `${s}|${state.activeUnit === unit.id}`;
      if (key === row.last) continue;
      row.last = key;

      row.el.className = `skill ${s}`;
      if (state.activeUnit === unit.id) row.el.classList.add('active');
      row.stateEl.textContent = mark;
    }
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
