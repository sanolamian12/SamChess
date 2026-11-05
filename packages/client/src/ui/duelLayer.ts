/**
 * 일기토 · 설전 층 — `#duel` (GDD §3.11, 설계서 §4-2 ~ §4-4 · 단계 3c)
 *
 * 판 위에 겹치는 **전체 화면 층**이다(고유기술 팝업 `#skillpop`처럼 프레임 전체). 전투 씬은 멈춘 채 뒤에 있다 — 대결 동안 시간이 안 흐른다.
 *
 * | 걸음 | 뜨는 것 (`data-view`) |
 * |---|---|
 * | 내가 신청받았다(`answering`) | 건 장수 초상 · 예보 줄(맥락 판의 확인창과 같은 `challengeLines`) · 남은 초 · [거절] [수락] (`offer`) |
 * | 내가 걸고 답을 기다린다 | 「…의 답을 기다립니다」 (`wait`) |
 * | 합 | 배경 · 양쪽 초상 · 게이지 · 공격권 북 · 「제 n 합」 · 3 · 2 · 1 · 패 셋 · [도망] (`round`) |
 * | 공개 · 끝 | 두 패가 가운데서 부딪힌다(섬광 · 금빛 먹물) · 결과 한 줄 → 끝이면 승패 · 보상 한 줄 (`round` + `data-reveal`) |
 *
 * **마감은 판정 주체가 잰다** — 응답 10초 · 카운트 3초가 끝나면 그쪽이 수를 넣는다. 여기는 남은 시간(`Playback.remainingMs`)을 그리기만 한다.
 * 공개 연출 동안은 재생기를 멈춘다(`hold`) — 다음 합의 카운트는 판정 주체가 연출 길이(`DUEL_REVEAL_MS`)를 앞에 붙여 잰다.
 * 숫자는 전부 엔진이 낸다(`gaugeOf` · `officerStats` · `duelForecast`).
 */

import { combatantById } from '@samchess/data';
import { DUEL_COUNT_MS, DUEL_REVEAL_MS, FORMULA, duelRulesOn, gaugeOf, officerStats } from '@samchess/rules';
import type { BattleEvent, BattleState, DuelKind, DuelPick, DuelRoundResult, DuelState, Side, UnitId, UnitState } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { t } from '../i18n/index.ts';
import { battleArtUrl } from './art.ts';
import { challengeLines, whoOf } from './contextPanel.ts';
import { josaOf } from './eventText.ts';
import { gameIconEl, type GameIconName } from './gameIcon.ts';
import { playSfx } from '../audio/sfx.ts';
import { playChallengeSound, playDuelVoice, stopChallengeSound } from '../audio/duelSound.ts';

export interface DuelHandlers {
  answer(accept: boolean): void;
  pick(pick: DuelPick): void;
  flee(): void;
}

/** 끝 장면(승패 · 보상 한 줄)을 보여 주는 시간 — 공개 연출 뒤에 이어진다. 판정에는 안 닿는다(대결이 이미 끝났다) */
const END_MS = 1_800;

const PICKS: Record<DuelKind, readonly DuelPick[]> = { duel: ['rock', 'paper', 'scissors'], debate: [1, 2, 3] };
const PICK_ICON = (p: DuelPick): GameIconName =>
  (typeof p === 'number' ? `debate-${p}` : `rps-${p}`) as GameIconName;
const pickLabel = (p: DuelPick): string => (typeof p === 'number' ? String(p) : t(`duel.pick.${p}`));

interface Reveal { round: number; picks: Record<Side, DuelPick>; holder: UnitId; result: DuelRoundResult; damage: number; until: number }
interface Ending { text: string; until: number }

export class DuelLayer {
  /** 대결의 마지막 모습 — 끝난 뒤(`state.duel`이 지워진 뒤)에도 끝 장면을 그리려고 들고 있다 */
  private last: DuelState | null = null;
  private reveal: Reveal | null = null;
  private ending: Ending | null = null;
  private lastKey = '';
  private lastCount = -1;
  private countEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly on: DuelHandlers,
    private readonly hold: (ms: number) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    root.replaceChildren();
    root.dataset.open = '0';
  }

  /** 열려 있는가 — 씬이 판 클릭 · 카메라를 쉬게 한다 */
  get open(): boolean { return this.root.dataset.open === '1'; }

  /**
   * 통 하나의 이벤트 — 소리 · 공개 · 끝 장면. `onChange`에서 부른다(그래야 `hold`가 그 통의 연출로 걸린다).
   */
  events(state: BattleState, side: Side | null, events: readonly BattleEvent[]): void {
    if (state.duel) this.last = structuredClone(state.duel);
    const d = this.last;
    let held = 0;
    for (const e of events) {
      // SP가 상한에 닿았다 — SP MAX 버프가 켜진다(GDD §3.11 R15). 소리는 따로 안 받고 `roar2`(기획자 11-05)
      if (e.e === 'spChanged' && duelRulesOn(state) && e.to >= state.spCap[e.side]) playSfx('roar2');
      if (e.e === 'challengeOffered') {
        this.last = state.duel ? structuredClone(state.duel) : this.last;
        this.ending = null;
        playChallengeSound();
      } else if (e.e === 'challengeAnswered') {
        stopChallengeSound();
      } else if (e.e === 'duelRound' && d) {
        this.reveal = { round: e.round, picks: e.picks, holder: e.holder, result: e.result, damage: e.damage, until: this.now() + DUEL_REVEAL_MS };
        held += DUEL_REVEAL_MS;
        playSfx('duel_reveal');
        this.roundVoice(state, side, d.kind, e.holder, e.result, e.round);
      } else if (e.e === 'duelEnded') {
        stopChallengeSound();
        if (e.reason === 'refused') playSfx('duel_refuse');
        this.ending = { text: this.endText(state, e.kind, e.reason, e.winner ?? null), until: 0 };
        held += END_MS;
      }
    }
    if (this.ending && this.ending.until === 0) this.ending.until = this.now() + held;
    if (held > 0) this.hold(held);
  }

  /** 매 프레임 — 걸음이 바뀌었으면 다시 짓고, 아니면 카운트 숫자만 고친다 */
  refresh(state: BattleState, side: Side | null, phase: PlaybackPhase, remainingMs: number | null, busy: boolean): void {
    const now = this.now();
    if (this.reveal && now > this.reveal.until) this.reveal = null;
    if (this.ending && now > this.ending.until) this.ending = null;
    const d = state.duel ?? (this.reveal || this.ending ? this.last : null);
    const view = !d ? 'closed'
      : d.step === 'offer' && state.phase === 'duel' ? (phase === 'answering' ? 'offer' : 'wait')
      : 'round';

    const key = `${view}|${phase}|${busy}|${d ? JSON.stringify([d.round, d.holder, d.picks, d.auto, d.step]) : ''}`
      + `|${this.reveal?.round ?? ''}|${this.ending?.text ?? ''}|${d ? [d.challenger, d.defender].map((id) => `${gaugeOf(state.units[id]!, d.kind)}`).join(',') : ''}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.build(state, side, phase, busy, view, d);
    }
    this.tick(remainingMs, view);
  }

  // ── 짓기 ─────────────────────────────────────────────────────

  private build(state: BattleState, side: Side | null, phase: PlaybackPhase, busy: boolean, view: string, d: DuelState | null): void {
    this.root.dataset.open = view === 'closed' ? '0' : '1';
    this.root.dataset.view = view;
    this.countEl = null;
    this.timerEl = null;
    this.lastCount = -1;
    if (!d || view === 'closed') { this.root.replaceChildren(); delete this.root.dataset.kind; return; }
    this.root.dataset.kind = d.kind;
    const kindName = t(`duel.kind.${d.kind}`);
    const challenger = state.units[d.challenger]!;
    const defender = state.units[d.defender]!;

    if (view === 'offer') {
      const box = el('div', 'dl-offer');
      const who = whoOf(state, challenger.id);
      box.append(portrait(challenger),
        text('div', 'dl-title', t('duel.offer.title', { who, j: josaOf(who, '이가'), kind: kindName, o: josaOf(kindName, '을를') })),
        ...challengeLines(state, defender, challenger.id, d.kind),
        text('div', 'dl-note', t('duel.offer.refuseNote', { who })));
      this.timerEl = text('div', 'dl-timer', '');
      box.append(this.timerEl, text('div', 'dl-note', t('duel.offer.timeout')));
      const row = el('div', 'dl-buttons');
      row.append(
        btn('refuse', t('duel.offer.refuse'), () => this.on.answer(false), busy),
        btn('accept', t('duel.offer.accept'), () => this.on.answer(true), busy, 'go'),
      );
      box.append(row);
      this.root.replaceChildren(box);
      return;
    }
    if (view === 'wait') {
      const box = el('div', 'dl-offer dl-wait');
      box.append(portrait(defender), text('div', 'dl-title', t('duel.offer.wait', { who: whoOf(state, defender.id) })));
      this.timerEl = text('div', 'dl-timer', '');
      box.append(this.timerEl);
      this.root.replaceChildren(box);
      return;
    }

    // 합 — 왼쪽이 나, 오른쪽이 상대(관전이면 건 쪽이 왼쪽)
    const meFirst = !side || challenger.side === side;
    const [left, right] = meFirst ? [challenger, defender] : [defender, challenger];
    const stage = el('div', 'dl-stage');
    stage.style.backgroundImage = `url(duel/bg-${d.kind}.jpg)`;
    const head = text('div', 'dl-round', t('duel.round', { n: Math.min(d.round, FORMULA.duelRounds), max: FORMULA.duelRounds }));
    const sides = el('div', 'dl-sides');
    sides.append(this.sideCard(state, left, d, 'me', !!side && left.side === side), this.sideCard(state, right, d, 'foe', !!side && right.side === side));

    const center = el('div', 'dl-center');
    if (this.reveal) center.append(this.revealView(state, d.kind, left, right, this.reveal));
    else if (this.ending) center.append(text('div', 'dl-end', this.ending.text));
    else {
      this.countEl = text('div', 'dl-count', '');
      center.append(this.countEl);
    }
    stage.append(head, sides, center);

    if (this.ending && !this.reveal) {
      this.root.dataset.reveal = 'end';
    } else {
      this.root.dataset.reveal = this.reveal ? this.reveal.result : '';
    }

    const mine = side ? (challenger.side === side ? challenger : defender.side === side ? defender : null) : null;
    if (mine && state.phase === 'duel' && !this.ending) {
      const hold = d.holder === mine.id;
      stage.append(text('div', 'dl-hint', t(`duel.hint.${d.kind}.${hold ? 'hold' : 'chase'}`)));
      const picks = el('div', 'dl-picks');
      const chosen = d.picks[mine.side];
      for (const p of PICKS[d.kind]) {
        const b = document.createElement('button');
        b.className = 'dl-pick';
        b.dataset.pick = String(p);
        if (chosen === p) b.dataset.picked = '1';
        b.disabled = phase !== 'dueling' || busy || !!this.reveal;
        b.append(gameIconEl(PICK_ICON(p), pickLabel(p)));
        b.title = pickLabel(p);
        b.addEventListener('click', () => this.on.pick(p));
        picks.append(b);
      }
      const flee = btn('flee', t('duel.flee'), () => this.on.flee(), phase !== 'dueling' || busy || !!this.reveal);
      flee.prepend(gameIconEl('duel-fled', ''));
      stage.append(picks, flee);
    }
    this.root.replaceChildren(stage);
  }

  private sideCard(state: BattleState, u: UnitState, d: DuelState, cls: string, mine: boolean): HTMLElement {
    const card = el('div', `dl-side ${cls}`);
    card.dataset.unit = u.id;
    const name = whoOf(state, u.id);
    const g = gaugeOf(u, d.kind);
    const stat = d.kind === 'duel' ? officerStats(u).might : officerStats(u).intellect;
    card.append(portrait(u), text('div', 'dl-name', name));
    if (d.holder === u.id) {
      const drum = gameIconEl('duel-initiative', t(`duel.hint.${d.kind}.hold`));
      drum.classList.add('dl-holder');
      card.append(drum);
      card.dataset.holder = '1';
    }
    const bar = el('div', 'dl-gauge');
    bar.dataset.gauge = String(g);
    const fill = el('div', 'dl-fill');
    fill.style.width = `${Math.max(0, Math.min(100, g))}%`;
    bar.append(fill, text('span', 'dl-gv', `${g}/${FORMULA.duelGauge}`));
    const label = el('div', 'dl-stat');
    label.append(gameIconEl(d.kind === 'duel' ? 'stat-morale' : 'stat-mental', t(`duel.gauge.${d.kind}`)),
      text('span', '', `${t(`duel.stat.${d.kind}`)} ${stat}`));
    card.append(label, bar);
    // 「AI 대리 중」은 내 쪽만 — AI 상대의 패는 언제나 판정 주체가 채우므로 그쪽 표지는 뜻이 없다
    if (mine && d.auto[u.side]) card.append(text('div', 'dl-auto', t('duel.auto')));
    return card;
  }

  private revealView(state: BattleState, kind: DuelKind, left: UnitState, right: UnitState, r: Reveal): HTMLElement {
    const box = el('div', 'dl-reveal');
    box.dataset.result = r.result;
    const fx = document.createElement('img');
    fx.className = 'dl-fx';
    fx.alt = '';
    fx.src = `duel/${kind === 'duel' ? 'clash' : 'ink'}.png`;
    fx.onerror = () => fx.remove();
    const hand = (u: UnitState, cls: string): HTMLElement => {
      const h = gameIconEl(PICK_ICON(r.picks[u.side]), pickLabel(r.picks[u.side]));
      h.classList.add('dl-hand', cls);
      return h;
    };
    const holder = whoOf(state, r.holder);
    const other = whoOf(state, r.holder === left.id ? right.id : left.id);
    const line = r.result === 'hit' ? t('duel.result.hit', { who: holder, gauge: t(`duel.gauge.${kind}`), n: r.damage })
      : r.result === 'turnover' ? t('duel.result.turnover', { who: other })
      : t('duel.result.tie');
    box.append(hand(left, 'l'), r.result === 'tie' ? el('span', '') : fx, hand(right, 'r'), text('div', 'dl-line', line));
    return box;
  }

  /** 카운트 숫자 · 응답 남은 초 — 매 프레임. 둘째 합부터는 공개 연출 몫이 앞에 붙어 있어 3초 안쪽만 센다 */
  private tick(remainingMs: number | null, view: string): void {
    if (this.timerEl) this.timerEl.textContent = remainingMs === null ? '' : `⏱ ${Math.ceil(remainingMs / 1000)}`;
    if (!this.countEl || remainingMs === null || view !== 'round') return;
    const n = remainingMs > DUEL_COUNT_MS ? 0 : Math.max(1, Math.ceil(remainingMs / 1000));
    if (n === this.lastCount) return;
    this.lastCount = n;
    this.countEl.textContent = n ? String(n) : '';
    if (n) playSfx(n === 1 ? 'duel_tick_long' : 'duel_tick');
  }

  // ── 소리 · 글 ────────────────────────────────────────────────

  /** 합의 기합 — 일기토는 우리가 이긴 합(공격 · 공격권 뺏기) 기합 · 진 합 으악, 설전은 우리가 맞혔을 때 하하 (기획자) */
  private roundVoice(state: BattleState, side: Side | null, kind: DuelKind, holderId: UnitId, result: DuelRoundResult, round: number): void {
    const d = this.last;
    if (!d || !side || result === 'tie') return;
    const mineId = state.units[d.challenger]?.side === side ? d.challenger : d.defender;
    const officer = state.units[mineId]?.officer ?? '';
    const holderIsMine = holderId === mineId;
    if (kind === 'debate') {
      if (result === 'hit') playSfx('debate_hit');
      else playSfx('duel_turnover');
      if (result === 'hit' && holderIsMine) playDuelVoice(officer, 'laugh', round);
      return;
    }
    if (result === 'turnover') playSfx('duel_turnover');
    // 이 합을 이긴 쪽 — 공격권 쪽이 이겼으면(hit) 공격권 쪽, 아니면(turnover) 다른 쪽
    const weWon = result === 'hit' ? holderIsMine : !holderIsMine;
    if (weWon) playDuelVoice(officer, 'shout', round);
    else if (result === 'hit') playDuelVoice(officer, 'ouch', round);
  }

  private endText(state: BattleState, kind: DuelKind, reason: 'refused' | 'fled' | 'zero' | 'cap', winner: Side | null): string {
    const d = this.last;
    const unitOf = (s: Side): UnitState | undefined => (d ? [d.challenger, d.defender].map((id) => state.units[id]!).find((u) => u.side === s) : undefined);
    const loser = winner ? unitOf(winner === 'P1' ? 'P2' : 'P1') : undefined;
    const win = winner ? unitOf(winner) : undefined;
    const name = (u?: UnitState): string => (u ? whoOf(state, u.id) : '');
    const head = reason === 'cap' ? t('duel.end.cap')
      : reason === 'refused' ? `${t('duel.end.refused', { who: name(loser), j: josaOf(name(loser), '이가') })} — ${t('duel.end.win', { who: name(win) })}`
      : reason === 'fled' ? `${t('duel.end.fled', { who: name(loser), j: josaOf(name(loser), '이가') })} — ${t('duel.end.win', { who: name(win) })}`
      : t('duel.end.win', { who: name(win) });
    const reward = reason === 'cap'
      ? (kind === 'duel' ? t('duel.reward.drawSp', { n: FORMULA.duelDrawSp }) : t('duel.reward.drawMp', { n: FORMULA.debateDrawMp }))
      : (kind === 'duel' ? t('duel.reward.sp', { n: FORMULA.duelWinSp[state.mode] }) : t('duel.reward.mp', { n: FORMULA.debateWinMp }));
    return `${head} · ${reward}`;
  }
}

function portrait(u: UnitState): HTMLElement {
  const box = el('div', 'dl-portrait');
  const img = document.createElement('img');
  img.alt = '';
  img.src = battleArtUrl(u.officer);
  img.onerror = () => img.remove();
  box.append(img);
  box.title = combatantById.get(u.officer)?.name ?? '';
  return box;
}

function btn(action: string, label: string, onClick: () => void, disabled: boolean, tone?: 'go'): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.action = action;
  b.textContent = label;
  b.disabled = disabled;
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
