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
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { SquadDeployScreen } from './SquadDeployScreen.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName, pickOfficerNameById } from '../i18n/story.ts';

const SIDE_LABEL: Record<Side, StringKey> = { P1: 'squad.deploy.p1', P2: 'squad.deploy.p2' };

export function SquadEditScreen({ profile, draft, onBack, onSave, onDelete }: {
  profile: PlayerProfile;
  /** 고치는 중인 부대. **신규도 「아직 저장 안 된 부대」로 들어온다** — 화면이 하나다 */
  draft: Squad;
  /** 신규인가(= 목록에 아직 없는가). 단추 글자만 갈린다 */
  onBack: () => void;
  onSave: (squad: Squad) => void;
  /**
   * 이 부대를 지운다 — **목록에 이미 있는 부대일 때만 뜬다** (2026-09-16 지정).
   *
   * 예전에는 목록 화면이 줄마다(그다음엔 아래 단추 하나로) 지웠다. 목록은
   * **고르는 화면**이고 무엇을 할지는 들어와서 정한다는 쪽으로 옮겼다 —
   * 「고친다」와 「지운다」가 한자리에 있으면 잘못 누를 자리도 하나로 준다.
   */
  onDelete: (id: string) => void;
}): React.JSX.Element {
  useLang();
  const [squad, setSquad] = useState<Squad>(draft);
  const [active, setActive] = useState<PieceType>(squad.picks[0]?.piece ?? 'King');
  const [deploySide, setDeploySide] = useState<Side | null>(null);
  /** [부대 삭제] 확인 팝업이 떠 있는가 — 되돌릴 수 없는 수라 한 번 묻는다 */
  const [asking, setAsking] = useState(false);

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
        onSave={(cells) => {
          // **배치를 저장하면 부대도 그대로 확정한다** (2026-09-16 기획자 지정). 보유 장수가
          // 많으면 편성 화면의 [등록 완료]가 화면 밖으로 밀려 안 보이고, [목록으로]는
          // 저장하지 않는다 — 배치까지 마친 사람이 저장할 길을 잃었다. 구성이 아직
          // 성립하지 않으면(그럴 일은 드물다) 예전처럼 편성 화면으로 돌아간다.
          const next = withDeployment(squad, deploySide, cells);
          const nextReady: Squad = { ...next, picks: next.picks.filter((p) => p.officer) };
          if (validateSquad(profile, nextReady, isNew ? undefined : squad.id).ok) {
            onSave(nextReady);
            return;
          }
          setSquad(next);
          setDeploySide(null);
        }}
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
        {/* 그림 화살표(`::before`)를 입혔으므로 문구의 「← 」는 뗀다 — 새 편성
            만들기와 **같은 문구**(`squad.cancel`)를 나눠 쓰는데, 이제 둘 다
            그림 화살표가 있어 두 화면이 같이 뗀다 */}
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('squad.cancel'))}
        </button>
        <span className="place-nm">{squad.mode} {squad.name}</span>
      </div>

      <div className="place-body">
        {/*
          **위 세 판은 함께 스크롤하고 [등록 완료]만 바닥에 고정한다**
          (2026-09-16). 랭킹 화면이 이미 쓰는 구조 그대로다 — `.rk-top`이 남는
          높이를 먹고 스스로 스크롤하고 `.rk-mine`은 늘 바닥에 붙는다
          (`style.css`의 그 절 참조).

          **flex 비율로는 못 푼다.** 판 넷을 한 칸에 욱여넣으면 세로가 모자랄 때
          누가 얼마나 줄지를 브라우저가 정하는데, 그 결과가 「자리 카드가 난간에
          반쯤 걸려 잘린다」 · 「보유 장수 표가 한 줄」이었다(700px 눈검사에서
          `min-height`를 11 → 9rem으로 옮겨 봐도 잘린 자리만 바뀌었다).
          **저장 단추는 줄어들 수 있는 것이 아니다** — 스크롤 상자 밖에 두면
          그 사실이 구조로 서고, 다시는 밀리지 않는다.
        */}
        <div className="sqd-edit-scroll">
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
                  {/* 기물 이름(King·Rock…)은 **번역하지 않는다** — 엔진의
                      `PieceType` 그대로이고 배치·전투 화면도 같은 글자를 쓴다.
                      「필수」만 문구다(2026-09-16에 한국어 상수를 뺐다). */}
                  {piece}{piece === 'King' && <span className="req">{t('squad.required')}</span>}
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

        {/*
          **`block`이 있어야 `grow`가 산다** (2026-09-16). 늘이는 규칙은
          `.scr .block.grow` 하나뿐이라(`style.css`) `place-panel grow`는
          **아무것도 안 걸린다** — 그러면 이 판이 보유 장수 수만큼 부풀었다.
          같은 일을 하는 `OfficerListScreen`·`RecordsScreen`은 처음부터
          `place-panel block grow`였다. 안쪽 `.sqd-pool`이 `overflow-y: auto`라
          판이 줄면 목록이 스스로 스크롤한다.

          그때 고친 증상([등록 완료]가 화면 밖으로 잘린다)은 **이제 위
          `.sqd-edit-scroll`이 구조로 막는다** — 이 규칙은 「목록이 제 칸
          안에서 스크롤한다」만 맡는다.
        */}
        <section className="place-panel block grow">
          <h2 className="cap">{t('squad.pool')} — {t('squad.assign', { piece: active })}</h2>
          {/*
            표 머리는 **장수 일람이 이미 쓰는 키를 그대로 빌린다**
            (`officers.col.*`·`officers.sort.*`) — 같은 여섯 칸을 두 화면이
            보여 주므로 열쇠를 새로 지으면 열 언어에서 언젠가 갈린다.
            2026-09-16까지 여기만 한국어 상수였다.

            ★ **삼능력은 글자가 아니라 아이콘이다.** 칸이 2.2rem인데 몽골어의
            「Манлай」·「Түвшин」은 그보다 훨씬 길어 **옆 칸 글자와 겹쳤다**
            (700px 몽골어 눈검사에서 잡았다 — 한국어로만 떠 있던 동안에는
            드러날 수 없었다). 장수 카드의 삼능력 줄이 **같은 이유로 이미
            아이콘이다**(`RankingCommon.tsx`의 `Stat`) — 아이콘은 언어와
            무관하게 폭이 고정이고, 이름은 `alt`·`title`로 남는다.
          */}
          <div className="sqd-thead sqd-pool-head">
            <span>{t('officers.col.grade')}</span>
            <span>{t('officers.col.name')}</span>
            {([
              ['might', 'officers.sort.might'],
              ['intellect', 'officers.sort.intellect'],
              ['leadership', 'officers.sort.leadership'],
            ] as const).map(([key, label]) => (
              <span className="ic" key={key}>
                <img src={`icons/stat-${key}.png`} alt={t(label)} title={t(label)} />
              </span>
            ))}
            <span>{t('officers.col.level')}</span>
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
                    {pickOfficerNameById(row.officer, row.name)}
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
        </div>

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
          {/* **아직 저장도 안 된 부대는 지울 것이 없다** — 신규에는 안 뜬다.
              그 자리를 나가는 길은 [목록으로]다. 붉은 판(`btn-forcedcancel.png`)은
              대장간 [장비 회수]·부대 삭제 팝업과 같은 그림이다 — 되돌릴 수 없는
              수는 어느 화면에서든 같은 색이라야 손이 기억한다. */}
          {!isNew && (
            <button className="btn wide sqd-del" data-action="delete" onClick={() => setAsking(true)}>
              {t('squads.delete')}
            </button>
          )}
        </section>
      </div>

      {asking && (
        <DeleteModal
          squad={squad}
          onClose={() => setAsking(false)}
          onConfirm={() => { setAsking(false); onDelete(squad.id); }}
        />
      )}
    </ScreenChrome>
  );
}

/**
 * 삭제는 되돌릴 수 없어 한 번 묻는다 — 증축·재설계와 같은 결이다.
 *
 * **목록 화면에서 옮겨 왔다** (2026-09-16) — 지우는 자리가 여기 하나가 되면서
 * 팝업도 따라왔다. 틀(`.modal.sqd-modal`)은 대장간의 확인 팝업과 같은 그림이고,
 * 제목이 `.modal-ttl`인 것도 그대로다 — `.row > b`로 두면 화풍 리스킨에서
 * 청동 명패가 본문에도 깔린다.
 */
function DeleteModal({ squad, onClose, onConfirm }: {
  squad: Squad; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="squadDelete" onClick={onClose}>
      <div className="modal sqd-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('squads.delete.title')}</p>
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
            <span className="who">{pickOfficerName(data)}</span>
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
  return {
    id, name, mode, picks: [{ piece: 'King', officer: '' as OfficerId }],
    deploy: { P1: null, P2: null }, record: {},
  };
}
