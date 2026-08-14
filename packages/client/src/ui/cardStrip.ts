/**
 * 캐릭터 카드 스트립 — 체스판 위·아래 (기획 pptx 27쪽 · 2026-08-14 벽보 리디자인)
 *
 * ```
 *   ▁▂▃▄▅▆▇      ▁▂▃▄▅▆▇      ▁▂▃▄▅▆▇     ← 기와 지붕 (액자 그림의 윗변)
 *  ┃ ┌──────┐ ┃  ┃ ┌──────┐ ┃  ┃ ┌──────┐ ┃  위 = 북군(P2) · 아래 = 남군(P1)
 *  ┃ │ King │ ┃  ┃ │Queen │ ┃  ┃ │Bishop│ ┃  판의 진영 배치와 같다 — P2가 위쪽 5행,
 *  ┃ │[사진]│ ┃  ┃ │[사진]│ ┃  ┃ │[사진]│ ┃  P1이 아래쪽 5행 (rules/state.ts deployZone)
 *  ┃ │S 조운│ ┃  ┃ │A 유봉│ ┃  ┃ │B 관평│ ┃
 *  ┃ │HP ▓▒│ ┃  ┃ │HP ▓▓│ ┃  ┃ │HP ▓░│ ┃
 *  ┃ │WT 1.3│ ┃  ┃ │WT 차례│┃  ┃ │WT 0.4│ ┃
 *  ┃ │간뇌도지│┃  ┃ │용맹전진│┃  ┃ │  —   │ ┃  ← 고유기술은 종이 맨 아래
 *  ┃ └──────┘ ┃  ┃ └──────┘ ┃  ┃ └──────┘ ┃
 *  ┗━━━━━━┛  ┗━━━━━━┛  ┗━━━━━━┛  ← 기둥·아래 가로대
 * ```
 *
 * **카드 한 장이 벽보 한 장이다** (`assets/map/person.png`). 액자는 CSS가 9분할로
 * 두르므로(`style.css`의 `.uc-frame`) 3:3·5:5로 칸 너비가 달라져도 지붕 두께와
 * 기둥 굵기는 화면에서 언제나 같다. 카드 내용은 액자 안쪽 **흰 종이** 위에 얹힌다.
 *
 * 세로 순서는 기획자 지정이다 — `[기물 이름] [사진] [클래스 성명 레벨] [HP] [대기시간] [고유기술(SP)]`.
 *
 * **고유기술 버튼의 색이 곧 사양이다** (27쪽):
 * 주황 = SP가 모자람 · 초록 = 사용 준비됨 · 회색 = 이미 사용함.
 * 예전 HUD의 표기(금색 ●/회색 ○)와 정반대라 색 이름을 `data-state`로 못 박아 둔다.
 *
 * **판정은 하지 않는다.** 무엇을 보여줄지는 상태를 그대로 읽고, 고유기술을 실제로 쓸 수
 * 있는지는 누른 뒤 `ControlModal`이 `validate()`에 묻는다 — 화면 전체가 지키는 계약이다.
 */

import { officerById, skillById } from '@samchess/data';
import type { BattleState, Side, UnitId, UnitState } from '@samchess/rules';

/** 고유기술 버튼의 4상태. `data-state`와 1:1로 대응하고 색은 `style.css`가 준다. */
type SkillState = 'ready' | 'poor' | 'used' | 'none';

export interface CardHandlers {
  /** 카드를 눌렀다 — 그 기물로 카메라를 옮기고 상태 팝업을 연다 (pptx 28쪽) */
  pick(unitId: UnitId): void;
  /** 고유기술 버튼을 눌렀다 */
  skill(unitId: UnitId): void;
}

interface Card {
  unit: UnitId;
  root: HTMLElement;
  art: HTMLImageElement;
  who: HTMLElement;
  hpFill: HTMLElement;
  hpNum: HTMLElement;
  wait: HTMLElement;
  waitFill: HTMLElement;
  skill: HTMLButtonElement;
  last: string;
}

/** 진영 → 스트립. 판이 P2를 위, P1을 아래에 두므로 이름도 그렇게 붙는다. */
const ARMY: Record<Side, string> = { P2: '북군', P1: '남군' };

export class CardStrip {
  private cards: Card[] = [];

  constructor(
    north: HTMLElement,
    south: HTMLElement,
    state: BattleState,
    private readonly humanSide: Side | null,
    private readonly on: CardHandlers,
  ) {
    for (const [host, side] of [[north, 'P2'], [south, 'P1']] as [HTMLElement, Side][]) {
      host.replaceChildren();
      host.dataset.side = side;
      host.dataset.army = ARMY[side];
      host.classList.toggle('mine', side === humanSide);

      /*
       * **카드 한 장 = 벽보 한 장** (2026-08-14 리디자인).
       *
       * 예전에는 카드 줄과 고유기술 줄을 **따로 둔 두 그리드**였다(같은 열 수라
       * 세로로 정렬됐다). 이제는 액자 그림이 둘을 한꺼번에 감싸야 해서 유닛마다
       * 칸(`.uc-frame`) 하나를 두고 그 안에 카드와 고유기술 버튼을 넣는다.
       * 버튼이 카드 아래 한 줄로 늘어서는 모습은 그대로다 — 칸마다 맨 아래이므로.
       */
      const slots = add(host, 'div', 'strip-slots');
      const units = Object.values(state.units).filter((u) => u.side === side);
      slots.style.setProperty('--cols', String(units.length));
      for (const unit of units) this.cards.push(this.build(slots, unit));
    }
  }

  private build(slots: HTMLElement, unit: UnitState): Card {
    const officer = officerById.get(unit.officer)!;
    const skill = officer.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;

    // 벽보 액자 한 칸. 그림은 CSS가 9분할로 두르고(`.uc-frame`), 안쪽 흰 종이가
    // 카드와 고유기술 버튼의 자리가 된다. 그림이 없으면 테두리만 사라진다.
    const frame = add(slots, 'div', 'uc-frame');

    const root = document.createElement('button');
    root.className = 'uc';
    root.dataset.unit = unit.id;
    root.dataset.side = unit.side;
    root.addEventListener('click', () => this.on.pick(unit.id));

    // [기물 이름]
    addText(root, 'span', 'uc-piece', unit.piece);

    // [사진] — 수묵화 → 타일 초상화 → 빈자리로 물러난다. 그림은 리포에 없다(기획자 방침).
    const art = document.createElement('img');
    art.className = 'uc-art';
    art.alt = '';
    setCardArt(art, unit.officer);
    root.appendChild(art);
    // 「퇴각」 도장. 실제 표시 여부는 `.uc.down`이 정한다 (27쪽 — 전투 불능 시 표출)
    addText(root, 'span', 'uc-down', '퇴각');

    // [클래스, 장수 성명, 레벨]
    const who = addText(root, 'span', 'uc-who', '');
    who.dataset.grade = officer.grade;

    // [HP] — 게이지 위에 숫자. 숫자만 있으면 "얼마나 남았나"가, 게이지만 있으면
    // "몇 대 더 맞나"가 안 보인다. 둘 다 필요하다.
    const hp = add(root, 'span', 'uc-hp');
    addText(hp, 'i', '', 'HP');
    const bar = add(hp, 'span', 'uc-bar');
    const hpFill = add(bar, 'em', '');
    const hpNum = addText(bar, 'b', '', '');

    // [대기시간] — 숫자만으로는 "곧인지 한참인지"가 안 읽혀 게이지를 함께 둔다.
    // **판 위의 WT 바가 기본 배율에서 안 보인다**는 기획자 지적이라, 이쪽이 본체가 된다.
    // 방향은 판과 같다 — 차례가 다가올수록 차오른다 (GDD §3.10).
    const wt = add(root, 'span', 'uc-wt');
    addText(wt, 'i', '', 'WT');
    const wtBar = add(wt, 'span', 'uc-bar');
    const waitFill = add(wtBar, 'em', '');
    const wait = addText(wtBar, 'b', '', '');

    frame.appendChild(root);

    // [고유기술(필요SP)] — 없는 장수도 자리는 잡는다. 빠지면 칸마다 높이가 달라져
    // 벽보의 종이 아래가 들쭉날쭉해진다.
    const button = document.createElement('button');
    button.className = 'uc-skill';
    button.dataset.unit = unit.id;
    button.textContent = skill ? `${skill.name}(${skill.spCost})` : '—';
    button.title = skill ? `${skill.name}(${skill.hanja}) — ${skill.text}` : '고유기술 없음';
    button.addEventListener('click', () => this.on.skill(unit.id));
    frame.appendChild(button);

    return { unit: unit.id, root, art, who, hpFill, hpNum, wait, waitFill, skill: button, last: '' };
  }

  /**
   * 매 프레임 불린다.
   *
   * `displayTime`은 권위 상태의 `time`이 아니라 **화면이 따라잡은 시각**이다.
   * `advanceTime()`은 다음 제어권까지 한 번에 점프하므로 `unit.wt`를 그대로 적으면
   * 대기시간이 순간이동한다 — 타일의 WT 게이지와 **같은 보정**을 쓴다(`BattleScene.syncWaitBars`).
   *
   * @param shownHp 지금 화면에 그려야 할 HP. 게이지가 피격 그림보다 먼저 줄지 않도록
   *   연출 층이 보정해 준다(`PoseDirector.shownHp`). 타일 바와 **같은 값**이어야 한다.
   */
  refresh(state: BattleState, displayTime: number, shownHp?: (unit: UnitState) => number): void {
    const lag = state.time - displayTime;
    for (const card of this.cards) {
      const unit = state.units[card.unit]!;
      const hp = shownHp ? shownHp(unit) : unit.hp;
      const officer = officerById.get(unit.officer)!;
      const skill = officer.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;

      const turn = state.activeUnit === unit.id;
      const remain = Math.max(0, unit.wt + lag);
      // 대기시간은 일(日) 단위로 적는다 — HUD 시계와 같은 단위라 서로 비교가 된다.
      // **소수 둘째 자리까지** 적는다 (2026-08-13 기획자 지정) — 한 자리로는 차례가
      // 코앞인 구간이 전부 `0.0일`로 뭉쳐 누가 먼저인지 안 보인다.
      const waitText = !unit.alive ? '—' : turn ? '차례' : `${(remain / 100).toFixed(2)}일`;
      const s: SkillState = !skill ? 'none'
        : unit.uniqueSkillUses <= 0 ? 'used'
        : state.sp[unit.side] < skill.spCost ? 'poor'
        : 'ready';

      // 게이지는 시간에 따라 매끄럽게 차오르므로 소수 둘째 자리까지 키에 넣는다
      const filled = unit.alive ? 1 - Math.min(1, remain / Math.max(1, unit.wtBase)) : 0;
      const key = `${unit.alive}|${hp}/${unit.maxHp}|${waitText}|${filled.toFixed(2)}|${s}|${turn}|${unit.level}`;
      if (key === card.last) continue;
      card.last = key;

      card.root.classList.toggle('turn', turn);
      card.root.classList.toggle('down', !unit.alive);
      card.who.textContent = `${officer.name} Lv${unit.level}`;
      card.hpFill.style.width = `${unit.alive ? Math.max(0, (hp / unit.maxHp) * 100) : 0}%`;
      card.hpFill.classList.toggle('low', hp / unit.maxHp <= 0.34);
      card.hpNum.textContent = String(Math.max(0, hp));
      card.wait.textContent = waitText;
      card.wait.classList.toggle('now', turn);
      card.waitFill.style.width = `${filled * 100}%`;
      card.waitFill.classList.toggle('ready', turn || remain <= 0);
      card.skill.dataset.state = s;
      // 전투 불능이면 잠근다 (27쪽 — 「고유기술 버튼 disabled」).
      // 고유기술이 없는 장수의 빈 자리도 눌릴 이유가 없다.
      card.skill.disabled = !unit.alive || s === 'none';
    }
  }

  /** 스모크 테스트용 — 화면에 실제로 그려진 카드 상태 */
  debugCards(): { unit: string; side: string; turn: boolean; down: boolean; skill: string }[] {
    return this.cards.map((c) => ({
      unit: c.unit,
      side: c.root.dataset.side ?? '',
      turn: c.root.classList.contains('turn'),
      down: c.root.classList.contains('down'),
      skill: c.skill.dataset.state ?? '',
    }));
  }

  /** 내가 조작하는 진영 — 스트립에 「(나)」 표시를 붙이는 데 쓴다 */
  get mine(): Side | null { return this.humanSide; }
}

/**
 * 카드 그림 — 수묵화 → 타일 초상화 → 빈자리.
 *
 * `art.ts`의 `setOfficerArt`와 같은 순서지만 여기서 따로 두는 이유는, 카드가 세로로 긴
 * 자리라 **정사각 수묵화가 더 잘 맞기 때문**이다. 물러나는 규칙 자체는 같다.
 */
function setCardArt(img: HTMLImageElement, officerId: string): void {
  img.onerror = () => {
    img.onerror = () => { img.onerror = null; img.classList.add('no-art'); };
    img.src = `portraits/${officerId}.png`;
  };
  img.src = `battle/${officerId}.jpg`;
}

function add(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

function addText(parent: HTMLElement, tag: string, className: string, text: string): HTMLElement {
  const node = add(parent, tag, className);
  node.textContent = text;
  return node;
}
