/**
 * 대전 서버가 세는 사건 (2026-11-13, 관리자 「시스템 · 트래픽」) — 대기열 입장 · 퇴장, 방이 열림, 자리의 끊김 · 돌아옴 · 못 돌아옴 · 스스로 나감.
 * 1분 칸에 메모리로만 쌓는다(meta `recordEvent`). 방 · 대기열의 껍데기가 부르고, 내보내는 자리는 `health.ts`다.
 *
 * 판정은 하지 않는다 — 세기만 한다. 순수한 방의 규칙(`room-logic.ts` · `queue-logic.ts`)은 이것을 모른다.
 */
import { createTraffic, recordEvent } from '@samchess/meta';
import type { BattleEvent } from '@samchess/meta';
import { now } from './clock.ts';

export const traffic = createTraffic();

export const countEvent = (name: BattleEvent): void => recordEvent(traffic, now(), name);
