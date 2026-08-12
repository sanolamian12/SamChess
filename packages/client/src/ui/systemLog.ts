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
 * 만들 때 동시에 띄우면 읽을 수가 없다. 그래서 줄마다 1초씩 띄워 내보낸다(기획자 지정).
 * 다만 밀린 줄이 쌓이면 대화가 판보다 한참 뒤처지므로, 그때는 간격을 줄여 따라붙는다.
 *
 * 「항복」은 전체 기록 안에 있다 (27쪽 — 「클릭했을 때 대화 목록, 그 아래 [항복] 버튼」).
 */

import type { LogLine } from './eventText.ts';

/** 줄 사이 기본 간격 (기획자 지정) */
const LINE_DELAY_MS = 1000;
/** 밀린 줄이 이만큼 넘으면 간격을 줄여 따라붙는다 */
const BACKLOG_LIMIT = 3;
const CATCHUP_DELAY_MS = 220;
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
   * 말풍선이 놓일 세로 띠. **커맨드·상태 패널의 반대쪽**을 씬이 넘겨 준다.
   *
   * 패널 높이가 판의 0.6배라 붙은 쪽 60%를 덮는다. 반대쪽 띠에 두면 셋이 겹치지 않고,
   * 말풍선이 판 가로를 넉넉히 쓸 수 있다 — 가운데 1/4 칸에 가두면 한 문장이 안 들어간다.
   */
  place(y: 'top' | 'bottom'): void {
    if (this.root.dataset.y !== y) this.root.dataset.y = y;
  }

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
    this.waitMs = this.queue.length > BACKLOG_LIMIT ? CATCHUP_DELAY_MS : LINE_DELAY_MS;
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
