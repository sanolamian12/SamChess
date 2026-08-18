/**
 * 편성 부대 목록 (pptx 42쪽)
 *
 * ```
 * [← 병영으로]      편성 부대 목록          부대 2 / 10
 *  [새 편성 만들기]
 *  ── 3 vs 3 ──────────────────────────────
 *  참여인원   편성 명    전투력   구성
 *   3 vs 3    초전박살     843    조조, 관흥, 능통
 *  ── 5 vs 5 ──────────────────────────────
 *   5 vs 5    후반공격    1102    조조, 능통, …
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 3v3과 5v5를 **묶음으로 가른다** ★
 * ────────────────────────────────────────────────────────────────
 *
 * 42쪽 목업은 두 모드를 한 줄씩 섞어 놓았는데, 실측 계수가 모드마다 달라
 * **값 범위가 겹친다**(3v3 209~1304 · 5v5 253~1302 — GDD §7.1). 섞어 놓으면
 * 「이쪽이 더 세네」로 읽히고 그건 뜻이 없는 비교다. 그래서 묶음으로 나누고
 * **전투력으로 목록 전체를 정렬하는 길은 두지 않는다.**
 *
 * **숫자는 규칙이 낸다** — 전투력은 `squadPower()`(= `battlePower()`), 상한은
 * `squadCap()`. 화면이 공식을 다시 적으면 계수가 바뀌었을 때 **표시만** 어긋난다.
 */

import { useState } from 'react';
import { canAddSquad, squadCap, squadRow, squadsOf } from '@samchess/meta';
import type { PlayerProfile, Squad, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const MODES: BattleMode[] = ['3v3', '5v5'];

export function SquadListScreen({ profile, onBack, onNew, onOpen, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  const [asking, setAsking] = useState<Squad | null>(null);

  const room = canAddSquad(profile);
  const cap = squadCap(profile);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squads"
      account={null}
    >
      <div className="place-bar" data-screen="squads" data-squad-count={profile.squads.length}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('squads.back')}</button>
        <span className="place-nm">{t('squads.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqd-top">
          <p className="sqd-count" data-field="cap">
            {t('squads.count', { have: profile.squads.length, max: cap })}
          </p>
          <button className="btn wide primary" data-action="new" disabled={!room.ok} onClick={onNew}>
            {t('squads.new')}
          </button>
          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — 왜인지는 규칙이 말한다 */}
          {!room.ok && <p className="note" data-field="why">{room.reason}</p>}
        </section>

        {profile.squads.length === 0 ? (
          <section className="place-panel">
            <p className="hint" data-field="empty">{t('squads.empty')}</p>
          </section>
        ) : (
          MODES.map((mode) => (
            <ModeGroup
              key={mode}
              mode={mode}
              rows={squadsOf(profile, mode).map((s) => squadRow(profile, s))}
              onOpen={onOpen}
              onDelete={setAsking}
            />
          ))
        )}
      </div>

      {asking && (
        <DeleteModal
          squad={asking}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            onChange({ ...profile, squads: profile.squads.filter((s) => s.id !== asking.id) });
            setAsking(null);
          }}
        />
      )}
    </ScreenChrome>
  );
}

/** 모드 한 묶음. **비어 있어도 머리를 남긴다** — 「5v5는 아직 없다」가 보여야 한다 */
function ModeGroup({ mode, rows, onOpen, onDelete }: {
  mode: BattleMode;
  rows: SquadRow[];
  onOpen: (id: string) => void;
  onDelete: (squad: Squad) => void;
}): React.JSX.Element {
  return (
    <section className="place-panel sqd-group" data-mode={mode}>
      <h2 className="cap">{mode === '3v3' ? '3 vs 3' : '5 vs 5'}</h2>
      <div className="sqd-thead">
        <span>{t('squads.col.size')}</span>
        <span>{t('squads.col.name')}</span>
        <span>{t('squads.col.power')}</span>
        <span>{t('squads.col.members')}</span>
      </div>
      {rows.length === 0 ? (
        <p className="hint" data-field="emptyMode">{t('squads.emptyMode', { mode })}</p>
      ) : rows.map((row) => (
        <div key={row.squad.id} className="sqd-row" data-squad={row.squad.id} data-mode={mode}>
          <button className="sqd-open" data-action="open" onClick={() => onOpen(row.squad.id)}>
            <span className="sqd-size">{mode === '3v3' ? '3 vs 3' : '5 vs 5'}</span>
            <span className="sqd-nm" data-field="name">{row.squad.name}</span>
            {/* 전투력은 **모드와 같은 줄에** 있다 — 옆 칸의 숫자와 견주지 않도록 */}
            <span className="sqd-pw" data-field="power" data-power={row.power ?? ''}>
              {row.power === null ? '—' : row.power.toLocaleString()}
            </span>
            <span className="sqd-who" data-field="members">
              {row.members.map((m) => m.name).join(', ') || '—'}
            </span>
          </button>
          {row.problem && <p className="note" data-field="broken">{t('squads.broken', { why: row.problem })}</p>}
          <button
            className="btn ghost sm sqd-del"
            data-action="delete"
            onClick={() => onDelete(row.squad)}
          >
            {t('squads.delete.short')}
          </button>
        </div>
      ))}
    </section>
  );
}

/** 삭제는 되돌릴 수 없어 한 번 묻는다 — 증축·재설계와 같은 결이다 */
function DeleteModal({ squad, onClose, onConfirm }: {
  squad: Squad; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="squadDelete" onClick={onClose}>
      <div className="modal sqd-modal" onClick={(e) => e.stopPropagation()}>
        <p className="row"><b>{t('squads.delete.title')}</b></p>
        <p className="row" data-field="what">{t('squads.delete.what', { name: squad.name })}</p>
        <div className="sqd-acts">
          <button className="btn primary wide" data-action="deleteConfirm" onClick={onConfirm}>
            {t('squads.delete.ok')}
          </button>
          <button className="btn wide" data-action="deleteCancel" onClick={onClose}>
            {t('squads.delete.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
