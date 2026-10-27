/**
 * 여러 회귀가 함께 쓰는 계정 준비물.
 */

import type { BattleMode, OfficerId, PieceType } from '@samchess/rules';
import { officerById } from '@samchess/data';
import { addSquad, squadsOf } from '../src/index.ts';
import type { PlayerProfile, RosterPick } from '../src/index.ts';

const PIECES: readonly PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Queen'];

/**
 * **3v3 · 5v5 부대를 하나씩** 붙인다 — 그러면 두 모드 모두 수비군이 서서 [출정하기]가 열린다(`sortieGate`, 2026-10-27).
 * 보유 장수의 앞에서부터 쓰고, 헌제(E)는 King에 세우지 않는다. 이미 그 모드의 부대가 있으면 건너뛴다.
 */
export function withGarrisons(profile: PlayerProfile): PlayerProfile {
  let p = profile;
  for (const mode of ['3v3', '5v5'] as BattleMode[]) {
    if (squadsOf(p, mode).length > 0) continue;
    const size = mode === '3v3' ? 3 : 5;
    const ids = Object.keys(p.roster) as OfficerId[];
    const king = ids.find((id) => officerById.get(id)?.grade !== 'E');
    if (!king) throw new Error('King에 세울 장수가 없다');
    const rest = ids.filter((id) => id !== king);
    if (rest.length < size - 1) throw new Error(`${mode} 부대를 짤 장수가 모자란다`);
    const picks: RosterPick[] = [king, ...rest.slice(0, size - 1)].map((officer, i) => ({ piece: PIECES[i]!, officer }));
    p = addSquad(p, { name: `수비${size}`, mode, picks }).profile;
  }
  return p;
}
