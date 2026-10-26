/**
 * 게임 아이콘(React) — 이름 · 경로 · 놓는 규칙은 `ui/gameIcon.ts` 한 곳에 있고 여기서는 붙일 뿐이다(`GradeBadge`와 같은 결).
 *
 * `text`가 없으면 **아이콘이 글자를 대신**한다 — 좁은 자리(표 머리 · 칩 · 수치 라벨). 글자는 `title`(올리면) · `aria-label`.
 * `text`면 아이콘 + 글자 — 단추 · 상태 줄. 그림이 안 오면 글자로 물러난다.
 */

import { useState } from 'react';
import { gameIconUrl, type GameIconName } from '../ui/gameIcon.ts';

export function GameIcon({ name, label, text = false, className }: {
  name: GameIconName;
  /** 이 아이콘이 뜻하는 말 — `text`면 보이고, 아니면 올렸을 때 · 화면 낭독기에 */
  label: string;
  text?: boolean;
  className?: string;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`gic${className ? ` ${className}` : ''}`} data-ic={name} title={text ? undefined : label}>
      {failed
        ? (text ? null : label)
        : <img src={gameIconUrl(name)} alt={text ? '' : label} draggable={false} onError={() => setFailed(true)} />}
      {text && <span className="gic-t">{label}</span>}
    </span>
  );
}

/** 대전 모드 — 기물 셋 · 다섯 그림. 좁은 칸은 아이콘만(이름은 올리면), 단추는 `text`.
 *  글자는 「vs 3」 · 「vs 5」 — 그림이 「3」을 말하니 앞의 숫자를 덜어 아이콘 자리를 낸다(기획자 2026-10-26) */
export function ModeIcon({ mode, text = false }: { mode: '3v3' | '5v5'; text?: boolean }): React.JSX.Element {
  return <GameIcon name={mode === '3v3' ? 'mode-3v3' : 'mode-5v5'} label={mode === '3v3' ? 'vs 3' : 'vs 5'} text={text} />;
}

/** 장수 상태 — 건강 · 부상. 표 칸은 아이콘만 */
export function HealthIcon({ hurt, label }: { hurt: boolean; label: string }): React.JSX.Element {
  return <GameIcon name={hurt ? 'st-injured' : 'st-healthy'} label={label} />;
}

/** 승 · 무 · 패 · 격파 한 줄 — 「3 / 2 / 4 - 12 Kills」를 아이콘 + 숫자로. 칸은 `data-w` … 로 읽는다 */
export function TallyIcons({ w, d, l, k, labels }: {
  w: number; d: number; l: number; k?: number;
  labels: { w: string; d: string; l: string; k?: string };
}): React.JSX.Element {
  const cell = (name: GameIconName, label: string, n: number, key: string) => (
    <span className="gic-n" data-k={key}><GameIcon name={name} label={label} />{n}</span>
  );
  return (
    <span className="gic-tally" data-w={w} data-d={d} data-l={l} data-k={k ?? ''}>
      {cell('rec-win', labels.w, w, 'w')}
      {cell('rec-draw', labels.d, d, 'd')}
      {cell('rec-lose', labels.l, l, 'l')}
      {k !== undefined && cell('rec-kills', labels.k ?? '', k, 'k')}
    </span>
  );
}

/** 「승/무/패」 표 머리 — 값 칸(「3 / 2 / 4」)과 같은 차례로 아이콘 셋 */
export function WdlHead({ w, d, l }: { w: string; d: string; l: string }): React.JSX.Element {
  return (
    <span className="gic-wdl">
      <GameIcon name="rec-win" label={w} /><GameIcon name="rec-draw" label={d} /><GameIcon name="rec-lose" label={l} />
    </span>
  );
}

/** 건물 — 메인 · 마을 배경에서 잘라 낸 그 건물(금빛 고리 메달). 줄 이름 앞에 */
const BUILDING_ICON = {
  palace: 'bld-palace', barracks: 'bld-barracks', market: 'bld-market', academy: 'bld-academy',
  farm: 'bld-farm', hospital: 'bld-hospital', forge: 'bld-forge',
} as const satisfies Record<string, GameIconName>;

export function BuildingIcon({ id, label, text = false }: { id: string; label: string; text?: boolean }): React.JSX.Element {
  const name = (BUILDING_ICON as Record<string, GameIconName>)[id];
  return name ? <GameIcon name={name} label={label} text={text} className="gic-bld" /> : <>{label}</>;
}

/** 「[아이콘] ×3」 — 이름 대신 그림, 뒤에 수 (병원 현황처럼 「치료실 3개」를 줄일 때). 이름은 올리면 */
export function IconCount({ name, label, n }: { name: GameIconName; label: string; n: number }): React.JSX.Element {
  return <span className="gic-n gic-count" data-n={n}><GameIcon name={name} label={label} />×{n}</span>;
}
