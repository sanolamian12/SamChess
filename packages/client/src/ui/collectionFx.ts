/**
 * 컬렉션 덱 · 발동 장면 (2026-10-16 기획자, pptx 106~112쪽 「UI update261015」)
 *
 * ```
 *  ┌─────────────────────────────── 판 ─┐
 *  │                              [북]  │  ← 북군 덱(붉은 함) — 누르면 북군에 켜진 컬렉션 목록
 *  │          ╭──────────────╮      ┊   │
 *  │          │  라벨 그림     │ ←────┘   │  나옴: 덱에서 작고 흐리게 → **오른쪽 벽을 타고** 가운데로 커지며
 *  │          │ 도원결의 발동   │  ✦       │  머묾: 1초, 빛이 한 번 쓸고 지나간다(「짠」)
 *  │          ╰──────────────╯          │  돌아감: 가운데에서 **북군은 위로 · 남군은 아래로** 작아지고 흐려지며 덱으로
 *  │                              [남]  │  ← 남군 덱(푸른 함)
 *  └────────────────────────────────────┘
 * ```
 *
 * **배치가 열리자마자 한 번 — 배치 30초는 이 장면 뒤부터 센다.** 길이 · 순서(북군 먼저)는 엔진의 `timing.ts`
 * (`firedCollections` · `collectionIntroMs`)가 정한다 — 배치 마감을 재는 서버가 같은 함수를 읽으므로, 여기서 시간을 다시 적으면
 * 화면의 카운트와 서버의 마감이 갈린다. 근거는 엔진이 판을 만들 때 남긴 `UnitState.bonuses`뿐이다.
 *
 * 다음 장은 앞 장이 돌아가는 동안 나오고(전환), 그다음 장은 덱 위에서 반쯤 뽑혀 기다린다(110~112쪽의 겹친 장).
 * 장면이 도는 동안 판은 멈추고(`BattleScene.update()`) 판 클릭은 장면이 받는다 — 배치 단추는 배치 판이 끈다.
 * 위치는 판(`#board`) 화면 좌표의 % — 카메라 확대와 무관하게 판의 귀퉁이에 붙는다.
 */

import {
  COLLECTION_HOLD_MS, COLLECTION_IN_MS, COLLECTION_OUT_MS, type Side,
} from '@samchess/rules';
import { t } from '../i18n/index.ts';

/** 장면 · 덱 목록의 한 장 — 글은 화면이 다국어로 조립해 넘긴다 */
export interface DeckCard {
  id: string;
  side: Side;
  title: string;
  effect: string;
  /** 이 컬렉션이 붙은 장수 이름 */
  who: string[];
}

/** 덱 그림 — `tools/build_ui.py`의 `CELL_SHEETS`. 장수 카드의 컬렉션 인장도 같은 그림이다(`collectionBadge.ts`) */
export const deckArt = (side: Side): string => `ui/gi/collection-${side === 'P2' ? 'north' : 'south'}.png`;
const labelArt = (id: string): string => `collections/${id}.jpg`;

/** 덱 자리(판 %) — 북군 오른쪽 위 · 남군 오른쪽 아래 (판은 뒤집히지 않는다 — 북군이 언제나 위) */
const DECK: Record<Side, { x: number; y: number }> = { P2: { x: 93, y: 7 }, P1: { x: 93, y: 93 } };
/** 오른쪽 벽 — 나오는 장이 이 높이를 지나 가운데로 꺾인다 */
const WALL_X = 92;
/** 덱 위에서의 크기(가운데 크기에 대한 비) */
const SMALL = 0.12;
const STEP = COLLECTION_IN_MS + COLLECTION_HOLD_MS;
/** 「짠」 — 머묾이 시작되고 이만큼 동안 한 번 부풀었다 돌아온다 */
const POP_MS = 360;

type Pt = { x: number; y: number };
const bez = (a: Pt, c: Pt, b: Pt, u: number): Pt => ({
  x: (1 - u) ** 2 * a.x + 2 * (1 - u) * u * c.x + u ** 2 * b.x,
  y: (1 - u) ** 2 * a.y + 2 * (1 - u) * u * c.y + u ** 2 * b.y,
});
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const easeOut = (u: number): number => 1 - (1 - u) ** 3;
const easeIn = (u: number): number => u ** 3;
const CENTER: Pt = { x: 50, y: 50 };

export class CollectionFx {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly decks: Record<Side, HTMLButtonElement>;
  private cards: DeckCard[] = [];
  private flights: HTMLElement[] = [];
  private elapsed = -1;
  private total = 0;
  private openSide: Side | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.replaceChildren();
    this.stage = div('cfx-stage');
    this.pop = div('cfx-pop');
    this.pop.hidden = true;
    this.pop.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).dataset.action === 'closeDeck') this.closeDeck();
    });
    const deck = (side: Side): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'cfx-deck';
      b.dataset.side = side;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = deckArt(side);
      img.addEventListener('error', () => { img.remove(); b.classList.add('cfx-deck-css'); });
      b.append(img, div('cfx-count'));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDeck(side); });
      return b;
    };
    this.decks = { P2: deck('P2'), P1: deck('P1') };
    root.append(this.stage, this.decks.P2, this.decks.P1, this.pop);
    root.dataset.active = '';
  }

  get active(): boolean { return this.elapsed >= 0; }

  /** 판에 켜진 컬렉션을 덱에 싣는다 — 장면의 순서 그대로(북군 먼저). 판마다 한 번 */
  setDeck(cards: readonly DeckCard[]): void {
    this.cards = [...cards];
    for (const side of ['P1', 'P2'] as const) {
      const n = this.cards.filter((c) => c.side === side).length;
      const d = this.decks[side];
      d.dataset.count = String(n);
      d.querySelector('.cfx-count')!.textContent = n ? String(n) : '';
      d.title = t('collection.battle.deck', { army: t(`battle.army.${side}`) });
    }
  }

  /** 장면을 튼다. `fromMs` — 이미 지난 만큼(재접속하면 그 자리부터) */
  play(fromMs = 0): void {
    const n = this.cards.length;
    if (n === 0) return;
    this.total = n * STEP + COLLECTION_OUT_MS;
    if (fromMs >= this.total) return;
    this.closeDeck();
    this.flights = this.cards.map((c, i) => {
      const el = div('cfx-card');
      el.dataset.side = c.side;
      el.dataset.collection = c.id;          // 스모크는 글자가 아니라 이것으로 건다
      el.dataset.order = String(i);
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = labelArt(c.id);
      img.addEventListener('error', () => img.remove());
      const cap = div('cfx-cap');
      cap.append(text('cfx-army', t(`battle.army.${c.side}`)), text('cfx-title', t('collection.battle.fired', { title: c.title })));
      el.append(img, cap, div('cfx-shine'));
      el.style.opacity = '0';
      return el;
    });
    this.stage.replaceChildren(...this.flights);
    this.elapsed = Math.max(0, fromMs);
    this.root.dataset.active = 'on';
    this.root.dataset.count = String(n);
    this.draw();
  }

  update(delta: number): void {
    if (this.elapsed < 0) return;
    this.elapsed += delta;
    if (this.elapsed >= this.total) {
      this.elapsed = -1;
      this.stage.replaceChildren();
      this.flights = [];
      this.root.dataset.active = '';
      for (const d of Object.values(this.decks)) d.dataset.live = '';
      return;
    }
    this.draw();
  }

  /** 판을 누르면 닫힌다(98쪽 「판 아무 데나 누르면 닫힘」 — `BattleScene.onClick`) */
  closeDeck(): void {
    if (this.openSide === null) return;
    this.openSide = null;
    this.pop.hidden = true;
    this.pop.replaceChildren();
    for (const d of Object.values(this.decks)) d.classList.remove('open');
  }

  get openDeck(): Side | null { return this.openSide; }

  private toggleDeck(side: Side): void {
    if (this.active) return;
    if (this.openSide === side) { this.closeDeck(); return; }
    this.openSide = side;
    for (const [s, d] of Object.entries(this.decks)) d.classList.toggle('open', s === side);
    const list = this.cards.filter((c) => c.side === side);
    const head = div('cfx-pop-head');
    const close = document.createElement('button');
    close.className = 'cfx-pop-x';
    close.dataset.action = 'closeDeck';
    close.textContent = '×';
    head.append(text('cfx-pop-title', t('collection.battle.deck', { army: t(`battle.army.${side}`) })), close);
    const body = div('cfx-pop-list');
    if (list.length === 0) body.append(text('cfx-pop-none', t('collection.battle.none')));
    for (const c of list) {
      const row = div('cfx-pop-row');
      row.dataset.collection = c.id;
      const img = document.createElement('img');
      img.alt = '';
      img.src = labelArt(c.id);
      img.addEventListener('error', () => img.remove());
      const txt = div('cfx-pop-txt');
      txt.append(text('cfx-pop-name', c.title), text('cfx-pop-fx', c.effect), text('cfx-pop-who', c.who.join(' · ')));
      row.append(img, txt);
      body.append(row);
    }
    this.pop.dataset.side = side;
    this.pop.replaceChildren(head, body);
    this.pop.hidden = false;
  }

  /** 한 프레임 — 장마다 제 시각표의 어디쯤인지 보고 자리 · 크기 · 투명도를 정한다 */
  private draw(): void {
    const live: Record<Side, boolean> = { P1: false, P2: false };
    this.flights.forEach((el, i) => {
      const side = this.cards[i]!.side;
      const deck = DECK[side];
      const tt = this.elapsed - i * STEP;
      let p: Pt; let s: number; let o: number; let z = 1; let lit = false;
      if (tt < -STEP || tt >= STEP + COLLECTION_OUT_MS) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        return;
      }
      if (tt < 0) {
        // 다음 장 — 덱 위로 반쯤 뽑혀 나와 기다린다 (110~112쪽의 겹친 장)
        const u = easeOut((tt + STEP) / STEP);
        p = { x: deck.x - 3 * u, y: lerp(deck.y, 50, 0.08 * u) };
        s = SMALL * (1 + 0.4 * u);
        o = 0.45 * u;
        z = 0;
      } else if (tt < COLLECTION_IN_MS) {
        const u = easeOut(tt / COLLECTION_IN_MS);
        p = bez(deck, { x: WALL_X, y: 50 }, CENTER, u);
        s = lerp(SMALL * 1.4, 1, u);
        o = lerp(0.45, 1, u);
        z = 3;
      } else if (tt < STEP) {
        const h = tt - COLLECTION_IN_MS;
        p = CENTER;
        s = 1 + (h < POP_MS ? 0.06 * Math.sin((Math.PI * h) / POP_MS) : 0);
        o = 1;
        z = 2;
        lit = true;
      } else {
        // 가운데에서 제 덱 쪽(북군 위 · 남군 아래)으로 먼저 움직이고 오른쪽으로 꺾어 덱에 든다
        const u = easeIn((tt - STEP) / COLLECTION_OUT_MS);
        p = bez(CENTER, { x: 50, y: deck.y }, deck, u);
        s = lerp(1, SMALL, u);
        o = 1 - u;
        z = 1;
      }
      live[side] = true;
      el.style.visibility = '';
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
      el.style.transform = `translate(-50%, -50%) scale(${s})`;
      el.style.opacity = String(o);
      el.style.zIndex = String(z);
      if (el.classList.contains('lit') !== lit) el.classList.toggle('lit', lit);
    });
    for (const side of ['P1', 'P2'] as const) {
      const v = live[side] ? 'on' : '';
      if (this.decks[side].dataset.live !== v) this.decks[side].dataset.live = v;
    }
  }
}

function div(cls: string): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  return e;
}

function text(cls: string, s: string): HTMLElement {
  const e = div(cls);
  e.textContent = s;
  return e;
}
