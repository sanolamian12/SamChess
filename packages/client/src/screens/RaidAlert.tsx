/**
 * 도적떼 알림 — 메인 위에 뜨는 팝업 셋 (GDD §5.11).
 *
 * | 갈래 | 언제 | 단추 |
 * |---|---|---|
 * | `first` | 출몰을 처음 본 순간(메인 화면) | [항복] · [지금 전투] · [닫기] (파수꾼이 없으면 [지금 전투]가 농지로 보내며 빛난다) |
 * | `lastCall` | 남은 1분 — 어느 메타 화면에서든 | 위와 같다 — 제목만 「곧 마감이다」 |
 * | `settled` | 마감이 지나 서버가 항복으로 정산했다 | [확인] |
 * | `auto` | [자동 전투]를 눌렀다 — 전투력 예측 | [실행] · [취소] |
 * | `autoDone` | 자동 전투를 실행했다 — 같은 대치 판에서 7~8초 미니 전투(`raidFight.ts`) → 「승리!」 / 「패배」 | [확인](연출이 끝나면) |
 *
 * **언제 띄울지는 App이 정한다** — 이 컴포넌트는 그리기만 한다. 남은 시간은 `raidRemainingMs()`
 * (meta)가 내고, 문장은 `raidText.ts`의 것을 쓴다.
 *
 * 짜임 (2026-11-20 기획자) — 맨 위 대치 판(왼쪽 아군 꼬마 · 가운데 쌍검 + 섬광 · 오른쪽 도적 꼬마, 판 밑에
 * 「아군」 · 「적군」, 아무도 안 세웠으면 아군 자리에 주홍 붓 획 「미편성」) → 「승리 시 · 항복 시」 두 줄 → 말풍선 위 「(모래시계) m:ss 후 약탈」 →
 * [항복] · [지금 전투] · [자동 전투] · [닫기]. 옛 [전투 준비]는 닫기와 같은 일이라 [닫기](뒤로 가기 판)로 바꿨다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NPC_OFFICERS } from '@samchess/data';
import { RAID_ABANDON_MS, guardsOf, raidAbandoned, raidAutoForecast, raidLoot, raidRemainingMs, raidWinReward } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { Say } from './Steward.tsx';
import { t, tParts } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { CityBonusMark } from './CityBonus.tsx';
import { OfficerStand, standScale } from './OfficerArt.tsx';
import { animSheetHdUrl, hasArt } from '../ui/art.ts';
import { FRAME_COUNT, FRAME_H, FRAME_SIZE, FRAME_W } from '../battle/animSheet.ts';
import { fighting, fightPose, marchProgress, planRaidFight, timingOf } from './raidFight.ts';
import { playSfx } from '../audio/sfx.ts';
import type { SfxId } from '../audio/sfx.ts';
import type { FightPlan, FightSide } from './raidFight.ts';
import { GameIcon } from './GameIcon.tsx';
import { formatCountdown } from './raidText.ts';

export type RaidAlertKind = 'first' | 'lastCall' | 'settled' | 'auto' | 'autoDone';

/** 「승리 시」 요약 — 「(카드) × 2, (군량) +1」 (2026-11-20 기획자). 정산이 주는 줄(`raidWinReward()`)에서 내고 0인 칸은 안 적는다 */
function WinSummary(): React.JSX.Element {
  const spec = raidWinReward();
  const parts: React.JSX.Element[] = [];
  if (spec.cards.length > 0) parts.push(<span key="c" className="raid-win-part" data-kind="cards" data-n={spec.cards.length}><GameIcon name="res-card" label={t('market.status.cards')} /> × {spec.cards.length}</span>);
  if (spec.materials > 0) parts.push(<span key="m" className="raid-win-part" data-kind="materials" data-n={spec.materials}><GameIcon name="res-materials" label={t('city.materials')} /> +{spec.materials}</span>);
  if (spec.grain > 0) parts.push(<span key="g" className="raid-win-part" data-kind="grain" data-n={spec.grain}><GameIcon name="res-grain" label={t('main.grain')} /> +{spec.grain}</span>);
  return <>{parts.flatMap((el, i) => (i === 0 ? [el] : [<span key={`s${i}`} className="raid-win-sep">,</span>, el]))}</>;
}

/** 앞줄에 서는 꼬마 수 — 넘치면 뒷줄이 앞줄 사이사이(1·2 사이, 2·3 사이)에 조금 높이 선다 (2026-11-20 기획자 — 판을 안 키운다) */
const FRONT = 3;

/** 꼬마 줄 — 앞줄 `FRONT`명, 나머지는 뒷줄. 자리는 CSS 변수(`--x` 칸 수)로 준다 */
function Stands({ ids, flip, fight, march }: {
  ids: readonly string[];
  flip?: boolean;
  /** 자동 전투 연출 중이면 그 쪽 시간표와 경과 시간 — 꼬마가 애니메이션 시트로 움직인다 */
  fight?: { side: FightSide; plan: FightPlan; t: number } | undefined;
  /** 가운데로 나온 거리(px, 부호 포함) — 줄 전체를 민다 */
  march?: number;
}): React.JSX.Element {
  const front = Math.min(ids.length, FRONT);
  return (
    <div className="raid-vs-stands" style={{ '--n': front, ...(march ? { transform: `translateX(${march}px)` } : {}) } as React.CSSProperties}>
      {ids.map((id, i) => {
        const back = i >= FRONT;
        const x = back ? (i - FRONT) + 0.5 : i;
        const unit = fight?.plan.units.find((u) => u.side === fight.side && u.index === i);
        return (
          <span key={id} className={`raid-vs-slot${flip ? ' raid-vs-flip' : ''}`} data-row={back ? 'back' : 'front'}
            style={{ '--x': x } as React.CSSProperties}>
            {fight && unit
              ? <FightSprite officer={id} {...fightPose(fight.plan, unit, fight.t)} />
              : <OfficerStand officer={id} className="raid-vs-stand" />}
          </span>
        );
      })}
    </div>
  );
}

/**
 * 움직이는 꼬마 — 전투 판과 같은 18칸 애니메이션 시트(`anims-hd/`)의 한 칸. 칸이 정사각보다 크므로(머리 위 · 옆 여백)
 * 아래 정사각을 꼬마 자리에 맞추고 여백은 밖으로 내민다(`OfficerActionArt`와 같은 짜임). 앞으로 내미는 거리 `dx`는
 * 칸 안쪽 좌표라 도적(뒤집힌 칸)도 +가 아군 쪽이다. 도적 다섯은 `bandit` 한 벌을 함께 쓴다(`artKey`)
 */
function FightSprite({ officer, frame, dx, down }: { officer: string; frame: number; dx: number; down: boolean }): React.JSX.Element {
  const scale = standScale(officer);
  return (
    <span className="raid-fight-sprite" data-officer={officer} data-frame={frame} data-down={down ? '1' : '0'}
      style={{ transform: `translateX(${dx}rem)${scale !== 1 ? ` scale(${scale})` : ''}` }}>
      {hasArt(officer) && (
        <span className="raid-fight-frame" style={{
          width: `${(FRAME_W / FRAME_SIZE) * 100}%`,
          height: `${(FRAME_H / FRAME_SIZE) * 100}%`,
          left: `${((1 - FRAME_W / FRAME_SIZE) / 2) * 100}%`,
          backgroundImage: `url(${animSheetHdUrl(officer)})`,
          backgroundSize: `${FRAME_COUNT * 100}% 100%`,
          backgroundPosition: `${(frame / (FRAME_COUNT - 1)) * 100}% 0`,
        }} />
      )}
    </span>
  );
}

/**
 * 대치 판 — 고유기술 판(`panel-battle-skill`) 위에 반씩. 꼬마는 전투 시트 0번 칸, 도적은 왼쪽을 본다.
 * 자동 전투 예측(`power`)이면 「아군」 · 「적군」 밑에 전투력을 한 줄씩 단다
 */
function VsBoard({ profile, power, fight, verdict, fieldWhenNone }: {
  profile: PlayerProfile;
  /** 보초병이 없을 때 「미편성」 획 대신 빈 농지 그림(`raid-none`)을 세운다 — 자동 전투의 예측 · 결말 판(2026-11-27 기획자) */
  fieldWhenNone?: boolean;
  power?: { mine: number; theirs: number };
  /** 자동 전투 연출 — 시간표와 경과 시간(ms) */
  fight?: { plan: FightPlan; t: number };
  /** 연출 끝의 큰 글씨 「승리!」 / 「패배」 — 판 위에 겹쳐 찍는다(판 크기는 그대로) */
  verdict?: { win: boolean; shown: boolean };
}): React.JSX.Element {
  const raid = profile.raid!;
  const guards = guardsOf(profile);
  const bandits = NPC_OFFICERS.slice(0, raid.bandits);
  // 가운데까지의 거리 — 판이 그려진 뒤 한 번 잰다(언어 · 인원마다 판 안 자리가 다르다)
  const boardRef = useRef<HTMLDivElement>(null);
  const [reach, setReach] = useState<{ ally: number; foe: number } | null>(null);
  const fightOn = Boolean(fight);
  useLayoutEffect(() => {
    if (!fightOn || !boardRef.current) return;
    const board = boardRef.current;
    const mid = board.querySelector('.raid-vs-mid')!.getBoundingClientRect();
    const center = mid.left + mid.width / 2;
    const gap = parseFloat(getComputedStyle(board).fontSize) * 0.1;
    const ally = board.querySelector('.raid-vs-side.ally .raid-vs-stands:not(.raid-vs-empty)')?.getBoundingClientRect();
    const foe = board.querySelector('.raid-vs-side.foe .raid-vs-stands')?.getBoundingClientRect();
    // 보초병이 없으면 도적은 가운데가 아니라 빈 농지 그림에 **닿을 때까지** 걸어온다(2026-11-27 기획자) —
    // 두 그림 모두 가장자리가 투명해 테두리끼리 맞추면 떨어져 보이므로, 겹쳐 들어가는 만큼(`FIELD_TOUCH` rem) 더 온다
    const field = board.querySelector('.raid-vs-none')?.getBoundingClientRect();
    const target = field ? field.right - gap * (FIELD_TOUCH / 0.1) : center + gap;
    setReach({ ally: ally ? center - gap - ally.right : 0, foe: foe ? target - foe.left : 0 });
  }, [fightOn]);
  const p = fight ? marchProgress(fight.plan, fight.t) : 0;
  const pow = (n: number, field: string): React.JSX.Element => (
    <p className="raid-vs-pow" data-field={field} data-power={n}>
      <GameIcon name="battle-point" label={t('raid.auto.power')} /><span className="raid-vs-pow-n">{n}</span>
    </p>
  );
  return (
    <div className={`raid-vs${fight ? ' raid-vs-fighting' : ''}`} data-field="body" ref={boardRef}
      data-clash={fight && fighting(fight.plan, fight.t) ? '1' : '0'}>
      <div className="raid-vs-side ally" data-field="guards" data-guards={guards.length} data-none={guards.length === 0 ? '1' : '0'}>
        {guards.length > 0
          ? <Stands ids={guards.map((g) => g.officer)} fight={fight && { side: 'ally', ...fight }} march={reach ? reach.ally * p : 0} />
          : fieldWhenNone ? (
            /* 자동 전투 판 — 빈 농지(허수아비) 그림이 아군 자리에 선다. 도적이 이 앞까지 걸어온다 */
            <div className="raid-vs-stands raid-vs-empty">
              <img className="raid-vs-none" data-field="noGuards" src="icons/facility/raid-none.png" alt={t('raid.alert.unassigned')} title={t('raid.alert.unassigned')} />
            </div>
          ) : (
            /* 아무도 안 세웠으면 꼬마 자리에 주홍 붓 획 「미편성」 — 폭은 열 언어 중 가장 긴 말에 맞춰 못 박는다 */
            <div className="raid-vs-stands raid-vs-empty">
              <span className="frm-stroke frm-stroke-locked raid-vs-unassigned" data-field="unassigned">{t('raid.alert.unassigned')}</span>
            </div>
          )}
        <p className="raid-vs-cap"><span className="who">{t('raid.alert.ally')}</span></p>
        {power && pow(power.mine, 'minePower')}
      </div>
      <div className="raid-vs-mid" aria-hidden="true">
        <img className="raid-vs-hit" src="duel/hit.png" alt="" />
        <img className="raid-vs-swords" src="icons/battle.png" alt="" />
      </div>
      <div className="raid-vs-side foe" data-field="bandits" data-n={raid.bandits}>
        <Stands ids={bandits.map((b) => b.id)} flip fight={fight && { side: 'foe', ...fight }} march={reach ? reach.foe * p : 0} />
        <p className="raid-vs-cap"><span className="who">{t('raid.alert.foe')}</span></p>
        {power && pow(power.theirs, 'theirPower')}
      </div>
      {verdict && (
        <p className={`raid-fight-verdict ${verdict.win ? 'win' : 'lose'}`} data-field="fightVerdict" data-win={verdict.win ? '1' : '0'}
          data-shown={verdict.shown ? '1' : '0'}>
          {t(verdict.win ? 'raid.auto.doneWon' : 'raid.auto.doneLost')}
        </p>
      )}
    </div>
  );
}

/** 「(군량) −N」 큰 글씨 — 항복 정산 · 자동 전투 패배가 같이 쓴다 */
function LootBig({ loot }: { loot: number }): React.JSX.Element {
  return (
    <p className="raid-loot-big" data-field="loot" data-loot={loot}>
      <img className="raid-loot-grain" src="market/grain.png" alt={t('main.grain')} title={t('main.grain')} />
      {/* 빼기는 붙임표(-) — 명조(Song Myung)의 「−」(U+2212)는 가늘고 길어 숫자와 떨어져 보인다 */}
      <span className="raid-loot-n">-{loot}</span>
    </p>
  );
}

/** 보초병이 없는 판에서 도적의 칸이 농지 그림 오른쪽 끝을 넘어 들어오는 거리(rem) — 그림끼리 닿아 보이게 */
const FIELD_TOUCH = 0.9;

/** 맞붙은 동안 섞어 트는 소리 */
const CLASH_SFX: readonly SfxId[] = ['attack_sword', 'attack_fist', 'attack_arrow', 'attack_chain', 'forge_clang'];

/** 시트를 미리 받아 둔다 — 예측 판이 열려 있는 동안. 연출 첫 걸음에 그림이 비지 않게 */
function usePreloadSheets(ids: readonly string[]): void {
  const key = ids.join(',');
  useEffect(() => {
    for (const id of ids) if (hasArt(id)) new Image().src = animSheetHdUrl(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * 자동 전투의 결말 — 예측 판과 같은 대치 판에서 미니 전투를 8초 보여 주고(`raidFight.ts`) 「승리!」 / 「패배」를 찍는다.
 * 결말은 이미 서버가 정산했다(`raid.status`) — 연출은 그 값을 보여 줄 뿐이다. 결말 줄 · [확인]은 처음부터 자리를 잡고
 * 보이지만 않다가 끝에 나타난다(판 크기가 출렁이지 않게)
 */
function AutoFight({ profile, onClose }: { profile: PlayerProfile; onClose: () => void }): React.JSX.Element {
  const raid = profile.raid!;
  const won = raid.status === 'won';
  // 전투력은 정산 뒤에도 같다(보초병 · 도적 수는 그대로) — 약탈만 정산 값(`raid.loot`)을 쓴다
  const f = raidAutoForecast(profile)!;
  const [plan] = useState(() => planRaidFight(
    { win: won, mine: f.mine, theirs: f.theirs, allies: guardsOf(profile).length, foes: raid.bandits }, Math.random));
  const tl = timingOf(plan);
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const now = performance.now() - start;
      setMs(Math.min(now, tl.doneMs));
      if (now < tl.doneMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const shown = ms >= tl.verdictMs;
  const after = ms >= tl.afterMs;
  const done = ms >= tl.doneMs;
  // 소리 (2026-11-27 기획자) — 시작에 함성, 양쪽이 만난 때부터 칼 · 주먹 · 활 · 쇠사슬 · 쇠 부딪는 소리를 섞어, 결말 글씨와 함께 징
  useEffect(() => {
    playSfx('roar2');
    const timers: number[] = [];
    if (!plan.empty) {
      const end = tl.marchMs + tl.fightMs;
      for (let at = tl.marchMs; at < end; at += 200 + Math.random() * 260) {
        const id = CLASH_SFX[Math.floor(Math.random() * CLASH_SFX.length)]!;
        timers.push(window.setTimeout(() => playSfx(id, { volume: 0.6 }), at));
      }
    }
    timers.push(window.setTimeout(() => playSfx('duel_gong'), tl.verdictMs));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-back raid-alert" data-modal="raidAlert" data-kind="autoDone">
      <div className="modal frg-confirm raid-alert-box raid-auto-box raid-auto-fight" data-win={won ? '1' : '0'}
        data-done={done ? '1' : '0'} data-survivors={plan.survivors}>
        <p className="modal-ttl">{t('raid.auto.title')}</p>
        <VsBoard profile={profile} power={f} fight={{ plan, t: ms }} verdict={{ win: won, shown }} fieldWhenNone />
        <div className="raid-fight-after" data-shown={after ? '1' : '0'}>
          {/* 자리는 처음부터 잡고 내용은 끝에 그린다 — 약탈 숫자의 「한 번 커졌다 돌아오기」가 보이지 않는 동안 지나가지 않게 */}
          {after && (won
            ? <p className="raid-auto-note" data-field="note">{t('raid.auto.doneWonNote')}</p>
            : <LootBig loot={raid.loot ?? 0} />)}
        </div>
        <div className="frg-confirm-acts raid-acts raid-fight-acts" data-shown={done ? '1' : '0'}>
          <button className="btn wide raid-btn-fight" data-action="raidOk" disabled={!done} onClick={onClose}>
            <span className="lbl">{t('raid.ok')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function RaidAlert({ kind, profile, nowMs, busy, error, onFight, onSurrender, onToFarm, onAuto, onAutoRun, onAutoCancel, onClose }: {
  kind: RaidAlertKind;
  profile: PlayerProfile;
  nowMs: number;
  busy: boolean;
  error: string | null;
  onFight: () => void;
  onSurrender: () => void;
  onToFarm: () => void;
  /** [자동 전투] — 예측 판을 연다 */
  onAuto: () => void;
  /** 예측 판의 [실행] — 보여 준 예측을 함께 보낸다 */
  onAutoRun: (expectWin: boolean) => void;
  /** 예측 판의 [취소] — 알림으로 돌아간다 */
  onAutoCancel: () => void;
  onClose: () => void;
}): React.JSX.Element | null {
  useLang();
  const raid = profile.raid;
  usePreloadSheets(kind === 'auto' && raid
    ? [...guardsOf(profile).map((g) => g.officer), ...NPC_OFFICERS.slice(0, raid.bandits).map((b) => b.id)]
    : []);
  if (!raid) return null;
  const guards = guardsOf(profile);
  // 항복하면 잃는 군량 — 서버가 항복을 정산할 때 부르는 것과 **같은 함수**다
  const loss = raidLoot(profile, raid, profile.grain, raid.bandits);
  const left = formatCountdown(raidRemainingMs(profile, raid, nowMs));

  // ── 자동 전투 (2026-11-27 기획자) — 예측 판 · 결말 판 ──
  if (kind === 'auto') {
    const f = raidAutoForecast(profile)!;
    return (
      <div className="modal-back raid-alert" data-modal="raidAlert" data-kind={kind}>
        <div className="modal frg-confirm raid-alert-box raid-auto-box" data-win={f.win ? '1' : '0'}>
          <p className="modal-ttl">{t('raid.auto.title')}</p>
          <VsBoard profile={profile} power={f} fieldWhenNone />
          <p className={`raid-auto-verdict ${f.win ? 'win' : 'lose'}`} data-field="verdict" data-win={f.win ? '1' : '0'}>
            {t(f.win ? 'raid.auto.win' : 'raid.auto.lose')}
          </p>
          {f.win
            ? <p className="raid-auto-note" data-field="note">{t('raid.auto.winNote')}</p>
            : (
              <>
                <LootBig loot={f.loot} />
                <p className="raid-auto-note" data-field="note">{t('raid.auto.loseNote')}</p>
              </>
            )}
          <Say text={error} level={profile.cityLevel} name="error" repeat />
          <div className="frg-confirm-acts raid-acts">
            <button className="btn wide raid-btn-auto" data-action="raidAutoRun" disabled={busy} onClick={() => onAutoRun(f.win)}>
              <img className="raid-btn-ico" src="icons/officer/opp-ai.png" alt="" />
              <span className="lbl">{t('raid.auto.run')}</span>
            </button>
            <button className="btn wide raid-btn-close" data-action="raidAutoCancel" disabled={busy} onClick={onAutoCancel}>
              <span className="lbl">{t('raid.auto.cancel')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (kind === 'autoDone') return <AutoFight profile={profile} onClose={onClose} />;

  return (
    <div className="modal-back raid-alert" data-modal="raidAlert" data-kind={kind}>
      <div className={`modal frg-confirm raid-alert-box${kind === 'settled' && !raidAbandoned(raid) ? ' raid-alert-loot' : ''}`}>
        {kind === 'settled' ? (
          <>
            {/* 끊긴 판이 60분을 넘겨 정산됐으면 그 까닭을 말한다 (2026-10-15) — 응전 마감을 넘긴 것과 다르다 */}
            <p className="modal-ttl" data-abandoned={raidAbandoned(raid) ? '1' : '0'}>
              {t(raidAbandoned(raid) ? 'raid.abandoned.title' : 'raid.surrendered.title')}
            </p>
            {/* 항복 정산은 문장 없이 「(군량) −N」 큰 글씨 — 숫자는 붉게, 뜨는 순간 한 번 커졌다 돌아온다 (2026-11-23 기획자).
                끊긴 판은 까닭을 말해야 해서 문장 그대로 */}
            {raidAbandoned(raid) ? (
              <p className="frg-confirm-body" data-field="loot" data-loot={raid.loot ?? 0}>
                {t('raid.abandoned.body', { loot: raid.loot ?? 0, min: RAID_ABANDON_MS / 60_000 })}
              </p>
            ) : (
              <LootBig loot={raid.loot ?? 0} />
            )}
            {/* [확인]도 [지금 전투]와 같은 옥색 판이다(2026-09-22 지정) */}
            <div className="frg-confirm-acts raid-acts">
              <button className="btn wide raid-btn-fight" data-action="raidOk" onClick={onClose}>
                <span className="lbl">{t('raid.ok')}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-ttl">{t(kind === 'first' ? 'raid.alert.title' : 'raid.lastCall.title')}</p>
            <VsBoard profile={profile} />
            {/* 「이름 : 값」 두 줄 — 승리 시 · 항복 시 (2026-11-20 기획자). 약탈률 괄호는 걷었다 — 컬렉션이 깎았으면 인장만 */}
            <dl className="raid-info">
              <div className="raid-info-line">
                <dt>{t('raid.alert.k.win')}</dt>
                <dd data-field="win" className="win"><WinSummary /></dd>
              </div>
              <div className="raid-info-line">
                <dt>{t('raid.alert.k.loss')}</dt>
                <dd data-field="loss" data-loss={loss} className="loss">
                  <img className="raid-grain" src="market/grain.png" alt={t('main.grain')} title={t('main.grain')} />
                  <span className="raid-loss-n">−{loss}</span>
                  <span className="raid-rate" data-field="rate">
                    <CityBonusMark profile={profile} keys={['raidLoot']} atMs={raid.spawnedAt} />
                  </span>
                </dd>
              </div>
            </dl>
            {/* 말풍선 위 「(모래시계) m:ss 후 약탈」 — 모래시계는 좌우로 흔들리고 숫자는 숨 쉰다 */}
            <div className="raid-left" data-field="left">
              {tParts<React.ReactNode>('raid.alert.loot', {
                time: (
                  <span key="time" className="raid-left-clock">
                    <img className="raid-left-icon" src="ui/cmd/endTurn.png" alt="" />
                    <span className="raid-left-time">{left}</span>
                  </span>
                ),
              }).map((p, i) => (typeof p === 'string' ? <span key={i} className="raid-left-txt">{p}</span> : p))}
              <CityBonusMark profile={profile} keys={['raidResp']} atMs={raid.spawnedAt} />
            </div>
            <Say text={error} level={profile.cityLevel} name="error" repeat />
            {/* 단추 셋 — [항복](붉은 판) · [지금 전투](옥색 판) · [닫기](뒤로 가기 판).
                파수꾼이 없으면 [지금 전투]가 농지(파수꾼 관리)로 보내며 빛난다 */}
            <div className="frg-confirm-acts raid-acts">
              <button className="btn wide raid-btn-surrender" data-action="raidSurrender" disabled={busy} onClick={onSurrender}>
                <img className="raid-btn-ico" src="icons/raid-surrender.png" alt="" />
                <span className="lbl">{t('raid.surrender')}</span>
              </button>
              <button className="btn wide raid-btn-fight" data-action="raidFightNow" data-lead={guards.length === 0 ? '1' : undefined}
                disabled={busy} onClick={guards.length > 0 ? onFight : onToFarm}>
                <img className="raid-btn-ico" src="icons/battle.png" alt="" />
                <span className="lbl">{t('raid.fightNow')}</span>
              </button>
              {/* [자동 전투] — 금빛 두루마리. 판 없이 전투력으로 결말을 낸다(예측 판을 먼저 띄운다) */}
              <button className="btn wide raid-btn-auto" data-action="raidAuto" disabled={busy} onClick={onAuto}>
                <img className="raid-btn-ico" src="icons/officer/opp-ai.png" alt="" />
                <span className="lbl">{t('raid.auto')}</span>
              </button>
              <button className="btn wide raid-btn-close" data-action="raidClose" onClick={onClose}>
                <span className="lbl">{t('raid.close')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
