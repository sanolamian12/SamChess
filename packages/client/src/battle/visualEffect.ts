/**
 * 시각 효과(visual effect) — 「지금 이 유닛 뒤에 무슨 링을 깔 것인가」.
 *
 * **엔진의 「오라」와 이름이 겹치지 않게 조심한다.** `aurasOn()`은 여포·허저의 반경
 * **판정**이고(GDD §12 A1), 이 파일은 화면에 겹쳐 그리는 **그림**을 정한다.
 * 기획자와 `visualEffect`로 부르기로 했다 (2026-08-13). 엑셀 시트 이름만
 * 「오라매핑」으로 남아 있다.
 *
 * ────────────────────────────────────────────────────────────────
 * 갈래가 둘이고 키가 다르다
 * ────────────────────────────────────────────────────────────────
 *
 * | 갈래 | 그림 | 키 | 어디서 |
 * |---|---|---|---|
 * | 지속형 | 숫자 `1`~`23` | **상태** — 매 프레임 다시 묻는다 | 이 파일 |
 * | 일회성 | 알파벳 `A`~`G` | **기술·책략 id** | `ui/burstFx.ts` |
 *
 * 일회성이 상태가 아닌 이유 — 즉시 정산이라 유닛에 흔적이 남지 않고, 방덕
 * 「세한지송백」(`multiplyMaxHp`)처럼 **이벤트조차 내지 않는** 것이 있다.
 * 그래서 「무엇이 시전됐나」로 잡는다. 엑셀 「오라매핑」 시트도 그 단위로 적혀 있다.
 *
 * ────────────────────────────────────────────────────────────────
 * 이 파일은 Phaser를 부르지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `camera.ts`·`poses.ts`와 같은 이유다 — 헤드리스로 검사할 수 있어야 한다.
 * 「여포가 자유 이동을 쓰기 전에는 `5`, 쓰고 나면 `10`」 같은 규칙은 눈으로
 * 확인하기 어렵고, 실제로 확인하려면 판이 그 상황이 되기를 기다려야 한다.
 * `test/visualEffect.test.ts` 가 그 자리를 대신한다.
 */

import { STATUS_META, aurasOn } from '@samchess/rules';
import type { BattleState, UnitId, UnitState } from '@samchess/rules';
import { VISUAL_EFFECTS, officerById } from '@samchess/data';

/**
 * 링이 둘 이상 겹칠 때 갈아 끼우는 주기 (기획자 지정 «2초 간격으로 스왑»).
 *
 * 줄여서 겹쳐 놓는 안도 있었는데 접었다 — 링이 전부 도넛이라 80%·60%로 줄이면
 * 안쪽 링이 캐릭터 몸에 가려 무엇인지 알아볼 수 없다. 몇 개가 걸렸는지는
 * 타일 우상·우하의 **버프/디버프 점 배지**가 이미 알려 준다.
 */
export const SWAP_MS = 2000;

const FX = VISUAL_EFFECTS.persistent;

/**
 * 이 유닛에 걸려 있는 링을 **전부** 돌려준다 (겹치면 여럿).
 *
 * 순서는 결정적이어야 한다 — 스왑이 순서를 타므로, 같은 상태에서 부를 때마다
 * 순서가 바뀌면 링이 무작위로 깜빡인다. 상태 배열의 순서(= 걸린 순서)를 그대로 쓴다.
 *
 * 출처가 다섯이다. **셋은 `unit.statuses`에 없다** — 놓치기 쉬운 자리다.
 *  1. `unit.statuses`  — 보통의 상태이상
 *  2. `unit.control`   — 조종. 별도 필드다
 *  3. `aurasOn()`      — 오라에 **영향받는 쪽**. 이 유닛에는 흔적이 없다
 *  4. `unit.wtModifiers` — 병귀신속·신속. 상태가 아니라 WT 보정 배열이다
 *  5. 지형              — 성지(holy) 위에 서 있는가
 */
export function ringsOn(state: BattleState, unit: UnitState): string[] {
  const out: string[] = [];
  const add = (vfx: string | undefined): void => {
    if (vfx && !out.includes(vfx)) out.push(vfx);
  };

  for (const s of unit.statuses) add(FX.byStatus[s.status]);
  if (unit.control) add(FX.byControl[unit.control.mode]);
  for (const aura of aurasOn(state, unit.id)) add(FX.byAura[aura.status]);
  if (unit.wtModifiers?.some((m) => m.turnsLeft > 0)) add(FX.wtModifier);

  const terrain = state.terrain?.find(
    (t) => t.pos.x === unit.pos.x && t.pos.y === unit.pos.y,
  );
  if (terrain) add(FX.byTerrain[terrain.terrain]);

  return applyOverrides(out, unit);
}

/**
 * 장수별 예외 둘. **데이터로 접히지 않아서** 남은 것이고, 그림 id 는 여전히
 * `visualEffects.json`이 준다 — 기획자가 그림만 갈아 끼울 수 있어야 하므로.
 *
 * - **조운 「간뇌도지」** — 반감(`1`)과 크리티컬(`4`)을 한꺼번에 얻는다.
 *   둘을 스왑하는 대신 전용 그림 `12` 하나로 바꾼다.
 * - **여포 「인중여포 마중적토」** — `freeMove`(1회)와 `auraOutgoingHalf`를 한꺼번에
 *   얻는데, 기획자 지정은 **차례로**다: 자유 이동을 쓰기 전에는 감녕과 같은 `5`,
 *   쓰고 나면 자기 표식 `10`. 스왑하면 「지금 자유 이동이 남았나」가 안 보인다.
 *   `freeMove`가 사라지는 순간 `5`가 빠지고 `10`이 저절로 드러난다.
 */
function applyOverrides(rings: string[], unit: UnitState): string[] {
  const officer = unit.officer;
  let out = rings;

  for (const c of FX.combo) {
    if (c.officer !== officer) continue;
    const need = c.requires.map((s) => FX.byStatus[s]).filter(Boolean) as string[];
    if (need.length === 0 || !need.every((v) => out.includes(v))) continue;
    out = [c.vfx, ...out.filter((v) => !need.includes(v))];
  }

  for (const e of FX.exclusive) {
    if (e.officer !== officer) continue;
    if (out.includes(e.prefer)) out = out.filter((v) => v !== e.over);
  }

  return out;
}

/**
 * 지금 이 순간 보여줄 링 하나. 겹쳐 있으면 `SWAP_MS`마다 다음 것으로 넘어간다.
 *
 * `elapsedMs`는 **판 전체가 공유하는 시계**를 넣는다. 유닛마다 따로 세면 링들이
 * 제각각 갈아 끼워져 화면이 어지럽다 — 자세 연출에서 「유닛마다 시계를 따로 두면
 * 안 된다」로 밟았던 것과 같은 결이다.
 */
export function ringAt(rings: readonly string[], elapsedMs: number): string | null {
  if (rings.length === 0) return null;
  if (rings.length === 1) return rings[0]!;
  const step = Math.floor(Math.max(0, elapsedMs) / SWAP_MS) % rings.length;
  return rings[step]!;
}

/**
 * 화면 갱신 판단용 지문. `statusChips.ts`의 `auraKey`와 같은 이유로 필요하다 —
 * **다른 유닛이 움직이면** 오라 링이 붙었다 떨어졌다 하는데 이 유닛의 상태는
 * 하나도 안 바뀐다.
 */
export const ringKey = (state: BattleState, unit: UnitState): string =>
  ringsOn(state, unit).join(',');

/**
 * 「선공」처럼 **즉시 1회**로 끝나는 WT 보정을 다음 차례까지 붙들어 둔다.
 *
 * `modifyWt`에 `turns`가 없으면 `wtModifiers`에 남지 않아 걸 자리가 없다.
 * 그런데 효과(「다음 차례가 당겨졌다」)는 그 차례가 올 때까지 유효하므로,
 * **제어권을 받으면 지운다**는 규칙으로 화면이 따로 물고 있는다
 * (2026-08-13 기획자 확정).
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

/**
 * 상태이상 22종이 전부 표에 있는가. 테스트가 부르는 자기 점검이다.
 *
 * `STATUS_META`는 `Record<StatusId, …>`라 상태가 새로 생기면 **컴파일이 깨져**
 * 이름·설명은 반드시 채우게 되어 있다. 그런데 그림 표는 JSON이라 그 보호가 없어서,
 * 새 상태가 링 없이 조용히 지나갈 수 있다. 그 구멍을 여기서 막는다.
 */
export function unmappedStatuses(): string[] {
  const known = new Set([...Object.keys(FX.byStatus), ...FX.noVfx]);
  return Object.keys(STATUS_META).filter((s) => !known.has(s)).sort();
}

/** 그림 파일 경로. `tools/build_status_fx.py`가 굽는다. */
export const ringUrl = (vfx: string): string => `vfx/${vfx}.png`;

/** 이 장수의 이름 — 링을 로그·디버그에 찍을 때만 쓴다. */
export const officerName = (unit: UnitState): string =>
  officerById.get(unit.officer)?.name ?? unit.officer;
