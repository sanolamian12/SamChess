/**
 * 부대 편집 · 새 부대 편성 — 부대원 고르기 (pptx 68·71쪽, 2026-09-17)
 *
 * ```
 * [← 목록으로]        부대 편집 / 새 부대 편성
 * ┌ 판 ────────────────────────────────────────┐
 * │ 초전박살 (3vs3)                              │
 * │ [King ]  [사진] [S] 가후 Lv1        [교체]    │  ← King은 못 바꾼다
 * │ [Rock▾]  [사진] [S] 서황 Lv5        [교체]    │  ← 누르면 남은 기물 목록
 * │ [Queen▾]  -                        [선택]    │
 * │ ( · )                                        │  ← 3v3은 흐린 두 줄
 * └────────────────────────────────────────────┘
 * ┌ 변경 전 / 후 (편집) · 부대 요약 (신규) ────────┐
 * [ 부대 배치 설정 | 부대 배치 ]
 * [ 뒤로 가기 ]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 여기서는 저장하지 않는다 — **반드시 배치 확인을 지난다** ★ (2026-09-17 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 부대원을 고치면 저장해 둔 배치가 어긋난다(프리셋이 기물을 키로 든다). 예전에는
 * 편성 화면이 그 배치를 **조용히 지웠다.** 이제는 새 부대와 같은 걸음이다 —
 * 무엇이든 바뀌면 [부대 배치 설정]이 켜지고, 배치 편집이 **옛 배치를 줄 차례대로
 * 물려준 판**(`remapDeployment`)을 띄워 사람이 확인한 뒤 거기서 저장한다.
 * 새 부대를 만드는 흐름과 고치는 흐름이 하나가 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 기물은 겹칠 수 없다 — **목록에서 애초에 뺀다**
 * ────────────────────────────────────────────────────────────────
 *
 * 엔진의 유닛 이름이 `{진영}-{기물}`이라 한 부대에 같은 기물이 둘일 수 없다. 포지션
 * 목록은 **King · 이 줄의 기물 · 다른 줄이 이미 쓰는 기물**을 빼고 띄운다(기획자
 * 지정) — 고른 뒤에 「겹친다」고 말하는 것보다 못 고르게 하는 것이 낫다.
 *
 * **장수는 겹치면 자리를 맞바꾼다.** 이미 다른 줄에 있는 장수를 고르면 그 줄에는
 * 이 줄의 옛 장수가 간다 — 한 장수가 한 부대에 두 번 설 수 없고(`validateRoster`),
 * 「빼고 넣기」를 두 번 하게 만들 이유도 없다.
 *
 * **성립하는지는 규칙이 말한다**(`validateSquad`) — 화면이 「King 필수」·「정원」을
 * 다시 적지 않는다. 전투력도 `squadPower()`다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import { PIECE_TYPES, remapDeployment, squadPower, teamSize, validateSquad } from '@samchess/meta';
import type { PlayerProfile, RosterPick, Squad } from '@samchess/meta';
import type { BattleMode, OfficerId, PieceType } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { OfficerPickModal } from './OfficerListScreen.tsx';
import { Dropdown, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { SquadDeployScreen } from './SquadDeployScreen.tsx';
import { SQUAD_ROWS, modeText } from './SquadViewScreen.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName, pickOfficerNameById } from '../i18n/story.ts';

/** 새 부대의 처음 포지션 (2026-09-17 기획자 확정) */
const START_PIECES: Record<BattleMode, PieceType[]> = {
  '3v3': ['King', 'Rock', 'Queen'],
  '5v5': ['King', 'Rock', 'Queen', 'Bishop', 'Knight'],
};

/** 새 부대의 빈 껍데기 — 첫 걸음(70쪽)에서 받은 이름·모드와 처음 포지션만 있다 */
export function emptySquad(id: string, name: string, mode: BattleMode): Squad {
  return {
    id, name, mode,
    picks: START_PIECES[mode].map((piece) => ({ piece, officer: '' as OfficerId })),
    deploy: { P1: null, P2: null }, record: {},
  };
}

const samePicks = (a: readonly RosterPick[], b: readonly RosterPick[]): boolean =>
  a.length === b.length && a.every((p, i) => p.piece === b[i]!.piece && p.officer === b[i]!.officer);

export function SquadMembersScreen({ profile, draft, base, onChange, onBack, onSave }: {
  profile: PlayerProfile;
  /** 고치는 중인 부대(신규면 `emptySquad`) */
  draft: Squad;
  /** 저장돼 있는 원본 — **신규면 `null`**. 비교 판과 배치 물려주기가 이것을 본다 */
  base: Squad | null;
  /** 장수 고르기 팝업 안의 레벨업이 프로필을 바꿀 수 있다(장수 일람 알맹이를 빌린다) */
  onChange: (p: PlayerProfile) => void;
  /** 고치던 부대원을 들고 나간다 — 신규는 이름 걸음으로 돌아갈 때 이름·모드를 되살린다 */
  onBack: (draft: Squad) => void;
  /** 배치까지 확인한 부대 — 저장은 부르는 쪽(App)이 규칙으로 한다 */
  onSave: (squad: Squad) => void;
}): React.JSX.Element {
  useLang();
  const [squad, setSquad] = useState<Squad>(draft);
  /** 장수를 넣을 줄 번호 — 팝업이 떠 있는 동안만 */
  const [picking, setPicking] = useState<number | null>(null);
  const [deploying, setDeploying] = useState(false);

  const isNew = base === null;
  const size = teamSize(squad.mode);
  const filled = squad.picks.every((p) => p.officer);
  const check = validateSquad(profile, squad, isNew ? undefined : squad.id);
  const power = check.ok ? squadPower(profile, squad) : null;
  const changed = isNew || !samePicks(base.picks, squad.picks);
  const canDeploy = check.ok && changed;

  const setPiece = (row: number, piece: PieceType): void =>
    setSquad((s) => ({ ...s, picks: s.picks.map((p, i) => (i === row ? { ...p, piece } : p)) }));

  /** 줄에 장수를 넣는다 — 다른 줄에 있던 장수면 두 줄이 맞바꾼다(머리말 참조) */
  const setOfficer = (row: number, officer: OfficerId): void =>
    setSquad((s) => {
      const mine = s.picks[row]!.officer;
      return {
        ...s,
        picks: s.picks.map((p, i) => {
          if (i === row) return { ...p, officer };
          if (p.officer === officer) return { ...p, officer: mine };
          return p;
        }),
      };
    });

  if (deploying) {
    return (
      <SquadDeployScreen
        profile={profile}
        squad={squad}
        // 고치는 부대는 **옛 배치를 줄 차례대로 물려받는다**(68·69쪽)
        initial={base ? remapDeployment(base.picks, squad.picks, base.deploy) : { P1: null, P2: null }}
        isNew={isNew}
        onBack={() => setDeploying(false)}
        onSave={(deploy) => onSave({ ...squad, deploy })}
      />
    );
  }

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-squad-members"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadEdit" data-squad={squad.id} data-mode={squad.mode} data-new={isNew ? '1' : '0'}>
        <button className="btn ghost sm" data-action="back" onClick={() => onBack(squad)}>
          {stripBackArrow(t('squad.cancel'))}
        </button>
        <span className="place-nm">{isNew ? t('squad.new.title') : t('squad.edit.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqv-panel">
          <h2 className="cap sqv-head" data-field="head">
            {t('squad.edit.head', { name: squad.name, mode: modeText(squad.mode) })}
          </h2>
          <div className="sqv-rows">
            {Array.from({ length: SQUAD_ROWS }, (_, i) => {
              if (i >= size) {
                // 3v3의 남는 두 줄 — 자리를 이렇게 차지한다는 것만 보여 준다(누를 수 없다)
                return <div key={i} className="sqv-row sqm-row" data-off="1" aria-hidden="true" />;
              }
              const pick = squad.picks[i]!;
              const data = pick.officer ? officerById.get(pick.officer) : undefined;
              const inst = pick.officer ? profile.roster[pick.officer] : undefined;
              const used = new Set(squad.picks.map((p) => p.piece));
              const options = PIECE_TYPES.filter((p) => p !== 'King' && !used.has(p));
              return (
                <div key={i} className="sqv-row sqm-row" data-row={i} data-piece={pick.piece} data-officer={pick.officer}>
                  {pick.piece === 'King' || options.length === 0 ? (
                    <span className="sqm-pos" data-locked="1">{pick.piece}</span>
                  ) : (
                    <Dropdown
                      value={pick.piece}
                      options={options}
                      dataField={`piece-${i}`}
                      buttonLabel={pick.piece}
                      label={(v) => v}
                      onChange={(v) => setPiece(i, v)}
                    />
                  )}
                  {data && inst ? (
                    <>
                      <OfficerArt officer={data.id} className="thumb" />
                      <span className="gr" data-grade={data.grade}>{data.grade}</span>
                      <span className="who">{pickOfficerName(data)}</span>
                      <span className="lv">Lv{inst.level}</span>
                    </>
                  ) : (
                    <span className="who empty">-</span>
                  )}
                  <button
                    className="sqm-pick"
                    data-action="pickOfficer"
                    data-row={i}
                    data-filled={pick.officer ? '1' : '0'}
                    onClick={() => setPicking(i)}
                  >
                    {pick.officer ? t('squad.swap') : t('squad.pick')}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {isNew ? (
          /* 부대 요약 — **다 채워져야** 뜬다(71쪽). 덜 찬 부대의 전투력은 값이 없다 */
          filled && (
            <section className="place-panel sqm-sum" data-field="summary">
              <h2 className="cap">{t('squad.summary.title')}</h2>
              <MemberLine profile={profile} squad={squad} power={power} />
            </section>
          )
        ) : (
          <section className="place-panel sqm-sum" data-field="compare">
            <h2 className="cap">{t('squad.compare.title')}</h2>
            <MemberLine profile={profile} squad={base} power={squadPower(profile, base)} label={t('squad.compare.before')} field="before" />
            <MemberLine profile={profile} squad={squad} power={power} label={t('squad.compare.after')} field="after" />
          </section>
        )}

        <section className="place-panel sqd-acts">
          {/* 왜 안 되는지 — 다 채운 뒤에만 말한다. 채우는 중에 「3명이 필요하다」를
              띄우면 방해만 된다 */}
          {filled && !check.ok && <p className="note" data-field="why">{check.reason}</p>}
          <button
            className="btn primary wide"
            data-action="toDeploy"
            disabled={!canDeploy}
            onClick={() => setDeploying(true)}
          >
            {isNew ? t('squad.toDeploy.new') : t('squad.toDeploy.edit')}
          </button>
          <button className="btn wide" data-action="backBottom" onClick={() => onBack(squad)}>
            {stripBackArrow(t('match.back'))}
          </button>
        </section>
      </div>

      {picking !== null && (
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('squad.pickTitle', { piece: squad.picks[picking]!.piece })}
          onPick={(officer) => { setOfficer(picking, officer); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </ScreenChrome>
  );
}

/** 「멤버들… 전투력」 한 줄 — 비교 판의 전/후와 요약 판이 같은 모양이다 */
function MemberLine({ squad, power, label, field }: {
  profile: PlayerProfile;
  squad: Squad;
  power: number | null;
  label?: string;
  field?: string;
}): React.JSX.Element {
  const names = squad.picks
    .filter((p) => p.officer)
    .map((p) => pickOfficerNameById(p.officer, officerById.get(p.officer)?.name ?? ''))
    .join(', ');
  return (
    <p className="sqm-line" data-field={field} data-power={power ?? ''}>
      {label && <span className="k">{label}</span>}
      <span className="who">{names || '—'}</span>
      <b className="pw">{t('squad.summary.power', { power: power === null ? '—' : power.toLocaleString() })}</b>
    </p>
  );
}
