/**
 * 기물 편성 — GDD §3.9 「기물 편성」
 *
 * ```
 * King 필수 + 나머지 기물을 1개씩만 선택 → 각 기물에 장수 카드 매치
 * ```
 *
 * 두 단계를 한 화면에서 한다. 위에서 **기물**을 고르고, 아래에서 그 자리에 **장수**를 넣는다.
 * King은 빼지 못하게 잠가 둔다 — 없으면 어차피 엔진이 거부한다.
 *
 * **되는지 안 되는지는 `@samchess/meta`에 묻는다.** 화면이 스스로 판단하지 않는 것은
 * 전투 UI가 `validate()`에 묻는 것과 같은 이유다 — 서버가 붙어도 판정이 갈리지 않는다.
 */

import { useMemo, useState } from 'react';
import { officerById } from '@samchess/data';
import type { BattleMode, OfficerId, PieceType } from '@samchess/rules';
import {
  GRADE_SCORE, PIECE_TYPES, grainCost, spendGrain, statsOf, teamSize, validateRoster,
} from '@samchess/meta';
import type { PlayerProfile, RosterPick } from '@samchess/meta';
import { backdropStyle, placeBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';

export function RosterScreen({ profile, mode, onBack, onStart }: {
  profile: PlayerProfile;
  mode: BattleMode;
  onBack: () => void;
  onStart: (picks: RosterPick[], seed: number, spent: PlayerProfile) => void;
}): React.JSX.Element {
  const size = teamSize(mode);
  const [slots, setSlots] = useState<Record<string, OfficerId | null>>(() => ({ King: null }));
  const [active, setActive] = useState<PieceType>('King');

  const chosenPieces = Object.keys(slots) as PieceType[];
  const picks: RosterPick[] = chosenPieces
    .filter((p) => slots[p])
    .map((p) => ({ piece: p, officer: slots[p]! }));

  // 군량은 「출전」을 누를 때 낸다. 편성 도중에 모자란다고 계속 알리면 방해만 된다.
  const check = validateRoster(profile, mode, picks, false);
  const affordable = profile.grain >= grainCost(mode);
  const ready = check.ok && affordable;

  const owned = useMemo(
    () => Object.values(profile.roster)
      .map((inst) => ({ inst, data: officerById.get(inst.officer)! }))
      .filter((x) => x.data)
      .sort((a, b) => GRADE_SCORE[b.data.grade] - GRADE_SCORE[a.data.grade]
        || b.inst.level - a.inst.level
        || a.data.name.localeCompare(b.data.name)),
    [profile.roster],
  );

  const usedOfficers = new Set(picks.map((p) => p.officer));

  const togglePiece = (piece: PieceType): void => {
    if (piece === 'King') return;                       // King은 필수라 잠근다
    setSlots((prev) => {
      const next = { ...prev };
      if (piece in next) delete next[piece];
      else if (Object.keys(next).length < size) next[piece] = null;
      return next;
    });
    setActive(piece);
  };

  const assign = (officer: OfficerId): void => {
    setSlots((prev) => {
      const next = { ...prev };
      // 이미 다른 자리에 있으면 옮긴다 — 같은 장수를 두 번 넣을 수 없다
      for (const key of Object.keys(next)) if (next[key] === officer) next[key] = null;
      next[active] = next[active] === officer ? null : officer;
      return next;
    });
    // 다음 빈 자리로 옮겨 준다. 한 명씩 넣을 때마다 자리를 다시 누르지 않아도 된다.
    const empty = chosenPieces.find((p) => p !== active && !slots[p]);
    if (empty) setActive(empty);
  };

  const start = (): void => {
    // 시드는 편성에서 만든다 — 같은 편성으로 다시 시작하면 같은 상대·같은 판이 나온다
    let seed = picks.length;
    for (const p of picks) for (const ch of p.officer + p.piece) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    onStart(picks, seed || 1, spendGrain(profile, mode));
  };

  /*
   * 편성은 **병영 안에서** 하는 일이다 (pptx 35쪽, 2026-08-15 기획자 지정).
   * 다만 여기는 카드가 빽빽해서 배경을 그대로 깔면 글자가 묻는다 —
   * `.scr-dim` 이 그림을 **눌러** 깔고, 판때기들은 예전 색 그대로 그 위에 선다.
   */
  return (
    <div
      className="scr scr-roster scr-dim"
      style={backdropStyle(placeBackdrop('barracks', profile.cityLevel))}
    >
      <header className="bar">
        <button className="btn ghost sm" onClick={onBack}>← 뒤로</button>
        <span className="ttl">{mode} 편성</span>
        <span className="tail">군량 {grainCost(mode)} / 보유 {profile.grain}</span>
      </header>

      <section className="block">
        <h2 className="cap">기물 — {chosenPieces.length}/{size}</h2>
        <div className="pieces">
          {PIECE_TYPES.map((piece) => {
            const on = piece in slots;
            return (
              <button
                key={piece}
                className={`piece${on ? ' on' : ''}${active === piece ? ' active' : ''}`}
                data-piece={piece}
                disabled={!on && chosenPieces.length >= size}
                onClick={() => (on ? setActive(piece) : togglePiece(piece))}
                onDoubleClick={() => togglePiece(piece)}
              >
                <span className="nm">{piece}</span>
                {piece === 'King' && <span className="req">필수</span>}
              </button>
            );
          })}
        </div>
        <p className="hint">고른 기물을 한 번 더 누르면(더블클릭) 뺀다. King은 뺄 수 없다.</p>
      </section>

      <section className="block">
        <h2 className="cap">자리</h2>
        <div className="slots">
          {chosenPieces.map((piece) => {
            const officer = slots[piece];
            const data = officer ? officerById.get(officer) : undefined;
            const inst = officer ? profile.roster[officer] : undefined;
            return (
              <button
                key={piece}
                className={`slot${active === piece ? ' active' : ''}${officer ? ' filled' : ''}`}
                data-piece={piece}
                onClick={() => setActive(piece)}
              >
                <span className="pc">{piece}</span>
                {data && inst ? (
                  <>
                    <OfficerArt officer={data.id} className="thumb" />
                    <span className="who">{data.name}</span>
                    <span className="lv">{data.grade}{inst.level}</span>
                  </>
                ) : (
                  <span className="empty">비어 있음</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="block grow">
        <h2 className="cap">보유 장수 {owned.length}명 — 「{active}」 자리에 넣는다</h2>
        <div className="pool">
          {owned.map(({ inst, data }) => {
            const used = usedOfficers.has(inst.officer);
            const here = slots[active] === inst.officer;
            const s = statsOf(inst);
            return (
              <button
                key={inst.officer}
                className={`card${used ? ' used' : ''}${here ? ' here' : ''}`}
                data-officer={inst.officer}
                onClick={() => assign(inst.officer)}
              >
                <OfficerArt officer={data.id} className="thumb" />
                <span className="nm">{data.name}</span>
                <span className="gr" data-grade={data.grade}>{data.grade}{inst.level}</span>
                <span className="ab">HP {s.hp} · AT {s.at} · 통솔 {data.leadership}</span>
                {used && <span className="tag">{here ? '이 자리' : '편성됨'}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <footer className="foot">
        <p className="note">{check.ok ? (affordable ? '출전 준비 완료' : `군량이 모자란다 — ${profile.grain}/${grainCost(mode)}`) : check.reason}</p>
        <button className="btn primary wide" disabled={!ready} onClick={start} data-action="start">출전</button>
      </footer>
    </div>
  );
}
