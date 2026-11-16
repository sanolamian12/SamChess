/**
 * 농지 — 현황 · 보초병 배치 · 도적단 퇴치 (GDD §5.11, 2026-09-21 → 2026-11-16 기획자 개편)
 *
 * ```
 * [←] 농지
 * ┌ 현황 ─────────────────────────────────┐
 * │   농지 Lv3        │   🌾 +6/시간        │
 * │ 도적단 출현 (3 명)    출현 (09:31 후 전투)│   ← 수는 출몰한 순간에 굳은 값. 상태는 오른쪽 벽 —
 * └──────────────────────────────────────┘      출현 붉음 · 약탈 회색 · 퇴치 완료 파랑(둥근 승리 인장)
 * ┌ 보초병 배치 (1/3 명) ─────────────────┐   ← 들어오자마자 보이고, 여기서 다 한다
 * │ 기물  명단          레벨  상태  병기구   │
 * │ ♚    (꼬마) 가후    Lv5   건강   [검]    │   ← 누르면 장수 카드 — 붉은 [해제하기] · [뒤로 가기]
 * │ ♜    ~~ 대원 지정 가능 ~~(옥색 붓 획)    │   ← 누르면 장수 일람 팝업(줄 → 카드의 [선택하기])
 * │ ♝    ~~ 레벨 4 해금 ~~(주홍 붓 획)       │   ← 자리는 늘 다섯, 못 연 자리는 잠김
 * └──────────────────────────────────────┘
 *          [ 도적단 퇴치 ]                     ← 도적떼가 와 있을 때만
 * ┌ 명령 ─ [ 마을로 가기 ] ─────────────────┐   ← 화면 바닥
 * ```
 *
 * 한 화면이다 — 옛 [보초병 관리] 걸음(2026-09-21 ~ 11-16)은 걷었다. 기물 아이콘을 누르면 기물 바꾸기
 * (King 줄 제외 — 다른 줄의 기물을 고르면 두 줄이 맞바꾼다).
 *
 * 기물 차례는 King 다음 Rock · Bishop · Knight · Pawn(남는 Queen은 바꿀 때 고른다, `layoutOf`). 자리 i는 농지 Lv i+1에
 * 열린다(`guardSlots` = 농지 레벨). 빈 줄에서 바꾼 기물은 저장되지 않는다 — 보초병만 저장된다.
 *
 * **성립하는지는 규칙이 말한다** — 칸 수 · King 필수 · 기물 겹침 · 부대 장수 불가는 `validateGuards()`가
 * 정한다. 보초병은 클라이언트 소유라 `PUT`으로 저장된다 — 서버는 전투를 시작할 때 `guardsOf()`로 다시 거른다.
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
import { CityBonusMark } from './CityBonus.tsx';
import { OfficerStand } from './OfficerArt.tsx';
import { BlinkGlow } from './BlinkGlow.tsx';
import type { BlinkTone } from './BlinkGlow.tsx';
import { pieceArtUrl } from '../ui/pieceIcon.ts';
import { GameIcon, HealthIcon } from './GameIcon.tsx';
import type { GameIconName } from '../ui/gameIcon.ts';
import type { RaidTone } from './raidText.ts';

/** 도적단 상태 — 글 앞의 그림(없음 · 출현 · 약탈 · 퇴치) */
const RAID_TONE_ICON: Record<RaidTone, GameIconName> = { none: 'raid-none', alert: 'raid-alert', looted: 'raid-looted', cleared: 'rec-win' };   // 퇴치 완료 = 튜토리얼 클리어의 둥근 승리 인장(2026-11-16 기획자)

/** 카운트다운이 초 단위라 1초마다 다시 그린다. 판정엔 안 쓴다 — 마감은 서버가 정한다 */
const REDRAW_MS = 1_000;

/** 자리는 늘 다섯 — 농지 레벨이 아직 못 연 자리는 「레벨 N 해금」으로 잠가 둔다(농지 최고 Lv5 = 다섯 자리) */
const ROWS = 5;
/** King 다음 줄의 처음 기물 (2026-11-16 기획자) — 남는 하나(Queen)는 기물을 바꿀 때 고를 수 있다 */
const DEFAULT_PIECES: readonly PieceType[] = ['King', 'Rock', 'Bishop', 'Knight', 'Pawn'];
/** King 줄 밖에서 고를 수 있는 기물 — King은 맨 윗줄에 박혀 있다(보초병에는 King이 있어야 한다) */
const SWAP_PIECES: readonly PieceType[] = ['Rock', 'Queen', 'Bishop', 'Knight', 'Pawn'];

/**
 * 다섯 줄의 기물 — 쓰던 배열(`prev`)이 세운 보초병을 다 품으면 그대로, 아니면 처음 차례에서 다시 낸다.
 * 처음 차례에 없는 기물(Queen)로 선 보초병이 있으면 그 기물이 아직 아무도 안 선 맨 아래 줄을 갈아 낀다.
 * 빈 줄의 기물은 저장되지 않는다(보초병만 저장된다) — 화면을 다시 열면 처음 차례로 돌아온다.
 */
function layoutOf(guards: readonly RosterPick[], prev: readonly PieceType[] | null): PieceType[] {
  const used = guards.map((g) => g.piece);
  if (prev && used.every((p) => prev.includes(p))) return [...prev];
  const out = [...DEFAULT_PIECES];
  for (const p of used) {
    if (out.includes(p)) continue;
    for (let i = out.length - 1; i > 0; i--) {
      if (!used.includes(out[i]!)) { out[i] = p; break; }
    }
  }
  return out;
}

/** 명단 꼬마의 후광 — 부대 관리 명단(`SquadListScreen`)과 같은 표: S급 자주 · A급 흰 별빛 · E급(황제) 금, B~D급은 없다 */
const STAND_GLOW: Partial<Record<string, BlinkTone>> = { S: 'purple', A: 'plain', E: 'gold' };

/** 기물 열 — 영어 이름 대신 아이콘. 부대 현황(`SquadViewScreen`)과 같은 그림, 이름은 `title`로 */
function PieceArt({ piece }: { piece: PieceType }): React.JSX.Element {
  return <img className="frm-piece" src={pieceArtUrl(piece, true)} alt={piece} title={piece} draggable={false} data-field="piece" />;
}

/** `home`은 들어오자마자 보이는 현황(눌러 보기만), `guards`는 [보초병 관리]로 한 번 더 들어간 고치기 */

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
  /** [선택]을 누른 줄의 기물 — 장수 일람 팝업이 떠 있는 동안만 */
  const [picking, setPicking] = useState<PieceType | null>(null);
  const [cardOf, setCardOf] = useState<OfficerId | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 기물을 바꾸려고 누른 줄 — 기물 고르기 팝업이 떠 있는 동안만 */
  const [swapRow, setSwapRow] = useState<number | null>(null);

  const level = buildingLevel(profile, 'farm');
  const slotCount = guardSlots(profile);
  const guards = guardsOf(profile);
  // 다섯 줄의 기물 — 빈 줄에서 바꾼 기물을 기억하려고 상태로 든다. 보초병이 바뀌면 그것을 품게 다시 맞춘다
  const [layoutState, setLayout] = useState<PieceType[] | null>(null);
  const layout = useMemo(() => layoutOf(guards, layoutState), [guards, layoutState]);
  const raid = profile.raid;
  const raidState = raidStateText(profile, now);

  // 장수 카드 — 장수 일람의 「보기」와 같은 카드·같은 행(3v3·5v5 통산)
  const cardRows = useMemo(() => officerRankRows(profile, 'all'), [profile]);
  const card = cardOf ? cardRows.find((r) => r.officer === cardOf) ?? null : null;
  const cardEquip = card ? equippedBy(profile, card.officer) : undefined;
  /** 카드로 연 장수가 세운 보초병이면 그 자리 — 카드에 [해제하기]가 붙는다 */
  const cardGuard = card ? guards.find((g) => g.officer === card.officer) ?? null : null;

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

  /**
   * 줄 `row`의 기물을 `piece`로 — 그 기물이 다른 줄에 있으면 두 줄이 기물을 맞바꾼다(장수는 제 줄에 남는다).
   * 세운 보초병의 기물이 바뀌면 저장하고, 빈 줄끼리면 화면의 배열만 바뀐다.
   */
  const swapPiece = (row: number, piece: PieceType): void => {
    const from = layout[row]!;
    if (from === piece || from === 'King') return;
    const next = [...layout];
    const other = next.indexOf(piece);
    next[row] = piece;
    if (other >= 0) next[other] = from;
    const moved = guards.map((g) => (g.piece === from ? { ...g, piece } : other >= 0 && g.piece === piece ? { ...g, piece: from } : g));
    if (moved.some((g, i) => g.piece !== guards[i]!.piece)) {
      const check = validateGuards(profile, moved);
      if (!check.ok) { setError(reasonText(check)); return; }
      setError(null);
      onChange(setGuards(profile, moved));
    }
    setLayout(next);
  };


  return (
    <ScreenChrome
      backdrop={buildingBackdrop('farm')}
      className="scr-place scr-building-farm"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar">
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('place.back'))}
        </button>
        <span className="place-nm">{t('place.farm')}</span>
      </div>

      {/* 현황판 — 두 칸(레벨 | 🌾 +n/시간) 아래 「도적단 출현」, 그 아래 「파수꾼 배치」와 자리 다섯 */}
      <div className="place-panel frm-status" data-field="status">
        <div className="frm-top">
          <span data-field="level">{t('farm.summary.level', { level })}</span>
          {/* 군량 아이콘 — 장터·병영·출정하기와 같은 그림(`GrainCost`) */}
          <span className="frm-rate" data-field="grainPerHour" data-n={grainPerHour(profile)}>
            {/* 시간당 충전 = 군량 자루 + 「+」(`grain-rate`) */}
            <GameIcon name="grain-rate" label={t('main.grain')} className="frm-rate-icon" />
            {t('farm.summary.grain', { n: grainPerHour(profile) })}
            <CityBonusMark profile={profile} keys={['grainRate']} />
          </span>
        </div>
        {level <= 0 ? (
          <p className="hint" data-field="notBuilt">{t('farm.notBuilt')}</p>
        ) : (
          <dl className="frm-info">
            <div className="frm-line frm-raid" data-field="raid" data-raid={raid?.status ?? 'none'}>
              {/* 도적단 출현 (n 명) — 출몰한 순간에 굳은 수(`raid.bandits`). 도적떼가 없으면 수를 안 붙인다 (2026-11-16 기획자) */}
              <dt><GameIcon name="bandit" label={raid ? t('farm.info.raidCount', { n: raid.bandits }) : t('farm.info.raid')} text /></dt>
              <dd className="v" data-tone={raidState.tone}>
                <GameIcon name={RAID_TONE_ICON[raidState.tone]} label={raidState.text} text />
                {/* 응전 시간 · 약탈률 — 출몰한 순간에 완성돼 있던 것만(meta와 같은 판정 시각) */}
                {raid && <CityBonusMark profile={profile} keys={['raidResp', 'raidLoot']} atMs={raid.spawnedAt} />}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="place-body frm-body-guards">
        {/* 보초병 배치 판 — 들어오자마자 보이고 여기서 다 한다(2026-11-16 기획자). 자리는 늘 다섯, 농지 레벨이 못 연 자리는 잠김.
            빈 자리 「대원 지정 가능」 → 장수 고르기, 찬 줄 → 장수 카드의 [해제하기], 기물 아이콘 → 기물 바꾸기(King 줄 제외) */}
        {level > 0 && (
          <section className="place-panel frm-guards" data-field="guardList">
            {/* 제목 — 「보초병 배치 (n/m 명)」, 왼쪽 벽 (현황판에서 옮겨 왔다) */}
            <h2 className="cap frm-guards-ttl" data-field="guards" data-count={guards.length}>
              <GameIcon name="guard" label={t('farm.info.guardsLabel')} text />{' '}
              <span className="frm-gl-count">{t('farm.info.guardsCount', { n: guards.length, max: slotCount })}</span>
            </h2>
            {/* 열 — 기물 · 명단 · 레벨 · 상태 · 병기구 (2026-11-16 기획자) */}
            <div className="frm-grow frm-thead" aria-hidden="true">
              <span className="pc">{t('squad.col.piece')}</span>
              <span className="nm">{t('squads.col.members')}</span>
              <span className="lv">{t('officers.col.level')}</span>
              <span className="st">{t('squad.col.status')}</span>
              <span className="eq">{t('squad.col.equip')}</span>
            </div>
            <div className="frm-grows">
              {Array.from({ length: ROWS }, (_, i) => {
                const piece = layout[i]!;
                const open = i < slotCount;
                const officer = open ? guards.find((g) => g.piece === piece)?.officer ?? null : null;
                const data = officer ? officerById.get(officer) : undefined;
                const inst = officer ? profile.roster[officer] : undefined;
                // 기물 칸 — 고치는 중이고 열린 자리이며 King 줄이 아니면 눌러서 바꾼다
                const swappable = open && piece !== 'King';
                const pc = swappable ? (
                  <button className="frm-pc-btn" data-action="swapPiece" data-piece={piece} title={t('farm.piece.change')}
                    onClick={(e) => { e.stopPropagation(); setError(null); setSwapRow(i); }}>
                    <PieceArt piece={piece} />
                  </button>
                ) : <PieceArt piece={piece} />;
                if (!open) {
                  // 잠긴 자리 — 주홍 붓 획 위에 「레벨 N 해금」(자리 i는 농지 Lv i+1에 열린다)
                  return (
                    <div key={i} className="frm-grow" data-row={i} data-piece={piece} data-locked="1">
                      <span className="pc">{pc}</span>
                      <span className="frm-slot-wide"><span className="frm-stroke frm-stroke-locked">{t('farm.slot.locked', { n: i + 1 })}</span></span>
                    </div>
                  );
                }
                if (!officer || !data || !inst) {
                  // 빈 자리 — 옥색 붓 획 「대원 지정 가능」. 고치는 중에만 눌린다
                  return (
                    <div key={i} className="frm-grow" data-row={i} data-piece={piece} data-empty="1">
                      <span className="pc">{pc}</span>
                      <span className="frm-slot-wide">
                        <button
                          className="frm-stroke frm-stroke-open"
                          data-action="pickGuard"
                          data-piece={piece}
                          onClick={(e) => { e.stopPropagation(); setError(null); setPicking(piece); }}
                        >
                          {t('farm.slot.open')}
                        </button>
                      </span>
                    </div>
                  );
                }
                const hurt = isInjured(inst, now);
                const eq = equippedBy(profile, officer);
                const glow = STAND_GLOW[data.grade];
                return (
                  <div
                    key={i}
                    className="frm-grow"
                    data-row={i}
                    data-piece={piece}
                    data-officer={officer}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setError(null); setCardOf(officer); }}
                  >
                    <span className="pc">{pc}</span>
                    <span className="nm">
                      {/* 꼬마 + 후광(S 자주 · A 흰 별빛 · E 금, 부대 관리 명단과 같은 표) — 2026-11-16 기획자 */}
                      <span className="frm-stand" data-grade={data.grade}>
                        {glow && <BlinkGlow tone={glow} className="frm-stand-glow" />}
                        <OfficerStand officer={officer} title={pickOfficerName(data)} />
                      </span>
                      <span className="nm-text">{pickOfficerName(data)}</span>
                    </span>
                    <span className="lv">Lv{inst.level}</span>
                    <span className="st" data-field="status" data-injured={hurt ? '1' : '0'}>
                      <HealthIcon hurt={hurt} label={hurt ? t('squad.status.injured') : t('squad.status.ok')} />
                    </span>
                    <span className="eq" data-field="equip" title={eq ? pickEquipName(eq) : t('officers.equip.none')}>
                      {eq ? <ItemThumb item={eq} variant="row" /> : <span className="none">—</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {error && <p className="note" data-field="error">{error}</p>}
          </section>
        )}

        {/* 도적단 퇴치 — 싸워야 할 때만, 현황 아래 제 판에 뜬다 */}
        {/* 끊긴 판(`fighting`)도 같은 자리에 [전투 재개] — 앱이 상태를 보고 재개로 가른다 (2026-10-15) */}
        {level > 0 && (raid?.status === 'pending' || raid?.status === 'fighting') && (
          <section className="place-panel frm-alert" data-field="raidAlertPanel">
            <button className="frm-alert-btn" data-action={raid.status === 'pending' ? 'raidFight' : 'raidResume'}
              disabled={fightBusy} onClick={onFight}>
              <span className="lbl">{t(raid.status === 'pending' ? 'farm.raidFight' : 'raid.resume')}</span>
            </button>
          </section>
        )}

        {/* 바닥 명령 판 — [마을로 가기] 하나(2026-11-16 기획자 — 보초병은 위 판에서 바로 고친다) */}
        <section className="place-panel frm-cmd">
          <div className="frg-buttons">
            <button className="btn wide" data-action="toTown" onClick={onBack}>
              <span className="lbl">{t('farm.toTown')}</span>
            </button>
          </div>
        </section>
      </div>

      {picking && (
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('squad.pickTitle', { piece: picking })}
          // 부대에 든 장수는 파수꾼이 될 수 없다(`validateGuards`) — 흐리게, 이유는 글자로
          blocked={(id) => (officerDuty(profile, id) === 'squad' ? t('farm.pick.inSquad') : null)}
          // 줄을 누르면 카드 — 카드의 [선택하기]가 곧 등록이다. 부대 장수는 줄째로 안 눌린다 (2026-11-16 기획자)
          cardPick
          // 거부돼도 닫는다 — 이유는 줄 밑에 뜨는데 팝업이 그 자리를 가린다
          onPick={(officer) => { assign(picking, officer); setPicking(null); }}
          onClose={() => { setPicking(null); setError(null); }}
        />
      )}

      {/* 기물 바꾸기 — King 밖의 다섯 기물. 다른 줄에 있는 기물을 고르면 두 줄이 맞바꾼다 */}
      {swapRow !== null && (
        <div className="modal-back" data-modal="swapPiece" onClick={() => setSwapRow(null)}>
          <div className="modal frm-swap" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('farm.piece.change')}</p>
            <div className="frm-swap-grid">
              {SWAP_PIECES.map((p) => (
                <button key={p} className="frm-swap-pc" data-piece={p} data-on={layout[swapRow] === p ? '1' : '0'}
                  onClick={() => { swapPiece(swapRow, p); setSwapRow(null); }}>
                  <PieceArt piece={p} />
                  <span>{p}</span>
                </button>
              ))}
            </div>
            <button className="btn wide" data-action="swapCancel" onClick={() => setSwapRow(null)}>
              <span className="lbl">{stripBackArrow(t('match.back'))}</span>
            </button>
          </div>
        </div>
      )}

      {card && (
        <OfficerCardModal
          row={card}
          onClose={() => setCardOf(null)}
          {...(cardEquip ? { equip: cardEquip } : {})}
          {...(cardGuard ? { action: {
            kind: 'release' as const,
            label: t('farm.guard.remove'),
            // King은 혼자일 때만 풀 수 있다 — 다른 보초병이 남으면 King 없는 편성이 된다
            blocked: cardGuard.piece === 'King' && guards.length > 1 ? t('reason.raid.needKing') : null,
            onPress: () => { release(cardGuard.piece); setCardOf(null); },
          } } : {})}
        />
      )}
    </ScreenChrome>
  );
}
