/**
 * 부대 칸의 이름표 (2026-11-14 부대 개편) — 부대 이름이 없어졌으므로 화면은 칸(모드 · 역할)을 글자로 쓴다.
 *
 * - 내 부대 — 「3vs3 공격대」(`squadText`). 이력의 `mySquad`도 칸 id라 같은 함수를 지난다.
 * - 남의 부대 — 도시 이름이 곧 부대명이다(`squadName`에 이미 도시 이름이 실려 온다). 그대로 찍는다.
 * - 개편 전 이력 줄 — 그때의 부대 이름 글자. 칸 id가 아니면 받은 글자 그대로다.
 */

import { slotOf } from '@samchess/meta';
import type { SquadRole } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import { modeText } from './SquadViewScreen.tsx';

/** 「공격대」 · 「수비대」 */
export const roleText = (role: SquadRole): string =>
  t(role === 'attack' ? 'squad.role.attack' : 'squad.role.defense');

/** 「3vs3 공격대」 — 칸 id가 아니면 받은 글자 그대로(남의 도시 이름 · 개편 전 부대 이름), 없으면 `null` */
export function squadText(idOrName: string | null | undefined): string | null {
  if (!idOrName) return null;
  const slot = slotOf(idOrName);
  return slot ? `${modeText(slot.mode)} ${roleText(slot.role)}` : idOrName;
}
