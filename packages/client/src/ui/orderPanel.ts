/**
 * 순서 판 — 위 칸 왼쪽 (전투 UI 개편 3단계, pptx 90·92쪽 · `docs/전투UI개편/설계.md` §1 · §3)
 *
 * ```
 *            ┌──[ 순서 ]──┐             ← 제목 판(`plate-settings.png`, pptx 103쪽 — 열 제목 줄을 갈음)
 * (①)═╡ ♚ [얼굴] 차례              ▶   ← 한 줄 = 칼 한 자루 (pptx 101쪽). 칼자루에 숫자 방패,
 * (②)═╡ ♜ [얼굴] 0.25              ▶      칼날에 기물 · 얼굴 띠(102쪽 — 이름 글자를 갈음) · 대기(얇은 막대 위에 숫자)
 * ```
 *
 * - **얼굴 띠**(`faces/{id}.webp`, `tools/build_portraits.py`) — 수묵화를 눈높이 가운데로 2:1로 자른 것. 이름 글자는
 *   세 글자부터 「사마…」로 접혀 그림으로 갈음했다(2026-10-08). 이름은 줄의 `title`과 그림의 `alt`에 남는다.
 * - **장전 연출**(2026-10-08 기획자 지정) — 차례가 넘어가면 첫 줄의 칼이 오른쪽으로 **쏘아지듯** 빠지며 사라지고,
 *   나머지가 한 칸씩 올라오고, 새 다섯째가 아래에서 나타난다(탄창에서 다음 탄이 올라오듯). **행동 연출과 시간 흐름이
 *   끝날 때까지는 옛 줄을 그대로 둔다** — 엔진은 행동과 함께 다음 제어권까지 이미 정해 두지만, 화면에서 그 사이는
 *   「방금 차례가 끝난 장수의 연출 → 대기 숫자가 줄어드는 시간」이다. 다음 장수가 차례를 받는 순간(카메라가
 *   그쪽으로 가기 시작할 때)에 쏜다. 그동안의 대기 숫자는 **옛 예보를 낸 상태의 시각**으로 잰다(아래 `from`).
 *
 * - **칼 둘레의 네온이 고유기술 상태다**(101쪽 → 2026-10-08 고침) — 쓸 수 있음: **등급 색**(B 파랑 · A 빨강 · S 보라 · E 노랑) ·
 *   준비 중(SP 부족): 어두운 회색 · 이미 씀 · 봉인(조조 「협천자」 등) · 고유기술 없음: 네온 없음.
 *   `skillStatus()` 다섯 값이 줄의 `data-skill`, 고유기술 등급이 `data-tier`이고 색은 CSS가 칠한다.
 *   옛 줄 끝 표시등(●)과 「스킬」 열은 이때 걷었다 — 고유기술 설명은 줄을 눌러 뜨는 장수 팝업의 고유기술 줄로 본다.
 *
 * - **기물은 아이콘이다**(`pieceIcon.ts`) — 아군 · 적군 두 벌. 영어 이름을 걷었다(100쪽).
 * - **대기는 숫자 + 막대**(100쪽) — 「일」을 뗀 숫자를 막대 **안**에 쓴다. 막대의 끝은 `WT_BAR_MAX`(3일)이고
 *   왼쪽 노랑 · 오른쪽 초록이 흐리게 섞인다. 숫자가 줄수록 초록이 왼쪽으로 노랑을 밀어내 0이면 온통 초록이다.
 *   3일이 넘으면 온통 노랑이다(숫자는 그대로).
 *
 * - 배치 · 정찰 중에는 **전원**을 두 열(1~5 · 6~10)로, 전투 중에는 **지금부터 5번째까지**.
 *   배치 중에는 위 칸 전체를 쓴다(게임 정보가 숨는다 — 90쪽 목업, 2026-10-06 기획자 확정).
 * - 순서는 엔진의 `turnForecast()`가 낸다 — 「다들 넘긴다」 가정이라 틀릴 수 있고,
 *   **상태가 바뀔 때마다 다시 부른다**(2026-09-27 기획자 확정). 화면이 순서를 셈하지 않는다.
 * - WT는 **매 프레임** 다시 적는다 — 예보 시각에 화면 지연(`state.time − displayTime`)을
 *   더한다. `advanceTime()`은 다음 제어권까지 한 번에 뛰므로, 안 더하면 숫자가 순간이동한다
 *   (옛 카드 줄 · 타일의 WT 게이지와 같은 보정).
 * - 표시등은 `skillStatus()` 다섯 값 그대로 `data-state`다(노랑 SP 부족 · 초록 준비 ·
 *   회색 사용 후 · 빨강 봉인 · 없음). 누르면 고유기술 설명 — 재생 없이 닫기만.
 * - **줄을 누르면 카메라가 그 장수에게 가고 살펴보기가 뜬다** (2026-10-06 기획자 확정) —
 *   옛 카드 줄의 「카드 → 카메라」(28쪽)를 이어받는다. 판정은 씬이 한다(`on.focus`).
 *
 * **판정은 하지 않는다.** 엔진이 낸 것을 그대로 그린다.
 */

import { combatantById, skillById } from '@samchess/data';
import { skillStatus, turnForecast } from '@samchess/rules';
import type { BattleState, Side, TurnSlot, UnitId } from '@samchess/rules';
import type { PlaybackPhase } from '../battle/playback.ts';
import { currentLang, t } from '../i18n/index.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { pieceIcon } from './pieceIcon.ts';
import { faceStripUrl, hasArt } from './art.ts';

/** 전투 중 순서 판의 줄 수 (92쪽 「현재 차례부터 향후 5번째까지」) */
export const ORDER_BATTLE_ROWS = 5;

/** WT 막대의 끝 — 이 값(일) 이상이면 온통 노랑 (2026-10-07 기획자 지정, pptx 100쪽) */
export const WT_BAR_MAX = 3;

interface Row {
  slot: TurnSlot;
  root: HTMLElement;
  wt: HTMLElement;
  /** 막대 — 노랑의 몫(0 = 온통 초록 · 1 = 온통 노랑)을 `--wt`로 받는다 */
  bar: HTMLElement;
}

export interface OrderPanelHooks {
  /** 줄을 눌렀다 — 카메라 · 살펴보기는 씬이 정한다 */
  focus(unitId: UnitId): void;
}

/** 장전 연출의 길이(ms) — 쏘아지는 칼 · 올라오는 줄 · 나타나는 다섯째 */
const RELOAD_MS = 420;

export class OrderPanel {
  private readonly listEl: HTMLElement;
  private rows: Row[] = [];
  /** 예보를 다시 부르는 계기 — 상태 객체가 바뀌었거나 단계(배치/전투)가 바뀌었다 */
  private lastState: BattleState | null = null;
  private lastMode = '';
  private lastLang = '';
  /** 지금 그린 예보를 낸 상태의 시각 — 대기 숫자는 「그 시각 + 예보 at − 화면 시각」이다 */
  private from = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly humanSide: Side | null,
    private readonly on: OrderPanelHooks,
  ) {
    // 제목 판 「순서」(103쪽) — 열 제목 줄을 갈음했다
    const plate = document.createElement('div');
    plate.className = 'ord-plate';
    plate.textContent = t('ord.title');
    this.plate = plate;
    // 둘째 자식은 배치 · 정찰의 단추 줄(`#ctx-prep`, pptx 100쪽) — 순서 판이 그 줄을 품는다. 그리기는 `PrepPanel`이 한다
    const keep = [...root.children].filter((c) => c.id === 'ctx-prep');
    this.listEl = document.createElement('div');
    this.listEl.className = 'ord-list';
    root.replaceChildren(plate, this.listEl, ...keep);
  }

  private readonly plate: HTMLElement;

  /**
   * 매 프레임 불린다. 예보는 상태가 바뀔 때만 다시 부르고, 그 사이에는 WT 글자만 고친다.
   *
   * @param busy    연출이 도는 중 — 전투 중이면 옛 줄을 그대로 두고 연출 · 시간 흐름이 끝난 뒤 장전한다(파일 머리)
   * @param focused 지금 카메라가 붙어 있는(줄로 고른) 장수 — 그 줄에 테를 두른다
   * @param flash   반짝일 장수 — 주사위 쪽지가 떠 있는 동안 동점 무리 (설계 §5-1 끝)
   */
  refresh(
    state: BattleState, displayTime: number, phase: PlaybackPhase, busy: boolean,
    focused: UnitId | null, flash: ReadonlySet<UnitId>,
  ): void {
    const deploy = phase === 'deploying' || phase === 'scouting';
    const mode = deploy ? 'deploy' : 'battle';
    const lang = currentLang();
    const changed = state !== this.lastState || mode !== this.lastMode || lang !== this.lastLang;
    // 전투 중 연출 · 시간 흐름 동안에는 옛 줄을 둔다 — 단계 · 언어가 바뀐 것은 기다리지 않는다
    const hold = mode === 'battle' && mode === this.lastMode && lang === this.lastLang
      && this.rows.length > 0 && (busy || phase === 'advancing');
    if (changed && !hold) {
      const animate = mode === 'battle' && mode === this.lastMode && lang === this.lastLang && this.rows.length > 0;
      if (lang !== this.lastLang) this.plate.textContent = t('ord.title');
      this.lastState = state;
      this.lastMode = mode;
      this.lastLang = lang;
      this.root.dataset.mode = mode;
      this.from = state.time;
      const count = deploy ? Object.values(state.units).filter((u) => u.alive).length : ORDER_BATTLE_ROWS;
      this.rebuild(state, turnForecast(state, count), animate);
    }

    for (const row of this.rows) {
      const { slot } = row;
      // 지금 차례 줄은 「차례」. 나머지는 일 단위, 소수 둘째 자리 (2026-09-27 기획자 확정) — 「일」은 뗐다(100쪽)
      const days = slot.active ? 0 : Math.max(0, this.from + slot.at - displayTime) / 100;
      const text = slot.active ? t('card.wait.turn') : days.toFixed(2);
      if (row.wt.textContent !== text) row.wt.textContent = text;
      const yellow = Math.min(1, Math.max(0, days / WT_BAR_MAX)).toFixed(3);
      if (row.bar.style.getPropertyValue('--wt') !== yellow) row.bar.style.setProperty('--wt', yellow);
      row.root.classList.toggle('focused', focused === slot.unit);
      row.root.classList.toggle('flash', flash.has(slot.unit));
    }
  }

  /**
   * 줄을 다시 그린다. `animate`면 **장전 연출**(FLIP) — 옛 줄의 자리를 재 두고, 새 줄을 옛 자리에서 제자리로 옮긴다.
   * 옛 첫 줄은 오른쪽으로 쏘아지며 사라지고(새 목록에 다시 있어도 그 줄은 아래에서 새로 나타난다), 목록에서 빠진
   * 다른 줄(퇴각)은 그 자리에서 흐려진다. 새로 들어온 줄은 아래에서 올라오며 나타난다.
   */
  private rebuild(state: BattleState, slots: TurnSlot[], animate: boolean): void {
    const motion = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = new Map<UnitId, DOMRect>();
    const old = this.rows;
    const fired = old[0] && slots[0]?.unit !== old[0].slot.unit ? old[0] : null;
    if (motion) for (const r of old) before.set(r.slot.unit, r.root.getBoundingClientRect());
    const host = this.listEl.getBoundingClientRect();

    this.rows = slots.map((slot, i) => this.row(state, slot, i + 1));
    this.listEl.replaceChildren(...this.rows.map((r) => r.root));
    if (!motion) return;

    const kept = new Set(this.rows.map((r) => r.slot.unit));
    for (const r of old) {
      const gone = r === fired || !kept.has(r.slot.unit);
      if (!gone) continue;
      // 옛 줄을 제자리에 띄워 두고 내보낸다 — 줄 목록(`rows`)에는 없다
      const at = before.get(r.slot.unit)!;
      const ghost = r.root;
      // `ord-row`는 남긴다 — 칼 · 방패 · 막대의 모양이 전부 그 아래에 걸려 있다(떼면 방패가 원본 크기로 커진다).
      // 세는 쪽은 `.ord-row:not(.ord-row-ghost)`로 고른다
      ghost.classList.remove('focused', 'flash');
      ghost.classList.add('ord-row-ghost');
      Object.assign(ghost.style, {
        position: 'absolute', left: `${at.left - host.left}px`, top: `${at.top - host.top}px`,
        width: `${at.width}px`, height: `${at.height}px`, pointerEvents: 'none',
      });
      this.listEl.append(ghost);
      const shot = r === fired;
      ghost.animate(shot
        ? [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${host.width * .9}px)`, opacity: 0 }]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: RELOAD_MS, easing: shot ? 'cubic-bezier(.5, 0, .9, .4)' : 'ease-out', fill: 'forwards' })
        .finished.then(() => ghost.remove(), () => ghost.remove());
    }
    for (const r of this.rows) {
      const was = r.slot.unit !== fired?.slot.unit ? before.get(r.slot.unit) : undefined;
      const now = r.root.getBoundingClientRect();
      if (was) {
        const dy = was.top - now.top;
        if (Math.abs(dy) > 1) {
          r.root.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
            { duration: RELOAD_MS, easing: 'cubic-bezier(.2, .8, .2, 1)', delay: 60 });
        }
      } else {
        // 탄창에서 올라오는 새 탄 — 아래에서 반 줄 올라오며 나타난다
        r.root.animate([{ transform: `translateY(${now.height * .7}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
          { duration: RELOAD_MS, easing: 'ease-out', delay: 140, fill: 'backwards' });
      }
    }
  }

  private row(state: BattleState, slot: TurnSlot, n: number): Row {
    const unit = state.units[slot.unit]!;
    const officer = combatantById.get(unit.officer);
    // 사람 쪽이 없으면(관전 · 데모) 남군을 아군 색으로 — 판의 아래쪽이 남군이다
    const mine = slot.side === (this.humanSide ?? 'P1');

    const root = document.createElement('div');
    root.className = 'ord-row';
    root.dataset.unit = slot.unit;
    root.dataset.side = mine ? 'mine' : 'foe';
    if (slot.active) root.dataset.active = '1';
    root.title = officer ? pickOfficerName(officer) : unit.officer;

    const pc = span('ord-pc', '');
    pc.append(pieceIcon(unit.piece, mine));
    // 순서 번호 = 칼자루 위의 방패 그림(1~10). 그 밖의 수는 글자로
    const num = span('ord-n', '');
    if (n >= 1 && n <= 10) {
      const shield = document.createElement('img');
      shield.alt = String(n);
      shield.src = `ui/numbers/${n}.png`;
      num.append(shield);
    } else {
      num.textContent = String(n);
    }
    // 장수 = 얼굴 띠(102쪽). 그림이 없다고 데이터가 말하는 장수는 이름 글자로
    const name = officer ? pickOfficerName(officer) : unit.officer;
    const who = span('ord-name', '');
    if (hasArt(unit.officer)) {
      const face = document.createElement('img');
      face.className = 'ord-face';
      face.alt = name;
      face.src = faceStripUrl(unit.officer);
      who.append(face);
    } else {
      who.textContent = name;
    }
    root.append(num, pc, who);
    const bar = span('ord-wt ord-bar', '');
    const wt = span('ord-wt-n', '');
    bar.append(wt);
    root.appendChild(bar);

    // 고유기술 상태 = 칼의 네온 (파일 머리). 쓸 수 있을 때의 색은 고유기술 등급이 정한다
    root.dataset.skill = skillStatus(state, slot.unit);
    const skill = officer?.uniqueSkill ? skillById.get(officer.uniqueSkill) : undefined;
    if (skill) root.dataset.tier = skill.tier;
    root.addEventListener('click', () => this.on.focus(slot.unit));
    return { slot, root, wt, bar };
  }

  /** 순서 판이 실제로 그린 것 — 스모크가 엔진의 예보와 맞춘다 */
  debugRows(): { unit: string; side: string; active: boolean; wt: string; bar: number; piece: string; skill: string }[] {
    return this.rows.map((r) => ({
      unit: r.slot.unit,
      side: r.root.dataset.side ?? '',
      active: r.slot.active,
      wt: r.wt.textContent ?? '',
      bar: Number(r.bar.style.getPropertyValue('--wt')),
      piece: r.root.querySelector<HTMLElement>('.pc-icon')?.dataset.piece ?? '',
      skill: r.root.dataset.skill ?? '',
    }));
  }
}

function span(className: string, text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
