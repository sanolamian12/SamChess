/**
 * 편성 부대 목록 — 칸 넷 (2026-11-14 기획자, 부대 개편 — `Design/부대개편_공격대수비대.md`)
 *
 * ```
 * [← 병영으로]      편성 부대 목록
 * ┌ 판 ──────────────────────────────┐
 * │ ┌ 3v3 공격대 ┐ ┌ 3v3 수비대 ┐      │
 * │ │  꼬마 명단  │ │ 🛡 꼬마 명단 │      │
 * │ │    594    │ │    611    │      │
 * │ └───────────┘ └───────────┘      │
 * │ ┌ 5v5 공격대 ┐ ┌ 5v5 수비대 ┐      │
 * │ │ + 편성하기  │ │  …        │      │
 * │ └───────────┘ └───────────┘      │
 * └──────────────────────────────────┘
 * [ 뒤로 가기 ]
 * ```
 *
 * 부대는 계정마다 넷으로 고정이다 — 위 줄 3v3 · 아래 줄 5v5, 왼쪽 공격대 · 오른쪽 수비대(칸 차례는 `SQUAD_SLOTS`).
 * 부대 수 · [정렬] · 쪽 넘김 · [새 편성] · [수비군 지정]이 없어졌다 — **수비대 칸이 곧 수비군**이다.
 *
 * **채운 칸을 누르면 부대 현황**(`onOpen`), **빈 칸을 누르면 곧장 부대원 편집**(`onFill`, 그 칸의 모드 · 역할로).
 * 비우기는 부대 현황에서 한다. 숫자는 규칙이 낸다 — 전투력은 `squadRow()`(= `battlePower()`).
 */

import { SQUAD_SLOTS, firstSquadPending, isGarrison, squadById, squadRow } from '@samchess/meta';
import { guidesEnabled } from './guideScript.ts';
import type { PlayerProfile, SquadRole, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon, ModeIcon } from './GameIcon.tsx';
import { OfficerStand } from './OfficerArt.tsx';
import { BlinkGlow } from './BlinkGlow.tsx';
import type { BlinkTone } from './BlinkGlow.tsx';
import { roleText } from './squadText.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 명단 꼬마의 후광 (2026-11-13 기획자) — S급 자주 · A급 흰 별빛 · E급(황제) 금, B~D급은 없다 */
const STAND_GLOW: Partial<Record<string, BlinkTone>> = { S: 'purple', A: 'plain', E: 'gold' };

export function SquadListScreen({ profile, onBack, onOpen, onFill }: {
  profile: PlayerProfile;
  onBack: () => void;
  /** 채운 칸 — 부대 현황으로 */
  onOpen: (id: string) => void;
  /** 빈 칸 — 그 칸의 부대원 편집으로 */
  onFill: (mode: BattleMode, role: SquadRole) => void;
}): React.JSX.Element {
  useLang();
  // 첫 편성(2026-11-13 · 11-14 공격대 먼저) — 3v3 공격대가 생길 때까지 그 칸이 빛난다
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
        <span className="place-nm">{t('squads.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqd-list">
          <div className="sqg-grid">
            {SQUAD_SLOTS.map((slot) => {
              const squad = squadById(profile, slot.id);
              const row = squad ? squadRow(profile, squad) : null;
              return (
                <Cell
                  key={slot.id} slot={slot.id} mode={slot.mode} role={slot.role} row={row}
                  garrison={!!squad && isGarrison(profile, squad)}
                  cue={cue && slot.id === 'atk-3v3'}
                  onPress={() => (squad ? onOpen(squad.id) : onFill(slot.mode, slot.role))}
                />
              );
            })}
          </div>
        </section>

        {/* 화면 바닥의 단추 판 — [뒤로 가기]는 제목 바의 [병영으로]와 같은 일, 대장간 판 아래 단추와 같은 참나무 목판 */}
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
 * 칸 하나 — 머리(모드 아이콘 · 공격대/수비대 · 수비군 표지), 채웠으면 꼬마 명단 · 전투력, 비었으면 「+ 편성하기」.
 * 성립하지 않는 부대(장수가 계정에서 빠졌다)는 전투력 대신 「—」와 고칠 이유가 선다.
 */
function Cell({ slot, mode, role, row, garrison, cue, onPress }: {
  slot: string; mode: BattleMode; role: SquadRole; row: SquadRow | null; garrison: boolean; cue: boolean; onPress: () => void;
}): React.JSX.Element {
  const names = row ? row.members.map((m) => pickOfficerNameById(m.officer, m.name)) : [];
  return (
    <button
      className="sqg-cell" data-slot={slot} data-mode={mode} data-role={role}
      data-filled={row ? '1' : '0'} data-garrison={garrison ? '1' : '0'}
      data-action={row ? 'open' : 'fill'} data-guide-cue={cue ? '' : undefined}
      onClick={onPress}
    >
      <span className="sqg-head">
        <span className="sqg-mode"><ModeIcon mode={mode} /></span>
        <span className="sqg-role" data-field="role">{roleText(role)}</span>
        {/* 수비군은 글자 표지 대신 아이콘(`gi/me`, 2026-11-13 기획자) — 수비대가 성립할 때만 */}
        {garrison && <img className="sqd-garrison-ic" data-field="garrison" src="ui/gi/me.png" alt={t('squad.garrison')} title={t('squad.garrison')} draggable={false} />}
      </span>
      {row ? (
        <>
          {/* 명단은 꼬마 장수(서 있는 자세) — 자리는 언제나 다섯, 3인팀은 1 · 3 · 5번째(2026-11-13 기획자). 이름은 `title` · `data-names` */}
          <span className="sqd-who sqg-who" data-field="members" data-names={names.join(', ')} aria-label={names.join(', ') || '—'}>
            {Array.from({ length: 5 }, (_, at5) => {
              const at = row.members.length === 3 ? [0, -1, 1, -1, 2][at5]! : at5;
              const m = at >= 0 ? row.members[at] : undefined;
              const glow = m ? STAND_GLOW[m.grade] : undefined;
              return (
                <span key={at5} className="sqd-slot" data-slot={at5} data-grade={m?.grade}>
                  {glow && <BlinkGlow tone={glow} className="sqd-stand-glow" />}
                  {m && <OfficerStand officer={m.officer} title={names[at] ?? m.name} />}
                </span>
              );
            })}
          </span>
          <span className="sqg-pw" data-field="power" data-power={row.power ?? ''}>
            {row.power === null ? '—' : row.power.toLocaleString()}
          </span>
          {row.problem && <span className="note sqg-broken" data-field="broken"><GameIcon name="mk-warn" label={t('squads.broken', { why: row.problem })} text /></span>}
        </>
      ) : (
        <span className="sqg-fill" data-field="empty"><GameIcon name="mk-plus" label={t('squads.fill')} text /></span>
      )}
    </button>
  );
}
