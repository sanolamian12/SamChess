/**
 * 편성 부대 목록 (pptx 42쪽)
 *
 * ```
 * [← 병영으로]      편성 부대 목록
 * ┌ 목록 판 ────────────────────────────────┐
 * │ 부대 2 / 10                              │
 * │ [3 vs 3 ▾]      [검색칸] [검색]           │
 * │ 참여인원  편성 명   전투력  구성           │
 * │  3 vs 3   초전박살    843   조조, 관흥, 능통│
 * └─────────────────────────────────────────┘
 * ┌ 단추 판 (화면 바닥) ─────────────────────┐
 * │ [ 새 편성 만들기 ]                        │
 * │ [ 부대 삭제 ]                             │
 * └─────────────────────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 위는 정보, 아래는 폭을 다 쓰는 단추 — 화면 전체가 그 결이다 ★ (2026-09-16)
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
 * 말한다** — 값을 견주는 눈은 그 열에서 멈춘다(기획자 판단). 가르는 뜻 자체는
 * 살아 있고, 부대가 없을 때 빈 판이 뜨지 않는다.
 *
 * 필터·검색은 **부대 랭킹(`SquadRankingScreen`)의 것을 그대로 빌린다** —
 * `Dropdown`·`SearchBar`가 이미 전역 그림(`.rk-dropdown`·`.rk-search.field`)을
 * 입고 있어 새로 만들 것이 없다. **검색은 부대 이름과 장수 이름 둘 다** 본다
 * (기획자 지정) — 「조조가 어느 부대에 있더라」가 이 화면에서 가장 잦은 물음이다.
 *
 * ────────────────────────────────────────────────────────────────
 * [삭제]는 줄마다가 아니라 **아래 단추 하나**다
 * ────────────────────────────────────────────────────────────────
 *
 * 줄마다 붉은 판이 서 있으면 목록이 「지우는 화면」처럼 보이고, 줄을 누르려다
 * 잘못 누를 자리가 부대 수만큼 늘어난다. [부대 삭제]는 **어느 부대를 지울지
 * 먼저 고르게** 하고(`PickDeleteModal`), 고른 뒤에 예전 그대로 한 번 더 묻는다
 * (`DeleteModal`). 지울 것이 하나도 없으면 **단추가 잠긴 채 옅게** 남는다 —
 * 없애 버리면 「원래 없는 기능인가」가 되고, 그냥 두면 눌러 보고서야 안다.
 *
 * **숫자는 규칙이 낸다** — 전투력은 `squadPower()`(= `battlePower()`), 상한은
 * `squadCap()`. 화면이 공식을 다시 적으면 계수가 바뀌었을 때 **표시만** 어긋난다.
 */

import { useMemo, useState } from 'react';
import { canAddSquad, squadCap, squadRow, squadsOf } from '@samchess/meta';
import type { PlayerProfile, Squad, SquadRow } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { Dropdown, FilterRow, MODE_KEY, SearchBar, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerNameById } from '../i18n/story.ts';

/** 목록 필터 — 모드 둘에 **「전체」가 하나 더 있다.** `BattleMode`가 아니라서
    `ModeSelect`(랭킹의 짝)를 못 쓰고 일반형 `Dropdown`을 쓴다 */
type ListFilter = 'all' | BattleMode;
const LIST_FILTERS: readonly ListFilter[] = ['all', '3v3', '5v5'];

const filterLabel = (v: ListFilter): string =>
  (v === 'all' ? t('records.filter.all') : t(MODE_KEY[v]));

export function SquadListScreen({ profile, onBack, onNew, onOpen, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  /** 지우기 전 마지막 확인 — 고른 부대가 들어 있다 */
  const [asking, setAsking] = useState<Squad | null>(null);
  /** [부대 삭제]를 눌러 **어느 것을 지울지 고르는 중**인가 */
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<ListFilter>('all');
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
    if (!needle) return all;
    return all.filter((r) => r.squad.name.toLowerCase().includes(needle)
      || r.members.some((m) => m.name.toLowerCase().includes(needle)
        || pickOfficerNameById(m.officer, m.name).toLowerCase().includes(needle)));
  }, [profile, filter, q]);

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

          <FilterRow>
            <Dropdown
              value={filter} options={LIST_FILTERS} dataField="mode"
              label={filterLabel} onChange={setFilter}
            />
          </FilterRow>
          <SearchBar value={q} onSubmit={setQ} placeholder={t('squads.search')} />

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
              {rows.map((row) => <Row key={row.squad.id} row={row} onOpen={onOpen} />)}
            </div>
          )}
        </section>

        {/* 화면 바닥의 단추 판 — 병영·도시·편성과 같은 자리·같은 결 */}
        <section className="place-panel sqd-acts">
          <button className="btn wide primary" data-action="new" disabled={!room.ok} onClick={onNew}>
            {t('squads.new')}
          </button>
          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — 왜인지는 규칙이 말한다 */}
          {!room.ok && <p className="note" data-field="why">{room.reason}</p>}
          <button
            className="btn wide"
            data-action="deletePick"
            disabled={profile.squads.length === 0}
            onClick={() => setPicking(true)}
          >
            {t('squads.delete')}
          </button>
        </section>
      </div>

      {picking && (
        <PickDeleteModal
          rows={profile.squads.map((s) => squadRow(profile, s))}
          onPick={(squad) => { setPicking(false); setAsking(squad); }}
          onClose={() => setPicking(false)}
        />
      )}

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

/** 부대 한 줄. **누르면 편성 화면으로 간다** — 이 줄이 하는 일은 그 하나뿐이다 */
function Row({ row, onOpen }: { row: SquadRow; onOpen: (id: string) => void }): React.JSX.Element {
  const mode = row.squad.mode === '3v3' ? '3 vs 3' : '5 vs 5';
  return (
    <div className="sqd-row" data-squad={row.squad.id} data-mode={row.squad.mode}>
      <button className="sqd-open" data-action="open" onClick={() => onOpen(row.squad.id)}>
        <span className="sqd-size">{mode}</span>
        <span className="sqd-nm" data-field="name">{row.squad.name}</span>
        {/* 전투력은 **모드와 같은 줄에** 있다 — 옆 칸의 숫자와 견주지 않도록 */}
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

/**
 * 지울 부대 고르기 (2026-09-16) — [부대 삭제]가 **먼저 묻는 것**이다.
 *
 * **필터·검색을 안 탄다** — `profile.squads` 전부를 보여 준다. 지우려는 부대가
 * 지금 필터 밖에 있을 수 있고, 그때 목록이 비어 있으면 「지울 수가 없다」로
 * 읽힌다. 고르는 자리와 보는 자리는 뜻이 다르다.
 *
 * 판때기는 삭제 확인 팝업과 **같은 그림**이다(`.modal.sqd-modal`) — 한 흐름의
 * 두 걸음이라 판이 바뀌면 다른 곳으로 온 것처럼 읽힌다.
 */
function PickDeleteModal({ rows, onPick, onClose }: {
  rows: SquadRow[]; onPick: (squad: Squad) => void; onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="squadDeletePick" onClick={onClose}>
      <div className="modal sqd-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('squads.delete')}</p>
        <p className="row">{t('squads.delete.pick')}</p>
        <div className="sqd-picks">
          {rows.map((r) => (
            <button
              key={r.squad.id}
              className="btn wide sqd-pick"
              data-action="pickDelete"
              data-squad={r.squad.id}
              onClick={() => onPick(r.squad)}
            >
              <span className="lbl">{r.squad.name}</span>
              <span className="sub">{r.squad.mode === '3v3' ? '3 vs 3' : '5 vs 5'}</span>
            </button>
          ))}
        </div>
        <button className="btn wide" data-action="pickCancel" onClick={onClose}>
          {t('squads.delete.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * 삭제는 되돌릴 수 없어 한 번 묻는다 — 증축·재설계와 같은 결이다.
 *
 * 제목은 `.modal-ttl`이다(2026-09-16) — 예전엔 `.row > b`였는데, 화풍 리스킨에서
 * 제목만 청동 명패로 올라가야 해서 **뜻이 다른 두 줄을 같은 이름으로 두면**
 * 명패가 본문에도 깔린다. 대장간의 확인 팝업(`ForgeScreen`의 `ConfirmModal`)이
 * 이미 쓰는 이름 그대로다 — 새 이름을 안 만든다.
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
