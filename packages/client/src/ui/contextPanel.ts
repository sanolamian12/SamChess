/**
 * 맥락 판 — 아래 칸 오른쪽 `#ctx` (pptx 94~97쪽, 전투 UI 개편 4단계 · 2026-10-06)
 *
 * 명령 판(왼쪽)에서 고른 것을 **이어 받는 자리**다. 판을 덮지 않으므로 맵을 보며 고른다 — 옛 확인창
 * (`.cast-confirm`)과 고유기술 물음(`.ctl-prompt`)이 판 한가운데에 떠서 정작 대상을 가리던 것이 없어졌다.
 *
 * | 흐름 | 뜨는 것 (`data-view`) |
 * |---|---|
 * | 고유기술 물음 | 「고유기술을 쓰시겠습니까?」 · 발동 시간 · [미사용] · [사용 (SP n)] (`ask`) — 기술은 왼쪽 카드의 라벨이 보여 준다 |
 * | 명령 선택 | **지금 차례 장수** — 장수 카드 하나(`renderOfficerCard`) — 장수 팝업 · 적 차례 카드와 같은 꼴 (`self`, 2026-10-07 기획자 지정 · 2026-10-09 105쪽 꼴로) |
 * | 이동 · 공격 · 조준 | 「…을 선택해주세요」 + [취소] (`move` · `attack` · `aim`) |
 * | 책략 · 아이템 | 목록 + [취소] (`list`) |
 * | 확인 | 공격(데미지 · 치명타) · 책략(성공확률) · 아이템 · 명상(회복량) · 대기 + [취소][확인] (`confirm`) |
 * | 적 차례 | 비어 있음 → 적이 겨눈 장수의 카드 (`target`) |
 *
 * **숫자는 엔진이 낸다** — `forecastAttack` · `illusionChance` · `meditateGain` · `tacticMpCost`.
 * 화면이 공식을 다시 적으면 표시만 조용히 어긋난다(CLAUDE.md).
 */

import {
  forecastAttack, illusionChance, meditateGain, tacticMpCost, usableItemOf,
} from '@samchess/rules';
import type { BattleState, Side, UnitId, UnitState } from '@samchess/rules';
import { combatantById, skillById, tacticById } from '@samchess/data';
import type { PlaybackPhase } from '../battle/playback.ts';
import { t } from '../i18n/index.ts';
import {
  castDelayNote, pickMarketItemName, pickMarketItemText,
  pickOfficerName, pickSkillName, pickTacticName, pickTacticText,
} from '../i18n/story.ts';
import { josaOf } from './eventText.ts';
import type { CommandFlow, Confirm, Step } from './commandFlow.ts';
import { officerCardKey, renderOfficerCard } from './officerCard.ts';
import type { StatusPopup } from './statusPopup.ts';

export interface ContextHandlers {
  cancel(): void;
  commit(): void;
  useUnique(): void;
  skipUnique(): void;
  pickTactic(id: string): void;
  pickItem(): void;
}

export class ContextPanel {
  private lastKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly tip: StatusPopup,
    private readonly flow: CommandFlow,
    private readonly on: ContextHandlers,
  ) {
    root.replaceChildren();
    root.dataset.view = 'empty';
  }

  /**
   * @param aimedAt 적 차례에 그 적이 겨눈 장수 — 씬이 엔진 이벤트(`attacked` · `tacticCast` …의 `target`)에서 모은다.
   *   온라인에서는 상대의 의도가 오지 않고 이벤트만 오므로 이것이 유일한 길이다.
   */
  refresh(
    state: BattleState, side: Side | null, phase: PlaybackPhase, busy: boolean, aimedAt: UnitId | null,
  ): void {
    const unit = state.activeUnit ? state.units[state.activeUnit] : undefined;
    const mine = phase === 'awaitingInput' && !busy && !!unit && !!side;
    const target = phase === 'aiThinking' && aimedAt ? state.units[aimedAt] : undefined;
    const step = this.flow.step;
    const asking = mine && this.flow.asking(state, side);
    const view = asking ? 'ask'
      : mine && step.k !== 'menu' ? step.k
      : mine ? 'self'
      : target?.alive ? 'target'
      : 'empty';

    const key = `${view}|${this.flow.version}|${state.time}|${JSON.stringify(state.activeTurn)}`
      + `|${unit ? `${unit.mp}/${unit.hp}/${unit.itemUsed}` : ''}|${state.sp.P1}|${state.sp.P2}`
      + `|${target ? officerCardKey(state, target) : ''}`
      + `|${view === 'self' ? officerCardKey(state, unit!) : ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.root.dataset.view = view;
    delete this.root.dataset.kind;
    const out: HTMLElement[] = [];
    if (view === 'ask') this.ask(out, unit!);
    else if (view === 'target') out.push(renderOfficerCard(state, target!, this.tip));
    else if (view === 'self') out.push(renderOfficerCard(state, unit!, this.tip));
    else if (view !== 'empty') this.stepView(out, state, side!, unit!, step);
    this.root.replaceChildren(...out);
  }

  // ── 고유기술 물음 (확정 5) ─────────────────────────────────────

  /**
   * 물음 · 발동 시간 · [미사용] · [사용 (SP n)] — **기술 이름 · 라벨 그림은 안 싣는다** (2026-10-09 기획자 지정).
   * 무엇인지는 왼쪽 장수 카드의 고유기술 라벨이 이미 보여 주고, 누르면 설명이 뜬다. 여기 그림까지 얹으면 칸이 넘쳐 깨졌다.
   */
  private ask(out: HTMLElement[], unit: UnitState): void {
    const officer = combatantById.get(unit.officer)!;
    const skill = skillById.get(officer.uniqueSkill!)!;
    out.push(text('div', 'cx-q', t('cx.ask.q')));

    // 시전 지연은 **누르기 전에** 보여 준다 — 지연 기술은 [사용]을 누르는 순간 차례가 끝난다
    const delay = text('div', 'cx-delay', castDelayNote(skill));
    delay.dataset.delayed = skill.castDelay > 0 ? '1' : '0';
    out.push(delay);

    // 이동 · 대기와 같은 두 층 — 진행하는 단추([사용])가 맨 아래
    const row = buttons(
      button('skipUnique', t('cx.ask.skip'), () => this.on.skipUnique()),
      button('useUnique', t('cx.ask.use', { sp: skill.spCost }), () => this.on.useUnique(), 'go'),
    );
    row.classList.add('cx-stack');
    out.push(row);
  }

  // ── 명령을 고른 뒤 ─────────────────────────────────────────────

  private stepView(out: HTMLElement[], state: BattleState, side: Side, unit: UnitState, step: Step): void {
    const cancel = (): HTMLElement => button('cancel', t('cmd.cancel'), () => this.on.cancel());
    switch (step.k) {
      case 'move':
        out.push(text('div', 'cx-q', t('cx.move')), buttons(cancel()));
        return;
      case 'attack': {
        // [공격]은 대상이 없어도 열린다(확정 1) — 그때는 사거리만 보이고 여기서 「없다」를 말한다
        const none = (this.flow.commands(state, side)?.attack ?? false) === false;
        const q = text('div', 'cx-q', t(none ? 'cx.attack.none' : 'cx.attack'));
        if (none) this.root.dataset.kind = 'none';
        out.push(q, buttons(cancel()));
        return;
      }
      case 'list':
        this.root.dataset.kind = step.kind;
        out.push(text('div', 'cx-cap', t(step.kind === 'tactic' ? 'cmd.castTactic' : 'cmd.useItem')));
        out.push(step.kind === 'tactic' ? this.tacticList(state, side, unit) : this.itemList(state, side, unit));
        out.push(buttons(cancel()));
        return;
      case 'aim': {
        this.root.dataset.kind = step.kind;
        // 둘레가 정해진 조준에 후보가 없으면 [공격]처럼 「범위 안에 … 없습니다」 (2026-10-09)
        const none = step.radius !== undefined && step.targets.length === 0;
        if (none) this.root.dataset.kind = 'none';
        out.push(
          text('div', 'cx-label', `「${castLabel(unit, step.kind, step.tactic)}」`),
          text('div', 'cx-q', t(none ? (step.side === 'enemy' ? 'cx.aim.none.enemy' : 'cx.aim.none.ally')
            : step.tiles ? 'cx.aim.tile' : 'cx.aim.unit')),
          buttons(cancel()),
        );
        return;
      }
      case 'confirm': {
        this.confirm(out, state, unit, step.c);
        const ok = button('commit', t(step.c.k === 'move' ? 'cx.moveOk' : 'cx.ok'), () => this.on.commit(), 'go');
        const no = button('cancel', t('cmd.cancel'), () => this.on.cancel());
        // 확인창은 전부 두 층 — 한 단추가 폭 전체를 쓰고 **[확정] · [확인]이 맨 아래**다 (2026-10-09 기획자 지정 —
        // 대기에서 시작해 이동 · 공격 · 책략 · 아이템까지 통일했다). 손가락이 마지막에 닿는 자리가 진행하는 단추다
        const row = buttons(no, ok);
        row.classList.add('cx-stack');
        out.push(row);
        return;
      }
    }
  }

  private tacticList(state: BattleState, side: Side, unit: UnitState): HTMLElement {
    // 두 열 — 한 열로는 넷째 줄부터 칸 아래로 잘려 스크롤했다(Lv9 = 8종, 2026-10-08)
    const list = el('div', 'cx-list cx-list-tactics');
    const usable = this.flow.commands(state, side)?.tactics ?? {};
    for (const id of unit.tactics) {
      const def = tacticById.get(id)!;
      const row = document.createElement('button');
      row.className = 'cx-row';
      row.dataset.tactic = id;
      row.disabled = !usable[id];
      row.title = pickTacticText(def);
      row.append(text('span', 'nm', pickTacticName(def)), text('span', 'cost', `MP ${tacticMpCost(unit, id)}`));
      row.addEventListener('click', () => this.on.pickTactic(id));
      list.append(row);
    }
    if (unit.tactics.length === 0) list.append(text('div', 'cx-empty', t('cmd.tactics.empty')));
    return list;
  }

  /** 아이템 목록 — 장수 하나가 하나만 들므로 **늘 한 줄**이다(94쪽 목업대로 목록을 거친다, 확정 3) */
  private itemList(state: BattleState, side: Side, unit: UnitState): HTMLElement {
    const list = el('div', 'cx-list');
    const item = usableItemOf(unit);
    if (item) {
      const row = document.createElement('button');
      row.className = 'cx-row';
      row.dataset.item = item.id;
      row.disabled = !this.flow.commands(state, side)?.useItemOpen;
      // 왼쪽 = 아이템 그림(장터와 같은 `market-items/{id}.png`), 오른쪽 = 이름(밝게) · 효과(회색) 같은 크기 (2026-10-09)
      const art = document.createElement('img');
      art.className = 'cx-item-art';
      art.alt = '';
      art.src = `market-items/${item.id}.png`;
      art.onerror = () => { art.remove(); };
      const words = el('span', 'cx-item-txt');
      words.append(text('span', 'nm', pickMarketItemName(item)), text('span', 'desc', pickMarketItemText(item)));
      row.classList.add('cx-item');
      row.append(art, words);
      row.addEventListener('click', () => this.on.pickItem());
      list.append(row);
    }
    return list;
  }

  // ── 확인창 넷 (94~96쪽) ────────────────────────────────────────

  private confirm(out: HTMLElement[], state: BattleState, caster: UnitState, c: Confirm): void {
    this.root.dataset.kind = c.k === 'cast' ? c.kind : c.k;
    switch (c.k) {
      case 'move':
        out.push(text('div', 'cx-q', t('cx.confirm.move')));
        return;
      case 'attack': {
        const f = forecastAttack(state, caster.id, c.target);
        const who = whoOf(state, c.target);
        out.push(text('div', 'cx-q', t('cx.confirm.attack', { who, j: josaOf(who, '을를') })));
        if (!f) return;
        if (f.victim !== c.target) {
          // 「고육지책」 — 실제로 맞는 쪽이 다르다. 숫자는 그 쪽의 것이다
          const victim = whoOf(state, f.victim);
          out.push(text('div', 'cx-sub', t('cx.confirm.redirect', { who: victim, j: josaOf(victim, '이가') })));
        }
        if (f.execute) {
          out.push(rate(t('cx.damage'), t('board.instantKill'), 'execute'));
          return;
        }
        out.push(
          rate(t('cx.damage'), `${f.normal}-${f.critical}`, 'damage'),
          rate(t('cx.critical'), `${f.criticalRate}%`, 'critical'),
        );
        return;
      }
      case 'cast': {
        const label = castLabel(caster, c.kind, c.tactic);
        const target = typeof c.target === 'string' ? c.target : undefined;
        const tile = typeof c.target === 'object' ? c.target : undefined;
        const verb = c.kind === 'tactic' ? 'cast' : 'use';
        // 조사는 값에 붙인다 — 한국어일 때만(`josaOf`). 다른 언어의 문장은 `{o}` 자리를 안 적는다
        const o = josaOf(label, '을를');
        out.push(text('div', 'cx-q', target
          ? t(`cx.confirm.${verb}.unit`, { who: whoOf(state, target), name: label, o })
          : tile ? t(`cx.confirm.${verb}.tile`, { x: tile.x + 1, y: tile.y + 1, name: label, o })
          : t(`cx.confirm.${verb}.self`, { name: label, o })));
        if (c.kind === 'tactic') {
          const def = tacticById.get(c.tactic!)!;
          // MP는 설명문 머리에 — 줄 하나를 따로 쓰면 두 층 단추와 함께 칸이 넘쳤다 (2026-10-09)
          const desc = el('div', 'cx-text');
          desc.append(text('span', 'cx-mp', `MP ${tacticMpCost(caster, c.tactic!)}`), pickTacticText(def));
          out.push(desc);
          const chance = illusionChance(state, caster.id, c.tactic!, target);
          if (chance !== null) {
            const row = rate(t('cx.rate'), `${chance}%`, 'rate');
            row.dataset.level = chance >= 80 ? 'high' : chance >= 40 ? 'mid' : 'low';
            out.push(row);
          }
        } else {
          // 아이템은 저항 판정을 안 탄다 — 없는 판정을 「100%」로 채우지 않는다
          const item = usableItemOf(caster);
          if (item) out.push(text('div', 'cx-text', pickMarketItemText(item)));
          out.push(text('div', 'cx-spend', t('cmd.confirm.itemSpend')));
        }
        return;
      }
      case 'meditate':
        out.push(text('div', 'cx-q', t('cx.confirm.meditate', { n: meditateGain(state, caster.id) })));
        return;
      case 'endTurn':
        out.push(text('div', 'cx-q', t('cx.confirm.endTurn')));
        return;
    }
  }
}

/** 시전할 것의 이름 — 책략 · 아이템 · 고유기술 */
function castLabel(unit: UnitState, kind: 'tactic' | 'item' | 'unique', tactic?: string): string {
  if (kind === 'tactic') return pickTacticName(tacticById.get(tactic!)!);
  if (kind === 'item') { const item = usableItemOf(unit); return item ? pickMarketItemName(item) : ''; }
  return pickSkillName(skillById.get(combatantById.get(unit.officer)!.uniqueSkill!)!);
}

/** 장수 이름 — 기물은 안 붙인다(조사가 이름의 받침을 봐야 한다). 카메라가 이미 그 장수를 비춘다 */
function whoOf(state: BattleState, id: UnitId): string {
  const u = state.units[id];
  const o = u ? combatantById.get(u.officer) : undefined;
  return o ? pickOfficerName(o) : '';
}

function rate(label: string, value: string, kind: string): HTMLElement {
  const row = el('div', 'cx-rate');
  row.dataset.kind = kind;
  row.append(text('span', 'k', label), text('span', 'v', value));
  return row;
}

function button(action: string, label: string, onClick: () => void, tone?: 'go'): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.action = action;
  b.textContent = label;
  if (tone) b.classList.add(tone);
  b.addEventListener('click', onClick);
  return b;
}

function buttons(...items: HTMLElement[]): HTMLElement {
  const row = el('div', 'cx-buttons');
  row.append(...items);
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

