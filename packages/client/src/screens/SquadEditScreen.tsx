/**
 * 부대 편성 — 만들기와 고치기 (pptx 42·43쪽)
 *
 * ```
 * [← 목록으로]     3vs3  초전박살
 *  구성   King      Rock      Pawn
 *        [S] 조조  [A] 관흥  [B] 능통
 *          1         2         1        ← 레벨 눈금 (1 ~ 보유 레벨)
 *  배치  [남군] [북군]                    전투력  843 점
 *  보유 장수   등급 | 이름 | 무력 | 지력 | 통솔 | 레벨
 *                                        [등록 완료] / [수정 완료]
 * ```
 *
 * **두 화면이 아니라 한 화면이다** — 43쪽의 신규와 42쪽의 수정이 같은 목업이고
 * 단추 글자만 「등록 완료」/「수정 완료」로 다르다. 참여 인원은 첫 걸음에서 정해져
 * 오므로 여기서는 못 바꾼다.
 *
 * ────────────────────────────────────────────────────────────────
 * 레벨 눈금이 이 화면의 핵심이다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 「캐릭터별 최대 레벨에서 1 사이로 조절 가능」(42쪽). **전투력을 낮춰 약한 상대와
 * 붙기 위한 장치**이고(§5-1), 낮춘 레벨의 능력치·책략은 새로 고르는 것이 아니라
 * **성장 스택에서 그대로 꺼낸다**(GDD §4.2). 그래서 화면은 눈금만 그리면 되고
 * 숫자는 `squadRow()`가 낸다 — HP·AT도, 전투력도.
 *
 * **전투력은 `battlePower()`가 낸다.** 화면이 실측 계수를 다시 적으면 다시 쟀을 때
 * 표시만 조용히 어긋난다. 3v3·5v5를 나란히 놓지 않는 것도 목록과 같은 이유다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import {
  PIECE_TYPES, officerRows, squadPower, teamSize, validateSquad, withDeployment,
} from '@samchess/meta';
import type { PlayerProfile, RosterPick, Squad } from '@samchess/meta';
import type { BattleMode, OfficerId, PieceType, Side } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { SquadDeployScreen } from './SquadDeployScreen.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const SIDE_LABEL: Record<Side, StringKey> = { P1: 'squad.deploy.p1', P2: 'squad.deploy.p2' };

export function SquadEditScreen({ profile, draft, onBack, onSave }: {
  profile: PlayerProfile;
  /** 고치는 중인 부대. **신규도 「아직 저장 안 된 부대」로 들어온다** — 화면이 하나다 */
  draft: Squad;
  /** 신규인가(= 목록에 아직 없는가). 단추 글자만 갈린다 */
  onBack: () => void;
  onSave: (squad: Squad) => void;
}): React.JSX.Element {
  useLang();
  const [squad, setSquad] = useState<Squad>(draft);
  const [active, setActive] = useState<PieceType>(squad.picks[0]?.piece ?? 'King');
  const [deploySide, setDeploySide] = useState<Side | null>(null);

  const isNew = !profile.squads.some((s) => s.id === squad.id);
  const size = teamSize(squad.mode);
  const pieces = squad.picks.map((p) => p.piece);

  /*
   * **아직 장수를 안 넣은 자리는 편성이 아니다.** 화면은 빈 자리를 들고 있어야 하지만
   * (기물을 먼저 고르고 장수를 넣는 순서라서) 규칙에는 「빈 자리」가 없다 — 정원이
   * 고정이다. 그래서 채워진 것만 골라 묻고, 그러면 「3v3은 3명을 채워야 한다 —
   * 지금 2명」이라는 **맞는 말**이 나온다.
   */
  const filled: RosterPick[] = squad.picks.filter((p) => p.officer);
  const ready: Squad = { ...squad, picks: filled };

  // **성립하는지도 규칙에 묻는다** — 화면이 「King 필수」를 다시 적지 않는다
  const check = validateSquad(profile, ready, isNew ? undefined : squad.id);
  const power = check.ok ? squadPower(profile, ready) : null;

  const setPicks = (picks: RosterPick[]): void => setSquad((s) => ({ ...s, picks }));

  /** 기물을 넣고 뺀다. King은 잠근다 — 없으면 어차피 엔진이 거부한다 */
  const togglePiece = (piece: PieceType): void => {
    if (piece === 'King') return;
    setActive(piece);
    if (pieces.includes(piece)) {
      // 기물이 빠지면 그 기물의 배치도 뜻이 없어진다 — 프리셋을 통째로 버린다
      setSquad((s) => ({
        ...s,
        picks: s.picks.filter((p) => p.piece !== piece),
        deploy: { P1: null, P2: null },
      }));
    } else if (pieces.length < size) {
      setSquad((s) => ({ ...s, picks: [...s.picks, { piece, officer: '' as OfficerId }], deploy: { P1: null, P2: null } }));
    }
  };

  /** 자리에 장수를 넣는다. 이미 다른 자리에 있으면 옮긴다 */
  const assign = (officer: OfficerId): void => {
    setPicks(squad.picks.map((p) => {
      if (p.piece === active) {
        return p.officer === officer
          ? { piece: p.piece, officer: '' as OfficerId }
          : { piece: p.piece, officer };
      }
      return p.officer === officer ? { piece: p.piece, officer: '' as OfficerId } : p;
    }));
    const empty = squad.picks.find((p) => p.piece !== active && !p.officer);
    if (empty) setActive(empty.piece);
  };

  const setLevel = (piece: PieceType, level: number): void =>
    setPicks(squad.picks.map((p) => (p.piece === piece ? { ...p, level } : p)));

  if (deploySide) {
    return (
      <SquadDeployScreen
        profile={profile}
        squad={ready}
        side={deploySide}
        onCancel={() => setDeploySide(null)}
        onSave={(cells) => { setSquad((s) => withDeployment(s, deploySide, cells)); setDeploySide(null); }}
      />
    );
  }

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadEdit" data-squad={squad.id} data-mode={squad.mode}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('squad.cancel')}</button>
        <span className="place-nm">{squad.mode} {squad.name}</span>
      </div>

      <div className="place-body">
        <section className="place-panel">
          <h2 className="cap">{t('squad.slots')} — {pieces.length}/{size}</h2>
          <div className="sqd-pieces">
            {PIECE_TYPES.map((piece) => {
              const on = pieces.includes(piece);
              return (
                <button
                  key={piece}
                  className={`sqd-piece${on ? ' on' : ''}${active === piece ? ' active' : ''}`}
                  data-piece={piece}
                  data-on={on ? '1' : '0'}
                  disabled={!on && pieces.length >= size}
                  onClick={() => (on ? setActive(piece) : togglePiece(piece))}
                  onDoubleClick={() => togglePiece(piece)}
                >
                  {piece}{piece === 'King' && <span className="req">필수</span>}
                </button>
              );
            })}
          </div>

          <div className="sqd-slots">
            {squad.picks.map((pick) => (
              <SlotCard
                key={pick.piece}
                profile={profile}
                pick={pick}
                active={active === pick.piece}
                onPick={() => setActive(pick.piece)}
                onLevel={(lv) => setLevel(pick.piece, lv)}
              />
            ))}
          </div>
          <p className="hint">{t('squad.levelNote')}</p>
        </section>

        <section className="place-panel sqd-sums">
          <p className="sqd-power" data-field="power" data-power={power ?? ''}>
            <span className="k">{t('squad.power')}</span>
            <b className="v">{power === null ? '—' : power.toLocaleString()}</b>
            <span className="u">{t('squad.power.unit')}</span>
          </p>
          <p className="hint">{t('squad.power.note')}</p>

          <div className="sqd-deploys">
            <span className="k">{t('squad.deploy')}</span>
            {(['P1', 'P2'] as Side[]).map((side) => (
              <button
                key={side}
                className="btn sm"
                data-action="deploy"
                data-side={side}
                data-saved={squad.deploy[side] ? '1' : '0'}
                disabled={!check.ok}
                onClick={() => setDeploySide(side)}
              >
                {t(SIDE_LABEL[side])}
                <span className="dim">
                  {squad.deploy[side] ? t('squad.deploy.saved') : t('squad.deploy.none')}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="place-panel grow">
          <h2 className="cap">{t('squad.pool')} — {t('squad.assign', { piece: active })}</h2>
          <div className="sqd-thead sqd-pool-head">
            <span>등급</span><span>이름</span><span>무력</span><span>지력</span><span>통솔</span><span>레벨</span>
          </div>
          <div className="sqd-pool">
            {officerRows(profile).map((row) => {
              const used = squad.picks.some((p) => p.officer === row.officer);
              const here = squad.picks.some((p) => p.piece === active && p.officer === row.officer);
              return (
                <button
                  key={row.officer}
                  className={`sqd-prow${used ? ' used' : ''}${here ? ' here' : ''}`}
                  data-officer={row.officer}
                  onClick={() => assign(row.officer)}
                >
                  <span className="gr" data-grade={row.grade}>{row.grade}</span>
                  <span className="nm">
                    {row.name}
                    {used && <em className="tag">{here ? t('squad.here') : t('squad.used')}</em>}
                  </span>
                  <span className="n">{row.might}</span>
                  <span className="n">{row.intellect}</span>
                  <span className="n">{row.leadership}</span>
                  <span className="n">{row.level}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/*
          **저장 단추를 `<footer className="foot">`으로 두면 안 된다.** `.scr .foot`은
          `flex-direction: column` + `margin-top: auto`인데 `.place-body`도 `margin-top:
          auto`라 둘이 서로를 밀어내고, 글자가 세로 한 줄로 짜부라진다(실제로 그랬다).
          배경 화면의 단추는 전부 판때기 안에 있다 — 41쪽의 `.cty-acts`와 같은 자리다.
        */}
        <section className="place-panel sqd-acts">
          {!check.ok && <p className="note" data-field="why">{check.reason}</p>}
          <button
            className="btn primary wide"
            data-action="save"
            disabled={!check.ok}
            onClick={() => onSave(ready)}
          >
            {isNew ? t('squad.save.new') : t('squad.save.edit')}
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}

/**
 * 자리 한 칸 — 기물 · 장수 · **레벨 눈금**.
 *
 * 눈금의 위 끝은 **그 장수의 보유 레벨**이다. 아직 장수를 안 넣은 자리에는 눈금이
 * 없다 — 무엇의 레벨인지 말할 수 없다.
 */
function SlotCard({ profile, pick, active, onPick, onLevel }: {
  profile: PlayerProfile;
  pick: RosterPick;
  active: boolean;
  onPick: () => void;
  onLevel: (level: number) => void;
}): React.JSX.Element {
  const inst = pick.officer ? profile.roster[pick.officer] : undefined;
  const data = pick.officer ? officerById.get(pick.officer) : undefined;
  const max = inst?.level ?? 1;
  const level = Math.max(1, Math.min(pick.level ?? max, max));

  return (
    <div className={`sqd-slot${active ? ' active' : ''}`} data-piece={pick.piece} data-level={inst ? level : ''}>
      <button className="sqd-slot-head" data-action="slot" onClick={onPick}>
        <span className="pc">{pick.piece}</span>
        {data && inst ? (
          <>
            <OfficerArt officer={data.id} className="thumb" />
            <span className="gr" data-grade={data.grade}>[{data.grade}]</span>
            <span className="who">{data.name}</span>
          </>
        ) : (
          <span className="empty">{t('squad.empty')}</span>
        )}
      </button>
      {inst && (
        <div className="sqd-levels">
          {Array.from({ length: max }, (_, i) => i + 1).map((lv) => (
            <button
              key={lv}
              className={`sqd-lv${lv === level ? ' on' : ''}`}
              data-level={lv}
              onClick={() => onLevel(lv)}
            >
              {lv}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 새 부대의 빈 껍데기 — 첫 걸음(43쪽)에서 받은 이름·모드만 채워져 있다 */
export function emptySquad(id: string, name: string, mode: BattleMode): Squad {
  return { id, name, mode, picks: [{ piece: 'King', officer: '' as OfficerId }], deploy: { P1: null, P2: null } };
}
