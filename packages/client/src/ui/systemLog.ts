/**
 * 시스템 대화창 — HUD와 체스판 사이 (기획 pptx 21쪽)
 *
 * ```
 *        조운이 이동 했다. (A3 E3)      ← 지난 대화: 왼쪽에 붙어 위로 밀려 올라간다
 *      조운이 공격했다. (유봉)
 *          조운이 명상 했다. (MP+2)     ← 가장 최근: 가운데, 체스판에 가장 가깝게
 *  ┌──────────────────────────┐
 *  │          체스판           │
 * ```
 *
 * **한 번에 쏟아붓지 않는다.** 「고유기술 발동!」 + 「효과 설명」처럼 한 행동이 두 줄 이상을
 * 만들 때 동시에 띄우면 읽을 수가 없다. 그래서 줄마다 1초씩 띄워 내보낸다(기획자 지정).
 * 다만 밀린 줄이 쌓이면 대화가 판보다 한참 뒤처지므로, 그때는 간격을 줄여 따라붙는다.
 *
 * 히스토리는 대화 영역을 누르면 전체 목록으로 펼쳐진다.
 */

import type { LogLine } from './eventText.ts';

/** 줄 사이 기본 간격 (기획자 지정) */
const LINE_DELAY_MS = 1000;
/** 밀린 줄이 이만큼 넘으면 간격을 줄여 따라붙는다 */
const BACKLOG_LIMIT = 3;
const CATCHUP_DELAY_MS = 220;
/** 대화 영역에 남겨 두는 줄 수. 넘치면 위에서 지운다 (전체는 히스토리에서 본다) */
const VISIBLE_LINES = 4;

export class SystemLog {
  /** 아직 못 내보낸 줄 */
  private queue: LogLine[] = [];
  /** 지금까지 내보낸 전부 — 히스토리 */
  private history: LogLine[] = [];
  private waitMs = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly historyRoot: HTMLElement,
  ) {
    root.replaceChildren();
    historyRoot.replaceChildren();
    historyRoot.classList.add('hidden');

    root.addEventListener('click', () => this.toggleHistory());
    historyRoot.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.action === 'closeHistory') this.toggleHistory(false);
    });
  }

  /** 새 줄을 대기열에 넣는다. 실제 표시는 `update()`가 간격을 두고 한다. */
  push(lines: readonly LogLine[]): void {
    this.queue.push(...lines);
  }

  /** 매 프레임 호출한다. */
  update(deltaMs: number): void {
    if (this.queue.length === 0) return;
    this.waitMs -= deltaMs;
    if (this.waitMs > 0) return;

    this.emit(this.queue.shift()!);
    this.waitMs = this.queue.length > BACKLOG_LIMIT ? CATCHUP_DELAY_MS : LINE_DELAY_MS;
  }

  /** 아직 못 내보낸 줄 수. 연출을 대화보다 앞세우지 않으려고 씬이 들여다본다. */
  get pending(): number { return this.queue.length; }

  private emit(line: LogLine): void {
    this.history.push(line);

    const el = document.createElement('div');
    el.className = `log-line ${line.tone}`;
    el.textContent = line.text;
    this.root.appendChild(el);

    // 가장 최근 줄만 가운데, 나머지는 왼쪽 — CSS의 :last-child가 맡으므로
    // 여기서는 넘치는 줄만 걷어낸다
    while (this.root.childElementCount > VISIBLE_LINES) {
      this.root.firstElementChild!.remove();
    }
  }

  private toggleHistory(force?: boolean): void {
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
    body.scrollTop = body.scrollHeight;   // 최근 것이 보이게
  }

  /** 스모크 테스트용 — 화면에 실제로 나간 줄 */
  get lines(): readonly LogLine[] { return this.history; }
}
