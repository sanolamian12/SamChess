/**
 * 배치 · 정찰 화면 — pptx 90 · 91쪽 (전투 UI 개편 5단계) → **100쪽으로 다시 짰다** (전투 그래픽 마감, 2026-10-07)
 *
 * ```
 * ┌ 위 = #cmd — 고유기술 (화면 너비 전부) ───────────────────────┐
 * │ (꼬마) [百騎劫魏營 배너]          │ (꼬마) [賈詡之策 배너]          │   왼쪽 아군 · 오른쪽 적군
 * │ (꼬마) [九伐中圓 배너]            │ (꼬마) —                        │   한 줄 = 판의 꼬마 그림 + 고유기술 라벨
 * ├ 판 ────────────────────────────────────────────────────────┤
 * │                      게임 시작                               │   #countdown — 판 한가운데,
 * │                        15초                                  │   초가 줄 때마다 숫자가 살짝 번진다
 * │          내 진영 안에서 기물을 눌러 옮긴다 …                  │
 * ├ 아래 = #order — 순서 판 (화면 너비 전부) ────────────────────┤
 * │ 순서 기물 장수 대기 스킬   │ 순서 기물 장수 대기 스킬           │
 * │ [ 책략 확인 ]              [ 준비완료 ]                      │   #ctx-prep — 순서 판이 품는다
 * └────────────────────────────────────────────────────────────┘
 * ```
 *
 * **위 칸과 아래 칸을 맞바꾼다**(100쪽 1). DOM은 옮기지 않고 `#frame[data-stage="prep"]`이 두 칸의 grid 줄을 바꾼다 —
 * 그래서 배치 중의 위 칸은 원래 아래 칸(`#cmd`가 고유기술을 그린다), 아래 칸은 원래 위 칸(`#order`)이다.
 * 옛 오른쪽 배치 판(배치 N초 · 안내 · 단추)은 없어졌다 — 시계와 안내는 판 가운데로, 단추는 순서 판 바닥으로 갔다.
 *
 * - **고유기술 패널**(`renderSkillRoster`) — 꼬마 그림을 누르면 **장수 팝업이 판 한가운데**, 라벨을 누르면
 *   **고유기술 팝업**(`skillPanel.ts`, 메타 화면의 `SkillModal`과 같은 껍데기 · **발동 영상 단추는 없다**).
 * - **[책략 확인] → 적 책략 팝업**(`IntelPopup`, 91쪽) — [장수][지력][책략목록], 책략을 누르면 설명 팝업이 하나 더.
 *   켜짐은 엔진의 `tacticsRevealed()` — **내 편에 척후기가 있는가**(2026-10-06 기획자 확정). 적 책략이
 *   실려 왔는가로 재면 Lv1 상대 앞에서 척후기를 들고도 꺼진다. 가리는 것은 화면이 아니라 전선이다(`toWire`).
 * - 정찰도 같은 자리다 — [준비완료]가 [전투 시작]으로 바뀌고 시계는 마지막 5초만 센다(GDD §3.9).
 *
 * **남은 시간은 스스로 세지 않는다** — `Playback.remainingSec`을 읽기만 한다(온라인에서는 서버가 내려 준다).
 */

import { combatantById, skillById, tacticById } from '@samchess/data';
import { officerStats, SCOUT_COUNTDOWN_MS, tacticsRevealed } from '@samchess/rules';
import type { BattleState, Side, UnitId, UnitState } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import { pickOfficerName, pickSkillName, pickTacticName, pickTacticText } from '../i18n/story.ts';
import { hasArt, portraitUrl, skillArtUrl } from './art.ts';
import { armyName } from '../i18n/engineLabel.ts';
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

/** 고유기술 패널의 줄을 눌렀다 — 무엇을 띄울지는 씬이 정한다 */
export interface SkillRosterHooks {
  /** 꼬마 그림 → 장수 팝업(판 한가운데) */
  openUnit(unitId: UnitId): void;
  /** 라벨 → 고유기술 팝업(발동 영상 없음) */
  openSkill(skillId: string): void;
}

export function renderSkillRoster(state: BattleState, humanSide: Side | null, on: SkillRosterHooks): HTMLElement[] {
  const mine = mineOf(humanSide);
  const foe: Side = mine === 'P1' ? 'P2' : 'P1';
  // 제목 줄 — 아래 두 열과 같은 격자. 열마다 오른쪽 끝에 그 열의 진영 이름(101쪽, 2026-10-08) — 왼쪽은 언제나 아군이다
  const head = el('div', 'sk-head-row');
  const left = el('div', 'sk-head-cell');
  left.append(text('span', 'cmd-title', t('sk.title')), army(mine, true));
  const right = el('div', 'sk-head-cell');
  right.append(army(foe, false));
  head.append(left, right);

  const grid = el('div', 'sk-grid');
  for (const side of [mine, foe] as const) {
    const col = el('div', 'sk-col');
    col.dataset.side = side === mine ? 'mine' : 'foe';
    for (const unit of Object.values(state.units)) {
      if (unit.side === side) col.append(skillRow(unit, side === mine, on));
    }
    grid.append(col);
  }
  return [head, grid];
}

function army(side: Side, mine: boolean): HTMLElement {
  const label = text('span', 'sk-army', armyName(side));
  label.dataset.side = mine ? 'mine' : 'foe';
  label.dataset.army = side;
  return label;
}

/**
 * 한 줄 = **판의 꼬마 그림 + 고유기술 라벨**(100쪽, 2026-10-07 기획자 확정 — 수묵 초상이 아니라 판에 선 그 그림).
 * 라벨 그림(`skills/{기술id}.jpg`)이 없으면 「기술명」 SP 글자로 물러난다. 고유기술이 없는 장수(C·D급 · 도적)는
 * 줄을 남기되(진영의 인원이 보이게) 라벨 칸이 흐린 「—」다.
 */
function skillRow(unit: UnitState, mine: boolean, on: SkillRosterHooks): HTMLElement {
  const officer = combatantById.get(unit.officer);
  const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
  const name = officer ? pickOfficerName(officer) : unit.officer;

  const row = el('div', 'sk-row');
  row.dataset.unit = unit.id;        // 스모크가 이것으로 줄을 센다
  row.dataset.side = mine ? 'mine' : 'foe';
  row.dataset.skill = skill?.id ?? '';

  const art = document.createElement('button');
  art.className = 'sk-art';
  art.dataset.action = 'officer';
  art.title = `${unit.piece} · ${name}`;
  if (hasArt(unit.officer)) {
    const img = document.createElement('img');
    img.alt = name;
    img.src = portraitUrl(unit.officer);
    art.append(img);
  } else {
    art.append(text('span', 'sk-art-name', name));
  }
  art.addEventListener('click', () => on.openUnit(unit.id));

  const banner = document.createElement('button');
  banner.className = 'sk-banner';
  banner.dataset.action = 'skill';
  if (skill) {
    banner.title = `${name} · 「${pickSkillName(skill)}」 SP ${skill.spCost}`;
    const img = document.createElement('img');
    img.alt = '';
    img.src = skillArtUrl(skill.id);
    img.addEventListener('error', () => { banner.dataset.noart = '1'; });
    const label = el('span', 'sk-label');
    label.append(text('span', 'sk-skill', `「${pickSkillName(skill)}」`), text('span', 'sk-sp', `SP ${skill.spCost}`));
    banner.append(img, label);
    banner.addEventListener('click', () => on.openSkill(skill.id));
  } else {
    banner.append(text('span', 'sk-skill', '—'));
    banner.disabled = true;
  }
  row.append(art, banner);
  return row;
}

// ── 단추 줄(순서 판 바닥) · 판 가운데 카운트 ─────────────────────

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
    /** 판 한가운데의 「게임 시작 / N초」 (`#countdown`) */
    private readonly clockRoot: HTMLElement,
    intelRoot: HTMLElement,
    private readonly tip: StatusPopup,
    private readonly humanSide: Side | null,
    private readonly on: PrepHandlers,
  ) {
    root.replaceChildren();
    root.dataset.phase = '';
    clockRoot.replaceChildren();
    clockRoot.classList.add('hidden');
    this.intel = new IntelPopup(intelRoot, tip, humanSide);
  }

  /** @param remainingSec `Playback`이 준 남은 초. 배치 · 정찰이 아니면 `null` */
  refresh(state: BattleState, phase: PlaybackPhase, remainingSec: number | null): void {
    const on = isPrepPhase(phase);
    if (!on) {
      // 전투가 시작되면 팝업도 함께 걷는다 — 정찰 동안 열어 둔 채 시작을 누를 수 있다
      if (this.root.dataset.phase !== '') {
        this.root.dataset.phase = ''; this.root.replaceChildren(); this.last = '';
        this.clockRoot.replaceChildren(); this.clockRoot.classList.add('hidden'); this.lastSec = null;
      }
      this.intel.close();
      return;
    }

    const deploying = phase === 'deploying';
    const readyAlready = this.humanSide ? state.ready[this.humanSide] : true;
    // 정찰은 20초를 세되 **마지막 5초만** 숫자를 보여준다 (GDD §3.9)
    const showClock = deploying || (remainingSec !== null && remainingSec <= SCOUT_COUNTDOWN_MS / 1000);
    const revealed = this.humanSide !== null && tacticsRevealed(state, this.humanSide);

    // 언어도 키에 넣는다 (순서 판 · 카드와 같은 사정) — 안 넣으면 옛 언어로 남는다
    const key = `${phase}|${showClock ? remainingSec : ''}|${readyAlready}|${revealed}|${this.intel.isOpen}|${currentLang()}`;
    if (key === this.last) return;
    this.last = key;

    // 대기(내가 먼저 준비를 마쳤다)는 배치 단계 안의 걸음이다 — 전선의 `waiting`이 재생기에서 `deploying`으로 온다
    this.root.dataset.phase = !deploying ? 'scouting' : readyAlready ? 'waiting' : 'deploying';

    this.drawClock(deploying, readyAlready, showClock ? remainingSec : null);

    const go = button(deploying ? 'ready' : 'begin', t(deploying ? 'prep.ready' : 'prep.begin'), () => {
      if (deploying) this.on.ready(); else this.on.begin();
    }, 'go');
    go.disabled = deploying && readyAlready;

    const intel = button('intel', t('prep.intel'), () => this.intel.toggle(state));
    intel.disabled = !revealed;
    intel.classList.toggle('on', this.intel.isOpen);
    // 꺼진 이유를 적는다 — 「아이템이 있어야 켜진다」(91쪽)는 눌러 봐서는 모른다
    intel.title = revealed ? '' : t('prep.intel.off');

    // 왼쪽 [책략 확인] · 오른쪽 [준비완료] (100쪽 5)
    this.root.replaceChildren(intel, go);
  }

  /** 판 가운데 카운트를 잠깐 숨긴다 — 동점 주사위가 같은 자리에서 돈다 */
  dim(on: boolean): void {
    if (this.clockRoot.classList.contains('dimmed') !== on) this.clockRoot.classList.toggle('dimmed', on);
  }

  private lastSec: number | null = null;

  /**
   * 판 한가운데의 카운트 (100쪽 6) — 「게임 시작」(정찰이면 「전투 시작」) · N초 · 안내 한 줄.
   * **숫자가 바뀔 때마다 그 글자만 새로 만든다** — 그래야 CSS 애니메이션(`cd-tick`, 살짝 번지며 나타남)이 다시 돈다.
   * 안내는 카운트 아래 작은 글씨(2026-10-07 기획자 확정) — 대기 중이면 「상대를 기다리는 중」.
   */
  private drawClock(deploying: boolean, readyAlready: boolean, sec: number | null): void {
    const root = this.clockRoot;
    root.classList.remove('hidden');
    root.dataset.phase = this.root.dataset.phase ?? '';
    const title = t(deploying ? 'cd.deploy' : 'prep.begin');
    const note = deploying ? t(readyAlready ? 'prep.note.waiting' : 'prep.note.deploy') : t('prep.note.scout');
    let titleEl = root.querySelector<HTMLElement>('.cd-title');
    let noteEl = root.querySelector<HTMLElement>('.cd-note');
    if (!titleEl || !noteEl) {
      titleEl = el('div', 'cd-title');
      noteEl = el('div', 'cd-note');
      root.replaceChildren(titleEl, el('div', 'cd-num'), noteEl);
      this.lastSec = null;
    }
    if (titleEl.textContent !== title) titleEl.textContent = title;
    if (noteEl.textContent !== note) noteEl.textContent = note;
    if (sec === this.lastSec && root.querySelector('.cd-num')!.textContent !== '') return;
    this.lastSec = sec;
    const num = text('div', 'cd-num', sec === null ? '' : t('cd.seconds', { n: sec }));
    num.classList.toggle('urgent', sec !== null && sec <= 5);
    root.querySelector('.cd-num')!.replaceWith(num);
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
