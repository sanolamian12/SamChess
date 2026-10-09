/**
 * 시스템 메시지 — **판 왼쪽 위, 동시에 최대 3줄** (pptx 98쪽 · 전투 UI 개편 6단계, 2026-10-06)
 *
 * ```
 *  ┌───────────────────────────────┐
 *  │ [...]                          │ ← 첫 줄. 찍히는 동안 숨고, 다 찍히면 드러난다 → 전투 기록
 *  │ ╭ 조운 이동했다. ╮             │
 *  │ ╭ 조운 공격했다. (장료 −3) ╮   │   새 줄은 아래에 붙고 위를 밀어 올린다.
 *  │ ╭ 장료 퇴각했다. ╮             │   넷째 줄이 오면 맨 위 줄이 빠진다
 *  │           체스판               │
 *  └───────────────────────────────┘
 * ```
 *
 * 예전(27쪽)에는 판 한가운데 → 판 왼쪽 아래의 **한 줄**이었다(「지난 줄을 남기지 않는다」, 2026-08-12).
 * 98쪽이 「맵 좌상단에 잠깐 표시 · 동시에 최대 3줄 (밀어올림)」으로 바꿨다. 판 밖으로 명령 판이
 * 내려가(2단계) 판을 가리는 것이 줄었으므로 세 줄을 쌓아도 된다. **줄마다 `LINE_HOLD_MS` 뒤 걷힌다**
 * — 「잠깐」이다. 자동 포커싱 토글은 이 자리를 내주고 판 왼쪽 아래로 갔다(6단계 확정 4).
 *
 * **한 번에 쏟아붓지 않는다.** 「고유기술 발동!」 + 「효과 설명」처럼 한 행동이 두 줄 이상을
 * 만들 때 동시에 띄우면 읽을 수가 없다. 그래서 줄마다 사이를 두고 내보낸다.
 *
 * ────────────────────────────────────────────────────────────────
 * 간격은 **연출 길이가 정한다** ★ (2026-08-13)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 줄마다 1초 고정이었다. 그런데 한 행동이 4~5줄을 만드는 일이 흔해서
 * (책략 = 시전 + 성공 + 효과들), 연출은 2초에 끝나는데 말은 5초가 걸렸다.
 * **밀린 줄이 평균 2.7 · 최대 8이었다**(60초 실측) — 화면에서는 이미 두세 수 지난
 * 일을 말하고 있는 셈이라, 기획자가 「대화창이 게임 속도를 못 따라간다」고 지적했다.
 *
 * 이제 `pace(windowMs)`가 **이번 연출이 도는 시간을 줄 수로 나눠** 간격을 정한다.
 * 읽을 수 있는 하한(`MIN_LINE_MS`)과 넉넉한 상한(`MAX_LINE_MS`) 사이로 자른다.
 * 씬은 그 대가로 `timeToDrain()`만큼 판을 붙들어 준다 —
 * **판은 자기가 설명하는 것을 기다린다**가 이 층의 계약이 됐다.
 *
 * **[...] (전투 기록)** — 6단계 확정 6: 기록이 하나 이상 있고 **대기 줄이 다 찍혔을 때만** 드러난다.
 * 찍히는 동안 숨기는 것은 설계 확정 7이다(누르면 판 위를 덮는 기록이 말하는 도중에 열린다).
 * 예전엔 게임 정보 귀퉁이의 ⋯였다(3단계의 임시 자리). 「항복」은 3단계에서 게임 정보로 나갔다.
 */

import type { LogLine } from './eventText.ts';
import { t } from '../i18n/index.ts';

/** 줄 사이 간격의 상한. 할 말이 적으면 이만큼 여유 있게 읽힌다 (기획자 지정 «1초») */
const MAX_LINE_MS = 1000;
/**
 * 줄 사이 간격의 하한. 이보다 촘촘하면 읽기 전에 다음 줄로 바뀐다.
 * 예전 「따라붙기」 간격(220ms)이 실제로 그랬다 — 빠른 게 아니라 안 읽혔다.
 */
const MIN_LINE_MS = 450;
/** 한 줄이 떠 있는 시간 (98쪽 「잠깐 표시」 — 옛 말풍선이 걷히던 시간과 같다) */
const LINE_HOLD_MS = 4000;
/** 동시에 떠 있는 줄의 상한 (98쪽) */
export const LOG_MAX_LINES = 3;

interface Shown { el: HTMLElement; ms: number }

export class SystemLog {
  /** 아직 못 내보낸 줄. `due`는 이 시각(`clockMs`) 전에는 안 내보낸다 — 연출이 그 장면에 닿을 때 (2026-10-09) */
  private queue: { line: LogLine; due: number }[] = [];
  /** 이 대화창이 켜진 뒤 흐른 시간 — `due`의 시계 */
  private clockMs = 0;
  /** 지금까지 내보낸 전부 — 히스토리 */
  private history: LogLine[] = [];
  private waitMs = 0;
  /** 지금 판에 떠 있는 줄 — 위에서 아래(오래된 것 → 새 것) */
  private shown: Shown[] = [];
  /** 지금 쓰고 있는 줄 간격. `pace()`가 연출 길이에 맞춰 정한다 */
  private lineDelayMs = MAX_LINE_MS;
  private readonly more: HTMLButtonElement;
  private readonly linesEl: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly historyRoot: HTMLElement,
  ) {
    // [...]만 클릭을 받는다 — `#log` 자체는 `pointer-events: none`이라 판 클릭이 통과한다
    this.more = document.createElement('button');
    this.more.className = 'log-more hidden';
    this.more.dataset.action = 'history';
    // 펼쳐지는 두루마리 그림(`scroll-open-3.png`, 2026-10-09) 위에 먹으로 「...」 — 이름은 툴팁 · aria-label
    this.more.textContent = '...';
    this.more.title = t('hud.more');
    this.more.setAttribute('aria-label', t('hud.more'));
    this.more.addEventListener('click', () => this.toggleHistory());
    this.linesEl = document.createElement('div');
    this.linesEl.className = 'log-lines';
    root.replaceChildren(this.more, this.linesEl);
    historyRoot.replaceChildren();
    historyRoot.classList.add('hidden');

    historyRoot.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).dataset.action;
      if (action === 'closeHistory') this.toggleHistory(false);
    });
  }

  /**
   * 새 줄을 대기열에 넣는다. 실제 표시는 `update()`가 간격을 두고 한다.
   *
   * `dueMs`는 줄마다 연출 계획이 정한 시각이다(`poses.ts`의 `EventTiming`, 줄의 `ev` · `effect`로 고른다) —
   * 「시전했다」는 시전 자세와, 「책략이 성공했다」는 배지와 함께. 카메라가 시전자에게 가기도 전에 말이 먼저 뜨던 것을 막는다.
   * 간격(`lineDelayMs`)은 그대로 지킨다 — 시각은 「이보다 이르지 않게」일 뿐이다.
   */
  push(lines: readonly LogLine[], dueMs: readonly number[] = []): void {
    lines.forEach((line, i) => this.queue.push({ line, due: this.clockMs + (dueMs[i] ?? 0) }));
  }

  /**
   * 이번 연출이 `windowMs` 동안 돈다 — 그 안에 말이 끝나도록 간격을 잡는다.
   *
   * **밀린 줄까지 함께 센다.** 앞 행동의 말이 남아 있는데 이번 것만 보고 나누면
   * 뒤처짐이 계속 쌓인다 — 실측에서 8줄까지 밀렸던 것이 그 때문이다.
   */
  pace(windowMs: number): void {
    const lines = this.queue.length;
    if (lines === 0) return;
    const spacing = windowMs / lines;
    this.lineDelayMs = Math.max(MIN_LINE_MS, Math.min(MAX_LINE_MS, spacing));
    // 이미 기다리는 중이라면 새 간격으로 줄여 준다. 안 그러면 앞 줄의 1초를
    // 다 채운 뒤에야 빨라져서, 짧은 연출에서는 따라잡을 틈이 없다.
    this.waitMs = Math.min(this.waitMs, this.lineDelayMs);
  }

  /**
   * 밀린 줄을 다 내보내는 데 걸릴 시간(ms). 씬이 이만큼 판을 붙들어 준다.
   *
   * 연출이 짧은데 할 말이 많은 구간(도트 정산·「장료지제」)에서는 이쪽이 더 길다.
   * 그때는 판이 잠깐 멈추는 편이 맞다 — 안 그러면 다음 수가 그 위를 덮는다.
   */
  timeToDrain(): number {
    if (this.queue.length === 0) return 0;
    // 줄마다 「앞 줄 + 간격」과 「제 시각」 중 늦은 쪽에 나간다
    let at = Math.max(this.waitMs, this.queue[0]!.due - this.clockMs);
    for (let i = 1; i < this.queue.length; i++) {
      at = Math.max(at + this.lineDelayMs, this.queue[i]!.due - this.clockMs);
    }
    return Math.max(0, at);
  }

  /** 매 프레임 호출한다. */
  update(deltaMs: number): void {
    // 줄마다 제 수명이 있다 — 다 된 줄부터(언제나 맨 위부터) 걷는다
    for (const line of this.shown) line.ms -= deltaMs;
    while (this.shown.length > 0 && this.shown[0]!.ms <= 0) this.shown.shift()!.el.remove();

    this.clockMs += deltaMs;
    if (this.queue.length > 0) {
      this.waitMs -= deltaMs;
      if (this.waitMs <= 0 && this.queue[0]!.due <= this.clockMs) {
        this.emit(this.queue.shift()!.line);
        this.waitMs = this.lineDelayMs;
      }
    }
    // [...]는 기록이 있고 할 말을 다 했을 때만 (6단계 확정 6)
    this.more.classList.toggle('hidden', this.queue.length > 0 || this.history.length === 0);
  }

  /** 아직 못 내보낸 줄 수. 연출을 대화보다 앞세우지 않으려고 씬이 들여다본다. */
  get pending(): number { return this.queue.length; }

  private emit(line: LogLine): void {
    this.history.push(line);

    const el = document.createElement('div');
    el.className = `log-line ${line.tone}`;
    el.textContent = line.text;
    // 새 줄은 아래에 붙고 위를 밀어 올린다. 넘치면 맨 위가 빠진다 (98쪽)
    this.linesEl.appendChild(el);
    this.shown.push({ el, ms: LINE_HOLD_MS });
    while (this.shown.length > LOG_MAX_LINES) this.shown.shift()!.el.remove();
  }

  /** [...]가 부른다. */
  toggleHistory(force?: boolean): void {
    const open = force ?? this.historyRoot.classList.contains('hidden');
    this.historyRoot.classList.toggle('hidden', !open);
    if (!open) return;

    const head = document.createElement('div');
    head.className = 'hist-head';
    const title = document.createElement('span');
    title.textContent = t('hist.title', { n: this.history.length });
    const close = document.createElement('button');
    close.className = 'hist-close';
    close.textContent = '×';
    close.dataset.action = 'closeHistory';
    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'hist-body';
    for (const line of this.history) {
      const el = document.createElement('div');
      el.className = `hist-line ${line.tone}`;
      el.textContent = line.text;
      body.appendChild(el);
    }
    if (this.history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hist-line plain';
      empty.textContent = t('hist.empty');
      body.appendChild(empty);
    }

    this.historyRoot.replaceChildren(head, body);
    body.scrollTop = body.scrollHeight;   // 최근 것이 보이게
  }

  /** 스모크 테스트용 — 화면에 실제로 나간 줄 */
  get lines(): readonly LogLine[] { return this.history; }
}
