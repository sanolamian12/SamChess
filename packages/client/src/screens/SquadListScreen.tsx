/**
 * 편성 부대 목록 (pptx 42쪽)
 *
 * ```
 * [← 병영으로]      편성 부대 목록
 * ┌ 목록 판 ────────────────────────────────┐
 * │ 부대 2 / 10                              │
 * │ [전체][분류▾]  [부대 이름][정렬▾]          │
 * │ [ 부대명 또는 장수명으로 검색          ]   │
 * │  참여인원 · 편성 명 · 전투력 │    구성      │
 * │   3 vs 3    초전박살    843  │ 조조, 관흥…  │
 * └─────────────────────────────────────────┘
 * ┌ 단추 판 (화면 바닥) ─────────────────────┐
 * │ [ 새 편성 만들기 ]                        │
 * └─────────────────────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 위는 정보, 아래는 폭을 다 쓰는 단추 — 화면 전체가 그 결이다 (2026-09-16)
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 [새 편성 만들기]가 **맨 위 판**에 있었다. 그 사이 병영·궁궐·도시·
 * 대장간이 전부 「위는 정보, 아래는 단추 판」으로 자리를 잡았으므로 여기도 맞춘다
 * (기획자 지정). 손이 가는 자리가 화면마다 다르면 그때마다 눈으로 찾게 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 모드는 **묶음이 아니라 필터**가 됐다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 예전에는 3v3 판과 5v5 판을 **둘 다** 그렸다. 3v3과 5v5의 전투력을 눈으로도
 * 섞지 않으려던 것인데(§「전투력은 눈으로도 섞지 않는다」), **판이 늘 둘이라**
 * 한쪽이 비어도 자리를 차지했고 부대가 늘수록 화면이 길어졌다.
 *
 * 이제 판은 하나이고 **리스트 박스가 3v3 · 5v5 · 전체를 가른다.** 「전체」에서는
 * 두 모드가 한 표에 섞이는데, **맨 앞 열이 「참여인원」이라 줄마다 제 모드를
 * 말한다** — 값을 견주는 눈은 그 열에서 멈춘다(기획자 판단).
 *
 * ────────────────────────────────────────────────────────────────
 * 고르는 줄은 **리스트 박스 둘, 1:1**이다 ★ (2026-09-16, 세 번 바뀌었다)
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * 처음:  [   분류 ▾   ]  [   정렬 ▾   ]
 * 고른 뒤: [  3 vs 3 ▾  ]  [ 전투력 ▾ ]
 * ```
 *
 * 한 차례 **넷**(나무판에 지금 값 + 옆 단추에 이름 — 장수 일람의 짜임)이었는데,
 * 좁은 칸 넷에 나눠 담느라 **펼친 목록까지 좁아져 「3 vs 3」이 두 줄로 접혔다**
 * (기획자가 배포 화면에서 잡았다). 지금은 둘이고, 단추가 **안 골랐을 땐 이름,
 * 고른 뒤엔 값**을 적는다(`Dropdown`의 `buttonLabel`을 고르기 전에만 준다).
 * 안 고른 동안은 기본값(전체·부대 이름)이 걸려 있으므로 이름을 적어도 거짓이 아니다.
 *
 * **정렬 셋**(`SquadSort`)은 아래 `sortRows()` 참조 — 「장수 이름」이 이 화면에만
 * 있는 것이라 거기 적었다.
 *
 * ────────────────────────────────────────────────────────────────
 * 검색은 **0.5초 뒤 스스로** 나간다 · 삭제는 **여기 없다**
 * ────────────────────────────────────────────────────────────────
 *
 * 랭킹의 검색은 전체 유저를 훑는 **서버 요청**이라 「누르거나 Enter」를 지키지만,
 * 여기는 **내 부대 열 개를 메모리에서 거르는 것**이라 타이핑마다 걸러도 값이
 * 안 든다 — [검색] 단추가 오히려 한 걸음을 더 만든다(`SearchBar`의 `debounceMs`).
 *
 * **[부대 삭제]는 편성 화면으로 옮겼다** (2026-09-16 둘째 지정). 부대를 눌러
 * 들어가면 거기서 고치거나 지운다 — 목록은 **고르는 화면**이고, 무엇을 할지는
 * 그 안에서 정한다. 줄마다 붉은 판이 서 있던 처음 모양도, 아래 단추 하나로
 * 모았던 중간 모양도 **목록에 「지우는 일」을 남겨 두고 있었다.**
 *
 * **숫자는 규칙이 낸다** — 전투력은 `squadPower()`(= `battlePower()`), 상한은
 * `squadCap()`. 화면이 공식을 다시 적으면 계수가 바뀌었을 때 **표시만** 어긋난다.
 */

import { useEffect, useMemo, useState } from 'react';
import { canAddSquad, squadCap, squadRow, squadsOf } from '@samchess/meta';
import type { PlayerProfile, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { Pager } from './PagerButton.tsx';
import { Dropdown, MODE_KEY, SearchBar, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 목록 필터 — 모드 둘에 **「전체」가 하나 더 있다.** `BattleMode`가 아니라서
    `ModeSelect`(랭킹의 짝)를 못 쓰고 일반형 `Dropdown`을 쓴다 */
type ListFilter = 'all' | BattleMode;
const LIST_FILTERS: readonly ListFilter[] = ['all', '3v3', '5v5'];

const filterLabel = (v: ListFilter): string =>
  (v === 'all' ? t('records.filter.all') : t(MODE_KEY[v]));

/** 정렬 셋 (2026-09-16 지정) */
type SquadSort = 'name' | 'power' | 'members';
/** 차례는 **부대 이름 · 장수 이름 · 전투력**이다(2026-09-16 지정) — 이름 둘이
    나란하고 숫자가 끝에 온다. 글자에 「순」을 안 붙인다(「부대명 순」→「부대 이름」):
    옆의 [정렬]이 이미 「무엇으로 줄 세우나」를 묻고 있어 같은 말을 두 번 하던 자리다. */
const SQUAD_SORTS: readonly SquadSort[] = ['name', 'members', 'power'];
const SORT_KEY: Record<SquadSort, StringKey> = {
  name: 'squads.sort.name', power: 'squads.sort.power', members: 'squads.sort.members',
};

/** 한 쪽에 다섯 부대 (2026-09-17 지정, pptx 66쪽) — 쪽 줄은 장수 일람과 같은 `Pager` */
const PAGE_SIZE = 5;

/** 검색이 스스로 나가기까지 기다리는 시간 (2026-09-16 지정) */
const SEARCH_DEBOUNCE_MS = 500;

/**
 * 줄 정렬 — **화면이 쓰는 글자로 맞춘다.**
 *
 * | 기준 | 어떻게 |
 * |---|---|
 * | 부대 이름 | 이름 가나다 |
 * | 장수 이름 | 구성원을 **앞에서부터 차례로** 견준다 |
 * | 전투력 | **큰 쪽이 위**. 성립 안 하는 부대(`null`)는 맨 아래 |
 *
 * ★ **「장수 이름」은 첫 사람만 보는 것이 아니다** (2026-09-16 지정). 첫 사람이
 * 같으면 둘째, 그다음… 으로 내려간다 — 자리 차례가 곧 `picks`의 차례이고 보통
 * 첫 자리가 King이라 **사실상 King 가나다순**이지만, 같은 King을 여러 부대에
 * 넣는 것이 흔해서 거기서 멈추면 순서가 뒤죽박죽으로 보인다.
 *
 * **이름은 지금 언어의 것**으로 견준다(`pickOfficerNameById`) — 화면에 보이는
 * 차례와 정렬이 어긋나면 정렬이 안 된 것처럼 읽힌다. `localeCompare`라 언어마다
 * 제 사전 차례를 따른다.
 *
 * **같은 값이면 이름으로 갈린다** — 안 그러면 같은 목록을 두 번 그렸을 때
 * 순서가 달라진다(§장수 일람의 `sortRows`와 같은 이유).
 */
function sortRows(rows: SquadRow[], sort: SquadSort): SquadRow[] {
  const byName = (a: SquadRow, b: SquadRow): number => a.squad.name.localeCompare(b.squad.name);
  const names = (r: SquadRow): string[] => r.members.map((m) => pickOfficerNameById(m.officer, m.name));
  return [...rows].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'power') {
      // 성립하지 않는 부대는 맨 아래 — 「0점」이 아니라 「아직 값이 없다」다
      if (a.power === null || b.power === null) {
        if (a.power === b.power) return byName(a, b);
        return a.power === null ? 1 : -1;
      }
      return b.power - a.power || byName(a, b);
    }
    const [x, y] = [names(a), names(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const c = (x[i] ?? '').localeCompare(y[i] ?? '');
      if (c !== 0) return c;
    }
    return byName(a, b);
  });
}

export function SquadListScreen({ profile, onBack, onNew, onOpen }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  useLang();
  const [filter, setFilter] = useState<ListFilter>('all');
  const [sort, setSort] = useState<SquadSort>('name');
  /** 한 번이라도 골랐는가 — 안 골랐으면 단추가 값 대신 「분류」·「정렬」을 적는다 */
  const [filterPicked, setFilterPicked] = useState(false);
  const [sortPicked, setSortPicked] = useState(false);
  const [q, setQ] = useState('');

  const room = canAddSquad(profile);
  const cap = squadCap(profile);

  /*
   * **검색은 부대 이름과 장수 이름 둘 다 본다** (2026-09-16 지정).
   *
   * 장수 이름은 **화면에 뜨는 그 글자**로 맞춰야 한다 — `SquadRow.members[].name`은
   * meta가 실어 온 **한국어 평문**이고(meta는 언어를 모른다), 사람이 치는 것은
   * 지금 보고 있는 언어의 이름이다. 둘 다 본다: 한국어로 기억하는 사람과 영어로
   * 보고 있는 사람이 같은 화면에서 각자 찾을 수 있다.
   */
  const rows = useMemo(() => {
    const all = squadsOf(profile, filter === 'all' ? undefined : filter)
      .map((s) => squadRow(profile, s));
    const needle = q.trim().toLowerCase();
    const hit = !needle ? all : all.filter((r) => r.squad.name.toLowerCase().includes(needle)
      || r.members.some((m) => m.name.toLowerCase().includes(needle)
        || pickOfficerNameById(m.officer, m.name).toLowerCase().includes(needle)));
    return sortRows(hit, sort);
  }, [profile, filter, q, sort]);

  /* 쪽 — **분류·정렬·검색이 바뀌면 첫 쪽으로** 돌아간다(장수 일람과 같은 규칙).
     부대를 지워 줄이 줄었을 때 지금 쪽이 사라지면 마지막 쪽에 머문다. */
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filter, q, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

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
        <section className="place-panel block grow sqd-list">
          {/* 보유 수는 **목록 판 안**이다(2026-09-16 지정) — 세는 대상이 바로
              아래 표라, 예전처럼 단추 판에 있으면 무엇을 세는 값인지 한 번 더
              짚어야 했다. */}
          <p className="sqd-count" data-field="cap">
            {t('squads.count', { have: profile.squads.length, max: cap })}
          </p>

          {/*
            고르는 줄 — **리스트 박스 둘, 1:1** (2026-09-16 셋째 지정).

            처음엔 「분류」·「정렬」이라는 **이름**을 적고, 한 번 고르고 나면 **고른
            값**을 적는다. 바로 전 모양(나무판에 값 + 옆 단추에 이름, 넷)은 좁은
            칸 넷에 나눠 담느라 펼친 목록까지 좁아져 「3 vs 3」이 두 줄로 접혔다.
            나무판이 따로 말하던 「지금 무엇인가」는 **고른 뒤의 단추 글자**가
            대신 말한다 — 안 고른 동안은 기본값(전체·부대 이름)이라 이름을
            적어도 거짓말이 아니다.
          */}
          <div className="sqd-pickrow">
            <Dropdown
              value={filter} options={LIST_FILTERS} dataField="mode"
              {...(filterPicked ? {} : { buttonLabel: t('squads.filter') })}
              label={filterLabel}
              onChange={(v) => { setFilter(v); setFilterPicked(true); }}
            />
            <Dropdown
              value={sort} options={SQUAD_SORTS} dataField="sort"
              {...(sortPicked ? {} : { buttonLabel: t('squads.sortBtn') })}
              label={(v) => t(SORT_KEY[v])}
              onChange={(v) => { setSort(v); setSortPicked(true); }}
            />
          </div>

          <SearchBar
            value={q} onSubmit={setQ} placeholder={t('squads.search')}
            debounceMs={SEARCH_DEBOUNCE_MS}
          />

          {/* 열 폭은 **왼쪽 셋이 절반, 「구성」이 나머지 절반**이고 전부 가운데
              정렬이다(2026-09-16 지정) — `style.css`의 `.scr-squads .sqd-thead`
              참조. 머리와 줄이 같은 그리드를 써야 숫자가 열에 맞는다. */}
          <div className="sqd-thead">
            <span>{t('squads.col.size')}</span>
            <span>{t('squads.col.name')}</span>
            <span>{t('squads.col.power')}</span>
            <span>{t('squads.col.members')}</span>
          </div>

          {/* 「한 번도 안 만들었다」와 「찾은 것이 없다」는 **다른 말**이다 —
              앞엣것은 [새 편성 만들기]로 가라는 뜻이고, 뒤엣것은 필터·검색을
              고치라는 뜻이다. 한 문구로 합치면 둘 중 한쪽이 거짓말이 된다. */}
          {profile.squads.length === 0 ? (
            <p className="hint" data-field="empty">{t('squads.empty')}</p>
          ) : rows.length === 0 ? (
            <p className="hint" data-field="noResult">{t('squads.noResult')}</p>
          ) : (
            <div className="sqd-rows">
              {pageRows.map((row) => <Row key={row.squad.id} row={row} onOpen={onOpen} />)}
            </div>
          )}
          {/* 부대는 도시를 키울수록 늘어나는 목록이라 [처음]·[끝]을 켠다 —
              장수 일람과 같은 판단(`Pager`의 `ends` 머리말) */}
          {pageCount > 1 && <Pager page={current} pageCount={pageCount} onPage={setPage} ends />}
        </section>

        {/* 화면 바닥의 단추 판 — 병영·도시·편성과 같은 자리·같은 결 */}
        <section className="place-panel sqd-acts">
          <button className="btn wide primary" data-action="new" disabled={!room.ok} onClick={onNew}>
            {t('squads.new')}
          </button>
          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — 왜인지는 규칙이 말한다 */}
          {!room.ok && <p className="note" data-field="why">{room.reason}</p>}
        </section>
      </div>
    </ScreenChrome>
  );
}

/** 부대 한 줄. **누르면 편성 화면으로 간다** — 고치는 것도 지우는 것도 거기서 한다 */
function Row({ row, onOpen }: { row: SquadRow; onOpen: (id: string) => void }): React.JSX.Element {
  const mode = row.squad.mode === '3v3' ? '3 vs 3' : '5 vs 5';
  return (
    <div className="sqd-row" data-squad={row.squad.id} data-mode={row.squad.mode}>
      <button className="sqd-open" data-action="open" onClick={() => onOpen(row.squad.id)}>
        <span className="sqd-size">{mode}</span>
        <span className="sqd-nm" data-field="name">{row.squad.name}</span>
        <span className="sqd-pw" data-field="power" data-power={row.power ?? ''}>
          {row.power === null ? '—' : row.power.toLocaleString()}
        </span>
        <span className="sqd-who" data-field="members">
          {row.members.map((m) => pickOfficerNameById(m.officer, m.name)).join(', ') || '—'}
        </span>
      </button>
      {row.problem && <p className="note" data-field="broken">{t('squads.broken', { why: row.problem })}</p>}
    </div>
  );
}
