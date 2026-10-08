/**
 * 시각 효과(visual effect) — 「지금 이 유닛 뒤에 무슨 링을 깔 것인가」.
 *
 * **엔진의 「오라」와 이름이 겹치지 않게 조심한다.** `aurasOn()`은 여포·허저의 반경
 * **판정**이고(GDD §12 A1), 이 파일은 화면에 겹쳐 그리는 **그림**을 정한다.
 * 기획자와 `visualEffect`로 부르기로 했다 (2026-08-13). 엑셀 시트 이름만
 * 「오라매핑」으로 남아 있다.
 *
 * ────────────────────────────────────────────────────────────────
 * 다섯 갈래 (2026-10-08 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전엔 상태마다 그림이 따로였고(숫자 23장 + 조운 · 여포 예외 + 일회성 알파벳) 판 위가 난잡했다.
 * 이제 **뜻의 갈래**만 그린다 — 무엇이 걸렸는지는 장수 팝업의 상태 배지가 글로 알려 준다.
 *
 * | 순서 | 갈래 | 그림 |
 * |---|---|---|
 * | 1 | 고유기술 시전 중 | `cast-{등급}` |
 * | 2 | 고유기술이 건 나쁜 효과 | `14` |
 * | 3 | 책략이 건 나쁜 효과 | `2` |
 * | 4 | 고유기술이 건 좋은 효과 | `17` |
 * | 5 | 책략 · 아이템이 건 좋은 효과 | `1` |
 *
 * 좋고 나쁨은 엔진의 `STATUS_META.kind`(오라는 `aurasOn()`의 `kind`), 출처는 엔진이 거는 순간 남긴
 * `origin` 하나다 — 화면이 상태 이름으로 출처를 짐작하지 않는다(같은 상태가 양쪽에서 온다).
 * 여럿이면 **이 순서로** 3초씩 돌리고 사이를 1초 페이드로 잇는다(`ringAt`).
 *
 * 「세는」 상태(삼고초려 표식 · AT 누적 · 다음 공격 즉사)는 링이 아니라 고유기술 동그라미의 숫자다(`counterOn`).
 *
 * ────────────────────────────────────────────────────────────────
 * 이 파일은 Phaser를 부르지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `camera.ts`·`poses.ts`와 같은 이유다 — 헤드리스로 검사할 수 있어야 한다
 * (`test/visualEffect.test.ts`).
 */

import { STATUS_META, aurasOn } from '@samchess/rules';
import type { ActiveStatus, BattleState, StatusOrigin, UnitId, UnitState } from '@samchess/rules';
import { VISUAL_EFFECTS, combatantById } from '@samchess/data';

const FX = VISUAL_EFFECTS.persistent;

/** 링 하나가 온전히 도는 시간 (기획자 지정 «3초») */
export const RING_HOLD_MS = 3000;
/** 다음 링으로 넘어가는 페이드 — 나가는 것 반 · 들어오는 것 반 (기획자 지정 «1초») */
export const RING_FADE_MS = 1000;
/** 겹친 링 하나가 차지하는 칸 = 들어오는 페이드 반 + 3초 + 나가는 페이드 반 */
export const SWAP_MS = RING_HOLD_MS + RING_FADE_MS;

type Tone = 'buff' | 'debuff';

/** 좋음/나쁨 × 고유기술/책략 → 그림 */
export function ringOf(kind: Tone, origin: StatusOrigin | undefined): string {
  const skill = origin === 'skill';
  return kind === 'debuff'
    ? (skill ? FX.rings.skillDebuff : FX.rings.tacticDebuff)
    : (skill ? FX.rings.skillBuff : FX.rings.tacticBuff);
}

/** 좋음/나쁨 한쪽의 두 그림(고유기술 · 책략) — 출처를 모르는 자리(이벤트)가 함께 다룰 때 */
export const ringsOfKind = (kind: Tone): string[] => [ringOf(kind, 'skill'), ringOf(kind, undefined)];

/** 상태 하나의 링 — `poses.ts`가 「방금 걸린 디버프」를 맞는 순간까지 감출 때도 쓴다 */
export const ringOfStatus = (st: ActiveStatus): string => ringOf(STATUS_META[st.status].kind, st.origin);

/** 우선순위 — 시전 중 → 고유기술 나쁨 → 책략 나쁨 → 고유기술 좋음 → 책략 좋음 (기획자 확정) */
const ORDER: readonly string[] = [FX.rings.skillDebuff, FX.rings.tacticDebuff, FX.rings.skillBuff, FX.rings.tacticBuff];
const rank = (vfx: string): number => {
  const i = ORDER.indexOf(vfx);
  return i < 0 ? -1 : i;                       // 시전 오라(`cast-*`)는 표 밖 — 맨 앞
};

/**
 * 이 유닛에 걸린 링을 **우선순위 순으로** 돌려준다 (갈래마다 하나, 겹치면 여럿).
 *
 * 출처가 다섯이다. **넷은 `unit.statuses`에 없다** — 놓치기 쉬운 자리다.
 *  1. `unit.statuses`    — 보통의 상태이상
 *  2. `unit.control`     — 조종. 별도 필드다(언제나 나쁨)
 *  3. `aurasOn()`        — 여포 · 허저 오라에 **영향받는 쪽**. 이 유닛에는 흔적이 없다. 오라는 고유기술뿐이다
 *  4. `unit.wtModifiers` — 병귀신속 · 신속. 상태가 아니라 WT 보정 배열이다. 고유기술뿐이다
 *  5. `unit.casting`     — 고유기술 시전 중. **등급별로 그림이 다르다** (2026-09-07)
 *
 * `extra`는 엔진에 흔적이 없어 화면이 물고 있는 링(`PendingRings`)이다 — 같은 순서에 끼운다.
 */
export function ringsOn(state: BattleState, unit: UnitState, extra?: string): string[] {
  const out: string[] = [];
  const add = (vfx: string | undefined): void => {
    if (vfx && !out.includes(vfx)) out.push(vfx);
  };

  for (const s of unit.statuses) add(ringOfStatus(s));
  if (unit.control) add(ringOf('debuff', unit.control.origin));
  for (const aura of aurasOn(state, unit.id)) add(ringOf(aura.kind, 'skill'));
  for (const m of unit.wtModifiers ?? []) {
    if (m.turnsLeft > 0 && m.delta !== 0) add(ringOf(m.delta < 0 ? 'buff' : 'debuff', 'skill'));
  }
  add(extra);
  // 시전 중 — 등급은 **장수**가 갖고 있다(기술이 아니라). A/B급은 여럿이 같은
  // 기술을 나눠 쓰므로 기술로 고르면 한 그림밖에 안 나온다.
  if (unit.casting) add(FX.byCasting[combatantById.get(unit.officer)?.grade as keyof typeof FX.byCasting]);

  return out.sort((a, b) => rank(a) - rank(b));
}

/** 지금 그릴 링 하나와 그 불투명도 */
export interface RingFrame { vfx: string; alpha: number }

/**
 * 지금 이 순간 보여줄 링 하나. 겹쳐 있으면 3초씩 돌리고, 갈아 끼우는 자리에서 1초에 걸쳐
 * 나가는 것이 사라지고(0.5초) 들어오는 것이 차오른다(0.5초) — 「확확 바뀌지 않게」(기획자 지정).
 * 하나뿐이면 깜빡이지 않는다.
 *
 * `elapsedMs`는 **판 전체가 공유하는 시계**를 넣는다. 유닛마다 따로 세면 링들이
 * 제각각 갈아 끼워져 화면이 어지럽다.
 */
export function ringAt(rings: readonly string[], elapsedMs: number): RingFrame | null {
  if (rings.length === 0) return null;
  if (rings.length === 1) return { vfx: rings[0]!, alpha: 1 };
  const t = Math.max(0, elapsedMs);
  const vfx = rings[Math.floor(t / SWAP_MS) % rings.length]!;
  const at = t % SWAP_MS;
  const half = RING_FADE_MS / 2;
  const alpha = at < half ? at / half : at > SWAP_MS - half ? (SWAP_MS - at) / half : 1;
  return { vfx, alpha };
}

/** 고유기술 동그라미에 얹는 숫자 — `kind`가 색을 정한다 */
export interface Counter { text: string; kind: Tone }

/**
 * 「세는」 상태를 고유기술 동그라미(장수 왼쪽 위)에 숫자로 (2026-10-08 기획자 확정).
 * 링으로는 「몇 번 남았나」를 못 보여 준다.
 *
 * - 삼고초려 표식(맞은 쪽) — `표식/필요` (3이 차면 지휘권을 빼앗긴다)
 * - AT 누적(강유 「구벌중원」) — `+누적`. 아직 안 때렸으면(0) 안 띄운다
 * - 다음 공격 즉사(관우) — `!`
 *
 * 둘 이상이면 나쁜 것(표식)이 먼저다 — 링의 순서와 같은 이유.
 */
export function counterOn(unit: UnitState): Counter | null {
  const mark = unit.statuses.find((s) => s.status === 'convertProgress');
  if (mark) return { text: `${mark.magnitude ?? 0}/${mark.charges ?? 3}`, kind: 'debuff' };
  const stack = unit.statuses.find((s) => s.status === 'attackStacking');
  if (stack && (stack.magnitude ?? 0) > 0) return { text: `+${stack.magnitude}`, kind: 'buff' };
  if (unit.statuses.some((s) => s.status === 'instantKillNext')) return { text: '!', kind: 'buff' };
  return null;
}

/**
 * 링 그림 한 칸을 보여주는 시간 (기획자 지정 «0.5초에 한 번씩», 2026-09-01
 * 「불꽃」류 시범). `SWAP_MS`(4초, 겹친 링을 갈아 끼우는 주기)와는 다른 시계처럼
 * 보이지만 같은 `ringClockMs`를 나눠 쓴다 — 유닛마다 따로 세면 화면이 어지럽다는
 * 점은 스왑과 같은 이유다.
 */
export const RING_FRAME_MS = 500;

/** 4칸 띠(`tools/build_status_fx.py`의 `-new` 소스)의 칸 수 — 2×2를 편 것 */
export const RING_FRAMES = 4;

/**
 * 지금 보여줄 칸. `tools/build_status_fx.py`가 2×2를 4칸 띠로 편 그림(원래
 * `-new` 소스)에만 뜻이 있다 — 한 칸짜리 그림은 `frameCount`가 1로 들어와
 * 언제나 0을 돌려준다.
 */
export function ringFrame(elapsedMs: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  return Math.floor(Math.max(0, elapsedMs) / RING_FRAME_MS) % frameCount;
}

/**
 * 화면 갱신 판단용 지문. `statusChips.ts`의 `auraKey`와 같은 이유로 필요하다 —
 * **다른 유닛이 움직이면** 오라 링이 붙었다 떨어졌다 하는데 이 유닛의 상태는
 * 하나도 안 바뀐다.
 */
export const ringKey = (state: BattleState, unit: UnitState): string =>
  ringsOn(state, unit).join(',');

/**
 * 「선공」 · 「함정」 · 「십면매복」처럼 **즉시 1회**로 끝나는 WT 보정을 다음 차례까지 붙들어 둔다.
 *
 * `modifyWt`에 `turns`가 없으면 `wtModifiers`에 남지 않아 걸 자리가 없다.
 * 그런데 효과(「다음 차례가 당겨졌다/밀렸다」)는 그 차례가 올 때까지 유효하므로,
 * **제어권을 받으면 지운다**는 규칙으로 화면이 따로 물고 있는다
 * (2026-08-13 기획자 확정 — 그때는 당기는 것만, 2026-10-08 일회성 `D`를 걷으며 미는 것도).
 *
 * 엔진에 흔적이 없는 것을 화면이 기억하는 유일한 자리다. 온라인이 되면 이
 * 값은 클라이언트마다 따로 생기는데, **보여 주기 전용이라 판정에 영향이 없다.**
 */
export class PendingRings {
  private readonly held = new Map<UnitId, string>();

  /** 책략·기술이 즉시 WT를 당겼다. 다음 차례까지 링을 물고 있는다. */
  mark(unit: UnitId, vfx: string): void { this.held.set(unit, vfx); }

  /** 제어권을 받았다 — 당겨진 차례가 실제로 왔으므로 지운다. */
  clear(unit: UnitId): void { this.held.delete(unit); }

  clearAll(): void { this.held.clear(); }

  get(unit: UnitId): string | undefined { return this.held.get(unit); }
}

/** 그림 파일 경로. `tools/build_status_fx.py`가 굽는다. */
export const ringUrl = (vfx: string): string => `vfx/${vfx}.png`;

/** 이 장수의 이름 — 링을 로그·디버그에 찍을 때만 쓴다. */
export const officerName = (unit: UnitState): string =>
  combatantById.get(unit.officer)?.name ?? unit.officer;
