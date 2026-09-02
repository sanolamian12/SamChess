/**
 * 배치 프리셋 편집 — 42쪽의 `배치 [남군 / 북군]`
 *
 * ```
 * [취소]        남군 배치        [기본 배치로] [저장]
 *        F  G  H  I  J  …            ← 배치 구역만 보여준다
 *    16  ·  ·  ·  ·  ·
 *    17  ·  K  ·  R  ·                K = King · R = Rock …
 *    …
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 남군용과 북군용을 **따로** 저장한다 (§5-14)
 * ────────────────────────────────────────────────────────────────
 *
 * `P1 = 남군(아래 5행)` · `P2 = 북군(위 5행)`이라 한쪽 좌표를 다른 쪽에 쓸 수 없다.
 * 진영 폭도 **참여 수 × 5열**이라 모드마다 다르다 — 그래서 격자를 화면이 그리지 않고
 * `deployZone(mode, side)`에게 묻는다. 칸 이름(`A~Y` / `1~20`)도 전투 화면과 같은
 * `cellName()`을 쓴다.
 *
 * **「기본 배치로」는 엔진이 세우는 그 자리다** (`defaultSquadCells` → `defaultDeployPos`).
 * 화면이 「5×5의 중앙」을 다시 적으면 배치 구역 규칙이 바뀌었을 때 여기만 어긋난다.
 *
 * **저장할 수 있는지도 규칙에 묻는다** (`isDeployable`). 여기서만 통과하고 전투에서
 * 걸리면 「저장은 됐는데 기본 배치로 뜬다」가 되어 아무도 못 찾는다.
 */

import { useState } from 'react';
import { officerById } from '@samchess/data';
import { defaultSquadCells, isDeployable } from '@samchess/meta';
import type { PlayerProfile, Squad, SquadCell } from '@samchess/meta';
import { deployZone } from '@samchess/rules';
import type { PieceType, Side } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { cellName } from '../ui/eventText.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';

export function SquadDeployScreen({ profile, squad, side, onCancel, onSave }: {
  profile: PlayerProfile;
  squad: Squad;
  side: Side;
  onCancel: () => void;
  onSave: (cells: SquadCell[]) => void;
}): React.JSX.Element {
  useLang();
  const [cells, setCells] = useState<SquadCell[]>(
    () => squad.deploy[side] ?? defaultSquadCells(squad.mode, side, squad.picks),
  );
  const [holding, setHolding] = useState<PieceType>(squad.picks[0]?.piece ?? 'King');

  const zone = deployZone(squad.mode, side);
  const at = (x: number, y: number): SquadCell | undefined =>
    cells.find((c) => c.x === x && c.y === y);

  /** 고른 기물을 그 칸으로. **이미 누가 있으면 자리를 맞바꾼다** — 지우고 다시 놓을 필요가 없다 */
  const place = (x: number, y: number): void => {
    setCells((prev) => {
      const mine = prev.find((c) => c.piece === holding);
      if (!mine) return prev;
      const there = prev.find((c) => c.x === x && c.y === y);
      return prev.map((c) => {
        if (c.piece === holding) return { ...c, x, y };
        if (there && c.piece === there.piece) return { ...c, x: mine.x, y: mine.y };
        return c;
      });
    });
  };

  const ok = isDeployable(profile, squad, side, cells);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-deploy"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadDeploy" data-side={side} data-mode={squad.mode}>
        <button className="btn ghost sm" data-action="deployCancel" onClick={onCancel}>
          {t('deploy.cancel')}
        </button>
        <span className="place-nm">
          {t('deploy.title', { side: t(side === 'P1' ? 'squad.deploy.p1' : 'squad.deploy.p2') })}
        </span>
      </div>

      <div className="place-body">
        <section className="place-panel">
          <p className="hint">{t('deploy.note')}</p>
          <div className="sqd-hold">
            <span className="k">{t('deploy.pick')}</span>
            {squad.picks.map((pick) => {
              const who = officerById.get(pick.officer);
              return (
                <button
                  key={pick.piece}
                  className={`btn sm${holding === pick.piece ? ' primary' : ''}`}
                  data-hold={pick.piece}
                  data-on={holding === pick.piece ? '1' : '0'}
                  onClick={() => setHolding(pick.piece)}
                >
                  {pick.piece}<span className="dim">{who ? pickOfficerName(who) : ''}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="place-panel sqd-grid-wrap">
          {/*
            격자는 **배치 구역만** 그린다 — 20×25를 다 그리면 한 칸이 글자보다 작아진다.
            열·행 이름은 판 전체 기준이라 `cellName()`을 그대로 쓴다(전투 화면과 같은 말).
          */}
          <div
            className="sqd-grid"
            style={{ gridTemplateColumns: `1.6rem repeat(${zone.x1 - zone.x0 + 1}, 1fr)` }}
            data-cols={zone.x1 - zone.x0 + 1}
          >
            <span className="sqd-corner" />
            {range(zone.x0, zone.x1).map((x) => (
              <span key={`h${x}`} className="sqd-axis">{String.fromCharCode(65 + x)}</span>
            ))}
            {range(zone.y0, zone.y1).map((y) => (
              <FragmentRow key={`r${y}`} y={y} zone={zone} at={at} onPlace={place} holding={holding} />
            ))}
          </div>
        </section>

        <section className="place-panel sqd-acts sqd-acts-row">
          <button
            className="btn"
            data-action="deployReset"
            onClick={() => setCells(defaultSquadCells(squad.mode, side, squad.picks))}
          >
            {t('deploy.reset')}
          </button>
          <button className="btn primary" data-action="deploySave" disabled={!ok} onClick={() => onSave(cells)}>
            {t('deploy.save')}
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}

/** 격자 한 줄. `<>` 조각이라 그리드가 평평하게 유지된다 */
function FragmentRow({ y, zone, at, onPlace, holding }: {
  y: number;
  zone: { x0: number; x1: number };
  at: (x: number, y: number) => SquadCell | undefined;
  onPlace: (x: number, y: number) => void;
  holding: PieceType;
}): React.JSX.Element {
  return (
    <>
      <span className="sqd-axis">{y + 1}</span>
      {range(zone.x0, zone.x1).map((x) => {
        const here = at(x, y);
        return (
          <button
            key={`${x},${y}`}
            className={`sqd-cell${here ? ' taken' : ''}${here?.piece === holding ? ' holding' : ''}`}
            data-cell={cellName({ x, y })}
            data-piece={here?.piece ?? ''}
            onClick={() => onPlace(x, y)}
          >
            {here ? here.piece[0] : ''}
          </button>
        );
      })}
    </>
  );
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
