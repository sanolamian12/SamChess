/**
 * 편성 부대 목록 (pptx 42쪽 · 2026-11-14 기획자 개정)
 *
 * ```
 * [← 병영으로]      편성 부대 목록
 * ┌ 목록 판 ────────────────────────────────┐
 * │ [부대 아이콘] 2 / 10          [정렬 ▾]   │
 * │  인원 · 이름 · 명단 · 전투력               │
 * │  ♜♞♝  백호대  (꼬마 다섯)        594     │
 * │ [처음][이전] 1 / 1 [다음][끝]             │
 * └─────────────────────────────────────────┘
 * ┌ 단추 판 (화면 바닥) ─────────────────────┐
 * │ [ + 새 편성 ]                             │
 * │ [ 수비군 지정 ]                           │
 * │ [ 뒤로 가기 ]                             │
 * └─────────────────────────────────────────┘
 * ```
 *
 * **[분류] · 검색은 걷었다** (2026-11-14 기획자) — 부대는 많아야 열 남짓이고, 두 모드가 한 표에 섞여도
 * 맨 앞 「인원」 열이 줄마다 제 모드를 말한다. 그만큼 목록 판이 낮아졌다. 보유 수는 글자 「부대」 대신
 * 부대 아이콘(`icons/tab-squad.png` — 병영의 [부대 관리] · 랭킹 탭과 같은 그림)이고, 같은 줄 오른쪽이 [정렬]이다.
 *
 * **정렬 셋** — 생성일(만든 차례, 오래된 것이 위 · 기본) · 부대명 · 전투력(큰 쪽이 위).
 *
 * **[수비군 지정]** — 누르면 목록이 「고르는 중」이 되어 줄을 누르면 그 부대가 **제 모드의 수비군**이 되고
 * 수비군 설정 화면으로 간다(`onGarrison`). 성립하지 않는 부대는 흐리게 막는다(`setGarrison`이 거절한다).
 * 다시 누르면(그만두기) 평소 목록으로 — 그때 줄은 평소처럼 부대 현황으로 간다.
 *
 * **[부대 삭제]는 여기 없다** — 부대를 눌러 들어간 부대 현황에서 한다(2026-09-16). 숫자는 규칙이 낸다 —
 * 전투력은 `squadPower()`(= `battlePower()`), 상한은 `squadCap()`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { canAddSquad, firstSquadPending, isGarrison, squadCap, squadRow, squadsOf } from '@samchess/meta';
import { guidesEnabled } from './guideScript.ts';
import type { PlayerProfile, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { Pager } from './PagerButton.tsx';
import { useSteadyPage } from './useSteadyPage.ts';
import { Dropdown, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon, ModeIcon } from './GameIcon.tsx';
import { OfficerStand } from './OfficerArt.tsx';
import { BlinkGlow } from './BlinkGlow.tsx';
import type { BlinkTone } from './BlinkGlow.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 정렬 셋 (2026-11-14 기획자) — 생성일 · 부대명 · 전투력. 기본은 생성일 */
type SquadSort = 'created' | 'name' | 'power';
const SQUAD_SORTS: readonly SquadSort[] = ['created', 'name', 'power'];
const SORT_KEY: Record<SquadSort, StringKey> = {
  created: 'squads.sort.created', name: 'squads.sort.name', power: 'squads.sort.power',
};

/** 명단 꼬마의 후광 (2026-11-13 기획자) — S급 자주 · A급 흰 별빛 · E급(황제) 금, B~D급은 없다. 장수 그림 뒤 후광(`officerBlink`)과 달리 아래 등급은 비운다 */
const STAND_GLOW: Partial<Record<string, BlinkTone>> = { S: 'purple', A: 'plain', E: 'gold' };

/** 한 쪽에 다섯 부대 (2026-09-17 지정, pptx 66쪽) — 쪽 줄은 장수 일람과 같은 `Pager` */
const PAGE_SIZE = 5;

/**
 * 줄 정렬. **생성일은 계정의 부대 차례**다(`profile.squads`는 만든 차례로 쌓인다 — `createdAt`은 옛 부대에 없다).
 * 부대명 · 전투력이 같으면 만든 차례로 갈린다 — 안 그러면 같은 목록을 두 번 그렸을 때 순서가 달라진다.
 * 전투력은 큰 쪽이 위이고, 성립 안 하는 부대(`null`)는 맨 아래 — 「0점」이 아니라 「아직 값이 없다」다.
 */
function sortRows(rows: SquadRow[], sort: SquadSort): SquadRow[] {
  const at = new Map(rows.map((r, i) => [r.squad.id, i]));
  const byCreated = (a: SquadRow, b: SquadRow): number => at.get(a.squad.id)! - at.get(b.squad.id)!;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return a.squad.name.localeCompare(b.squad.name) || byCreated(a, b);
    if (sort === 'power') {
      if (a.power === null || b.power === null) {
        if (a.power === b.power) return byCreated(a, b);
        return a.power === null ? 1 : -1;
      }
      return b.power - a.power || byCreated(a, b);
    }
    return byCreated(a, b);
  });
}

export function SquadListScreen({ profile, onBack, onNew, onOpen, onGarrison }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  /** [수비군 지정]으로 고른 부대 — 화면 밖이 수비군으로 정하고 수비군 설정으로 간다 */
  onGarrison: (id: string) => void;
}): React.JSX.Element {
  useLang();
  const [sort, setSort] = useState<SquadSort>('created');
  /** 한 번이라도 골랐는가 — 안 골랐으면 단추가 값 대신 「정렬」을 적는다 */
  const [sortPicked, setSortPicked] = useState(false);
  /** [수비군 지정]을 눌러 수비군으로 삼을 부대를 고르는 중인가 */
  const [picking, setPicking] = useState(false);

  const room = canAddSquad(profile);
  const cap = squadCap(profile);

  const rows = useMemo(() => sortRows(squadsOf(profile).map((s) => squadRow(profile, s)), sort), [profile, sort]);
  /** 수비군으로 고를 수 있는 부대가 하나라도 있는가 — 없으면 [수비군 지정]을 잠근다 */
  const canPick = rows.some((r) => !r.problem);

  /* 쪽 — **정렬이 바뀌면 첫 쪽으로** 돌아간다(장수 일람과 같은 규칙).
     부대를 지워 줄이 줄었을 때 지금 쪽이 사라지면 마지막 쪽에 머문다. */
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // 판 높이는 쪽을 넘겨도 그대로 — 가장 긴 쪽에 맞춘다(`useSteadyPage`, 2026-11-13 기획자)
  const listRef = useRef<HTMLElement>(null);
  const current = Math.min(page, pageCount - 1);
  const shown = useSteadyPage(listRef, current, pageCount, [rows.map((r) => r.squad.id).join()]);
  const pageRows = rows.slice(shown * PAGE_SIZE, shown * PAGE_SIZE + PAGE_SIZE);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squads"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squads" data-squad-count={profile.squads.length}>
        {/* 그림 화살표(`::before`)를 입혔으므로 문구의 「← 」는 뗀다 — 병영·궁궐과
            같은 자리·같은 이유(`RankingCommon.tsx`의 `stripBackArrow` 머리말). */}
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('squads.back'))}
        </button>
        <span className="place-nm">{t('squads.title')}</span>
      </div>

      <div className="place-body">
        {/* 판은 **다섯 줄 + 쪽 줄만큼**이다(2026-09-17 지정) — 예전엔 `block grow`로 남는 높이를
            다 먹어 부대가 하나여도 빈 양피지가 화면을 채웠다. 줄 칸(`.sqd-page`)의 높이를
            다섯 줄로 고정해 부대 수·검색 결과와 무관하게 판이 들썩이지 않는다 */}
        <section ref={listRef} className="place-panel sqd-list">
          {/* 보유 수 · 정렬 한 줄 (2026-11-14 기획자) — 글자 「부대」 대신 부대 아이콘 */}
          <div className="sqd-headrow">
            <p className="sqd-count" data-field="cap" aria-label={t('squads.count', { have: profile.squads.length, max: cap })}>
              <img className="sqd-count-ic" src="icons/tab-squad.png" alt="" draggable={false} />
              <span>{profile.squads.length} / {cap}</span>
            </p>
            <Dropdown
              value={sort} options={SQUAD_SORTS} dataField="sort"
              {...(sortPicked ? {} : { buttonLabel: t('squads.sortBtn') })}
              label={(v) => t(SORT_KEY[v])}
              onChange={(v) => { setSort(v); setSortPicked(true); }}
            />
          </div>

          {/* 열 폭은 **왼쪽 셋이 절반, 「구성」이 나머지 절반**이고 전부 가운데
              정렬이다(2026-09-16 지정) — `style.css`의 `.scr-squads .sqd-thead`
              참조. 머리와 줄이 같은 그리드를 써야 숫자가 열에 맞는다. */}
          <div className="sqd-thead">
            <span>{t('squads.col.size')}</span>
            <span>{t('squads.col.name')}</span>
            <span>{t('squads.col.members')}</span>
            <span>{t('squads.col.power')}</span>
          </div>

          {/* 「한 번도 안 만들었다」와 「찾은 것이 없다」는 **다른 말**이다 —
              앞엣것은 [새 편성 만들기]로 가라는 뜻이고, 뒤엣것은 필터·검색을
              고치라는 뜻이다. 한 문구로 합치면 둘 중 한쪽이 거짓말이 된다. */}
          <div className="sqd-page">
          {rows.length === 0 ? (
            <p className="hint" data-field="empty">{t('squads.empty')}</p>
          ) : (
            <div className="sqd-rows" data-picking={picking ? '1' : undefined}>
              {pageRows.map((row) => (
                <Row
                  key={row.squad.id} row={row} garrison={isGarrison(profile, row.squad)}
                  picking={picking}
                  onOpen={picking ? (id) => { setPicking(false); onGarrison(id); } : onOpen}
                />
              ))}
            </div>
          )}
          </div>
          {/* 부대는 도시를 키울수록 늘어나는 목록이라 [처음]·[끝]을 켠다 —
              장수 일람과 같은 판단(`Pager`의 `ends` 머리말). **쪽이 하나여도 그린다**
              (2026-09-17 지정) — 대장간 지급 목록처럼 `1 / 1`이 「여기가 전부다」를 말하고,
              판 높이도 쪽 수와 무관하게 같다 */}
          <Pager page={current} pageCount={pageCount} onPage={setPage} ends />
        </section>

        {/* 화면 바닥의 단추 판 — 병영·도시·편성과 같은 자리·같은 결 */}
        <section className="place-panel sqd-acts">
          {/* 첫 편성(2026-11-13) — 3인팀이 생길 때까지 [새 편성]이 빛난다 */}
          <button className="btn wide primary" data-action="new" data-guide-cue={guidesEnabled() && firstSquadPending(profile) ? '' : undefined} disabled={!room.ok} onClick={onNew}>
            <GameIcon name="mk-plus" label={t('squads.new')} text />
          </button>
          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — 왜인지는 규칙이 말한다 */}
          {!room.ok && <p className="note" data-field="why">{room.reason}</p>}
          {/* [수비군 지정] (2026-11-14 기획자) — 누르면 위 목록에서 수비군을 고른다. 고르는 동안은 [그만두기]가 되고
              무엇을 하면 되는지 한 줄이 위에 선다 */}
          {picking && <p className="hint sqd-pickhint" data-field="garrisonPick">{t('squads.garrisonPick')}</p>}
          <button
            className={`btn wide${picking ? ' sqd-picking' : ''}`} data-action="garrisonPick"
            disabled={!picking && !canPick} onClick={() => setPicking((v) => !v)}
          >
            <span className="lbl">{picking ? t('squads.garrisonCancel') : t('squads.garrison')}</span>
          </button>
          {/* [뒤로 가기] — 제목 바의 [병영으로]와 같은 일. 대장간 화면들의 판 아래 단추와
              **같은 참나무 목판**(`btn-secondary.png`)이고 글자도 같은 `match.back`이다 */}
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            <span className="lbl">{stripBackArrow(t('match.back'))}</span>
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}

/**
 * 부대 한 줄. **누르면 편성 화면으로 간다** — 고치는 것도 지우는 것도 거기서 한다.
 * 그 모드의 수비군이면 이름 옆에 표지가 선다(`garrisonOf`가 정한다 — 안 골랐으면 첫 부대, 2026-10-27)
 */
function Row({ row, garrison, picking, onOpen }: { row: SquadRow; garrison: boolean; picking: boolean; onOpen: (id: string) => void }): React.JSX.Element {
  const names = row.members.map((m) => pickOfficerNameById(m.officer, m.name));
  return (
    <div className="sqd-row" data-squad={row.squad.id} data-mode={row.squad.mode} data-garrison={garrison ? '1' : '0'}>
      {/* 수비군을 고르는 중에는 성립 안 하는 부대를 막는다 — 수비군이 될 수 없다(`setGarrison`) */}
      <button className="sqd-open" data-action="open" disabled={picking && !!row.problem} onClick={() => onOpen(row.squad.id)}>
        <span className="sqd-size"><ModeIcon mode={row.squad.mode} /></span>
        {/* 이름 글자만 `data-field="name"` — 표지가 이름에 섞여 읽히지 않게 */}
        {/* 수비군은 글자 표지 대신 이름 왼쪽의 아이콘(`gi/me` ← `record/battle_system_badge_me`, 2026-11-13 기획자) */}
        <span className="sqd-nm">
          {garrison && <img className="sqd-garrison-ic" data-field="garrison" src="ui/gi/me.png" alt={t('squad.garrison')} title={t('squad.garrison')} draggable={false} />}
          <span data-field="name">{row.squad.name}</span>
        </span>
        {/* 명단은 꼬마 장수(서 있는 자세)로 — 다섯 자리 폭이 언어와 상관없이 같다(2026-11-13 기획자). 이름은 `title` · `data-names`(스모크 · 검색 시험이 읽는다).
            자리는 언제나 다섯 — 3인팀은 1 · 3 · 5번째에 서서 줄이 같은 폭에 고르게 퍼진다. S · A · E급은 뒤에 후광(`STAND_GLOW`) */}
        <span className="sqd-who" data-field="members" data-names={names.join(', ')} aria-label={names.join(', ') || '—'}>
          {Array.from({ length: 5 }, (_, slot) => {
            const at = row.members.length === 3 ? [0, -1, 1, -1, 2][slot]! : slot;
            const m = at >= 0 ? row.members[at] : undefined;
            const glow = m ? STAND_GLOW[m.grade] : undefined;
            return (
              <span key={slot} className="sqd-slot" data-slot={slot} data-grade={m?.grade}>
                {glow && <BlinkGlow tone={glow} className="sqd-stand-glow" />}
                {m && <OfficerStand officer={m.officer} title={names[at] ?? m.name} />}
              </span>
            );
          })}
        </span>
        <span className="sqd-pw" data-field="power" data-power={row.power ?? ''}>
          {row.power === null ? '—' : row.power.toLocaleString()}
        </span>
      </button>
      {row.problem && <p className="note" data-field="broken"><GameIcon name="mk-warn" label={t('squads.broken', { why: row.problem })} text /></p>}
    </div>
  );
}
