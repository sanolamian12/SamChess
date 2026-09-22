/**
 * 농지 — 현황 · 도적단 퇴치 · 파수꾼 관리 (GDD §5.11, 2026-09-21)
 *
 * ```
 * [←] 농지
 * ┌ 현황 ─────────────────────────────────┐
 * │   농지 Lv3        │   시간당 군량 6     │
 * │ 파수꾼 배치 : 2/3 명 · 가후, 서황       │
 * │ 도적단 출현 : 출현 (09:31 후 전투)      │   ← 출현 붉음 · 약탈 회색 · 퇴치 완료 파랑
 * └──────────────────────────────────────┘
 *
 *          ┌──────────────────┐
 *          │ [ 도적단 퇴치 ]   │   ← 도적떼가 와 있을 때만, 화면 가운데
 *          └──────────────────┘
 *
 * ┌ 명령 ─────────────────────────────────┐
 * │ [ 파수꾼 관리 ]                        │   ← 화면 바닥
 * └──────────────────────────────────────┘
 * ```
 *
 * 다른 건물과 같은 틀이다 — 제목 바 밑이 현황판, 바닥이 명령 판(병원·대장간·랭킹 메뉴).
 * 단추는 글자만 든 참나무 목판이다(아이콘은 2026-09-22 기획자 지정으로 뺐다).
 *
 * [파수꾼 관리]는 대장간의 [병기구 지급 관리]처럼 **같은 화면 안의 한 걸음**(`view`)이다 —
 * 현황판은 그대로 두고 몸통만 바뀐다. 바닥의 명령 판은 **두 걸음이 같은 판·같은 높이의
 * 단추**다(`.frm-cmd`) — [파수꾼 관리] ↔ [뒤로 가기]로 바뀔 때 판이 들썩이지 않게.
 *
 * ────────────────────────────────────────────────────────────────
 * 파수꾼 관리 — 부대 편집과 같은 줄 (2026-09-21 지정)
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * 기물   이름            레벨  상태  병기구
 * [King] [S] 가후        Lv5   건강   [검]   [해제]
 * [Rock]  -                                 [선택]
 * ```
 *
 * 줄 수는 농지 레벨(`guardSlots`)이고, 줄의 기물은 **세운 파수꾼의 것 → 없으면 차례대로 남은
 * 기물**(King · Rock · Queen · Bishop · Knight — 부대 편성의 처음 포지션과 같다). [선택]은 부대
 * 편집·대장간 지급과 **같은 장수 일람 팝업**(`OfficerPickModal`)이다 — 줄을 누르면 장수 카드가
 * 뜨고, 부대에 든 장수는 흐리게 못 고른다. 파수꾼 줄을 눌러도 같은 장수 카드가 뜬다.
 *
 * **단추는 한 자리에 하나 — 토글이다** (2026-09-22 지정). 빈 자리는 [선택], 찬 자리는 [해제].
 * 다른 장수로 바꾸려면 [해제] 뒤에 [선택]한다. 다른 자리에 이미 선 파수꾼을 빈 자리에서
 * 고르면 그 장수가 이 자리로 **옮겨 온다**(한 장수가 두 자리에 설 수 없다).
 *
 * **성립하는지는 규칙이 말한다** — 칸 수 · King 필수 · 부대 장수 불가는 `validateGuards()`가
 * 정한다. 파수꾼은 클라이언트 소유라 `PUT`으로 저장된다 — 서버는 전투를 시작할 때
 * `guardsOf()`로 다시 거른다.
 */

import { useEffect, useMemo, useState } from 'react';
import { officerById } from '@samchess/data';
import {
  buildingLevel, equippedBy, grainPerHour, guardSlots, guardsOf, isInjured, officerDuty, officerRankRows,
  setGuards, validateGuards,
} from '@samchess/meta';
import type { PlayerProfile, RosterPick } from '@samchess/meta';
import type { OfficerId, PieceType } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { pickEquipName, pickOfficerName } from '../i18n/story.ts';
import { reasonText } from '../i18n/reason.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { buildingBackdrop } from './backdrop.ts';
import { ItemThumb } from './EquipThumb.tsx';
import { OfficerPickModal } from './OfficerListScreen.tsx';
import { raidStateText } from './raidText.ts';
import { OfficerCardModal, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GradeBadge } from './GradeBadge.tsx';

/** 카운트다운이 초 단위라 1초마다 다시 그린다. 판정엔 안 쓴다 — 마감은 서버가 정한다 */
const REDRAW_MS = 1_000;

/** 빈 자리에 매기는 기물의 차례 — 부대 편성의 처음 포지션(5v5)과 같다 */
const SLOT_PIECES: readonly PieceType[] = ['King', 'Rock', 'Queen', 'Bishop', 'Knight', 'Pawn'];

type View = 'home' | 'guards';

/** 줄 하나 — 세운 파수꾼이 있으면 `officer`가 있다 */
interface Slot { piece: PieceType; officer: OfficerId | null }

/** 농지 레벨만큼의 줄. 세운 파수꾼이 먼저, 빈 줄은 아직 안 쓴 기물을 차례대로 받는다 */
function slotsOf(guards: readonly RosterPick[], count: number): Slot[] {
  const used = new Set(guards.map((g) => g.piece));
  const spare = SLOT_PIECES.filter((p) => !used.has(p));
  const rows: Slot[] = guards.slice(0, count).map((g) => ({ piece: g.piece, officer: g.officer }));
  while (rows.length < count) rows.push({ piece: spare.shift() ?? 'Pawn', officer: null });
  // King 줄은 언제나 맨 위 — 첫 파수꾼이 King이어야 한다는 것이 줄 차례로도 보인다
  return rows.sort((a, b) => Number(b.piece === 'King') - Number(a.piece === 'King'));
}

export function FarmScreen({ profile, onBack, onChange, onFight, fightBusy }: {
  profile: PlayerProfile;
  onBack: () => void;
  /** 파수꾼을 바꾼 계정 — 부르는 쪽이 저장한다 */
  onChange: (next: PlayerProfile) => void;
  /** [도적단 퇴치] — 서버에 시작을 시키고 전투로 가는 일은 App이 한다(메인의 단추와 같은 길) */
  onFight: () => void;
  /** 시작 요청이 가는 중 — 두 번 누르지 못하게 */
  fightBusy: boolean;
}): React.JSX.Element {
  useLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => window.clearInterval(id);
  }, []);
  const [view, setView] = useState<View>('home');
  /** [선택]을 누른 줄의 기물 — 장수 일람 팝업이 떠 있는 동안만 */
  const [picking, setPicking] = useState<PieceType | null>(null);
  const [cardOf, setCardOf] = useState<OfficerId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const level = buildingLevel(profile, 'farm');
  const slotCount = guardSlots(profile);
  const guards = guardsOf(profile);
  const slots = useMemo(() => slotsOf(guards, slotCount), [guards, slotCount]);
  const raid = profile.raid;
  const raidState = raidStateText(raid, now);

  // 장수 카드 — 장수 일람의 「보기」와 같은 카드·같은 행(3v3·5v5 통산)
  const cardRows = useMemo(() => officerRankRows(profile, 'all'), [profile]);
  const card = cardOf ? cardRows.find((r) => r.officer === cardOf) ?? null : null;
  const cardEquip = card ? equippedBy(profile, card.officer) : undefined;

  /** 규칙을 지나서만 저장한다 — 거부되면 그 이유를 그대로 보여 준다 */
  const save = (next: RosterPick[]): void => {
    const check = validateGuards(profile, next);
    if (!check.ok) { setError(reasonText(check)); return; }
    setError(null);
    onChange(setGuards(profile, next));
  };

  /** 빈 자리에 장수를 세운다 — 다른 자리에 있던 파수꾼이면 이 자리로 옮겨 온다 */
  const assign = (piece: PieceType, officer: OfficerId): void => {
    const mine = guards.find((g) => g.piece === piece)?.officer ?? null;
    const next: RosterPick[] = [];
    for (const g of guards) {
      if (g.piece === piece) continue;
      if (g.officer === officer) { if (mine) next.push({ piece: g.piece, officer: mine }); continue; }
      next.push(g);
    }
    next.push({ piece, officer });
    // King을 앞에 — 저장 차례가 곧 현황판의 이름 차례다
    next.sort((a, b) => Number(b.piece === 'King') - Number(a.piece === 'King'));
    save(next);
  };

  const release = (piece: PieceType): void => { save(guards.filter((g) => g.piece !== piece)); };

  const back = (): void => {
    if (view === 'home') { onBack(); return; }
    setError(null);
    setView('home');
  };

  return (
    <ScreenChrome
      backdrop={buildingBackdrop('farm')}
      className="scr-place scr-building-farm"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={back}>
          {stripBackArrow(t(view === 'home' ? 'place.back' : 'farm.backHome'))}
        </button>
        <span className="place-nm">{t('place.farm')}</span>
      </div>

      {/* 현황판 — 두 칸(레벨 | 시간당 군량) 아래 「파수꾼 배치」·「도적단 출현」 두 줄 */}
      <div className="place-panel frm-status" data-field="status">
        <div className="frm-top">
          <span data-field="level">{t('farm.summary.level', { level })}</span>
          <span data-field="grainPerHour">{t('farm.summary.grain', { n: grainPerHour(profile) })}</span>
        </div>
        {level <= 0 ? (
          <p className="hint" data-field="notBuilt">{t('farm.notBuilt')}</p>
        ) : (
          <dl className="frm-info">
            <div className="frm-line" data-field="guards" data-count={guards.length}>
              <dt>{t('farm.info.guards')}</dt>
              <dd>
                <span className="n">{t('farm.info.guardsCount', { n: guards.length, max: slotCount })}</span>
                {/* 현황판에는 **이름만** — 자세한 것은 [파수꾼 관리] 너머에 있다 */}
                <span className="names" data-field="guardNames">
                  {guards.length === 0
                    ? t('farm.info.guardsNone')
                    : guards.map((g) => {
                      const data = officerById.get(g.officer);
                      return data ? pickOfficerName(data) : g.officer;
                    }).join(', ')}
                </span>
              </dd>
            </div>
            <div className="frm-line frm-raid" data-field="raid" data-raid={raid?.status ?? 'none'}>
              <dt>{t('farm.info.raid')}</dt>
              <dd className="v" data-tone={raidState.tone}>{raidState.text}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* 도적단 퇴치 — 싸워야 할 때만 **화면 가운데** 제 판에 뜬다(위아래 `margin: auto`) */}
      {view === 'home' && level > 0 && raid?.status === 'pending' && (
        <section className="place-panel frm-alert" data-field="raidAlertPanel">
          <button className="frm-alert-btn" data-action="raidFight" disabled={fightBusy} onClick={onFight}>
            <span className="lbl">{t('farm.raidFight')}</span>
          </button>
        </section>
      )}

      <div className={`place-body${view === 'guards' ? ' frm-body-guards' : ''}`}>
        {view === 'guards' && (
          <section className="place-panel frm-guards" data-field="guardList">
            <h2 className="cap frm-guards-ttl">{t('farm.manage')}</h2>
            {/* 열 제목 — 부대 현황과 같은 열쇠(같은 뜻, 같은 번역) */}
            <div className="frm-grow frm-thead" aria-hidden="true">
              <span className="pc">{t('squad.col.piece')}</span>
              <span className="nm">{t('officers.col.name')}</span>
              <span className="lv">{t('officers.col.level')}</span>
              <span className="st">{t('squad.col.status')}</span>
              <span className="eq">{t('squad.col.equip')}</span>
              <span className="acts" />
            </div>
            <div className="frm-grows">
              {slots.map((s) => {
                const data = s.officer ? officerById.get(s.officer) : undefined;
                const inst = s.officer ? profile.roster[s.officer] : undefined;
                const pick = (
                  <button
                    className="sqm-pick"
                    data-action="pickGuard"
                    data-piece={s.piece}
                    onClick={(e) => { e.stopPropagation(); setError(null); setPicking(s.piece); }}
                  >
                    {t('squad.pick')}
                  </button>
                );
                if (!s.officer || !data || !inst) {
                  return (
                    <div key={s.piece} className="frm-grow" data-piece={s.piece} data-empty="1">
                      <span className="pc"><span className="frm-pc">{s.piece}</span></span>
                      <span className="frm-dash">-</span>
                      <span className="acts">{pick}</span>
                    </div>
                  );
                }
                const hurt = isInjured(inst, now);
                const eq = equippedBy(profile, s.officer);
                // King은 혼자일 때만 풀 수 있다 — 다른 파수꾼이 남으면 King 없는 편성이 된다
                const locked = s.piece === 'King' && guards.length > 1;
                return (
                  <div
                    key={s.piece}
                    className="frm-grow"
                    data-piece={s.piece}
                    data-officer={s.officer}
                    role="button"
                    tabIndex={0}
                    onClick={() => setCardOf(s.officer)}
                  >
                    <span className="pc"><span className="frm-pc">{s.piece}</span></span>
                    <span className="nm">
                      {/* 사진 대신 등급 배지 — 장수 일람 표와 같은 배지·같은 색(2026-09-22 지정) */}
                      <GradeBadge grade={data.grade} />
                      <span className="nm-text">{pickOfficerName(data)}</span>
                    </span>
                    <span className="lv">Lv{inst.level}</span>
                    <span className="st" data-field="status" data-injured={hurt ? '1' : '0'}>
                      {hurt ? t('squad.status.injured') : t('squad.status.ok')}
                    </span>
                    <span className="eq" data-field="equip" title={eq ? pickEquipName(eq) : t('officers.equip.none')}>
                      {eq ? <ItemThumb item={eq} variant="row" /> : <span className="none">—</span>}
                    </span>
                    <span className="acts">
                      <button
                        className="sqm-pick frm-release"
                        data-action="releaseGuard"
                        data-piece={s.piece}
                        disabled={locked}
                        onClick={(e) => { e.stopPropagation(); release(s.piece); }}
                      >
                        {t('farm.guard.remove')}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            {error && <p className="note" data-field="error">{error}</p>}
          </section>
        )}

        {/* 바닥 명령 판 — 두 걸음이 **같은 판·같은 높이의 단추**다(`.frm-cmd`) */}
        {level > 0 && (
          <section className="place-panel frm-cmd">
            <div className="frg-buttons">
              {view === 'home' ? (
                <button className="btn wide" data-action="manageGuards" onClick={() => { setError(null); setView('guards'); }}>
                  <span className="lbl">{t('farm.manage')}</span>
                </button>
              ) : (
                <button className="btn wide" data-action="backHome" onClick={back}>
                  <span className="lbl">{stripBackArrow(t('match.back'))}</span>
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {picking && (
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('squad.pickTitle', { piece: picking })}
          // 부대에 든 장수는 파수꾼이 될 수 없다(`validateGuards`) — 흐리게, 이유는 글자로
          blocked={(id) => (officerDuty(profile, id) === 'squad' ? t('farm.pick.inSquad') : null)}
          // 거부돼도 닫는다 — 이유는 줄 밑에 뜨는데 팝업이 그 자리를 가린다
          onPick={(officer) => { assign(picking, officer); setPicking(null); }}
          onClose={() => { setPicking(null); setError(null); }}
        />
      )}

      {card && (
        <OfficerCardModal
          row={card}
          onClose={() => setCardOf(null)}
          {...(cardEquip ? { equip: cardEquip } : {})}
        />
      )}
    </ScreenChrome>
  );
}
