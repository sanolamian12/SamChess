/**
 * 부대 관리 — 칸 넷을 편성판으로 (2026-11-14 기획자 부대 개편 · 2026-11-16 병영 현황판과 정보를 맞바꿈 · 2026-11-17 줄 넷만)
 *
 * ```
 * [← 병영으로]          부대 관리
 * ┌ 판 ────────────────────────────────────────┐
 * │ ⚔ 돌격대                                   │
 * │ [3인] ♚꼬마 ♜꼬마 ♟꼬마              [✔]     │  ← 3v3 공격대 — King · Rock · Bishop · Knight · Queen · Pawn 차례로 붙여 선다,
 * │                                            │     오른쪽 벽에 완성 표지(파란 도장) · 덜 찼으면 경고 표지
 * │ [5인] ━━ 미편성 ━━                          │  ← 빈 칸은 주홍 붓 획(병영 현황판 · 농지와 같은 `.frm-stroke`)
 * │ 🪖 수성군                                   │
 * │ [3인] …                                    │
 * │ [5인] …                                    │
 * └────────────────────────────────────────────┘
 * [ 뒤로 가기 ]
 * ```
 *
 * 2026-11-17 기획자 — 기물 머리 줄을 걷고 꼬마 왼쪽 앞에 제 기물 아이콘(꼬마의 반 크기)을 세운다. 꼬마는 기물 칸이 아니라
 * 기물 차례(`PIECE_TYPES`)대로 왼쪽부터 붙는다. 명령 패널의 [공격대 편성] · [수비대 편성](모드 고르기 팝업)은 걷었다 —
 * 줄을 누르는 것이 곧 그 칸으로 가는 길이다: 채운 줄은 부대 편집(`onOpen`), 빈 줄은 새 부대원 편집(`onFill`).
 * 판 맨 위에 「클릭해서 세부정보를 봅니다.」, 단 머리는 「돌격대」 · 「수성군」(+ 표지 열 제목 「준비」). 수성군의 기물은 북군 색.
 *
 * 2026-11-17 기획자(둘째) — 덜 찬 부대도 저장된다. 꼬마 다섯 자리를 조금 촘촘하게 하고 한 자리만큼 비운 오른쪽 벽에
 * 완성(`mk-done-blue`) · 덜 참(`mk-warn`) 표지. 줄 하나(`SquadLine`)와 단 머리(`SquadHead`)는 부대 편집의 맨 위 판이 그대로 빌린다.
 */

import { PIECE_TYPES, firstSquadPending, squadAt, squadRow, squadSlot, validateSquad } from '@samchess/meta';
import { guidesEnabled } from './guideScript.ts';
import type { PlayerProfile, Squad, SquadRole, SquadState } from '@samchess/meta';
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

export function SquadListScreen({ profile, onBack, onOpen, onFill }: {
  profile: PlayerProfile;
  onBack: () => void;
  /** 채운 줄 — 그 부대의 편집으로 (2026-11-17) */
  onOpen: (id: string) => void;
  /** 빈 줄 — 그 칸의 부대원 편집으로 */
  onFill: (mode: BattleMode, role: SquadRole) => void;
}): React.JSX.Element {
  useLang();
  // 첫 편성(2026-11-13 · 11-14 공격대 먼저) — 3v3 공격대가 완성될 때까지 그 줄이 빛난다
  const cue = guidesEnabled() && firstSquadPending(profile);

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
          {/* 안내 — 판 맨 윗줄, 단 머리와 같은 글꼴 · 왼쪽 정렬 (2026-11-17 기획자) */}
          <p className="bar-ttl sql-hint" data-field="hint">{t('squads.hint')}</p>
          <div className="sql-rows">
            {/* 위 단 돌격대(공격대) · 아래 단 수성군(수비대), 단마다 머리 → 3v3 → 5v5 */}
            {(['attack', 'defense'] as const).map((role) => (
              <div key={role} className="sql-group" data-role={role}>
                <SquadHead role={role} />
                {MODES.map((mode) => {
                  const squad = squadAt(profile, mode, role);
                  const slot = squadSlot(mode, role);
                  return (
                    <SquadLine
                      key={mode} profile={profile} mode={mode} role={role} squad={squad ?? null}
                      cue={cue && slot === 'atk-3v3'}
                      onPress={() => (squad ? onOpen(squad.id) : onFill(mode, role))}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* 명령 패널 — [뒤로 가기] 하나 (2026-11-17 기획자 — [공격대 편성] · [수비대 편성]은 줄 누르기로 갈음) */}
        <section className="place-panel sqd-acts">
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            <span className="lbl">{stripBackArrow(t('match.back'))}</span>
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}

/**
 * 단 머리 — 쌍칼 「돌격대」 · 투구 「수성군」, 오른쪽 표지 열 위에 열 제목 「준비」. 부대 편집의 맨 위 판도 이것을 쓴다.
 * (2026-11-17 기획자 — 「돌격대 구성」은 몽골어가 너무 길어 되돌렸다.) 머리도 줄과 같은 격자라 「준비」가 표지 바로 위에 선다
 */
export function SquadHead({ role }: { role: SquadRole }): React.JSX.Element {
  return (
    <span className="sql-head">
      <span className="sql-head-ttl">
        <img className="sql-role" src={role === 'attack' ? 'icons/battle.png' : 'icons/tutorial/next.png'} alt="" draggable={false} />
        <span className="bar-ttl" data-field="squadHead">{t(role === 'attack' ? 'barracks.squad.attack' : 'barracks.squad.defense')}</span>
      </span>
      <span className="bar-ttl sql-ready" data-field="readyHead">{t('squads.col.ready')}</span>
    </span>
  );
}

/** 칸의 상태 — 부대원이 없으면 빈 칸, 성립하면 완성, 아니면 덜 참 (`squadStateAt`과 같은 셈 — 부대 편집은 저장 전의 부대를 넘긴다) */
export function squadStateOf(profile: PlayerProfile, squad: Squad | null): SquadState {
  if (!squad || squad.picks.length === 0) return 'empty';
  return validateSquad(profile, squad).ok ? 'done' : 'partial';
}

/**
 * 한 줄 — [모드 아이콘][꼬마 다섯 자리][표지]. 꼬마는 기물 차례(`PIECE_TYPES` — King · Rock · Bishop · Knight · Queen · Pawn)대로
 * 왼쪽부터 붙고, 왼쪽 앞에 제 기물 아이콘(꼬마의 반 크기)이 선다. 오른쪽 벽은 완성 표지(파란 도장) · 덜 찬 경고 표지.
 * 빈 줄은 주홍 붓 획 「미편성」(병영 현황판과 같은 문구 · 같은 획).
 * `onPress`가 없으면 눌리지 않는 판(부대 편집의 맨 위 판)이다.
 */
export function SquadLine({ profile, mode, role, squad, cue = false, onPress }: {
  profile: PlayerProfile; mode: BattleMode; role: SquadRole; squad: Squad | null; cue?: boolean; onPress?: () => void;
}): React.JSX.Element {
  const state = squadStateOf(profile, squad);
  const row = squad && state !== 'empty' ? squadRow(profile, squad) : null;
  const members = row ? PIECE_TYPES.flatMap((piece) => row.members.filter((m) => m.piece === piece)) : [];
  const names = members.map((m) => pickOfficerNameById(m.officer, m.name));
  const markLabel = state === 'done' ? t('barracks.squad.formed') : t('barracks.squad.partial');
  const inner = (
    <>
      <span className="sql-mode"><ModeIcon mode={mode} foe={role === 'defense'} /></span>
      {row ? (
        <span className="sql-team">
          {members.map((m) => {
            const glow = STAND_GLOW[m.grade];
            return (
              <span key={m.piece} className="sql-cell" data-piece={m.piece} data-grade={m.grade}>
                {/* 후광 — S급 자주 · A급 흰 별빛 · E급(황제) 금, B~D급은 없다 */}
                {glow && <BlinkGlow tone={glow} className="sqd-stand-glow" />}
                <OfficerStand officer={m.officer} title={pickOfficerNameById(m.officer, m.name)} />
                {/* 기물 — 꼬마 왼쪽 앞, 꼬마의 반 크기. 돌격대는 남군(내 편) 색, 수성군은 북군 색 (2026-11-17 기획자) */}
                <img className="sql-piece" src={pieceArtUrl(m.piece, role === 'attack')} alt={m.piece} title={m.piece} draggable={false} />
              </span>
            );
          })}
        </span>
      ) : (
        <span className="sql-fill" data-field="empty">
          <span className="frm-stroke frm-stroke-locked sql-unformed">{t('barracks.squad.unformed')}</span>
        </span>
      )}
      {row && (
        <span className="sql-mark" data-field="mark" data-state={state} title={state === 'partial' && row.problem ? `${markLabel} — ${row.problem}` : markLabel}>
          <GameIcon name={state === 'done' ? 'mk-done-blue' : 'mk-warn'} label={markLabel} />
        </span>
      )}
    </>
  );
  const common = {
    className: 'sql-row', 'data-slot': squadSlot(mode, role), 'data-mode': mode, 'data-role': role,
    'data-filled': state === 'empty' ? '0' : '1', 'data-state': state, 'data-names': names.join(', '),
  };
  if (!onPress) return <div {...common} data-static="1">{inner}</div>;
  return (
    <button
      {...common} data-action={state === 'empty' ? 'fill' : 'open'} data-guide-cue={cue ? '' : undefined} onClick={onPress}
      aria-label={names.join(', ') || t('barracks.squad.unformed')}
    >
      {inner}
    </button>
  );
}
