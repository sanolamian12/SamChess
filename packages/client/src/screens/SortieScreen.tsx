/**
 * 출전 — 구성 고르기 · 부대 고르기 (pptx 45쪽 · F, 2026-08-18)
 *
 * ```
 * [← 병영으로]  구성을 선택해주세요.        [← 병영으로]  부대를 선택해주세요.
 *    [ 3 vs 3 ]                                부대명   멤버        전투력
 *    [ 5 vs 5 ]                                초전박살 조조,관흥…    843  [대전상대 찾기]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 부대가 없으면 **부대부터 만든다** (2026-08-18 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 즉석 편성으로 출전하는 길은 두지 않는다. 구성 화면이 둘이면(42쪽의 부대 편성과
 * 즉석 편성) 「판정을 두 벌 만들지 않는다」가 깨지고, 이력의 `mySquad`도 절반만
 * 채워진다. E가 `RosterScreen`에 뚫어 둔 임시 통로는 여기로 흡수되며 **그 화면은
 * 지워졌다** — 구성은 이제 `SquadEditScreen` 하나다.
 *
 * 그래서 이 화면의 「직접 편성 루트」는 **[새 편성 만들기]로 보내는 것**이다.
 * 막다른 길에 세우지 않는 것이 요점이라, 그 모드의 부대가 없으면 그 단추만 남는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 군량 안내는 **매칭에 들어가기 전에** 받는다 (§5-16)
 * ────────────────────────────────────────────────────────────────
 *
 * 딱 최소 군량이면 매칭된 상대와 반드시 싸워야 한다 — 들어간 뒤에 「거절이 안 된다」를
 * 알면 늦다. **판정은 화면이 하지 않는다**(`canDeclineMatch`) — `grain > 3`을 여기 적으면
 * 참가비나 패널티가 바뀌었을 때 조용히 어긋난다.
 */

import { useState } from 'react';
import {
  canStartMatch, canDeclineMatch, grainCost, poolUsed, squadRow, squadsOf,
} from '@samchess/meta';
import type { PlayerProfile, Squad, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const MODES: BattleMode[] = ['3v3', '5v5'];

export function SortieScreen({ profile, onBack, onNewSquad, onSeek }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNewSquad: () => void;
  onSeek: (mode: BattleMode, squad: Squad) => void;
}): React.JSX.Element {
  useLang();
  /** 걸음 둘을 한 화면에서 — 모드를 고르기 전에는 부대를 보여줄 수 없다 */
  const [mode, setMode] = useState<BattleMode | null>(null);
  /** 「딱 최소 군량」 안내. 확인을 받은 뒤에야 매칭으로 넘어간다 */
  const [asking, setAsking] = useState<{ mode: BattleMode; squad: Squad; reason: string } | null>(null);

  const seek = (m: BattleMode, squad: Squad): void => {
    // 화면이 판정하지 않는다 — 거절할 수 없는 상태면 먼저 알린다.
    // **안내문도 규칙이 준다** — 옮겨 적으면 45쪽의 「군량 3소모」처럼 낡은 글자가 남는다
    const decline = canDeclineMatch(profile, m);
    if (decline.ok) onSeek(m, squad);
    else setAsking({ mode: m, squad, reason: decline.reason });
  };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-sortie"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="sortie" data-step={mode ? 'squad' : 'mode'}>
        <button
          className="btn ghost sm"
          data-action="back"
          onClick={() => (mode ? setMode(null) : onBack())}
        >
          {t('sortie.back')}
        </button>
        <span className="place-nm">{mode ? t('sortie.pickSquad') : t('sortie.pickMode')}</span>
      </div>

      <div className="place-body">
        {mode === null
          ? <ModeStep profile={profile} onPick={setMode} />
          : <SquadStep profile={profile} mode={mode} onNewSquad={onNewSquad} onSeek={seek} />}
      </div>

      {asking && (
        <MinGrainModal
          reason={asking.reason}
          onClose={() => setAsking(null)}
          onConfirm={() => { const it = asking; setAsking(null); onSeek(it.mode, it.squad); }}
        />
      )}
    </ScreenChrome>
  );
}

/**
 * 첫 걸음 — 「구성을 선택해주세요.」
 *
 * 잠기는 이유가 둘이라(군량 부족 · 장수 부족) **어느 쪽인지 글자로 말해 준다** —
 * 병영에 있던 그 판정이 그대로 옮겨 왔다. 잠긴 단추만 두면 「왜 안 눌리나」가 남는다.
 */
function ModeStep({ profile, onPick }: {
  profile: PlayerProfile;
  onPick: (mode: BattleMode) => void;
}): React.JSX.Element {
  return (
    <section className="place-panel srt-modes">
      {MODES.map((mode) => {
        const cost = grainCost(mode);
        const grain = canStartMatch(profile, mode);
        const short = poolUsed(profile) < cost;
        return (
          <button
            key={mode}
            className="btn wide"
            data-mode={mode}
            disabled={!grain.ok || short}
            onClick={() => onPick(mode)}
          >
            <span className="lbl">{mode === '3v3' ? '3 vs 3' : '5 vs 5'}</span>
            <span className="sub">
              {short ? t('barracks.needOfficers', { n: cost })
                : grain.ok ? t('barracks.needGrain', { n: cost })
                  : (grain as { reason: string }).reason}
            </span>
          </button>
        );
      })}
      {/* 보상도 전적도 온라인과 같다 — 2026-08-18에 뒤집혔다 (GDD §6.4 · §5-30) */}
      <p className="hint" data-field="aiNote">{t('barracks.aiNote')}</p>
    </section>
  );
}

/**
 * 둘째 걸음 — 「부대를 선택해주세요.」 45쪽의 `부대명 | 멤버 | 전투력` 그대로다.
 *
 * **그 모드의 부대만** 보여준다. 3v3 자리에 5v5 부대를 얹을 수 없고, 값 범위가
 * 겹치는 두 모드의 전투력을 나란히 놓지 않는다는 규약과도 맞는다(GDD §7.1).
 */
function SquadStep({ profile, mode, onNewSquad, onSeek }: {
  profile: PlayerProfile;
  mode: BattleMode;
  onNewSquad: () => void;
  onSeek: (mode: BattleMode, squad: Squad) => void;
}): React.JSX.Element {
  const rows = squadsOf(profile, mode).map((s) => squadRow(profile, s));
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = rows.find((r) => r.squad.id === picked && r.power !== null) ?? null;

  return (
    <>
      <section className="place-panel srt-list" data-mode={mode}>
        <div className="srt-thead">
          <span>{t('squads.col.name')}</span>
          <span>{t('squads.col.members')}</span>
          <span>{t('squads.col.power')}</span>
        </div>
        {rows.length === 0 ? (
          <p className="hint" data-field="noSquad">{t('sortie.noSquad', { mode })}</p>
        ) : rows.map((row) => (
          <SquadLine
            key={row.squad.id}
            row={row}
            on={picked === row.squad.id}
            onPick={() => setPicked(row.squad.id)}
          />
        ))}
      </section>

      <section className="place-panel srt-acts">
        <button
          className="btn primary wide"
          data-action="seek"
          disabled={!chosen}
          onClick={() => chosen && onSeek(mode, chosen.squad)}
        >
          {t('sortie.seek')}
        </button>
        {/* 「직접 편성 루트」 — 부대가 없으면 여기서 만들고 온다 (막다른 길을 두지 않는다) */}
        <button className="btn wide" data-action="newSquad" onClick={onNewSquad}>
          {t('sortie.newSquad')}
        </button>
      </section>
    </>
  );
}

/** 45쪽 목록의 한 줄. **성립하지 않는 부대는 고를 수 없고 이유를 적는다** */
function SquadLine({ row, on, onPick }: {
  row: SquadRow; on: boolean; onPick: () => void;
}): React.JSX.Element {
  return (
    <div className="srt-row" data-squad={row.squad.id} data-on={on ? '1' : '0'}>
      <button className="srt-open" data-action="pickSquad" disabled={row.power === null} onClick={onPick}>
        <span className="srt-nm" data-field="name">{row.squad.name}</span>
        <span className="srt-who" data-field="members">
          {row.members.map((m) => m.name).join(', ') || '—'}
        </span>
        {/* 전투력은 규칙이 낸다 — `squadPower()`(= `battlePower()`) */}
        <span className="srt-pw" data-field="power" data-power={row.power ?? ''}>
          {row.power === null ? '—' : row.power.toLocaleString()}
        </span>
      </button>
      {row.problem && <p className="note" data-field="broken">{t('squads.broken', { why: row.problem })}</p>}
    </div>
  );
}

/**
 * 「대전을 위한 최소군량만 있을 때는 상대 매칭 시 거절을 할 수 없습니다.」
 *
 * **문구는 규칙이 준다** (`canDeclineMatch`의 이유). 화면이 옮겨 적으면 45쪽 목업의
 * 「군량 3소모」처럼 낡은 글자가 남는다.
 */
function MinGrainModal({ reason, onClose, onConfirm }: {
  reason: string; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="minGrain" onClick={onClose}>
      <div className="modal srt-modal" onClick={(e) => e.stopPropagation()}>
        <p className="row" data-field="warn">{reason}</p>
        <div className="srt-modal-acts">
          <button className="btn primary wide" data-action="minGrainOk" onClick={onConfirm}>
            {t('sortie.confirm')}
          </button>
          <button className="btn wide" data-action="minGrainCancel" onClick={onClose}>
            {t('sortie.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
