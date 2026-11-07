/**
 * 일기토 · 설전 층 — `#duel` (GDD §3.11, 설계서 §4-2 ~ §4-4 · 단계 3c)
 *
 * 판 위에 겹치는 **전체 화면 층**이다(고유기술 팝업 `#skillpop`처럼 프레임 전체). 전투 씬은 멈춘 채 뒤에 있다 — 대결 동안 시간이 안 흐른다.
 *
 * | 걸음 | 뜨는 것 (`data-view`) |
 * |---|---|
 * | 내가 신청받았다(`answering`) | 라벨 그림 · 명판 제목 · 양쪽 판(합 화면의 것) · 예보(`offerForecast`) · 남은 초 · [거절] [수락] (`offer`) |
 * | 내가 걸고 답을 기다린다 | 「…의 답을 기다립니다」 (`wait`) |
 * | 합 | 배경 · 양쪽 초상 · [북] 이름 [무력|지력] 값 · [전의|정신력] 게이지 · 「제 n 합」 · 3 · 2 · 1 · 패 셋 · [도망] (`round`) |
 * | 공개 · 끝 | 두 패가 가운데서 부딪힌다(섬광 · 금빛 먹물) · 결과 한 줄 → 끝이면 승패 · 보상 한 줄 (`round` + `data-reveal`) |
 *
 * **마감은 판정 주체가 잰다** — 응답 10초 · 카운트 3초가 끝나면 그쪽이 수를 넣는다. 여기는 남은 시간(`Playback.remainingMs`)을 그리기만 한다.
 * 공개 연출 동안은 재생기를 멈춘다(`hold`) — 다음 합의 카운트는 판정 주체가 연출 길이(`DUEL_REVEAL_MS`)를 앞에 붙여 잰다.
 * 숫자는 전부 엔진이 낸다(`gaugeOf` · `officerStats` · `duelForecast`).
 *
 * **미리 낸 패** (2026-11-06 기획자) — 합이 열렸는데 내가 아직 안 냈으면 화면이 하나를 골라 **실제로 낸다**(`duelPick`)
 * 그리고 네온으로 보여 준다 — 「안 고르면 이게 나간다」가 거짓말이 안 되려면 그 패가 이미 판에 들어가 있어야 한다
 * (안 낸 패는 카운트가 끝나는 순간 판정 주체가 비밀로 채워서 미리 알 수 없다). 다른 것을 누르면 그것으로 바뀐다.
 * AI 대리(`auto`) 중이면 고르지 않는다 — 대리는 판정 주체가 채운다.
 *
 * **연출 그림** (2026-11-06 기획자, 일기토만) — 가운데 손 아래에 장면 그림이 깔린다: 내 그림의 왼쪽 반 + 상대 그림을 뒤집은 오른쪽 반,
 * 찢긴 종이 선으로 잇는다. 어느 장면 · 어느 그림인지는 `duelScene.ts`가 정하고 여기는 그 장면을 들고 그리기만 한다.
 * 합 화면이 열리면 1(첫 격돌), 공개마다 그 합의 장면, 끝나면 승패 장면. 1 · 2 · 3은 이음매에서 섬광이 터진다.
 */

import { combatantById } from '@samchess/data';
import { DUEL_COUNT_MS, DUEL_END_MS, DUEL_INTRO_FADE_MS, DUEL_INTRO_MS, DUEL_REVEAL_MS, FORMULA, duelForecast, duelRulesOn, gaugeMaxOf, gaugeOf, officerStats } from '@samchess/rules';
import type { BattleEvent, BattleState, DuelKind, DuelPick, DuelRoundResult, DuelState, Side, UnitId, UnitState } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { t } from '../i18n/index.ts';
import { battleArtUrl } from './art.ts';
import { whoOf } from './contextPanel.ts';
import { josaOf } from './eventText.ts';
import { gameIconEl, type GameIconName } from './gameIcon.ts';
import { playSfx } from '../audio/sfx.ts';
import { SCENE_FLASH, sceneOfEnd, sceneOfRound, sceneUrls, type DuelScene } from './duelScene.ts';
import { playChallengeSound, playDuelVoice, stopChallengeSound } from '../audio/duelSound.ts';

export interface DuelHandlers {
  answer(accept: boolean): void;
  pick(pick: DuelPick): void;
  flee(): void;
}

/**
 * 끝 장면(승패 · 보상 한 줄 · 승패 그림)을 보여 주는 시간 — 공개 연출 뒤에 이어진다. 값은 `timing.ts`의 `DUEL_END_MS` —
 * 서버가 그만큼 늦게 다음 차례의 20초를 센다(화면만 늘리면 다음 사람의 시간을 먹는다).
 */
const END_MS = DUEL_END_MS;
/** 끝 장면 마지막의 걷힘 — 층 전체가 이만큼 서서히 사라진다(「딱 끊긴다」 2026-11-06 기획자). `style.css`의 `dl-close`와 같은 값 */
const CLOSE_MS = 700;
/** 합 번호가 바뀐 뒤 머리가 반짝이는 길이 — `style.css`의 `dl-flash`와 같은 값 */
const FLASH_MS = 700;
/** 결과 효과음 · 목소리를 공개 소리 뒤로 미는 시간 — 두 패가 가운데서 부딪히는 때(`.dl-fx`의 0.25초 + 반쯤) */
const RESULT_SFX_DELAY = 420;
/** 장면 그림이 바뀔 때 스며드는 길이 · 섬광 길이 — `style.css`의 `dl-scene-in` · `dl-scene-flash`와 같은 값 */
const SCENE_IN_MS = 450;
/** 승패 그림(4 · 5 · 6)은 천천히 떠오른다 — `dl-scene-in-slow` */
const SCENE_IN_SLOW_MS = 1_100;
const SCENE_FLASH_MS = 700;
/** 맞은 쪽 초상이 떨고 섬광이 번지는 길이 — 목소리(`RESULT_SFX_DELAY`)와 함께 시작한다. `style.css`의 `dl-shake` · `dl-hit-*`와 같은 값 */
const HIT_MS = 650;
/**
 * 설전의 말 — 두 장수가 말풍선으로 주고받는다(2026-11-07 기획자: 아이콘만으로는 무엇을 말하는지 한눈에 안 들어온다).
 * 첫 말은 공개와 함께, 둘째는 `SAY_GAP_MS` 뒤. 말풍선은 공개 연출(1.5초)이 끝나도 다음 합의 카운트 앞머리까지 남는다(`SAY_MS`) —
 * 공개를 늘리면 합 열 번의 상한(`DUEL_MAX_MS` < 재접속 유예)을 넘어서, 늘리지 않고 읽을 시간을 카운트 쪽에서 빌린다.
 * 결과(정신력 −n · 공격권)는 둘째 말 뒤(`DEBATE_RESULT_DELAY`) — `style.css`의 `dl-say-*` · 설전 `.dl-line` 지연과 같은 값
 */
const SAY_GAP_MS = 500;
const SAY_MS = 3_000;
const SAY_OUT_MS = 350;
const DEBATE_RESULT_DELAY = 900;
const resultDelay = (kind: DuelKind): number => kind === 'debate' ? DEBATE_RESULT_DELAY : RESULT_SFX_DELAY;
/**
 * 결과 한 줄(공격 · 공격권 · 비김 말풍선)이 떠 있는 시간 — 떠오른 때부터. 공개(1.5초)가 끝나도 카운트와 따로 그 자리에 남는다
 * (2026-11-07 기획자: 「공격권이 …에게 넘어갔다」가 너무 짧다). 떠오르는 때는 `style.css`의 `.dl-line` 지연(일기토 0.45초 · 설전 0.9초)
 */
const LINE_STAY_MS = 2_000;
const LINE_OUT_MS = 350;
const lineAppear = (kind: DuelKind): number => kind === 'debate' ? DEBATE_RESULT_DELAY : 450;

/** 지금 깔린 장면 — 언제 바뀌었나 · 얼마에 걸쳐 떠오르나 · 섬광은 바뀐 뒤 얼마 만에 터지나 */
interface SceneNow { duel: string; n: DuelScene; at: number; fade: number; flashDelay: number }

const PICKS: Record<DuelKind, readonly DuelPick[]> = { duel: ['rock', 'paper', 'scissors'], debate: [1, 2, 3] };
const PICK_ICON = (p: DuelPick): GameIconName =>
  (typeof p === 'number' ? `debate-${p}` : `rps-${p}`) as GameIconName;
/** 패 이름 — 일기토는 바위 · 보 · 가위, 설전은 세 논점 명분 · 실리 · 대세(엔진의 1 · 2 · 3, 2026-11-07 기획자 — 숫자 맞히기는 설전과 안 어울렸다) */
const pickLabel = (p: DuelPick): string => t(`duel.pick.${p}`);

/** 설전 한 합의 말 둘 — 어느 대결 · 언제 시작했나 · 말한 차례대로(`l` 왼쪽 장수 · `r` 오른쪽 장수) */
interface Talk { duel: string; at: number; lines: { at: 'l' | 'r'; text: string }[] }
interface Reveal { round: number; picks: Record<Side, DuelPick>; holder: UnitId; result: DuelRoundResult; damage: number; until: number }
/** 끝난 공개의 결과 한 줄 — 공개가 걷힌 뒤에도 `until`까지 남는다 */
interface Linger { duel: string; reveal: Reveal; until: number }
/**
 * 끝 장면 — 크게 「승리 · 패배 · 무승부」(보는 사람 기준, 관전이면 「…의 승리」), 그 아래 작게 결과 한 줄(도망 · 거절 · 보상).
 * `text`는 둘을 이은 것 — 다시 지을지 가르는 열쇠다.
 */
interface Ending { verdict: string; tone: 'win' | 'lose' | 'draw'; detail: string; text: string; until: number; loser?: UnitId }

export class DuelLayer {
  /** 대결의 마지막 모습 — 끝난 뒤(`state.duel`이 지워진 뒤)에도 끝 장면을 그리려고 들고 있다 */
  private last: DuelState | null = null;
  private reveal: Reveal | null = null;
  private ending: Ending | null = null;
  /**
   * 대결 중에 보인 능력치(일기토 무력 · 설전 지력) — 끝 장면은 이 값으로 그린다. 게이지 0으로 지면 엔진이 그 자리에서 다치게 해
   * (`woundByDuel`) 상태의 무력이 곧장 깎이는데, 대결 화면에서는 「패배」 도장만 찍고 깎인 값은 전투 화면으로 돌아와서 보인다 (2026-11-07 기획자)
   */
  private shownStat: { key: string; v: Record<string, number> } | null = null;
  private lastKey = '';
  private lastCount = -1;
  private countEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  /** 화면이 미리 낸 패 — 어느 합의 무엇인가(`roundKey`) */
  private suggested: { key: string; pick: DuelPick } | null = null;
  /** 사람이 손으로 누른 합 — 그 합은 네온이 아니라 「골랐다」로 그린다 */
  private chose = '';
  /** 합 번호가 바뀐 때 — 그 뒤 잠깐 머리가 반짝인다. 걸음마다 다시 지어도 반짝임이 처음부터 다시 돌지 않게 시각을 든다 */
  private flash = { key: '', at: 0 };
  /** 마지막으로 소리 낸 카운트 — 다시 지어도(미리 낸 패가 돌아와도) 같은 숫자를 또 울리지 않는다 */
  private tickKey = '';
  /** 기합 번갈이 — 하하 1 · 2, 기합 1 · 2를 **나올 때마다** 번갈아 (2026-11-06 기획자) */
  private laughs = 0;
  private shouts = 0;
  /** 지금 깔린 장면 — 어느 대결(`duel`)의 몇 번인가 · 언제 바뀌었나. 다시 지어도 스밈 · 섬광이 처음부터 다시 돌지 않게 시각을 든다 */
  private scene: SceneNow | null = null;
  /** 승패 그림은 마지막 공개가 끝난 뒤에 — 같은 통에 마지막 합과 끝이 함께 와도 그 합의 장면을 먼저 보인다 */
  private pendingScene: SceneNow | null = null;
  /** 맞은 장수 · 그 떨림이 시작하는 때(목소리와 같은 때) — 어느 쪽이 맞았는지 눈으로 (2026-11-06 기획자) */
  private hit: { unit: UnitId; at: number } | null = null;
  /** 지금 그린 대결이 첫 합을 기다리는가 — 그러면 남은 시간의 앞 5초가 준비(`DUEL_INTRO_MS`)다. `tick`이 읽는다 */
  private introOf: { duel: string; kind: DuelKind } | null = null;
  /** 준비의 소리를 낸 대결 — 다시 지어도 · 매 프레임 불려도 대결마다 한 번 */
  private introSounds = new Set<string>();
  /** 설전의 말풍선 — 다시 지어도 처음부터 다시 튀어나오지 않게 시작 시각을 든다 */
  private talk: Talk | null = null;
  /** 결과 한 줄을 공개 뒤에도 잠깐 더 — `LINE_STAY_MS` */
  private linger: Linger | null = null;
  /**
   * 끝 장면이 처음 그려진 때 — 끝 말풍선 · 「패배」 도장이 다시 지어도 처음부터 다시 튀어나오지 않게(음수 지연).
   * 끝 장면 도중에 말 · 결과 한 줄이 걷히고 대결 단계가 닫히며 두세 번 다시 지어져, 말풍선이 「두 번 나오는」 것으로 보였다 (2026-11-07 기획자)
   */
  private endShown: { text: string; at: number } | null = null;
  private endSince(): number {
    const text = this.ending?.text ?? '';
    if (this.endShown?.text !== text) this.endShown = { text, at: this.now() };
    return this.now() - this.endShown.at;
  }

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
    let d = this.last;
    let held = 0;
    for (const e of events) {
      // SP가 상한에 닿았다 — SP MAX 버프가 켜진다(GDD §3.11 R15). 소리는 따로 안 받고 `roar2`(기획자 11-05)
      if (e.e === 'spChanged' && duelRulesOn(state) && e.to >= state.spCap[e.side]) playSfx('roar2');
      if (e.e === 'challengeOffered') {
        // 받는 쪽(AI)이 같은 통에서 곧장 거절하면 `state.duel`은 이미 지워져 있다 — 이벤트로 대결의 모습을 세운다.
        // 안 그러면 그릴 것이 없어(또는 앞 대결이 남아) 거절 끝 장면이 아예 안 떴다 (2026-11-06)
        this.last = state.duel ? structuredClone(state.duel)
          : { kind: e.kind, challenger: e.by, defender: e.to, step: 'round', round: 1, holder: e.to, picks: {}, auto: {}, history: [] };
        d = this.last;
        this.ending = null;
        playChallengeSound();
      } else if (e.e === 'challengeAnswered') {
        stopChallengeSound();
      } else if (e.e === 'duelRound' && d) {
        this.reveal = { round: e.round, picks: e.picks, holder: e.holder, result: e.result, damage: e.damage, until: this.now() + DUEL_REVEAL_MS };
        this.setScene(d, sceneOfRound(e.result, e.holder === leftOf(state, side, d)));
        // 맞았으면 맞은 쪽 초상이 떨고 섬광이 번진다 — 목소리와 같은 때
        if (e.result === 'hit') this.hit = { unit: e.holder === d.challenger ? d.defender : d.challenger, at: this.now() + resultDelay(d.kind) };
        this.linger = { duel: duelKey(d), reveal: this.reveal, until: this.now() + lineAppear(d.kind) + LINE_STAY_MS };
        this.talk = d.kind === 'debate' ? { duel: duelKey(d), at: this.now(), lines: talkLines(state, side, d, e.holder, e.picks, e.result) } : null;
        held += DUEL_REVEAL_MS;
        playSfx('duel_reveal');
        this.roundVoice(state, side, d.kind, e.holder, e.result);
      } else if (e.e === 'duelEnded') {
        stopChallengeSound();
        if (e.reason === 'refused') playSfx('duel_refuse');
        this.ending = { ...this.endText(state, side, e.kind, e.reason, e.winner ?? null), until: 0 };
        if (d) {
          const leftSide = state.units[leftOf(state, side, d)]?.side;
          this.pendingScene = { duel: duelKey(d), n: sceneOfEnd(e.winner ? e.winner === leftSide : null), at: this.now() + held, fade: SCENE_IN_SLOW_MS, flashDelay: 0 };
        }
        // 결판이 나면 함성 — 승패 그림과 같은 때(마지막 공개 뒤)
        setTimeout(() => playSfx('duel_cheer'), held);
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
    if (this.pendingScene && now >= this.pendingScene.at) {
      this.scene = this.pendingScene;
      this.pendingScene = null;
      this.lastKey = '';   // 걸음이 그대로여도 그림은 바꿔 그린다
    }
    // 끝 장면의 마지막 — 층 전체가 서서히 걷힌다
    if (this.ending && now > this.ending.until - CLOSE_MS) this.root.dataset.closing = '1';
    else delete this.root.dataset.closing;
    const d = state.duel ?? (this.reveal || this.ending ? this.last : null);
    if (state.duel && !this.ending) {
      const live = state.duel;
      this.shownStat = { key: duelKey(live), v: Object.fromEntries([live.challenger, live.defender].map((id) => [id, statOf(state.units[id]!, live.kind)])) };
    }
    const view = !d ? 'closed'
      : d.step === 'offer' && state.phase === 'duel' ? (phase === 'answering' ? 'offer' : 'wait')
      : 'round';

    const key = `${view}|${phase}|${busy}|${this.talkLive(now) ? 'say' : ''}|${this.lingerLive(now) ? 'line' : ''}|${d ? JSON.stringify([d.round, d.holder, d.picks, d.auto, d.step]) : ''}`
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
      // 목판 위 — 라벨 그림(맥락 판 물음의 것) · 명판 제목 · 합 화면과 같은 양쪽 판(왼쪽 나 · 오른쪽 건 쪽) · 예보 · 남은 초 · 단추 (2026-11-07 기획자)
      const box = el('div', 'dl-offer');
      const who = whoOf(state, challenger.id);
      const banner = el('div', 'dl-of-banner');
      banner.style.backgroundImage = `url(duel/label-${d.kind}.jpg)`;
      const sides = el('div', 'dl-sides');
      sides.append(this.sideCard(state, defender, d, 'me', true), this.sideCard(state, challenger, d, 'foe', false));
      box.append(banner,
        text('div', 'dl-title', t('duel.offer.title', { who, j: josaOf(who, '이가'), kind: kindName, o: josaOf(kindName, '을를') })),
        sides, ...offerForecast(state, defender, challenger.id, d.kind),
        text('div', 'dl-note dl-refuse-note', t('duel.offer.refuseNote', { who })));
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
      // 건 쪽 — 받는 팝업과 같은 꼴(왼쪽 나 · 오른쪽 받는 쪽)에, 단추 자리를 같은 높이의 「상대방이 결정중입니다.」가 차지한다 (2026-11-07 기획자)
      const box = el('div', 'dl-offer dl-wait');
      const banner = el('div', 'dl-of-banner');
      banner.style.backgroundImage = `url(duel/label-${d.kind}.jpg)`;
      const sides = el('div', 'dl-sides');
      sides.append(this.sideCard(state, challenger, d, 'me', true), this.sideCard(state, defender, d, 'foe', false));
      box.append(banner, text('div', 'dl-title', t('duel.offer.wait', { who: whoOf(state, defender.id) })),
        sides, ...offerForecast(state, challenger, defender.id, d.kind));
      this.timerEl = text('div', 'dl-timer', '');
      box.append(this.timerEl, text('div', 'dl-deciding', t('duel.offer.deciding')));
      this.root.replaceChildren(box);
      return;
    }

    // 합 — 왼쪽이 나, 오른쪽이 상대(관전이면 건 쪽이 왼쪽)
    const meFirst = !side || challenger.side === side;
    const [left, right] = meFirst ? [challenger, defender] : [defender, challenger];
    const stage = el('div', 'dl-stage');
    stage.style.backgroundImage = `url(duel/bg-${d.kind}.jpg)`;
    const head = text('div', 'dl-round', t('duel.round', { n: Math.min(d.round, FORMULA.duelRounds), max: FORMULA.duelRounds }));
    // 합 번호가 갱신될 때마다 한 번 반짝 — 다시 지어도 그 자리부터 이어 돈다(음수 지연)
    const fk = `${d.challenger}>${d.defender}:${d.kind}:${d.round}`;
    if (this.flash.key !== fk) this.flash = { key: fk, at: this.now() };
    const since = this.now() - this.flash.at;
    if (since < FLASH_MS) { head.classList.add('dl-flash'); head.style.animationDelay = `-${Math.round(since)}ms`; }
    const sides = el('div', 'dl-sides');
    sides.append(this.sideCard(state, left, d, 'me', !!side && left.side === side), this.sideCard(state, right, d, 'foe', !!side && right.side === side));

    const center = el('div', 'dl-center');
    // 첫 합 전이면 준비 — 그림이 3초에 걸쳐 떠오르고(섬광은 징과 함께), 「일기토 시작!」 2초 뒤 카운트 (2026-11-06 기획자)
    const first = state.phase === 'duel' && d.history.length === 0 && !this.reveal && !this.ending;
    this.introOf = first ? { duel: duelKey(d), kind: d.kind } : null;
    // 대결이 열린 첫 모습은 첫 격돌 — 공개 · 끝이 오면 그 장면으로 바뀐다. 설전도 같은 틀(그림만 다르다, 2026-11-06)
    if (this.scene?.duel !== duelKey(d)) this.setScene(d, 1, first ? DUEL_INTRO_FADE_MS : SCENE_IN_MS, first ? DUEL_INTRO_FADE_MS : 0);
    center.append(this.sceneView(d.kind, left.officer, right.officer));
    if (this.reveal) center.append(this.revealView(state, d.kind, left, right, this.reveal));
    else if (this.ending) {
      // 가운데에 크게 — 판정(붓글씨) 한 줄 + 결과 한 줄 (2026-11-06 기획자)
      const b = el('div', 'dl-end dl-bubble');
      b.dataset.bubble = 'end';
      b.dataset.tone = this.ending.tone;
      b.append(text('div', 'dl-verdict', this.ending.verdict), text('div', 'dl-detail', this.ending.detail));
      b.style.animationDelay = `${Math.round(250 - this.endSince())}ms`;
      center.append(b);
    }
    else {
      this.countEl = text('div', 'dl-count', '');
      center.append(this.countEl);
      if (first) {
        const go = text('div', 'dl-start dl-bubble', t(`duel.start.${d.kind}`));
        go.dataset.bubble = 'end';
        center.append(go);
      }
    }
    // 공개가 걷힌 뒤에도 결과 한 줄은 같은 자리에 — 카운트와 따로 떠 있다가 걷힌다(끝 장면에는 안 겹친다)
    if (!this.reveal && !this.ending && this.linger?.duel === duelKey(d) && this.lingerLive(this.now())) {
      const box = this.revealView(state, d.kind, left, right, this.linger.reveal);
      box.classList.add('dl-linger');
      const line = box.querySelector<HTMLElement>('.dl-line');
      if (line) line.style.animationDelay = `${Math.round(this.linger.until - LINE_OUT_MS - this.now())}ms`;
      center.append(box);
    }
    if (this.talk?.duel === duelKey(d) && (this.reveal || !this.ending) && this.talkLive(this.now())) center.append(...this.talkView(this.talk));
    stage.append(head, sides, center);

    if (this.ending && !this.reveal) {
      this.root.dataset.reveal = 'end';
    } else {
      this.root.dataset.reveal = this.reveal ? this.reveal.result : '';
    }

    const mine = side ? (challenger.side === side ? challenger : defender.side === side ? defender : null) : null;
    // 끝 장면에서도 아래 칸(안내 · 패 · 도망)은 그대로 두고 꺼서 흐리게 — 걷으면 가운데 칸이 길어져 그림이 아래로 내려앉는다 (2026-11-06 기획자)
    if (this.ending) stage.dataset.ended = '1';
    if (mine && (state.phase === 'duel' || this.ending)) {
      const hold = d.holder === mine.id;
      stage.append(text('div', 'dl-hint', t(`duel.hint.${d.kind}.${hold ? 'hold' : 'chase'}`)));
      const picks = el('div', 'dl-picks');
      const chosen = d.picks[mine.side];
      const key = roundKey(d);
      const live = phase === 'dueling' && !busy && !this.reveal && !this.ending;
      // 아직 안 냈고 대리도 아니면 하나를 골라 낸다 — 다음 통에 `chosen`으로 돌아온다. 짓는 도중에 판을 밀지 않게 다음 틱에
      if (live && chosen === undefined && !d.auto[mine.side] && this.suggested?.key !== key) {
        const pool = PICKS[d.kind];
        const pick = pool[Math.floor(Math.random() * pool.length)]!;
        this.suggested = { key, pick };
        setTimeout(() => this.on.pick(pick), 0);
      }
      const shown = chosen ?? (this.suggested?.key === key ? this.suggested.pick : undefined);
      const neon = this.chose !== key && this.suggested?.key === key && shown === this.suggested.pick;
      for (const p of PICKS[d.kind]) {
        const b = document.createElement('button');
        b.className = 'dl-pick';
        b.dataset.pick = String(p);
        if (shown === p) b.dataset[neon ? 'suggested' : 'picked'] = '1';
        b.disabled = !live;
        b.append(gameIconEl(PICK_ICON(p), pickLabel(p)));
        b.title = pickLabel(p);
        // 다시 짓기를 청한다 — 미리 낸 패를 그대로 누르면 판의 패가 안 바뀌어 열쇠도 그대로라, 네온이 「골랐다」로 안 바뀌었다
        // (스모크가 그 패가 둘째 단추일 때만 떨어져 흔들림처럼 보였다, 2026-11-07)
        b.addEventListener('click', () => { this.chose = key; this.lastKey = ''; this.on.pick(p); });
        picks.append(b);
      }
      const flee = btn('flee', t('duel.flee'), () => this.on.flee(), !live);
      flee.prepend(gameIconEl('duel-fled', ''));
      stage.append(picks, flee);
    }
    this.root.replaceChildren(stage);
  }

  private setScene(d: DuelState, n: DuelScene, fade = SCENE_IN_MS, flashDelay = 0): void {
    this.scene = { duel: duelKey(d), n, at: this.now(), fade, flashDelay };
  }

  /**
   * 장면 그림 — 아래는 상대 그림을 뒤집은 것, 위는 내 그림을 찢긴 선(`tear.png`)으로 가린 것, 그 위에 선의 그림자 · 섬광.
   * 바뀐 지 얼마나 됐는지를 음수 지연으로 넘겨, 걸음마다 다시 지어도 스밈 · 섬광이 이어 돈다.
   */
  private sceneView(kind: DuelKind, leftOfficer: string, rightOfficer: string): HTMLElement {
    const sc = this.scene!;
    const url = sceneUrls(kind, sc.n, leftOfficer, rightOfficer);
    const since = this.now() - sc.at;
    const box = el('div', 'dl-scene');
    box.dataset.scene = String(sc.n);
    const half = (cls: string, src: string): HTMLElement => {
      const h = el('div', cls);
      h.style.backgroundImage = `url(${src})`;
      return h;
    };
    box.append(half('dl-scene-r', url.right), half('dl-scene-l', url.left));
    const line = document.createElement('img');
    line.className = 'dl-scene-line';
    line.alt = '';
    line.src = 'duel/scene/tear-line.png';
    box.append(line);
    if (since < sc.fade) {
      // 짧으면 번쩍 스미고, 길면(준비 · 승패) 살짝 다가오며 떠오른다
      box.classList.add(sc.fade >= 1_000 ? 'dl-scene-in-slow' : 'dl-scene-in');
      box.style.animationDuration = `${sc.fade}ms`;
      box.style.animationDelay = `-${Math.round(since)}ms`;
    }
    const size = SCENE_FLASH[sc.n];
    if (size && since < sc.flashDelay + SCENE_FLASH_MS) {
      const fx = document.createElement('img');
      fx.className = 'dl-scene-flash';
      fx.alt = '';
      fx.src = `duel/${kind === 'duel' ? 'clash' : 'ink'}.png`;
      fx.style.width = `${size * 100}%`;
      fx.style.animationDelay = `${Math.round(sc.flashDelay - since)}ms`;
      box.append(fx);
    }
    return box;
  }

  private sideCard(state: BattleState, u: UnitState, d: DuelState, cls: string, mine: boolean): HTMLElement {
    const card = el('div', `dl-side ${cls}`);
    card.dataset.unit = u.id;
    // 판때기 속은 진영 색 — 남군 푸른빛 · 북군 붉은빛 (2026-11-06 기획자)
    card.dataset.side = u.side;
    const name = whoOf(state, u.id);
    const g = gaugeOf(u, d.kind);
    const kept = this.ending && this.shownStat?.key === duelKey(d) ? this.shownStat.v[u.id] : undefined;
    const stat = kept ?? statOf(u, d.kind);
    // 이름 줄 — [북(공격권)] 이름 [무력|지력 그림] 값. 능력치 그림은 장수 카드 · 신청 확인창과 같은 것
    const nameRow = el('div', 'dl-name-row');
    if (d.holder === u.id) {
      const drum = gameIconEl('duel-initiative', t(`duel.hint.${d.kind}.hold`));
      drum.classList.add('dl-holder');
      nameRow.append(drum);
      card.dataset.holder = '1';
    }
    const statImg = document.createElement('img');
    statImg.className = 'dl-stat-icon';
    statImg.src = `icons/stat-${d.kind === 'duel' ? 'might' : 'intellect'}.png`;
    statImg.alt = statImg.title = t(`duel.stat.${d.kind}`);
    nameRow.append(text('span', 'dl-name', name), statImg, text('b', 'dl-stat-v', String(stat)));
    // 게이지 줄 — [전의|정신력 그림] 그 오른쪽에 막대
    const bar = el('div', 'dl-gauge');
    bar.dataset.gauge = String(g);
    const fill = el('div', 'dl-fill');
    // 상한은 장수마다 다르다 — 100 + 판 시작의 무력 · 지력 (2026-11-06 기획자)
    const max = gaugeMaxOf(u, d.kind);
    fill.style.width = `${Math.max(0, Math.min(100, (g / max) * 100))}%`;
    bar.append(fill, text('span', 'dl-gv', `${g}/${max}`));
    const gaugeRow = el('div', 'dl-gauge-row');
    gaugeRow.append(gameIconEl(d.kind === 'duel' ? 'stat-morale' : 'stat-mental', t(`duel.gauge.${d.kind}`)), bar);
    const face = portrait(u);
    // 맞은 쪽 — 초상이 부르르 떨고 섬광(`duel/hit.png`, 없으면 붉은 번쩍임만)이 번진다. 시작 전이면 양수 지연으로 기다린다
    const h = this.hit;
    if (h && h.unit === u.id && this.now() < h.at + HIT_MS) {
      card.classList.add('dl-hit');
      card.style.setProperty('--hit-delay', `${Math.round(h.at - this.now())}ms`);
      const fx = document.createElement('img');
      fx.className = 'dl-hit-fx';
      fx.alt = '';
      fx.src = 'duel/hit.png';
      fx.onerror = () => fx.remove();
      face.append(fx);
    }
    // 진 쪽 — 공개 연출이 끝난 끝 장면에서 초상에 붉은 「패배」 도장
    if (this.ending?.loser === u.id && !this.reveal) {
      card.dataset.lost = '1';
      const stamp = text('div', 'dl-lost', t('result.lose'));
      // 초상 폭(6rem)이 좁다 — 긴 낱말(Sconfitta · Ялагдал)은 글자를 줄인다
      if (stamp.textContent!.length > 4) stamp.dataset.long = '1';
      stamp.style.animationDelay = `${Math.round(-this.endSince())}ms`;
      face.append(stamp);
    }
    card.append(face, nameRow, gaugeRow);
    // 「AI 대리 중」은 내 쪽만 — AI 상대의 패는 언제나 판정 주체가 채우므로 그쪽 표지는 뜻이 없다
    if (mine && d.auto[u.side]) card.append(text('div', 'dl-auto', t('duel.auto')));
    return card;
  }

  private lingerLive(now: number): boolean {
    return !!this.linger && now < this.linger.until;
  }

  private talkLive(now: number): boolean {
    return !!this.talk && now - this.talk.at < SAY_MS;
  }

  /**
   * 설전의 말풍선 둘 — 만화처럼 톡 튀어나와(살짝 넘쳤다 돌아오며 기울어) 제 장수 쪽 위에 선다. 먼저 말한 쪽이 위.
   * 다시 지어도 그 자리부터 이어 돈다(음수 지연) — 튀어나옴 · 걷힘 두 애니메이션의 지연을 함께 적는다
   */
  private talkView(talk: Talk): HTMLElement[] {
    const since = this.now() - talk.at;
    return talk.lines.map((line, i) => {
      const b = text('div', `dl-say dl-say-${line.at}`, line.text);
      b.dataset.order = String(i);
      b.style.animationDelay = `${Math.round(i * SAY_GAP_MS - since)}ms, ${Math.round(SAY_MS - SAY_OUT_MS - since)}ms`;
      return b;
    });
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
      h.dataset.pick = String(r.picks[u.side]);
      return h;
    };
    const holder = whoOf(state, r.holder);
    const other = whoOf(state, r.holder === left.id ? right.id : left.id);
    const line = r.result === 'hit' ? t('duel.result.hit', { who: holder, gauge: t(`duel.gauge.${kind}`), n: r.damage })
      : r.result === 'turnover' ? t('duel.result.turnover', { who: other })
      : t('duel.result.tie');
    // 결과 한 줄은 말풍선 위 — 공격은 들쭉날쭉, 공격권은 둥근 별, 비김은 잔잔한 네모 (2026-11-06 기획자)
    const kindOf = r.result === 'hit' ? 'hit' : r.result === 'turnover' ? 'turn' : 'tie';
    box.append(hand(left, 'l'), r.result === 'tie' ? el('span', '') : fx, hand(right, 'r'), bubble('dl-line', kindOf, line));
    return box;
  }

  /** 카운트 숫자 · 응답 남은 초 — 매 프레임. 둘째 합부터는 공개 연출 몫이 앞에 붙어 있어 3초 안쪽만 센다 */
  private tick(remainingMs: number | null, view: string): void {
    if (this.timerEl) this.timerEl.textContent = remainingMs === null ? '' : `⏱ ${Math.ceil(remainingMs / 1000)}`;
    // 준비 — 남은 시간의 앞부분이 준비다(첫 합 마감 = 준비 + 카운트). 남은 시간으로 재므로 다시 지어도 · 다시 붙어도 그 자리부터
    const intro = this.introOf;
    const stage = intro && view === 'round' && remainingMs !== null && remainingMs > DUEL_COUNT_MS
      ? (DUEL_INTRO_MS + DUEL_COUNT_MS - remainingMs < DUEL_INTRO_FADE_MS ? 'fade' : 'start') : '';
    if (stage) this.root.dataset.intro = stage;
    else delete this.root.dataset.intro;
    if (intro && stage) {
      const k = intro.duel;
      if (!this.introSounds.has(`${k}:in`)) {
        this.introSounds.add(`${k}:in`);
        // 말발굽 원본이 함성보다 약 13dB 작다 — 일기토에서는 함성을 낮추고 말발굽을 끝까지 올려 둘 다 들리게 섞는다(원본은 다시 굽지 않는다)
        const duel = intro.kind === 'duel';
        playSfx('duel_crowd', { volume: duel ? 0.55 : 1 });
        if (duel) playSfx('duel_hooves', { volume: 1.25 });
      }
      if (stage === 'start' && !this.introSounds.has(`${k}:go`)) {
        this.introSounds.add(`${k}:go`);
        playSfx('duel_gong');
      }
    }
    if (!this.countEl || remainingMs === null || view !== 'round') return;
    const n = remainingMs > DUEL_COUNT_MS ? 0 : Math.max(1, Math.ceil(remainingMs / 1000));
    if (n === this.lastCount) return;
    this.lastCount = n;
    this.countEl.textContent = n ? String(n) : '';
    // 소리는 합 · 숫자마다 한 번 — 다시 지으면 `lastCount`가 풀려 같은 「3」을 또 울렸다(미리 낸 패가 돌아오는 순간)
    const tk = `${this.flash.key}:${n}`;
    if (n && tk !== this.tickKey) { this.tickKey = tk; playSfx(n === 1 ? 'duel_tick_long' : 'duel_tick'); }
  }

  // ── 소리 · 글 ────────────────────────────────────────────────

  /**
   * 합의 소리 — 일기토 · 설전이 **같은 규칙**이다 (2026-11-06 기획자):
   * 상대에게서 공격권을 가져오면 하하(1 · 2 번갈아), 우리 공격이 맞으면 기합(1 · 2 번갈아), 우리가 맞으면 으악. 비김 · 공격권을 잃음은 목소리가 없다.
   * 효과음(공격권 넘어감 · 설전 맞힘)과 목소리는 **두 패가 부딪힌 뒤**(`RESULT_SFX_DELAY`)에 낸다 — 공개 소리와 같은 순간에 내면
   * 더 크고 긴 공개 소리에 묻혀 안 들렸다(실측: 같은 ms에 셋이 겹쳤다).
   */
  private roundVoice(state: BattleState, side: Side | null, kind: DuelKind, holderId: UnitId, result: DuelRoundResult): void {
    const d = this.last;
    if (!d || result === 'tie') return;
    const later = (f: () => void): void => { setTimeout(f, resultDelay(kind)); };
    if (result === 'turnover') later(() => playSfx('duel_turnover'));
    else if (kind === 'debate') later(() => playSfx('debate_hit'));
    if (!side) return;
    const mineId = state.units[d.challenger]?.side === side ? d.challenger : d.defender;
    const officer = state.units[mineId]?.officer ?? '';
    const holderIsMine = holderId === mineId;
    if (result === 'turnover') {
      // 공격권이 상대 → 우리로 왔을 때만
      if (!holderIsMine) { const n = this.laughs++; later(() => playDuelVoice(officer, 'laugh', n)); }
      return;
    }
    if (holderIsMine) { const n = this.shouts++; later(() => playDuelVoice(officer, 'shout', n)); }
    else later(() => playDuelVoice(officer, 'ouch', 0));
  }

  private endText(state: BattleState, side: Side | null, kind: DuelKind, reason: 'refused' | 'fled' | 'zero' | 'cap', winner: Side | null): Omit<Ending, 'until'> {
    const d = this.last;
    const unitOf = (s: Side): UnitState | undefined => (d ? [d.challenger, d.defender].map((id) => state.units[id]!).find((u) => u.side === s) : undefined);
    const loser = winner ? unitOf(winner === 'P1' ? 'P2' : 'P1') : undefined;
    const win = winner ? unitOf(winner) : undefined;
    const name = (u?: UnitState): string => (u ? whoOf(state, u.id) : '');
    // 크게 쓰는 판정 — 보는 사람 기준. 관전이면 누가 이겼는지를 쓴다
    const tone: Ending['tone'] = !winner ? 'draw' : !side ? 'win' : winner === side ? 'win' : 'lose';
    const verdict = !winner ? t('result.draw') : !side ? t('duel.end.win', { who: name(win) }) : t(winner === side ? 'result.win' : 'result.lose');
    // 작게 쓰는 결과 — 어떻게 끝났나(도망 · 거절 · 결판 없음) + 보상. 결판이 나면 보상만
    const how = reason === 'cap' ? t('duel.end.cap')
      : reason === 'refused' ? t('duel.end.refused', { who: name(loser), j: josaOf(name(loser), '이가') })
      : reason === 'fled' ? t('duel.end.fled', { who: name(loser), j: josaOf(name(loser), '이가') })
      : '';   // 게이지 0으로 난 결판은 「누구의 승리」를 안 쓴다 — 판정 아래 곧장 보상 (2026-11-07 기획자)
    const reward = reason === 'cap'
      ? (kind === 'duel' ? t('duel.reward.drawSp', { n: FORMULA.duelDrawSp }) : t('duel.reward.drawMp', { n: FORMULA.debateDrawMp }))
      : (kind === 'duel' ? t('duel.reward.sp', { n: FORMULA.duelWinSp[state.mode] }) : t('duel.reward.mp', { n: FORMULA.debateWinMp }));
    // 정보 하나에 한 줄 — 어떻게 끝났나 / 이긴 쪽 / 진 쪽. 보상의 「·」에서도 끊는다 (2026-11-07 기획자: 폭에 아슬아슬하게 걸려 아무 데서나 두 줄이 됐다)
    const detail = [how, ...reward.split(/\s*[·・]\s*/)].filter(Boolean).join('\n');
    return { verdict, tone, detail, text: `${verdict}|${detail}`, ...(loser ? { loser: loser.id } : {}) };
  }
}

/** 대결에 쓰는 능력치 — 일기토 무력 · 설전 지력 */
const statOf = (u: UnitState, kind: DuelKind): number => (kind === 'duel' ? officerStats(u).might : officerStats(u).intellect);

/** 한 대결 — 장면을 대결마다 새로 시작한다 */
const duelKey = (d: DuelState): string => `${d.challenger}>${d.defender}:${d.kind}`;

/** 화면 왼쪽의 장수 — 나(관전이면 건 쪽). `build`의 좌우와 같은 규칙 */
/**
 * 설전 한 합의 말 둘 (2026-11-07 기획자). 공격권 쪽이 상대가 기댈 논점을 맞히는 판이다:
 * - 맞힘(같은 논점) — 받는 쪽이 「{논점}이 중요하오!」, 공격권 쪽이 「그리 말할 줄 알았소!」
 * - 빗나감(다른 논점) — 공격권 쪽이 「{제 논점}이 중요하오!」, 받는 쪽이 「내 얘길 들어보시오!」(공격권을 가져간다)
 */
function talkLines(state: BattleState, side: Side | null, d: DuelState, holder: UnitId, picks: Record<Side, DuelPick>, result: DuelRoundResult): Talk['lines'] {
  const left = leftOf(state, side, d);
  const other = holder === d.challenger ? d.defender : d.challenger;
  const at = (id: UnitId): 'l' | 'r' => (id === left ? 'l' : 'r');
  const point = (id: UnitId): string => {
    const name = pickLabel(picks[state.units[id]!.side]);
    return t('duel.say.point', { pick: name, j: josaOf(name, '이가') });
  };
  return result === 'hit'
    ? [{ at: at(other), text: point(other) }, { at: at(holder), text: t('duel.say.read') }]
    : [{ at: at(holder), text: point(holder) }, { at: at(other), text: t('duel.say.counter') }];
}

function leftOf(state: BattleState, side: Side | null, d: DuelState): UnitId {
  return !side || state.units[d.challenger]?.side === side ? d.challenger : d.defender;
}

/** 한 대결의 한 합 — 미리 낸 패 · 손으로 누른 것을 합마다 가른다(한 판에 대결이 여럿일 수 있다) */
const roundKey = (d: DuelState): string => `${d.challenger}>${d.defender}:${d.kind}:${d.round}`;

/** 말풍선 위 한 줄 — `duel/bubble-{hit,turn,end,tie}.png` (`npm run duel`) */
function bubble(cls: string, kind: 'hit' | 'turn' | 'end' | 'tie', value: string): HTMLElement {
  const b = text('div', `${cls} dl-bubble`, value);
  b.dataset.bubble = kind;
  return b;
}

/**
 * 받는 팝업의 예보 — 누가 공격권을 쥐고 시작하나 · 승 · 패 · 결판 없음 세 칸(「몇 번 맞으면 0」 줄은 2026-11-07 기획자가 뺐다). 숫자는 엔진(`duelForecast`)이 낸다.
 * 세 칸의 이름은 `duel.confirm.odds`(「승 · 패 · 결판 없음」)를 가운뎃점으로 갈라 쓴다 — 열 언어 모두 `·` · `・`로 잇는다. 안 갈리면 한 줄로.
 */
function offerForecast(state: BattleState, me: UnitState, foeId: UnitId, kind: DuelKind): HTMLElement[] {
  const f = duelForecast(state, me.id, foeId, kind);
  if (!f) return [];
  const foeName = whoOf(state, foeId);
  const holderName = f.iHold ? whoOf(state, me.id) : foeName;
  const holder = text('div', 'dl-of-line', t('duel.confirm.holder', { who: holderName, j: josaOf(holderName, '이가') }));
  holder.prepend(gameIconEl('duel-initiative', ''));
  // 1% 이하는 소수 첫째 자리까지 — 0%로 뭉개면 「일어날 수 없다」로 읽힌다 (2026-11-07 기획자). 0.05% 미만은 「<0.1%」, 정말 0이면 0%
  const pct = (x: number): string => {
    const p = x * 100;
    if (p <= 0) return '0%';
    if (p > 1) return `${Math.round(p)}%`;
    return p < 0.05 ? '<0.1%' : `${p.toFixed(1)}%`;
  };
  const odds = el('div', 'dl-odds');
  odds.dataset.win = String(Math.round(f.win * 100));
  const names = t('duel.confirm.odds').split(/\s*[·・]\s*/);
  const vals: [string, number][] = [['win', f.win], ['lose', f.lose], ['draw', f.draw]];
  if (names.length === 3) {
    vals.forEach(([k, v], i) => {
      const cell = el('div', `dl-odd dl-odd-${k}`);
      cell.append(text('span', 'dl-odd-k', names[i]!), text('b', 'dl-odd-v', pct(v)));
      odds.append(cell);
    });
  } else {
    odds.append(text('span', 'dl-odd-k', t('duel.confirm.odds')), text('b', 'dl-odd-v', vals.map(([, v]) => pct(v)).join(' · ')));
  }
  return [holder, odds];
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
