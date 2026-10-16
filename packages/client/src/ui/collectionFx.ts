/**
 * 컬렉션 덱 · 발동 장면 (2026-10-16 기획자, pptx 106~112쪽 「UI update261015」)
 *
 * ```
 *  ┌─────────────────────────────── 판 ─┐
 *  │                              [북]  │  ← 북군 덱(붉은 함) — 누르면 북군에 켜진 컬렉션 목록
 *  │           ┌┬┬─────────────┐  ┊   │  뒤에 셋까지 쌓인다 — 앞 장이 돌아가면 곧장 다음 장이 앞으로
 *  │          ╭┴┴──────────────╮←───┘   │  나옴: 덱에서 작고 흐리게 → **오른쪽 벽을 타고** 가운데로 커지며
 *  │          │ ◦  라벨 그림  ◦ │  ✦       │  머묾: 0.7초, 빛이 한 번 쓸고 지나간다(「짠」). 받침은 대자보 종이를 눕힌 것
 *  │          ╰────────────────╯          │  돌아감: 가운데에서 **북군은 위로 · 남군은 아래로** 작아지고 흐려지며 덱으로
 *  │                              [남]  │  ← 남군 덱(푸른 함)
 *  └────────────────────────────────────┘
 * ```
 *
 * **배치가 열리자마자 한 번 — 배치 30초는 이 장면 뒤부터 센다.** 길이 · 순서(북군 먼저)는 엔진의 `timing.ts`
 * (`firedCollections` · `collectionIntroMs`)가 정한다 — 배치 마감을 재는 서버가 같은 함수를 읽으므로, 여기서 시간을 다시 적으면
 * 화면의 카운트와 서버의 마감이 갈린다. 근거는 엔진이 판을 만들 때 남긴 `UnitState.bonuses`뿐이다.
 *
 * **진영마다 한 마디** — 「북군 컬렉션」 제목이 징 소리와 함께 강조됐다 사라지고(카운트와 같은 글꼴) 북군 장들, 이어서 남군 마디.
 * 켜진 것이 없는 진영은 마디가 없다.
 * 여러 장이면 지금 장 뒤에 **셋까지 쌓아 둔다**(2026-10-16 기획자) — 앞 장이 돌아가는 동안 바로 뒤 장이 앞으로 나서고, 덱에서 새 장이
 * 쌓임의 맨 뒤로 들어온다. 장에는 그림만 — 제목은 덱 목록이 말한다.
 * 장면이 도는 동안 판은 멈추고(`BattleScene.update()`) 판 클릭은 장면이 받는다 — 배치 단추는 배치 판이 끈다.
 * 위치는 판(`#board`) 화면 좌표의 % — 카메라 확대와 무관하게 판의 귀퉁이에 붙는다.
 */

import {
  COLLECTION_HOLD_MS, COLLECTION_IN_MS, COLLECTION_OUT_MS, COLLECTION_SWAP_MS, COLLECTION_TITLE_MS, collectionSegmentMs,
  type Side,
} from '@samchess/rules';
import { t } from '../i18n/index.ts';

/** 장면 · 덱 목록의 한 장 — 글은 화면이 다국어로 조립해 넘긴다 */
export interface DeckCard {
  id: string;
  side: Side;
  title: string;
  effect: string;
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
/** 한 장이 앞에 서 있다가 다음 장에 자리를 내주기까지 */
const STEP = COLLECTION_HOLD_MS + COLLECTION_SWAP_MS;
/** 이만큼 지난 장은 재접속해 중간부터 틀어도 소리를 낸다 */
const SOUND_GRACE_MS = 250;
/** 덱 목록 한 쪽의 줄 수 상한 — 넷이 위아래 여백이 알맞다, 다섯은 빡빡하다(2026-10-16 기획자) */
const PAGE_ROWS = 4;
/** 지금 장 뒤에 쌓아 두는 장 수 */
const STACK = 3;
/** 쌓임의 한 칸 — 오른쪽 위로 조금씩 비켜 서고 작아지고 어두워진다(판 %) */
const SLOT_DX = 2.4;
const SLOT_DY = -2.8;
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
/** 제목 — 나타나며 부풀었다 가라앉고(강조), 머물다, 사라진다 */
const TITLE_IN_MS = 380;
const TITLE_OUT_MS = 420;

/** 한 장의 자리 — 제 진영 마디 안에서 몇 번째인가 */
interface Slot { base: number; j: number; n: number }
/** 시각표의 소리 */
interface Cue { at: number; kind: 'title' | 'open'; side: Side }
/** 진영 한 마디 — 제목 시작 시각 */
interface Segment { side: Side; at: number }

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
  /** 장마다 「앞으로 나서기 시작한」 소리를 이미 틀었나 — 재접속으로 중간부터 틀면 지난 장은 건너뛴다 */
  private sounded = 0;
  private slots: Slot[] = [];
  private cues: Cue[] = [];
  private segments: Segment[] = [];
  private titles: HTMLElement[] = [];
  /** 장이 앞으로 나서기 시작할 때 — 소리(`battle_collection_open`)를 튼다 */
  onOpen: (() => void) | null = null;
  /** 덱 목록이 글꼴 받기를 기다리는 것을 그만둔다 */
  private unwatchFonts: (() => void) | null = null;
  /** 진영 제목이 펼쳐질 때 — 징 소리(`battle_collection_gong`) */
  onTitle: (() => void) | null = null;

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

  /**
   * 장면을 튼다. `fromMs` — 이미 지난 만큼(재접속하면 그 자리부터).
   * 진영마다 한 마디 — 제목 → 그 진영의 장들. 북군 마디 다음 남군 마디(장의 순서가 이미 그렇다). 길이는 `collectionSegmentMs`(엔진)
   */
  play(fromMs = 0): void {
    const n = this.cards.length;
    if (n === 0) return;
    this.segments = []; this.slots = []; this.cues = [];
    let at = 0;
    for (const side of ['P2', 'P1'] as const) {
      const idx = this.cards.flatMap((c, i) => (c.side === side ? [i] : []));
      if (idx.length === 0) continue;
      this.segments.push({ side, at });
      this.cues.push({ at, kind: 'title', side });
      const base = at + COLLECTION_TITLE_MS;
      idx.forEach((i, j) => {
        this.slots[i] = { base, j, n: idx.length };
        this.cues.push({ at: base + openAt(j), kind: 'open', side });
      });
      at += collectionSegmentMs(idx.length);
    }
    this.total = at;
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
      el.title = t('collection.battle.fired', { title: c.title });
      const paper = div('cfx-paper');
      const art = div('cfx-art');
      art.append(img, div('cfx-shine'));
      paper.append(art);
      el.append(paper);
      el.style.opacity = '0';
      return el;
    });
    this.titles = this.segments.map((g) => {
      const el = text('cfx-heading', t('collection.battle.deck', { army: t(`battle.army.${g.side}`) }));
      el.dataset.side = g.side;
      el.style.opacity = '0';
      return el;
    });
    this.stage.replaceChildren(...this.flights, ...this.titles);
    this.elapsed = Math.max(0, fromMs);
    // 첫 소리는 판이 열리고 몇십 ms 뒤에야 낸다(마감에서 거꾸로 재므로 `fromMs`가 0이 아니다) — 막 지난 것은 아직 소리를 낸다
    this.sounded = this.cues.findIndex((c) => c.at >= this.elapsed - SOUND_GRACE_MS);
    if (this.sounded < 0) this.sounded = this.cues.length;
    this.root.dataset.active = 'on';
    this.root.dataset.count = String(n);
    this.draw();
  }

  update(delta: number): void {
    if (this.elapsed < 0) return;
    this.elapsed += delta;
    while (this.sounded < this.cues.length && this.cues[this.sounded]!.at <= this.elapsed) {
      const cue = this.cues[this.sounded++]!;
      (cue.kind === 'title' ? this.onTitle : this.onOpen)?.();
    }
    if (this.elapsed >= this.total) {
      this.elapsed = -1;
      this.stage.replaceChildren();
      this.flights = [];
      this.titles = [];
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
    this.unwatchFonts?.();
    this.unwatchFonts = null;
    this.pop.hidden = true;
    this.pop.replaceChildren();
    for (const d of Object.values(this.decks)) d.classList.remove('open');
  }

  get openDeck(): Side | null { return this.openSide; }

  /**
   * 덱 목록 — 대자보 종이 한 장(판 높이의 80%까지), **굴리지 않고 쪽을 넘긴다**(2026-10-16 기획자 — 휴대폰에서 굴림이 어렵다).
   * 줄 수를 정해 두지 않고 실제 높이로 쪽을 나눈다: 효과 글이 두 줄로 접히는 줄이 있어 정한 수로는 넘친다.
   * 그래서 먼저 전부 그려 줄 높이를 재고, 칸에 들어가는 만큼씩 쪽으로 묶는다
   */
  private toggleDeck(side: Side): void {
    if (this.active) return;
    if (this.openSide === side) { this.closeDeck(); return; }
    this.unwatchFonts?.();
    this.openSide = side;
    for (const [s, d] of Object.entries(this.decks)) d.classList.toggle('open', s === side);
    const list = this.cards.filter((c) => c.side === side);
    const head = div('cfx-pop-head');
    const close = document.createElement('button');
    close.className = 'cfx-pop-x';
    close.dataset.action = 'closeDeck';
    close.textContent = '×';
    const pager = div('cfx-pager');
    const prev = pageButton('pagePrev', '‹');
    const next = pageButton('pageNext', '›');
    const label = div('cfx-page');
    pager.append(prev, label, next);
    head.append(text('cfx-pop-title', t('collection.battle.deck', { army: t(`battle.army.${side}`) })), pager, close);
    const body = div('cfx-pop-list');
    const rows = list.map((c) => {
      const row = div('cfx-pop-row');
      row.dataset.collection = c.id;
      const img = document.createElement('img');
      img.alt = '';
      img.src = labelArt(c.id);
      img.addEventListener('error', () => img.remove());
      // 이름은 줄 위에 한 줄로(열 언어 중 가장 긴 것이 40자 — 그림 옆에 두면 접힌다), 아래에 그림 · 효과
      row.append(text('cfx-pop-name', c.title), img, text('cfx-pop-fx', c.effect));
      return row;
    });
    if (rows.length === 0) body.append(text('cfx-pop-none', t('collection.battle.none')));
    else body.append(...rows);
    this.pop.dataset.side = side;
    this.pop.replaceChildren(head, body);
    this.pop.hidden = false;
    let pages: HTMLElement[][] = [];
    let at = 0;
    const show = (i: number): void => {
      at = Math.max(0, Math.min(pages.length - 1, i));
      body.replaceChildren(...(pages[at] ?? []));
      if (pages.length === 0) body.append(text('cfx-pop-none', t('collection.battle.none')));
      label.textContent = `${at + 1} / ${Math.max(1, pages.length)}`;
      this.pop.dataset.page = String(at + 1);
      this.pop.dataset.pages = String(Math.max(1, pages.length));
      prev.disabled = at === 0;
      next.disabled = at >= pages.length - 1;
    };
    // 쪽 나누기 — 줄을 전부 세워 높이를 재고 칸에 들어가는 만큼(넷까지) 묶는다. 그림은 비율(`aspect-ratio`)로 칸을 먼저 잡으므로
    // 다 받기 전에도 높이가 맞다. **글꼴은 아니다** — 웹 글꼴은 글자 범위마다 나뉘어 그 글자가 처음 그려질 때 받는다. 목록을 처음 여는 순간에는
    // 물러난 글꼴(더 높다)로 재여 쪽마다 셋만 들어갔다 — 받기를 마치면 다시 나눈다(보던 쪽 번호는 지킨다)
    const paginate = (): void => {
      body.replaceChildren(...rows);
      // 이름 · 머리는 한 줄 — 넘치면 글자를 조금씩 줄인다(줄을 바꾸지 않는다, 2026-10-16 기획자)
      for (const el of this.pop.querySelectorAll<HTMLElement>('.cfx-pop-name, .cfx-pop-title')) fitLine(el);
      // `clientHeight`는 안쪽 여백을 품는다 — 빼야 줄이 들어갈 자리다(안 빼면 쪽마다 몇 px씩 넘쳤다).
      // 줄 높이는 소수라(`offsetHeight`는 반올림 — 여섯 줄에 2px가 쌓여 넘쳤다) 정확히 재고 2px 여유를 둔다
      const cs = getComputedStyle(body);
      const room = body.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - 2;
      const gap = parseFloat(cs.rowGap) || 0;
      pages = [];
      let used = 0;
      for (const row of rows) {
        const h = row.getBoundingClientRect().height;
        if (pages.length === 0 || pages.at(-1)!.length >= PAGE_ROWS || used + gap + h > room) { pages.push([row]); used = h; }
        else { pages.at(-1)!.push(row); used += gap + h; }
      }
      // 한 쪽이어도 자리는 지킨다(`visibility`) — 숨겼다 드러내면 머리 너비가 바뀌어 맞춰 둔 머리 글자가 잘렸다
      pager.style.visibility = pages.length <= 1 ? 'hidden' : '';
      show(at);
    };
    prev.onclick = (e) => { e.stopPropagation(); show(at - 1); };
    next.onclick = (e) => { e.stopPropagation(); show(at + 1); };
    paginate();
    // 글자 범위 조각은 **그리면서** 받기 시작한다 — 나눈 직후에는 `document.fonts.status`가 아직 'loaded'라 그것으로는 못 기다린다.
    // 목록이 떠 있는 동안 글꼴이 하나 받아질 때마다 다시 나눈다
    const onFonts = (): void => { if (this.openSide === side && this.pop.contains(body)) paginate(); };
    document.fonts.addEventListener('loadingdone', onFonts);
    this.unwatchFonts = () => document.fonts.removeEventListener('loadingdone', onFonts);
  }

  /** 한 프레임 — 제목 · 장마다 제 시각표의 어디쯤인지 보고 자리 · 크기 · 투명도 · 밝기를 정한다 */
  private draw(): void {
    const live: Record<Side, boolean> = { P1: false, P2: false };
    this.segments.forEach((g, i) => {
      const el = this.titles[i]!;
      const u = this.elapsed - g.at;
      if (u < 0 || u >= COLLECTION_TITLE_MS) { hide(el); return; }
      // 강조 — 크게 나타나며 가라앉고(펼침), 머물고, 살짝 커지며 사라진다
      let o = 1; let sc = 1;
      if (u < TITLE_IN_MS) { const e = easeOut(u / TITLE_IN_MS); o = e; sc = lerp(1.35, 1, e); }
      else if (u > COLLECTION_TITLE_MS - TITLE_OUT_MS) { const e = (u - (COLLECTION_TITLE_MS - TITLE_OUT_MS)) / TITLE_OUT_MS; o = 1 - e; sc = 1 + 0.06 * e; }
      el.style.visibility = '';
      el.style.opacity = String(o);
      el.style.transform = `translate(-50%, -50%) scale(${sc})`;
      live[g.side] = true;
    });
    const slot = (k: number): Pt => ({ x: CENTER.x + SLOT_DX * k, y: CENTER.y + SLOT_DY * k });
    const slotScale = (k: number): number => 1 - 0.035 * k;
    const slotDim = (k: number): number => 1 - 0.12 * k;
    this.flights.forEach((el, i) => {
      const side = this.cards[i]!.side;
      const deck = DECK[side];
      const { base, j, n } = this.slots[i]!;
      const t = this.elapsed - base;
      if (t < 0) { hide(el); return; }
      const f = t < COLLECTION_IN_MS ? 0 : front(t, n);
      const leaveAt = COLLECTION_IN_MS + j * STEP + COLLECTION_HOLD_MS;
      let p: Pt; let s: number; let o = 1; let dim = 1; let z: number; let lit = false;
      if (t >= leaveAt) {
        // 돌아감 — 가운데에서 제 덱 쪽(북군 위 · 남군 아래)으로 먼저 움직이고 오른쪽으로 꺾어 덱에 든다
        const u = (t - leaveAt) / COLLECTION_OUT_MS;
        if (u >= 1) { hide(el); return; }
        const e = easeIn(u);
        p = bez(CENTER, { x: 50, y: deck.y }, deck, e);
        s = lerp(1, SMALL, e);
        o = 1 - e;
        z = 20;
      } else if (t < COLLECTION_IN_MS) {
        // 첫 걸음 — 앞 장과 쌓일 셋이 조금씩 어긋나 덱에서 오른쪽 벽을 타고 제 칸으로
        if (j > STACK) { hide(el); return; }
        const start = j * 70;
        const u = easeOut(Math.max(0, Math.min(1, (t - start) / (COLLECTION_IN_MS - start))));
        if (u <= 0) { hide(el); return; }
        p = bez(deck, { x: WALL_X, y: 50 }, slot(j), u);
        s = lerp(SMALL * 1.4, slotScale(j), u);
        o = lerp(0.45, 1, u);
        dim = lerp(1, slotDim(j), u);
        z = 10 - j;
      } else {
        const k = j - f;
        if (k > STACK + 1 || k < 0) { hide(el); return; }
        if (k > STACK) {
          // 덱에서 쌓임의 맨 뒤로 — 앞 장이 자리를 내주는 동안
          const u = STACK + 1 - k;
          if (u <= 0) { hide(el); return; }
          p = bez(deck, { x: WALL_X, y: 50 }, slot(STACK), u);
          s = lerp(SMALL * 1.4, slotScale(STACK), u);
          o = lerp(0.45, 1, u);
          dim = lerp(1, slotDim(STACK), u);
        } else {
          p = slot(k);
          s = slotScale(k);
          dim = slotDim(k);
          if (k === 0) {
            const h = t - (COLLECTION_IN_MS + j * STEP);
            lit = h >= 0 && h < COLLECTION_HOLD_MS;
            if (lit && h < POP_MS) s *= 1 + 0.06 * Math.sin((Math.PI * h) / POP_MS);
          }
        }
        z = 10 - Math.ceil(k);
      }
      live[side] = true;
      el.style.visibility = '';
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
      el.style.transform = `translate(-50%, -50%) scale(${s})`;
      el.style.opacity = String(o);
      el.style.filter = dim < 1 ? `brightness(${dim})` : '';
      el.style.zIndex = String(z);
      if (el.classList.contains('lit') !== lit) el.classList.toggle('lit', lit);
    });
    for (const side of ['P1', 'P2'] as const) {
      const v = live[side] ? 'on' : '';
      if (this.decks[side].dataset.live !== v) this.decks[side].dataset.live = v;
    }
  }
}

/**
 * 마디 안에서 장 `j`가 앞으로 나서기 시작하는 시각 — 첫 장은 덱에서 나올 때(0), 그 뒤는 앞 장이 자리를 내줄 때.
 * 소리는 여기서 튼다: 「쨍」이 0.5초쯤 뒤에 오는 소리라, 장이 앞에 닿아 빛을 받는 순간(나옴 0.5초 · 넘김 0.4초 뒤)과 맞는다
 */
function openAt(j: number): number {
  return j === 0 ? 0 : COLLECTION_IN_MS + (j - 1) * STEP + COLLECTION_HOLD_MS;
}

/**
 * 마디 안에서 앞에 선 장의 자리 — 정수면 그 장이 머무는 중, 사이 값이면 앞 장이 돌아가고 뒤 장이 나서는 중.
 * 장마다 `j − front`가 쌓임의 칸(0 = 앞, 1~3 = 뒤)이 된다
 */
function front(t: number, n: number): number {
  const last = n - 1;
  const k = Math.min(last, Math.floor((t - COLLECTION_IN_MS) / STEP));
  const r = t - COLLECTION_IN_MS - k * STEP;
  return k >= last || r < COLLECTION_HOLD_MS ? k : k + easeOut((r - COLLECTION_HOLD_MS) / COLLECTION_SWAP_MS);
}

function pageButton(action: string, glyph: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'cfx-pg';
  b.dataset.action = action;
  b.textContent = glyph;
  return b;
}

/**
 * 한 줄에 안 들어가면 글자를 줄인다 — 70%까지. 접지 않는다.
 * 글자 너비는 Range로 잰다 — 한 줄로 묶인 칸은 들어가도 `scrollWidth === clientWidth`라 「넘쳤나」를 그것으로는 못 가른다
 * (처음에 `scrollWidth > clientWidth × 0.98`로 쟀다가 117개가 전부 줄었다)
 */
function fitLine(el: HTMLElement): void {
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize);
  const range = document.createRange();
  range.selectNodeContents(el);
  const room = el.clientWidth * 0.98;
  let size = base;
  while (range.getBoundingClientRect().width > room && size > base * 0.7) {
    size -= base * 0.04;
    el.style.fontSize = `${size}px`;
  }
}

function hide(el: HTMLElement): void {
  el.style.opacity = '0';
  el.style.visibility = 'hidden';
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
