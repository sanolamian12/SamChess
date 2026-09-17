/**
 * 부대 배치 편집 — 판 전체 위에서 (pptx 69·72쪽, 2026-09-17)
 *
 * ```
 * [← 뒤로 가기]        부대 배치 편집
 * [ 남군 | 북군 ]                    [기본 배치로]
 * ┌ 20 × 25 판 (전투 지도) ─────────────────────┐
 * │        R        K        Q                  │ ← 가상의 상대(알파벳)
 * │                                             │
 * │     [가후]    [서황]    [감녕]                │ ← 우리 편(장수 그림)
 * └─────────────────────────────────────────────┘
 *  기물을 누르면 … / 두 번 누르면 …
 * [ 수정 완료 | 편성 완료 ]
 * [ 뒤로 가기 ]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 배치 구역만이 아니라 **판 전체**를 그린다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 예전 편집기는 우리 진영 5행만 그렸다 — 그러면 「상대가 저기 서면 내 Rock이 닿는가」를
 * 볼 수 없다. 69쪽은 실제 전투의 지도 위에 **가상의 상대**를 세워 두고 둘 다 움직여
 * 보게 한다. 상대는 연습용이라 **저장하지 않는다** — 저장되는 것은 우리 편 좌표뿐이다.
 *
 * 가상의 상대는 3v3 `Rock · King · Queen`, 5v5 `Rock · Bishop · King · Queen · Knight`
 * 차례로 **엔진의 기본 배치 자리**(`defaultDeployPos`)에 선다(기획자 지정). 화면이
 * 「5×5의 가운데」를 다시 적지 않는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 두 진영은 **작업본 둘**을 함께 든다
 * ────────────────────────────────────────────────────────────────
 *
 * [남군]·[북군]을 오가도 각자 고친 것이 남아 있어야 한다(기획자 지정) — 그래서 칸
 * 목록을 진영별로 들고(`cells.P1`·`cells.P2`), 마지막 단추 하나가 **둘 다** 넘긴다.
 * 상대 작업본도 진영별이다 — 남군 화면에서 옮겨 본 상대가 북군 화면으로 따라오면
 * 안 된다(거기서 상대는 반대편에 선다).
 *
 * **저장할 수 있는지는 규칙에 묻는다**(`isDeployable`) — 두 진영 모두 통과해야 단추가
 * 켜진다. 기본 배치와 똑같은 진영은 `null`로 넘긴다 — 「배치 없음」과 「기본 배치를
 * 저장함」이 갈리면 기본 배치 규칙이 바뀐 날 옛 좌표가 조용히 남는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 음영 두 가지
 * ────────────────────────────────────────────────────────────────
 *
 * | 몸짓 | 음영 | 출처 |
 * |---|---|---|
 * | 기물을 한 번 누른다 | 그 기물이 설 수 있는 빈 칸(제 진영 구역) | `deployZone` |
 * | 기물을 두 번 누른다 | 그 자리에서 **움직일 수 있는 칸만** | `legalMoves` |
 *
 * 공격 범위는 **안 보여 준다**(2026-09-17 지정) — 처음엔 `threatRange`(이동 뒤 공격까지의
 * 합집합)였는데, 자리를 잡는 화면에서 알고 싶은 것은 「여기서 어디로 갈 수 있나」다.
 * 범위는 **다른 기물을 장애물로** 넘겨 잰다 — 전투에서 막히는 길이 여기서도 막혀야
 * 미리 보는 뜻이 있다. 두 번 누르기는 한 번 누르기를 두 번 지나므로(브라우저가
 * `click` 둘 다음 `dblclick`을 쏜다) 범위를 켤 때 고르기는 비운다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import { defaultSquadCells, isDeployable } from '@samchess/meta';
import type { PlayerProfile, Squad, SquadCell } from '@samchess/meta';
import { FORMULA, defaultDeployPos, deployZone, inZone, legalMoves } from '@samchess/rules';
import type { PieceType, Side, Vec2 } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { BOARD_MAP_URL } from '../ui/art.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { OfficerArt } from './OfficerArt.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';

/** 가상의 상대가 서는 차례 (69쪽 기획자 지정) */
const ENEMY_ORDER: Record<Squad['mode'], PieceType[]> = {
  '3v3': ['Rock', 'King', 'Queen'],
  '5v5': ['Rock', 'Bishop', 'King', 'Queen', 'Knight'],
};

const other = (side: Side): Side => (side === 'P1' ? 'P2' : 'P1');

/** 판에 적는 한 글자 — **King과 Knight가 둘 다 `K`**라 첫 글자로는 5v5에서 갈리지
    않는다. 체스 기보의 약속대로 Knight는 `N`이다 */
const LETTER: Record<PieceType, string> = {
  King: 'K', Queen: 'Q', Rock: 'R', Bishop: 'B', Knight: 'N', Pawn: 'P',
};

type Team = 'ours' | 'enemy';
interface Held { team: Team; piece: PieceType }

const sameCells = (a: readonly SquadCell[], b: readonly SquadCell[]): boolean =>
  a.length === b.length && a.every((c) => b.some((d) => d.piece === c.piece && d.x === c.x && d.y === c.y));

function enemyCells(mode: Squad['mode'], enemySide: Side): SquadCell[] {
  return ENEMY_ORDER[mode].map((piece, i) => ({ piece, ...defaultDeployPos(mode, enemySide, i) }));
}

export function SquadDeployScreen({ profile, squad, initial, isNew, onBack, onSave }: {
  profile: PlayerProfile;
  /** 부대원이 다 찬 부대 — 배치는 `initial`로 따로 받는다 */
  squad: Squad;
  /** 진영별 시작 배치. `null`인 진영은 기본 배치로 시작한다 */
  initial: Squad['deploy'];
  /** 새 부대인가 — 마지막 단추 글자와 「기본 배치로 설정됩니다」 팝업이 갈린다 */
  isNew: boolean;
  onBack: () => void;
  onSave: (deploy: Squad['deploy']) => void;
}): React.JSX.Element {
  useLang();
  const mode = squad.mode;
  const defaults = (s: Side): SquadCell[] => defaultSquadCells(mode, s, squad.picks);

  const [side, setSide] = useState<Side>('P1');
  const [cells, setCells] = useState<Record<Side, SquadCell[]>>(() => ({
    P1: initial.P1 ?? defaults('P1'),
    P2: initial.P2 ?? defaults('P2'),
  }));
  /** 우리 편 진영을 기준으로 든 상대 작업본 — 남군 화면의 상대는 북군 구역에 선다 */
  const [enemy, setEnemy] = useState<Record<Side, SquadCell[]>>(() => ({
    P1: enemyCells(mode, 'P2'),
    P2: enemyCells(mode, 'P1'),
  }));
  const [touched, setTouched] = useState<Record<Side, boolean>>({ P1: false, P2: false });
  const [held, setHeld] = useState<Held | null>(null);
  const [range, setRange] = useState<Held | null>(null);
  const [asking, setAsking] = useState(false);

  const ours = cells[side];
  const theirs = enemy[side];
  const listOf = (team: Team): SquadCell[] => (team === 'ours' ? ours : theirs);
  const zoneOf = (team: Team) => deployZone(mode, team === 'ours' ? side : other(side));

  const occupant = (x: number, y: number): { team: Team; cell: SquadCell } | null => {
    const o = ours.find((c) => c.x === x && c.y === y);
    if (o) return { team: 'ours', cell: o };
    const e = theirs.find((c) => c.x === x && c.y === y);
    return e ? { team: 'enemy', cell: e } : null;
  };

  /* 한 번 누른 기물이 설 수 있는 칸 — 제 진영 구역의 빈 칸 */
  const canGo = (x: number, y: number): boolean =>
    held !== null && inZone(zoneOf(held.team), { x, y }) && occupant(x, y) === null;

  /* 두 번 누른 기물이 움직일 수 있는 칸 — 다른 기물을 장애물로(막힌 칸·가로막힌 길은 빠진다) */
  const rangeCells: Set<string> = (() => {
    if (!range) return new Set();
    const me = listOf(range.team).find((c) => c.piece === range.piece);
    if (!me) return new Set();
    const blocked = (p: Vec2): boolean =>
      !(p.x === me.x && p.y === me.y) && occupant(p.x, p.y) !== null;
    return new Set(legalMoves(range.piece, { x: me.x, y: me.y }, { blocked }).map((p) => `${p.x},${p.y}`));
  })();

  const move = (x: number, y: number): void => {
    if (!held) return;
    const update = (list: SquadCell[]): SquadCell[] =>
      list.map((c) => (c.piece === held.piece ? { ...c, x, y } : c));
    if (held.team === 'ours') {
      setCells((prev) => ({ ...prev, [side]: update(prev[side]) }));
      setTouched((prev) => ({ ...prev, [side]: true }));
    } else {
      setEnemy((prev) => ({ ...prev, [side]: update(prev[side]) }));
    }
    setHeld(null);
  };

  const onCell = (x: number, y: number): void => {
    const occ = occupant(x, y);
    setRange(null);
    if (occ) {
      setHeld(held && held.team === occ.team && held.piece === occ.cell.piece
        ? null : { team: occ.team, piece: occ.cell.piece });
      return;
    }
    if (canGo(x, y)) move(x, y);
    else setHeld(null);
  };

  const onDouble = (x: number, y: number): void => {
    const occ = occupant(x, y);
    if (!occ) return;
    setHeld(null);
    setRange({ team: occ.team, piece: occ.cell.piece });
  };

  const switchSide = (next: Side): void => {
    setSide(next); setHeld(null); setRange(null);
  };

  const resetSide = (): void => {
    setCells((prev) => ({ ...prev, [side]: defaults(side) }));
    setEnemy((prev) => ({ ...prev, [side]: enemyCells(mode, other(side)) }));
    setTouched((prev) => ({ ...prev, [side]: true }));
    setHeld(null); setRange(null);
  };

  const ok = isDeployable(profile, squad, 'P1', cells.P1) && isDeployable(profile, squad, 'P2', cells.P2);

  /** 기본 배치와 같은 진영은 `null` — 「배치 없음」 하나로 둔다(머리말 참조) */
  const result = (): Squad['deploy'] => ({
    P1: sameCells(cells.P1, defaults('P1')) ? null : cells.P1,
    P2: sameCells(cells.P2, defaults('P2')) ? null : cells.P2,
  });

  const finish = (): void => {
    // 새 부대를 **한 번도 안 만지고** 끝내면 기본 배치라는 것을 한 번 알린다(72쪽)
    if (isNew && !touched.P1 && !touched.P2) { setAsking(true); return; }
    onSave(result());
  };

  const rows = FORMULA.board.rows;
  const cols = FORMULA.board.cols;

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-squad-deploy"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadDeploy" data-side={side} data-mode={mode}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('match.back'))}
        </button>
        <span className="place-nm">{t('deploy.editTitle')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqb-panel">
          <div className="sqb-toolbar">
            <div className="sqb-sides" role="tablist">
              {(['P1', 'P2'] as Side[]).map((s) => (
                <button
                  key={s}
                  role="tab"
                  className={`sqb-side${side === s ? ' on' : ''}`}
                  data-action="deploySide"
                  data-side={s}
                  data-on={side === s ? '1' : '0'}
                  aria-selected={side === s}
                  onClick={() => switchSide(s)}
                >
                  {t(s === 'P1' ? 'squad.deploy.p1' : 'squad.deploy.p2')}
                </button>
              ))}
            </div>
            <button className="sqb-reset" data-action="deployReset" onClick={resetSide}>
              {t('deploy.reset')}
            </button>
          </div>

          <div
            className="sqb-board"
            style={{
              // 행·열을 **둘 다** 등분한다 — 행을 안 적으면 기물이 선 줄만 그림 높이만큼
              // 부풀고 나머지 줄이 쪼그라들었다(2026-09-17). 칸 안의 그림은 절대 배치라
              // 줄 높이를 밀지 않는다(`.sqb-cell > *`)
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              backgroundImage: `url(${BOARD_MAP_URL})`,
            }}
            data-held={held ? `${held.team}:${held.piece}` : ''}
            data-range={range ? `${range.team}:${range.piece}` : ''}
          >
            {Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
              const occ = occupant(x, y);
              const zone = inZone(deployZone(mode, side), { x, y }) ? 'ours'
                : inZone(deployZone(mode, other(side)), { x, y }) ? 'enemy' : '';
              const isHeld = occ && held && held.team === occ.team && held.piece === occ.cell.piece;
              const who = occ?.team === 'ours'
                ? squad.picks.find((p) => p.piece === occ.cell.piece)?.officer : undefined;
              const data = who ? officerById.get(who) : undefined;
              return (
                <button
                  key={`${x},${y}`}
                  className={`sqb-cell${canGo(x, y) ? ' can' : ''}${rangeCells.has(`${x},${y}`) ? ' range' : ''}${isHeld ? ' held' : ''}`}
                  data-x={x}
                  data-y={y}
                  data-zone={zone}
                  data-team={occ?.team ?? ''}
                  data-piece={occ?.cell.piece ?? ''}
                  title={occ ? `${occ.cell.piece}${data ? ` · ${pickOfficerName(data)}` : ''}` : undefined}
                  onClick={() => onCell(x, y)}
                  onDoubleClick={() => onDouble(x, y)}
                >
                  {occ?.team === 'ours' && data && <OfficerArt officer={data.id} className="sqb-art" />}
                  {occ?.team === 'ours' && !data && <span className="sqb-letter">{LETTER[occ.cell.piece]}</span>}
                  {occ?.team === 'enemy' && <span className="sqb-letter enemy">{LETTER[occ.cell.piece]}</span>}
                </button>
              );
            }))}
          </div>

          <ul className="sqb-guide">
            <li>{t('deploy.guide.move')}</li>
            <li>{t('deploy.guide.range')}</li>
            <li>{t('deploy.guide.enemy')}</li>
          </ul>
        </section>

        <section className="place-panel sqd-acts">
          <button className="btn primary wide" data-action="deploySave" disabled={!ok} onClick={finish}>
            {isNew ? t('deploy.done.new') : t('squad.save.edit')}
          </button>
          <button className="btn wide" data-action="deployBackBottom" onClick={onBack}>
            {stripBackArrow(t('match.back'))}
          </button>
        </section>
      </div>

      {asking && (
        <div className="modal-back" data-modal="deployDefault" onClick={() => setAsking(false)}>
          <div className="modal sqd-modal sqb-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="row" data-field="what">{t('deploy.defaultConfirm.body')}</p>
            <div className="sqd-acts">
              <button
                className="btn primary wide"
                data-action="deployDefaultOk"
                onClick={() => { setAsking(false); onSave(result()); }}
              >
                {t('deploy.defaultConfirm.ok')}
              </button>
              <button className="btn wide" data-action="deployDefaultCancel" onClick={() => setAsking(false)}>
                {t('deploy.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenChrome>
  );
}
