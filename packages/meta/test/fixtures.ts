/**
 * 여러 회귀가 함께 쓰는 계정 준비물.
 */

import type { BattleMode, OfficerId, PieceType } from '@samchess/rules';
import { officerById } from '@samchess/data';
import { SQUAD_ROLES, addSquad, squadAt } from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';

const PIECES: readonly PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'];

/**
 * **칸 넷을 채운다**(3v3 · 5v5 × 공격대 · 수비대, 2026-11-14 부대 개편) — 두 모드 모두 수비군이 서서 [출정하기]가 열리고
 * (`sortieGate`, 2026-10-27) 공격대로 출정할 수 있다. 공격대 · 수비대는 같은 명단이다(같은 장수가 함께 설 수 있다).
 * 보유 장수의 앞에서부터 쓰고, 헌제(E)는 King에 세우지 않는다. 이미 찬 칸은 건너뛴다.
 */
export function withGarrisons(profile: PlayerProfile): PlayerProfile {
  let p = profile;
  for (const mode of ['3v3', '5v5'] as BattleMode[]) {
    const size = mode === '3v3' ? 3 : 5;
    const ids = Object.keys(p.roster) as OfficerId[];
    const king = ids.find((id) => officerById.get(id)?.grade !== 'E');
    if (!king) throw new Error('King에 세울 장수가 없다');
    const rest = ids.filter((id) => id !== king);
    if (rest.length < size - 1) throw new Error(`${mode} 부대를 짤 장수가 모자란다`);
    const picks: RosterPick[] = [king, ...rest.slice(0, size - 1)].map((officer, i) => ({ piece: PIECES[i]!, officer }));
    for (const role of SQUAD_ROLES) {
      if (!squadAt(p, mode, role)) p = addSquad(p, { mode, role, picks }).profile;
    }
  }
  return p;
}
