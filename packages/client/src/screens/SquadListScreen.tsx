/**
 * 부대 관리 — 칸 넷을 한 줄씩 (2026-11-14 기획자, 부대 개편 — `Design/부대개편_공격대수비대.md`)
 *
 * ```
 * [← 병영으로]          부대 관리
 * ┌ 판 ────────────────────────────────────────┐
 * │ [3인] 꼬마 셋        │  🏆3 ⚪2 ⚫4 🗡12      │  ← 3v3 공격대(돌격대) — 전적 넷
 * │ [3인] 꼬마 셋        │              🪖 5     │  ← 3v3 수비대(수성군) — 막은 판 하나
 * │ [5인] 꼬마 V자       │  🏆0 ⚪0 ⚫0 🗡0       │  ← 5v5 공격대
 * │ [5인] + 편성하기     │              🪖 0     │  ← 5v5 수비대(비었다)
 * └────────────────────────────────────────────┘
 * [ 공격대 편성 ]  [ 수비대 편성 ]     ← 누르면 3 vs 3 / 5 vs 5를 고른다
 * [ 뒤로 가기 ]
 * ```
 *
 * 줄은 3 : 7 — 왼쪽은 모드 아이콘과 꼬마(병영 현황판에서 셋이 나란히 서는 폭만큼), 오른쪽은 전적이다. 다섯은 **V자**로 선다 —
 * 가운데(King)가 맨 앞, 그다음 둘이 그 뒤, 바깥 둘이 맨 뒤. 공격대 · 수비대는 글자가 아니라 **전적 아이콘의 수**가 말한다
 * (넷이면 돌격대 — 공격대 전적 승 · 무 · 패 · 적격파, 하나면 수성군 — 그 모드에서 막은 판, 방어 기록은 서버에만 있다).
 *
 * 채운 줄을 누르면 부대 현황(`onOpen`), 빈 줄은 곧장 부대원 편집(`onFill`). [공격대 편성] · [수비대 편성]은 모드를 고르면 그 칸의
 * 부대원 편집으로 간다(찬 칸이면 고치기). 숫자는 규칙이 낸다 — 전적은 `sumTally()`(부대 전적), 막은 판은 `GET /defense`.
 */

import { useEffect, useState } from 'react';
import { SQUAD_SLOTS, firstSquadPending, squadById, squadRow, sumTally } from '@samchess/meta';
import { guidesEnabled } from './guideScript.ts';
import type { PlayerProfile, SquadRole, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { fetchDefense } from '../meta/defense.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon, ModeIcon } from './GameIcon.tsx';
import type { GameIconName } from '../ui/gameIcon.ts';
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
  // 수성군 줄의 막은 판 — 모드마다(`heldByMode`). 못 닿으면 「—」
  const [held, setHeld] = useState<Record<BattleMode, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchDefense().then((d) => { if (alive && d) setHeld(d.summary.heldByMode); });
    return () => { alive = false; };
  }, []);
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
            {SQUAD_SLOTS.map((slot) => {
              const squad = squadById(profile, slot.id);
              const row = squad ? squadRow(profile, squad) : null;
              return (
                <Row
                  key={slot.id} slot={slot.id} mode={slot.mode} role={slot.role} row={row}
                  held={held?.[slot.mode] ?? null}
                  cue={cue && slot.id === 'atk-3v3'}
                  onPress={() => (squad ? onOpen(squad.id) : onFill(slot.mode, slot.role))}
                />
              );
            })}
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
 * 한 줄 — 3 : 7. 왼쪽 모드 아이콘 + 꼬마(셋은 나란히, 다섯은 V자), 오른쪽 전적(공격대 넷 · 수비대 하나).
 * 빈 줄은 「+ 편성하기」. 성립하지 않는 부대(장수가 계정에서 빠졌다)는 오른쪽 끝에 경고 표지 — 이유는 `title`.
 */
function Row({ slot, mode, role, row, held, cue, onPress }: {
  slot: string; mode: BattleMode; role: SquadRole; row: SquadRow | null; held: number | null; cue: boolean; onPress: () => void;
}): React.JSX.Element {
  const names = row ? row.members.map((m) => pickOfficerNameById(m.officer, m.name)) : [];
  const sum = row ? sumTally(row.squad.record) : null;
  return (
    <button
      className="sql-row" data-slot={slot} data-mode={mode} data-role={role} data-filled={row ? '1' : '0'}
      data-action={row ? 'open' : 'fill'} data-guide-cue={cue ? '' : undefined} onClick={onPress}
    >
      <span className="sql-left">
        <span className="sql-mode"><ModeIcon mode={mode} /></span>
        {row ? (
          <span className="sql-who" data-field="members" data-count={row.members.length} data-names={names.join(', ')} aria-label={names.join(', ')}>
            {row.members.map((m, i) => {
              const glow = STAND_GLOW[m.grade];
              return (
                <span key={m.officer} className="sql-stand" data-pos={standPos(row.members.length, i)} data-grade={m.grade}>
                  {glow && <BlinkGlow tone={glow} className="sqd-stand-glow" />}
                  <OfficerStand officer={m.officer} title={names[i] ?? m.name} />
                </span>
              );
            })}
          </span>
        ) : (
          <span className="sql-fill" data-field="empty"><GameIcon name="mk-plus" label={t('squads.fill')} text /></span>
        )}
      </span>
      <span className="sql-right" data-field="record">
        {role === 'attack' ? (
          <>
            <Rec icon="rec-win" label={t('records.result.win')} n={sum?.wins ?? 0} k="w" />
            <Rec icon="rec-draw" label={t('records.result.draw')} n={sum?.draws ?? 0} k="d" />
            <Rec icon="rec-lose" label={t('records.result.lose')} n={sum?.losses ?? 0} k="l" />
            <Rec icon="rec-kills" label={t('ranking.col.kills')} n={sum?.kills ?? 0} k="k" />
          </>
        ) : (
          <span className="bar-rec" data-k="held" data-held={held ?? ''}>
            <GameIcon name="tut-next" label={t('barracks.held')} />
            <b className="v">{held ?? '—'}</b>
          </span>
        )}
        {row?.problem && <span className="sql-broken" data-field="broken" title={t('squads.broken', { why: row.problem })}><GameIcon name="mk-warn" label={t('squads.broken', { why: row.problem })} /></span>}
      </span>
    </button>
  );
}

/** 전적 한 칸 — 아이콘 + 숫자(병영 현황판과 같은 `.bar-rec`) */
function Rec({ icon, label, n, k }: { icon: GameIconName; label: string; n: number; k: string }): React.JSX.Element {
  return (
    <span className="bar-rec" data-k={k}>
      <GameIcon name={icon} label={label} />
      <b className="v">{n}</b>
    </span>
  );
}

/**
 * 꼬마의 자리 — 셋은 나란히(왼쪽 · 가운데 · 오른쪽, 가운데가 King), 다섯은 V자(가운데 King이 맨 앞 → 다음 둘이 그 뒤 → 바깥 둘이 맨 뒤).
 * 명단 차례는 부대의 줄 차례(King이 첫 줄이다). CSS가 `data-pos`로 자리 · 깊이를 잡는다.
 */
function standPos(count: number, i: number): string {
  if (count === 3) return ['c', 'l', 'r'][i] ?? 'c';
  return ['c', 'ml', 'mr', 'bl', 'br'][i] ?? 'c';
}
