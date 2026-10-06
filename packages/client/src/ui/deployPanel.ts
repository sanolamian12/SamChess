/**
 * 배치 · 정찰의 아래 칸 — pptx 90 · 91쪽 (전투 UI 개편 5단계, 2026-10-06)
 *
 * ```
 * ┌ #cmd — 고유기술 ──────────────┐┌ #ctx-prep ─────────────┐
 * │ 조운       SP 5 │ 곽가     SP 6 ││ 배치 26초               │
 * │ 「백마의종」     │ 「유언계책」   ││ 내 진영 안에서 …        │
 * │ 장비            │ 순욱     SP 4 ││                         │
 * │ —               │ 「…」         ││ [준비완료] [책략 확인]   │
 * └─────────────────┴───────────────┘└─────────────────────────┘
 *      아군 열(파랑)    적군 열(주황)
 * ```
 *
 * - **왼쪽 — 고유기술 목록**(`renderSkillRoster`, 명령 판이 배치 중에 그린다). 두 열은 **진영별**,
 *   한 줄은 **장수 이름 + 「기술명」 SP**(2026-10-06 기획자 확정). 누르면 설명(재생 없이 닫기만 — 순서 판 표시등과 같다).
 * - **오른쪽 — 배치 판**(`PrepPanel`, 옛 `prepPanel.ts`를 갈음). 배치 N초 · [준비완료] · [책략 확인].
 *   정찰도 같은 자리다 — [전투 시작]으로 바뀌고 시계는 마지막 5초만 센다(GDD §3.9).
 * - **[책략 확인] → 적 책략 팝업**(`IntelPopup`, 91쪽) — [장수][지력][책략목록], 책략을 누르면 설명 팝업이 하나 더.
 *   켜짐은 엔진의 `tacticsRevealed()` — **내 편에 척후기가 있는가**(2026-10-06 기획자 확정). 적 책략이
 *   실려 왔는가로 재면 Lv1 상대 앞에서 척후기를 들고도 꺼진다. 가리는 것은 화면이 아니라 전선이다(`toWire`).
 *
 * 모양은 맥락 판(`contextPanel.ts`)의 `.cx-*`를 그대로 쓴다 — 같은 아래 칸이 단계마다 다른 생김새가 되지 않게.
 * **남은 시간은 스스로 세지 않는다** — `Playback.remainingSec`을 읽기만 한다(온라인에서는 서버가 내려 준다).
 */

import { combatantById, skillById, tacticById } from '@samchess/data';
import { officerStats, SCOUT_COUNTDOWN_MS, tacticsRevealed } from '@samchess/rules';
import type { BattleState, Side, UnitState } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import {
  castDelayNote, pickOfficerName, pickSkillName, pickSkillText, pickTacticName, pickTacticText,
} from '../i18n/story.ts';
import type { StatusPopup } from './statusPopup.ts';

/** 배치 판이 서는 단계 — 이때 명령 판은 고유기술 목록, 맥락 판은 배치 판이다 */
export function isPrepPhase(phase: PlaybackPhase): boolean {
  return phase === 'deploying' || phase === 'scouting';
}

/** 사람 쪽이 없으면(관전 · 데모) 남군을 아군으로 — 순서 판과 같은 셈 */
function mineOf(humanSide: Side | null): Side {
  return humanSide ?? 'P1';
}

// ── 왼쪽 — 고유기술 목록 ─────────────────────────────────────────

/** 목록이 바뀌었는가를 가르는 열쇠 — 배치 중에는 장수가 안 바뀌므로 언어만 본다 */
export function skillRosterKey(state: BattleState): string {
  return `${Object.keys(state.units).join(',')}|${currentLang()}`;
}

export function renderSkillRoster(state: BattleState, humanSide: Side | null, tip: StatusPopup): HTMLElement[] {
  const title = el('div', 'cmd-title');
  title.textContent = t('sk.title');

  const grid = el('div', 'sk-grid');
  const mine = mineOf(humanSide);
  for (const side of [mine, mine === 'P1' ? 'P2' : 'P1'] as const) {
    const col = el('div', 'sk-col');
    col.dataset.side = side === mine ? 'mine' : 'foe';
    for (const unit of Object.values(state.units)) {
      if (unit.side === side) col.append(skillRow(unit, side === mine, tip));
    }
    grid.append(col);
  }
  return [title, grid];
}

function skillRow(unit: UnitState, mine: boolean, tip: StatusPopup): HTMLElement {
  const officer = combatantById.get(unit.officer);
  const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
  const name = officer ? pickOfficerName(officer) : unit.officer;

  const row = document.createElement('button');
  row.className = 'sk-row';
  row.dataset.unit = unit.id;        // 스모크가 이것으로 줄을 센다
  row.dataset.side = mine ? 'mine' : 'foe';
  row.dataset.skill = skill?.id ?? '';
  row.title = `${unit.piece} · ${name}`;
  // 1줄 = 장수 이름 · SP, 2줄 = 「기술명」 — 기술명이 칸 폭을 다 쓴다(한 줄에 몰면 700px에서 「십면…」으로 잘렸다)
  const head = el('span', 'sk-head');
  head.append(text('span', 'sk-name', name));
  if (skill) head.append(text('span', 'sk-sp', `SP ${skill.spCost}`));
  row.append(head);

  const line = el('span', 'sk-line');
  if (skill) {
    line.append(text('span', 'sk-skill', `「${pickSkillName(skill)}」`));
    row.addEventListener('click', () => tip.showRaw('skill', `「${pickSkillName(skill)}」`, pickSkillText(skill),
      t('ins.skillTail', { hanja: skill.hanja, sp: skill.spCost, delay: castDelayNote(skill) })));
  } else {
    // C·D급과 도적은 고유기술이 없다 — 줄은 남기고(진영의 인원이 보이게) 흐리게
    line.append(text('span', 'sk-skill', '—'));
    row.disabled = true;
  }
  row.append(line);
  return row;
}

// ── 오른쪽 — 배치 판 ─────────────────────────────────────────────

interface PrepHandlers {
  /** 배치를 마쳤다 */
  ready(): void;
  /** 정찰을 건너뛰고 전투를 시작한다 */
  begin(): void;
}

export class PrepPanel {
  private last = '';
  private readonly intel: IntelPopup;

  constructor(
    private readonly root: HTMLElement,
    intelRoot: HTMLElement,
    private readonly tip: StatusPopup,
    private readonly humanSide: Side | null,
    private readonly on: PrepHandlers,
  ) {
    root.replaceChildren();
    root.dataset.phase = '';
    this.intel = new IntelPopup(intelRoot, tip, humanSide);
  }

  /** @param remainingSec `Playback`이 준 남은 초. 배치 · 정찰이 아니면 `null` */
  refresh(state: BattleState, phase: PlaybackPhase, remainingSec: number | null): void {
    const on = isPrepPhase(phase);
    if (!on) {
      // 전투가 시작되면 팝업도 함께 걷는다 — 정찰 동안 열어 둔 채 시작을 누를 수 있다
      if (this.root.dataset.phase !== '') { this.root.dataset.phase = ''; this.root.replaceChildren(); this.last = ''; }
      this.intel.close();
      return;
    }

    const deploying = phase === 'deploying';
    const readyAlready = this.humanSide ? state.ready[this.humanSide] : true;
    // 정찰은 20초를 세되 **마지막 5초만** 숫자를 보여준다 (GDD §3.9)
    const showClock = deploying || (remainingSec !== null && remainingSec <= SCOUT_COUNTDOWN_MS / 1000);
    const clock = showClock && remainingSec !== null ? t('prep.seconds', { n: remainingSec }) : '';
    const revealed = this.humanSide !== null && tacticsRevealed(state, this.humanSide);

    // 언어도 키에 넣는다 (순서 판 · 카드와 같은 사정) — 안 넣으면 옛 언어로 남는다
    const key = `${phase}|${clock}|${readyAlready}|${revealed}|${this.intel.isOpen}|${currentLang()}`;
    if (key === this.last) return;
    this.last = key;

    // 대기(내가 먼저 준비를 마쳤다)는 배치 단계 안의 걸음이다 — 전선의 `waiting`이 재생기에서 `deploying`으로 온다
    this.root.dataset.phase = !deploying ? 'scouting' : readyAlready ? 'waiting' : 'deploying';

    const head = el('div', 'cx-q prep-head');
    head.append(text('span', 'prep-title', t(deploying ? 'prep.deploy' : 'prep.scout')));
    const clockEl = text('span', 'prep-clock', clock);
    clockEl.classList.toggle('urgent', remainingSec !== null && remainingSec <= 5);
    head.append(clockEl);

    const note = text('div', 'cx-text prep-note', deploying
      ? t(readyAlready ? 'prep.note.waiting' : 'prep.note.deploy')
      : t('prep.note.scout'));

    const go = button(deploying ? 'ready' : 'begin', t(deploying ? 'prep.ready' : 'prep.begin'), () => {
      if (deploying) this.on.ready(); else this.on.begin();
    }, 'go');
    go.disabled = deploying && readyAlready;

    const intel = button('intel', t('prep.intel'), () => this.intel.toggle(state));
    intel.disabled = !revealed;
    intel.classList.toggle('on', this.intel.isOpen);
    // 꺼진 이유를 적는다 — 「아이템이 있어야 켜진다」(91쪽)는 눌러 봐서는 모른다
    intel.title = revealed ? '' : t('prep.intel.off');

    const row = el('div', 'cx-buttons');
    row.append(go, intel);
    this.root.replaceChildren(head, note, row);
  }

  /** 적 책략 팝업을 닫는다 — 판 아무 데나 누르면 (6단계 확정 5). [책략 확인]의 켜짐 표시는 다음 `refresh()`가 맞춘다 */
  closeIntel(): void { this.intel.close(); }

  /** 팝업이 열렸는가 · 몇 줄인가 — 스모크용 */
  get debugIntel(): { open: boolean; rows: number } {
    return { open: this.intel.isOpen, rows: this.intel.rows };
  }
}

// ── [책략 확인] → 적 책략 팝업 (91쪽) ────────────────────────────

/**
 * 적 장수마다 한 줄 — [장수] [지력] [책략목록]. 책략을 누르면 설명 팝업(`#tip`)이 그 위에 하나 더 뜬다.
 *
 * 지력은 **부상을 반영한 값**(`officerStats`, 엔진이 저항 판정에 쓰는 것과 같다)이다 — 환술이 먹힐지 가늠하는 칸이다.
 * 판 위에 뜨는 층(`#intel`)이라 판을 가리지만, 배치 중에는 판을 오래 볼 일이 없고 닫는 길이 셋이다(× · 단추 · 전투 시작).
 */
class IntelPopup {
  private open = false;
  rows = 0;

  constructor(private readonly root: HTMLElement, private readonly tip: StatusPopup, private readonly humanSide: Side | null) {
    root.classList.add('hidden');
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.action === 'closeIntel') this.close();
    });
  }

  get isOpen(): boolean { return this.open; }

  toggle(state: BattleState): void {
    if (this.open) this.close();
    else this.show(state);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.tip.hide();
  }

  private show(state: BattleState): void {
    this.open = true;
    const mine = mineOf(this.humanSide);

    const head = el('div', 'intel-head');
    const close = text('button', 'intel-close', '×');
    close.dataset.action = 'closeIntel';
    head.append(text('span', 'intel-title', t('intel.title')), close);

    const table = el('div', 'intel-table');
    table.append(
      text('span', 'intel-th', t('intel.officer')),
      text('span', 'intel-th', t('intel.intellect')),
      text('span', 'intel-th', t('intel.tactics')),
    );
    const foes = Object.values(state.units).filter((u) => u.side !== mine);
    for (const unit of foes) table.append(...this.row(unit));
    this.rows = foes.length;

    this.root.replaceChildren(head, table);
    this.root.classList.remove('hidden');
  }

  private row(unit: UnitState): HTMLElement[] {
    const officer = combatantById.get(unit.officer);
    const who = el('span', 'intel-who');
    who.dataset.unit = unit.id;
    who.append(text('span', 'intel-pc', unit.piece), text('span', 'intel-name', officer ? pickOfficerName(officer) : unit.officer));

    const int = text('span', 'intel-int', String(officerStats(unit).intellect));

    const list = el('span', 'intel-tactics');
    list.dataset.unit = unit.id;
    for (const id of unit.tactics) {
      const def = tacticById.get(id);
      if (!def) continue;
      const chip = text('button', `chip ${def.school}`, pickTacticName(def));
      chip.dataset.tactic = id;
      chip.addEventListener('click', () => this.tip.showRaw('tactic', pickTacticName(def), pickTacticText(def),
        t('ins.tacticTail', { level: def.level, mp: def.mpCost })));
      list.append(chip);
    }
    // 척후기를 들었는데 비어 있으면 정말로 안 배운 것이다 — 가린 것이 아니다(가렸다면 단추가 꺼져 있다)
    if (unit.tactics.length === 0) list.append(text('span', 'intel-none', t('intel.none')));
    return [who, int, list];
  }
}

// ── 작은 도우미 ───────────────────────────────────────────────────

function button(action: string, label: string, onClick: () => void, tone?: 'go'): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.action = action;
  b.textContent = label;
  if (tone) b.classList.add(tone);
  b.addEventListener('click', onClick);
  return b;
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
