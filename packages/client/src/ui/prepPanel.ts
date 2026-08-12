/**
 * 배치 · 정찰 패널 — 전투 이전 단계 (GDD §3.9)
 *
 * ```
 * [배치]   진영 안에서 자리를 잡는다 (최대 1분) → [준비완료]
 *    ↓
 * [정찰]   양측 기물을 눌러 살펴본다 (20초, 마지막 5초는 카운트다운) → [전투 시작]
 * ```
 *
 * 전투가 시작되면 물러나고 커맨드 패널(`controlModal.ts`)이 **같은 자리**를 쓴다 —
 * 판 안에 뜨는 플로팅 패널이다 (pptx 29쪽). 둘이 같은 자리에 서야 전투가 시작될 때
 * 조작하는 곳이 옮겨 다니지 않는다.
 *
 * **남은 시간은 스스로 세지 않는다.** `Playback.remainingSec`을 읽어 보여 주기만 한다 —
 * 지금은 클라이언트가 재지만 온라인에서는 서버가 마감을 내려 주기 때문이다.
 * 재는 자리를 한 곳으로 몰아 두면 그때 이 파일은 손댈 것이 없다.
 */

import type { PlaybackPhase } from '../battle/playback.ts';
import { SCOUT_COUNTDOWN_MS } from '../battle/playback.ts';

interface Handlers {
  /** 배치를 마쳤다 */
  ready(): void;
  /** 정찰을 건너뛰고 전투를 시작한다 */
  begin(): void;
}

export class PrepPanel {
  private titleEl!: HTMLElement;
  private noteEl!: HTMLElement;
  private clockEl!: HTMLElement;
  private buttonEl!: HTMLButtonElement;
  private last = '';

  constructor(private readonly root: HTMLElement, private readonly on: Handlers) {
    root.replaceChildren();
    root.classList.add('panel', 'hidden');

    const head = add(root, 'div', 'prep-head');
    this.titleEl = add(head, 'span', 'prep-title');
    this.clockEl = add(head, 'span', 'prep-clock');
    this.noteEl = add(root, 'div', 'prep-note');

    this.buttonEl = document.createElement('button');
    this.buttonEl.className = 'prep-go';
    this.buttonEl.addEventListener('click', () => {
      if (this.buttonEl.dataset.action === 'ready') this.on.ready();
      else this.on.begin();
    });
    root.appendChild(this.buttonEl);
  }

  /**
   * @param remainingSec `Playback`이 준 남은 초. 배치·정찰이 아니면 `null`
   * @param placed 내 유닛이 전부 진영 안에 있는가 (배치 단계에서만 의미가 있다)
   */
  refresh(phase: PlaybackPhase, remainingSec: number | null, readyAlready: boolean): void {
    const on = phase === 'deploying' || phase === 'scouting';
    this.root.classList.toggle('hidden', !on);
    if (!on) return;

    const deploying = phase === 'deploying';
    // 정찰은 20초를 세되 **마지막 5초만** 숫자를 보여준다 (GDD §3.9)
    const showClock = deploying || (remainingSec !== null && remainingSec <= SCOUT_COUNTDOWN_MS / 1000);
    const clock = showClock && remainingSec !== null ? `${remainingSec}초` : '';

    const key = `${phase}|${clock}|${readyAlready}`;
    if (key === this.last) return;
    this.last = key;

    this.titleEl.textContent = deploying ? '배치' : '정찰';
    this.clockEl.textContent = clock;
    this.clockEl.classList.toggle('urgent', remainingSec !== null && remainingSec <= 5);
    this.noteEl.textContent = deploying
      ? (readyAlready
        ? '준비를 마쳤다 — 상대를 기다리는 중'
        : '내 진영 안에서 기물을 눌러 옮긴다. 시간이 다 되면 지금 배치로 시작한다')
      : '양측 기물을 눌러 살펴볼 수 있다. 곧 전투가 시작된다';

    this.buttonEl.textContent = deploying ? '준비완료' : '전투 시작';
    this.buttonEl.dataset.action = deploying ? 'ready' : 'begin';
    this.buttonEl.disabled = deploying && readyAlready;
    this.root.dataset.phase = phase;
  }
}

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}
