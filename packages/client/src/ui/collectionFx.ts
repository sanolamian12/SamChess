/**
 * 컬렉션 발동 알림 — 배치 · 정찰에서 전투로 넘어가는 순간 **한 번** (2026-10-14 기획자 확정, `Design/컬렉션_기획.md` §4)
 *
 * ```
 *        ╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
 *   ◖◖   │        도원결의 발동             │   ◗◗     ← 아군 파랑 · 적군 주황 (순서 판 · 주사위와 같은 약속)
 *        │        오장원 발동               │
 *        ╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
 * ```
 *
 * 켜진 컬렉션을 **한 띠에 줄로** 모은다 — 컬렉션마다 띠를 따로 띄우면 5v5에서 여섯 번 넘게 판이 멈춘다.
 * **줄은 `MAX_LINES`까지** — 117개를 다 모은 두 사람이 붙으면 양쪽 합이 열여섯 줄을 넘어(데모 실측) 띠가 판을 통째로
 * 덮었다. 내 쪽이 먼저 서고, 넘친 것은 「외 N개」 한 줄로 접는다.
 * 근거는 엔진이 판을 만들 때 남긴 `UnitState.bonuses`이고, 무엇을 주는지는 장수 카드의 배지가 말한다.
 *
 * **판은 이 띠가 걷힐 때까지 기다린다**(고유기술 연출과 같은 결 — `BattleScene.update()`). 전투가 막 시작된 순간이라
 * 첫 차례의 확대가 띠 뒤에서 지나가면 무슨 일이 있었는지 못 본다. 그림(`ui/banner-collection.png`)이 없으면 CSS 띠로 물러난다.
 */

import { t } from '../i18n/index.ts';

const IN_MS = 300;
/** 한 줄을 읽는 시간 — 줄이 늘면 그만큼 오래 둔다 */
const BASE_HOLD_MS = 1300;
const PER_LINE_MS = 500;
const MAX_HOLD_MS = 3600;
/** 띠에 쓰는 줄 수 — 넘치면 마지막 자리를 「외 N개」로 */
export const MAX_LINES = 3;
/** CSS `#cfx.out`의 transition과 같다 */
const FADE_MS = 400;

export const BANNER_URL = 'ui/banner-collection.png';

export interface FiredLine {
  title: string;
  mine: boolean;
}

export class CollectionFx {
  private readonly root: HTMLElement;
  private readonly band: HTMLElement;
  private elapsed = -1;
  private total = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.className = 'hidden';
    this.band = document.createElement('div');
    this.band.className = 'cfx-band';
    root.replaceChildren(this.band);
    // 그림이 있는지 먼저 본다 — CSS 배경은 404여도 아무 말이 없다(주사위와 같은 규약)
    const probe = new Image();
    probe.onload = () => { root.dataset.art = 'ok'; };
    probe.onerror = () => { root.dataset.art = 'missing'; };
    probe.src = BANNER_URL;
  }

  get active(): boolean { return this.elapsed >= 0; }

  play(lines: readonly FiredLine[]): void {
    if (lines.length === 0) return;
    const shown = lines.length > MAX_LINES ? lines.slice(0, MAX_LINES) : lines;
    const rows = shown.map((l) => {
      const row = document.createElement('div');
      row.className = 'cfx-line';
      row.dataset.side = l.mine ? 'mine' : 'theirs';
      row.textContent = t('collection.battle.fired', { title: l.title });
      return row;
    });
    if (lines.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'cfx-line cfx-more';
      more.textContent = t('collection.battle.more', { n: lines.length - shown.length });
      rows.push(more);
    }
    this.band.replaceChildren(...rows);
    this.root.dataset.count = String(lines.length);
    this.root.classList.remove('hidden', 'out');
    this.total = IN_MS + Math.min(MAX_HOLD_MS, BASE_HOLD_MS + PER_LINE_MS * (rows.length - 1)) + FADE_MS;
    this.elapsed = 0;
  }

  update(delta: number): void {
    if (this.elapsed < 0) return;
    this.elapsed += delta;
    if (this.elapsed >= this.total) {
      this.elapsed = -1;
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.toggle('out', this.elapsed >= this.total - FADE_MS);
  }
}
