/**
 * 부대 관리 — 칸 넷을 편성판으로 (2026-11-14 기획자 부대 개편 · 2026-11-16 병영 현황판과 정보를 맞바꿈)
 *
 * ```
 * [← 병영으로]          부대 관리
 * ┌ 판 ────────────────────────────────────────┐
 * │ ⚔ 돌격대                                   │
 * │      ♚   ♜   ♛   ♝   ♞   ♟                 │  ← 기물 여섯 칸(King … Pawn)
 * │ [3인] 꼬마 꼬마  ·   ·   ·  꼬마            │  ← 3v3 공격대 — 꼬마가 제 기물 칸에 선다
 * │ [5인] + 편성하기                           │  ← 5v5 공격대(비었다)
 * │ 🪖 수성군                                   │
 * │      ♚   ♜   ♛   ♝   ♞   ♟                 │
 * │ [3인] …                                    │
 * │ [5인] …                                    │
 * └────────────────────────────────────────────┘
 * [ 공격대 편성 ]  [ 수비대 편성 ]     ← 누르면 3 vs 3 / 5 vs 5를 고른다
 * [ 뒤로 가기 ]
 * ```
 *
 * 2026-11-16 기획자 — 병영이 빼곡해 보여 두 화면의 정보를 맞바꿨다. 병영은 모드별 전적과 「편성 완료」 · 「미편성」만,
 * 이 화면은 병영에 있던 기물 칸 편성판(꼬마 명단)을 맡는다. 부대 전적은 병영 현황판의 모드 줄(3vs3 · 5vs5)이 말한다.
 *
 * 채운 줄을 누르면 부대 현황(`onOpen`), 빈 줄은 곧장 부대원 편집(`onFill`). [공격대 편성] · [수비대 편성]은 모드를 고르면 그 칸의
 * 부대원 편집으로 간다(찬 칸이면 고치기).
 */

import { useState } from 'react';
import { PIECE_TYPES, firstSquadPending, squadAt, squadRow, squadSlot } from '@samchess/meta';
import { guidesEnabled } from './guideScript.ts';
import type { PlayerProfile, SquadRole, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { pieceArtUrl } from '../ui/pieceIcon.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon, ModeIcon } from './GameIcon.tsx';
import { OfficerStand } from './OfficerArt.tsx';
import { BlinkGlow } from './BlinkGlow.tsx';
import type { BlinkTone } from './BlinkGlow.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 명단 꼬마의 후광 (2026-11-13 기획자) — S급 자주 · A급 흰 별빛 · E급(황제) 금, B~D급은 없다 */
const STAND_GLOW: Partial<Record<string, BlinkTone>> = { S: 'purple', A: 'plain', E: 'gold' };

const MODES: readonly BattleMode[] = ['3v3', '5v5'];

export function SquadListScreen({ profile, onBack, onOpen, onFill, onForm }: {
  profile: PlayerProfile;
  onBack: () => void;
  /** 채운 줄 — 부대 현황으로 */
  onOpen: (id: string) => void;
  /** 빈 줄 — 그 칸의 부대원 편집으로 */
  onFill: (mode: BattleMode, role: SquadRole) => void;
  /** [공격대 편성] · [수비대 편성]에서 모드를 골랐다 — 찬 칸이면 고치기, 빈 칸이면 새로 */
  onForm: (mode: BattleMode, role: SquadRole) => void;
}): React.JSX.Element {
  useLang();
  // 첫 편성(2026-11-13 · 11-14 공격대 먼저) — 3v3 공격대가 생길 때까지 그 줄이 빛난다
  const cue = guidesEnabled() && firstSquadPending(profile);
  /** [공격대 편성] · [수비대 편성]을 눌러 모드를 고르는 중 */
  const [forming, setForming] = useState<SquadRole | null>(null);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squads"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squads" data-squad-count={profile.squads.length}>
        {/* 그림 화살표(`::before`)를 입혔으므로 문구의 「← 」는 뗀다(`RankingCommon.tsx`의 `stripBackArrow` 머리말) */}
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('squads.back'))}
        </button>
        {/* 제목은 병영의 문 이름 그대로 — 「부대 관리」(2026-11-14 기획자) */}
        <span className="place-nm">{t('barracks.squads')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqd-list">
          <div className="sql-rows">
            {/* 위 단 돌격대(공격대) · 아래 단 수성군(수비대), 단마다 머리 → 기물 여섯 칸 → 3v3 → 5v5 */}
            {(['attack', 'defense'] as const).map((role) => (
              <div key={role} className="sql-group" data-role={role}>
                <span className="sql-head">
                  <img className="sql-role" src={role === 'attack' ? 'icons/battle.png' : 'icons/tutorial/next.png'} alt="" draggable={false} />
                  <span className="bar-ttl" data-field="squadHead">{t(role === 'attack' ? 'barracks.squad.attack' : 'barracks.squad.defense')}</span>
                </span>
                <div className="sql-grid sql-pieces">
                  <span className="sql-mode" />
                  {PIECE_TYPES.map((piece) => (
                    <span key={piece} className="sql-cell">
                      <img className="sql-piece" src={pieceArtUrl(piece, true)} alt={piece} title={piece} draggable={false} />
                    </span>
                  ))}
                </div>
                {MODES.map((mode) => {
                  const squad = squadAt(profile, mode, role);
                  const slot = squadSlot(mode, role);
                  return (
                    <Row
                      key={mode} slot={slot} mode={mode} role={role} row={squad ? squadRow(profile, squad) : null}
                      cue={cue && slot === 'atk-3v3'}
                      onPress={() => (squad ? onOpen(squad.id) : onFill(mode, role))}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* 명령 패널 — [공격대 편성] · [수비대 편성](모드를 고른다), 그 아래 [뒤로 가기] (2026-11-14 기획자) */}
        <section className="place-panel sqd-acts">
          <div className="sql-forms">
            <button className="btn wide primary" data-action="formAttack" onClick={() => setForming('attack')}>
              <span className="lbl">{t('squads.formAttack')}</span>
            </button>
            <button className="btn wide primary" data-action="formDefense" onClick={() => setForming('defense')}>
              <span className="lbl">{t('squads.formDefense')}</span>
            </button>
          </div>
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            <span className="lbl">{stripBackArrow(t('match.back'))}</span>
          </button>
        </section>
      </div>

      {forming && (
        <div className="modal-back" data-modal="formMode" data-role={forming} onClick={() => setForming(null)}>
          <div className="modal sqd-modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t(forming === 'attack' ? 'squads.formAttack' : 'squads.formDefense')}</p>
            <p className="row">{t('sortie.pickMode')}</p>
            <div className="sql-modes">
              {MODES.map((mode) => (
                <button key={mode} className="btn wide" data-mode={mode} onClick={() => { setForming(null); onForm(mode, forming); }}>
                  <span className="lbl"><ModeIcon mode={mode} /> {mode === '3v3' ? '3 vs 3' : '5 vs 5'}</span>
                </button>
              ))}
            </div>
            <button className="btn wide" data-action="formCancel" onClick={() => setForming(null)}>
              <span className="lbl">{t('sortie.cancel')}</span>
            </button>
          </div>
        </div>
      )}
    </ScreenChrome>
  );
}

/**
 * 한 줄 — [모드 아이콘][기물 여섯 칸]. 꼬마는 제 기물 칸에 선다(3v3은 세 칸만 찬다). 빈 줄은 여섯 칸을 함께 쓰는 「+ 편성하기」.
 * 성립하지 않는 부대(장수가 계정에서 빠졌다)는 오른쪽 끝에 경고 표지 — 이유는 `title`.
 */
function Row({ slot, mode, role, row, cue, onPress }: {
  slot: string; mode: BattleMode; role: SquadRole; row: SquadRow | null; cue: boolean; onPress: () => void;
}): React.JSX.Element {
  const names = row ? row.members.map((m) => pickOfficerNameById(m.officer, m.name)) : [];
  return (
    <button
      className="sql-row sql-grid" data-slot={slot} data-mode={mode} data-role={role} data-filled={row ? '1' : '0'}
      data-action={row ? 'open' : 'fill'} data-guide-cue={cue ? '' : undefined} onClick={onPress}
      data-names={names.join(', ')} aria-label={names.join(', ') || undefined}
    >
      <span className="sql-mode"><ModeIcon mode={mode} /></span>
      {row ? PIECE_TYPES.map((piece) => {
        const m = row.members.find((x) => x.piece === piece);
        const glow = m ? STAND_GLOW[m.grade] : undefined;
        return (
          <span key={piece} className="sql-cell" data-piece={piece} data-grade={m?.grade}>
            {/* 후광 — S급 자주 · A급 흰 별빛 · E급(황제) 금, B~D급은 없다 */}
            {glow && <BlinkGlow tone={glow} className="sqd-stand-glow" />}
            {m && <OfficerStand officer={m.officer} title={pickOfficerNameById(m.officer, m.name)} />}
          </span>
        );
      }) : (
        <span className="sql-fill" data-field="empty"><GameIcon name="mk-plus" label={t('squads.fill')} text /></span>
      )}
      {row?.problem && <span className="sql-broken" data-field="broken" title={t('squads.broken', { why: row.problem })}><GameIcon name="mk-warn" label={t('squads.broken', { why: row.problem })} /></span>}
    </button>
  );
}
