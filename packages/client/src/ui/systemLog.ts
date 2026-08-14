/**
 * 시스템 대화창 — **체스판 한가운데의 말풍선** (기획 pptx 27쪽)
 *
 * ```
 *  ┌───────────────────────────────┐
 *  │                               │
 *  │  ╭─────────────────────────╮  │   ← 최근 한 줄만. 가로는 판의 1/4 자리
 *  │  │ 조운이 「고유기술」을 발동했다! │  │     (양옆 3/8씩은 커맨드·상태 패널)
 *  │  ╰─────────────────────────╯  │
 *  │           체스판               │
 *  └───────────────────────────────┘
 * ```
 *
 * 예전에는 판 **위쪽 바깥**에 여러 줄이 쌓였는데, 27쪽에서 판 한가운데로 옮겨졌다.
 * **지난 줄은 남기지 않는다**(2026-08-12 확정) — 판 위에 겹쳐 뜨므로 여러 줄을 쌓으면
 * 그만큼 판이 가려진다. 지난 줄은 HUD 오른쪽 위의 「⋯」로 전체 기록에서 본다.
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
 * 「항복」은 전체 기록 안에 있다 (27쪽 — 「클릭했을 때 대화 목록, 그 아래 [항복] 버튼」).
 */

import type { LogLine } from './eventText.ts';

/** 줄 사이 간격의 상한. 할 말이 적으면 이만큼 여유 있게 읽힌다 (기획자 지정 «1초») */
const MAX_LINE_MS = 1000;
/**
 * 줄 사이 간격의 하한. 이보다 촘촘하면 읽기 전에 다음 줄로 바뀐다.
 * 예전 「따라붙기」 간격(220ms)이 실제로 그랬다 — 빠른 게 아니라 안 읽혔다.
 */
const MIN_LINE_MS = 450;
/** 말풍선이 저절로 걷히기까지. 다음 줄이 오면 그 줄로 바뀐다. */
const BUBBLE_HOLD_MS = 4000;

export class SystemLog {
  /** 아직 못 내보낸 줄 */
  private queue: LogLine[] = [];
  /** 지금까지 내보낸 전부 — 히스토리 */
  private history: LogLine[] = [];
  private waitMs = 0;
  /** 지금 떠 있는 말풍선이 걷히기까지 남은 시간 */
  private bubbleMs = 0;
  /** 지금 쓰고 있는 줄 간격. `pace()`가 연출 길이에 맞춰 정한다 */
  private lineDelayMs = MAX_LINE_MS;

  constructor(
    private readonly root: HTMLElement,
    private readonly historyRoot: HTMLElement,
    /** 「항복」 — 전체 기록 안에 있다. 관전(양쪽 AI)이면 낼 의도가 없어 `null` */
    private readonly onSurrender: (() => void) | null,
  ) {
    root.replaceChildren();
    historyRoot.replaceChildren();
    historyRoot.classList.add('hidden');

    historyRoot.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).dataset.action;
      if (action === 'closeHistory') this.toggleHistory(false);
      if (action === 'surrender' && this.onSurrender) {
        if (window.confirm('항복하시겠습니까? 이 판은 패배로 끝납니다.')) {
          this.toggleHistory(false);
          this.onSurrender();
        }
      }
    });
  }

  /** 새 줄을 대기열에 넣는다. 실제 표시는 `update()`가 간격을 두고 한다. */
  push(lines: readonly LogLine[]): void {
    this.queue.push(...lines);
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
    return this.queue.length === 0 ? 0 : this.waitMs + (this.queue.length - 1) * this.lineDelayMs;
  }

  // 말풍선은 **판 영역 한가운데**에 고정이다 (2026-08-13 기획자 지정).
  //
  // 예전에는 커맨드·상태 패널의 반대쪽 띠(위/아래)로 옮겨 다녔다. 그런데 같은 말이
  // 진영에 따라 위에 떴다 아래에 떴다 해서 눈이 따라다녀야 했다. 패널은 이제 상대
  // 차례에 접히고 내 차례에는 사분면으로 비켜서므로 한가운데를 내줘도 겹치지 않는다.
  // 자리를 잡는 일이 통째로 CSS(`#log`)로 내려갔다.

  /** 매 프레임 호출한다. */
  update(deltaMs: number): void {
    if (this.queue.length === 0) {
      // 말풍선은 판을 가리므로 할 말이 없으면 걷는다
      if (this.bubbleMs > 0 && (this.bubbleMs -= deltaMs) <= 0) this.root.replaceChildren();
      return;
    }
    this.waitMs -= deltaMs;
    if (this.waitMs > 0) return;

    this.emit(this.queue.shift()!);
    this.waitMs = this.lineDelayMs;
  }

  /** 아직 못 내보낸 줄 수. 연출을 대화보다 앞세우지 않으려고 씬이 들여다본다. */
  get pending(): number { return this.queue.length; }

  private emit(line: LogLine): void {
    this.history.push(line);
    this.bubbleMs = BUBBLE_HOLD_MS;

    const el = document.createElement('div');
    el.className = `log-line ${line.tone}`;
    el.textContent = line.text;
    // **한 줄만 남긴다.** 판 위에 겹쳐 뜨므로 쌓으면 그만큼 판이 가려진다.
    this.root.replaceChildren(el);
  }

  /** HUD 오른쪽 위의 「⋯」가 부른다. */
  toggleHistory(force?: boolean): void {
    const open = force ?? this.historyRoot.classList.contains('hidden');
    this.historyRoot.classList.toggle('hidden', !open);
    if (!open) return;

    const head = document.createElement('div');
    head.className = 'hist-head';
    const title = document.createElement('span');
    title.textContent = `시스템 기록 ${this.history.length}줄`;
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
      empty.textContent = '아직 기록이 없다.';
      body.appendChild(empty);
    }

    this.historyRoot.replaceChildren(head, body);
    // 「대화 목록, 그 아래 [항복] 버튼」 (27쪽). 되돌릴 수 없어 한 번 더 묻는다.
    if (this.onSurrender) {
      const give = document.createElement('button');
      give.className = 'hist-surrender';
      give.textContent = '항복';
      give.dataset.action = 'surrender';
      this.historyRoot.appendChild(give);
    }
    body.scrollTop = body.scrollHeight;   // 최근 것이 보이게
  }

  /** 스모크 테스트용 — 화면에 실제로 나간 줄 */
  get lines(): readonly LogLine[] { return this.history; }
}
