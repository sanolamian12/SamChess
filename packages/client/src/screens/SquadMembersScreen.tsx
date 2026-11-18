/**
 * 부대 편집 — 농지 보초병 배치의 틀을 빌린 한 화면 (pptx 68·71쪽, 2026-09-17 · 2026-11-17 기획자 개편)
 *
 * ```
 * [← 목록으로]                부대 편집
 * ┌ 판 ────────────────────────────────────────┐
 * │ ⚔ 돌격대 구성                               │  ← 부대 관리에서 누른 그 줄을 통째로(`SquadLine`) — 고치는 대로 바뀐다
 * │ [3인] ♚꼬마 ♜꼬마 ♛꼬마              [✔]     │
 * └────────────────────────────────────────────┘
 * ┌ 판 ────────────────────────────────────────┐
 * │ 구성원 변경 (2/3 명)                         │
 * │ 기물   명단        레벨  상태  병기구          │
 * │ ♚     꼬마 가후    Lv1   💪    —             │  ← 찬 줄을 누르면 장수 카드의 [해제하기]
 * │ ♜     ━ 대원 지정 가능 ━                     │  ← 빈 자리(옥색 획) → 장수 고르기
 * │ ♛ …                                        │  ← King 밖의 기물 아이콘은 눌러서 바꾼다
 * │       ━ 자리 없음 ━                          │  ← 3v3의 아래 두 줄은 흐리게
 * └────────────────────────────────────────────┘
 * [ 부대 배치 ] [ 아이템   ]
 * [ 행동 방침 ] [ 부대 저장 ]   ← 행동 방침은 수성군만
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 저장은 [저장] 한 번이다 ★ (2026-11-17 기획자 — 서버와 바뀔 때마다 주고받지 않는다)
 * ────────────────────────────────────────────────────────────────
 *
 * 부대원 · 배치 · 행동 방침 · 아이템을 이 화면이 **들고만 있다**(초안). 배치 편집 · 행동 방침 · 아이템은 이 화면 안의 걸음이고,
 * 거기서 고른 것도 초안으로 돌아온다. [저장]이 `applyDraft()` 하나로 계정에 얹고(`saveSquadSlot` — 덜 찬 부대도 저장된다,
 * 부대원이 없으면 칸을 비운다) 목록으로 간다 — 계정 저장 큐가 `PUT` 한 번을 보낸다. 위쪽 [← 목록으로]는 버리고 나간다(바꿨으면 묻는다).
 *
 * 맨 위 판 · 아이템 · 행동 방침은 **초안을 얹은 계정**(`work`)을 본다 — 「저장하면 이렇게 된다」를 그대로 보인다.
 * 계정을 통째로 들고 있지 않는 이유: 그 사이 군량 · 시간 정산으로 계정이 바뀌어도 낡은 값으로 덮지 않게, 늘 지금 계정 위에 초안을 다시 얹는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 기물 · 장수는 겹칠 수 없다 — 겹치면 맞바꾼다
 * ────────────────────────────────────────────────────────────────
 *
 * 엔진의 유닛 이름이 `{진영}-{기물}`이라 한 부대에 같은 기물이 둘일 수 없다. 기물을 바꾸면 그 기물을 쓰던 줄과 **기물을 맞바꾸고**
 * (장수는 제 줄에 남는다 — 농지와 같다), 다른 줄에 있는 장수를 고르면 **두 줄이 장수를 맞바꾼다.**
 */

import { useMemo, useState } from 'react';
import { equipmentById, marketItemById, officerById } from '@samchess/data';
import {
  PIECE_TYPES, canCarryItem, carriedCount, carryItem, equipOfficer, equipmentIdOfKey, equippedKey, firstSquadPending,
  garrisonMissionPending, heldFor, isInjured, marketHeldCount, marketUnits, officerRankRows, pendingGuide, remapDeployment, saveSquadSlot,
  squadById, squadSlot, teamSize, uncarryItem, unequipOfficer, validateSquad,
} from '@samchess/meta';
import { Say } from './Steward.tsx';
import { guidesEnabled } from './guideScript.ts';
import { useGuide } from './useGuide.tsx';
import type { PlayerProfile, RosterPick, Squad, SquadRole } from '@samchess/meta';
import type { BattleMode, OfficerId, PieceType } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { OfficerPickModal } from './OfficerListScreen.tsx';
import { OfficerCardModal, stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon, HealthIcon } from './GameIcon.tsx';
import { SquadDeployScreen } from './SquadDeployScreen.tsx';
import { Pager } from './PagerButton.tsx';
import { GarrisonPolicyScreen } from './GarrisonPolicyScreen.tsx';
import { SQUAD_ROWS } from './SquadViewScreen.tsx';
import { SquadHead, SquadLine } from './SquadListScreen.tsx';
import { OfficerStand } from './OfficerArt.tsx';
import { BlinkGlow, STAND_GLOW, equipBlink, itemBlink } from './BlinkGlow.tsx';
import type { BlinkTone } from './BlinkGlow.tsx';
import { LevelBadge } from './LevelBadge.tsx';
import { pieceArtUrl } from '../ui/pieceIcon.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { useFitText } from './useFitText.ts';
import { pickEquipName, pickEquipText, pickMarketItemName, pickMarketItemText, pickOfficerName, pickOfficerNameById } from '../i18n/story.ts';

/** 새 부대의 처음 포지션 (2026-09-17 기획자 확정) */
const START_PIECES: Record<BattleMode, PieceType[]> = {
  '3v3': ['King', 'Rock', 'Queen'],
  '5v5': ['King', 'Rock', 'Queen', 'Bishop', 'Knight'],
};
/** King 줄 밖에서 고를 수 있는 기물 — King은 맨 윗줄에 박혀 있다 */
const SWAP_PIECES: readonly PieceType[] = PIECE_TYPES.filter((p) => p !== 'King');


/** 빈 칸을 채울 껍데기 — 칸(모드 · 역할)과 처음 포지션만 있다 (2026-11-14 부대 개편 — 이름 걸음이 없어졌다) */
export function emptySquad(mode: BattleMode, role: SquadRole): Squad {
  return {
    id: squadSlot(mode, role), role, mode,
    picks: START_PIECES[mode].map((piece) => ({ piece, officer: '' as OfficerId })),
    deploy: { P1: null, P2: null }, record: {},
  };
}

/** 줄 하나 — 기물과 장수(빈 자리면 `''`) */
interface Slot { piece: PieceType; officer: OfficerId | '' }

/**
 * 정원만큼의 줄 — King 줄이 맨 위, 저장된 부대원은 그 차례대로, 모자란 줄은 처음 포지션에서 아직 안 쓴 기물로 채운다
 * (덜 찬 부대는 찬 자리만 저장되므로 빈 줄의 기물은 다시 연다).
 */
function slotsOf(squad: Squad): Slot[] {
  const size = teamSize(squad.mode);
  const king = squad.picks.find((p) => p.piece === 'King');
  const out: Slot[] = [{ piece: 'King', officer: king?.officer ?? '' }];
  for (const p of squad.picks) if (p.piece !== 'King') out.push({ piece: p.piece, officer: p.officer });
  for (const piece of [...START_PIECES[squad.mode], ...SWAP_PIECES]) {
    if (out.length >= size) break;
    if (!out.some((s) => s.piece === piece)) out.push({ piece, officer: '' });
  }
  return out.slice(0, size);
}

/**
 * 지닌 것 바꾸기 — **고른 차례대로** 쌓는다(병기 한 자루가 이 장수에서 저 장수로 옮겨 가므로 차례가 뜻을 갖는다).
 * `none`은 회수(병기 · 아이템 둘 다), `weapon`은 자루 키(`forgeOwned`의 키), `item`은 장터 아이템 id
 */
type HeldOp =
  | { officer: OfficerId; kind: 'none' }
  | { officer: OfficerId; kind: 'weapon'; key: string }
  | { officer: OfficerId; kind: 'item'; item: string };

/** 초안 — 부대원 · 배치(만들 때의 부대원과 함께) · 방침 · 아이템 */
interface Draft {
  slots: Slot[];
  /** 배치는 **그 배치를 만든 부대원**과 함께 든다 — 부대원이 바뀌면 줄 차례대로 물려준다(`remapDeployment`) */
  deployFor: RosterPick[];
  deploy: Squad['deploy'];
  policy: Squad['policy'];
  held: HeldOp[];
}

const picksOf = (slots: readonly Slot[]): RosterPick[] =>
  slots.filter((s): s is { piece: PieceType; officer: OfficerId } => s.officer !== '').map((s) => ({ piece: s.piece, officer: s.officer }));

/**
 * **초안을 계정에 얹는다** — 화면이 보는 「저장하면 이렇게 된다」(`work`)와 [저장]이 같은 함수다.
 * 부대 칸은 `saveSquadSlot`(덜 찬 부대도 · 부대원이 없으면 비운다). 지닌 것은 **한 장수에 하나**(GDD §6.5) — 병기를 주면 든 아이템은 보관함으로,
 * 아이템을 주면 낀 병기는 대장간으로(장터 보관함 · 대장간 지급과 같은 규칙). 병기는 그 자루를 쥔 다른 장수에게서 옮겨 온다(`equipOfficer`)
 */
function applyHeld(profile: PlayerProfile, op: HeldOp): PlayerProfile {
  const key = equippedKey(profile, op.officer);
  if (op.kind === 'none') return uncarryItem(key ? unequipOfficer(profile, key) : profile, op.officer);
  if (op.kind === 'weapon') return op.key in profile.forgeOwned ? equipOfficer(uncarryItem(profile, op.officer), op.key, op.officer) : profile;
  if (profile.marketCarry?.[op.officer] === op.item || !canCarryItem(profile, op.officer, op.item).ok) return profile;
  return carryItem(key ? unequipOfficer(profile, key) : profile, op.officer, op.item);
}

function applyDraft(profile: PlayerProfile, squad: Squad, draft: Draft, nowMs?: number): PlayerProfile {
  const picks = picksOf(draft.slots);
  const deploy = remapDeployment(draft.deployFor, picks, draft.deploy);
  let next = saveSquadSlot(profile, {
    mode: squad.mode, role: squad.role, picks, deploy,
    ...(draft.policy ? { policy: draft.policy } : {}),
  }, nowMs);
  for (const op of draft.held) next = applyHeld(next, op);
  return next;
}

export function SquadMembersScreen({ profile, draft: start, base, onChange, onBack, onSave }: {
  profile: PlayerProfile;
  /** 고치는 칸의 부대(빈 칸이면 `emptySquad`) */
  draft: Squad;
  /** 저장돼 있는 원본 — **빈 칸이면 `null`** */
  base: Squad | null;
  /** 안내 무관의 「들었다」 · 장수 고르기 팝업 안의 레벨업 — 초안과 상관없이 곧장 계정에 */
  onChange: (p: PlayerProfile) => void;
  /** 저장하지 않고 나간다 — 부대 관리 목록으로 */
  onBack: () => void;
  /** [저장] — 초안을 지금 계정에 얹는 함수를 넘긴다(시각은 부르는 쪽이 넣는다). `picks`는 농지 파수꾼 확인용 */
  onSave: (apply: (p: PlayerProfile, nowMs: number) => PlayerProfile, picks: RosterPick[]) => void;
}): React.JSX.Element {
  useLang();
  const squad = start;
  const size = teamSize(squad.mode);
  const isNew = base === null;

  const [draft, setDraft] = useState<Draft>(() => ({
    slots: slotsOf(start),
    deployFor: base ? base.picks : [],
    deploy: base ? base.deploy : { P1: null, P2: null },
    policy: base?.policy,
    held: [],
  }));
  const [first] = useState(() => JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== first;

  /** 걸음 — 편집 본판 · 배치 편집 · 행동 방침 */
  const [view, setView] = useState<'main' | 'deploy' | 'policy'>('main');
  /** 장수를 넣을 줄 — 장수 고르기 팝업이 떠 있는 동안만 */
  const [picking, setPicking] = useState<number | null>(null);
  /** 기물을 바꾸려고 누른 줄 */
  const [swapRow, setSwapRow] = useState<number | null>(null);
  /** 카드로 연 장수 — [아이템] · [해제하기] */
  const [cardOf, setCardOf] = useState<OfficerId | null>(null);
  /** 카드의 [아이템]으로 연 고르기 팝업 — 그 장수 */
  const [heldOf, setHeldOf] = useState<OfficerId | null>(null);
  /** 바꾼 채 [← 목록으로]를 눌렀다 */
  const [leaving, setLeaving] = useState(false);
  /** 배치 편집에서 돌아왔다 — 첫 편성이면 [저장]이 빛난다 */
  const [deployed, setDeployed] = useState(false);

  const picks = picksOf(draft.slots);
  const check = validateSquad(profile, { mode: squad.mode, picks });
  const complete = check.ok;
  /** 초안을 얹은 계정 — 맨 위 판 · 아이템 · 행동 방침이 본다 */
  const work = useMemo(() => applyDraft(profile, squad, draft), [profile, squad, draft]);
  const workSquad = squadById(work, squad.id) ?? null;

  const setSlots = (fn: (slots: Slot[]) => Slot[]): void => setDraft((d) => ({ ...d, slots: fn(d.slots) }));
  /** 줄에 장수를 넣는다 — 다른 줄에 있던 장수면 두 줄이 맞바꾼다 */
  const assign = (row: number, officer: OfficerId): void => setSlots((slots) => {
    const mine = slots[row]!.officer;
    return slots.map((s, i) => (i === row ? { ...s, officer } : s.officer === officer ? { ...s, officer: mine } : s));
  });
  const release = (officer: OfficerId): void => setSlots((slots) => slots.map((s) => (s.officer === officer ? { ...s, officer: '' } : s)));
  /** 줄의 기물을 바꾼다 — 그 기물을 쓰던 줄과 기물을 맞바꾼다(장수는 제 줄에 남는다) */
  const swapPiece = (row: number, piece: PieceType): void => setSlots((slots) => {
    const from = slots[row]!.piece;
    if (from === piece || from === 'King') return slots;
    return slots.map((s, i) => (i === row ? { ...s, piece } : s.piece === piece ? { ...s, piece: from } : s));
  });

  // ── 안내 ──
  // 첫 편성(2026-11-13) — 새 3v3 공격대면 무관이 King → Rock → Queen → [부대 배치] → [저장]으로 이끈다
  const [guidesOn] = useState(guidesEnabled);
  const mission = guidesOn && isNew && squad.id === 'atk-3v3' && firstSquadPending(profile);
  const lead = draft.slots.findIndex((s) => !s.officer);
  const filledN = lead < 0 ? draft.slots.length : lead;
  // 수비군 설정 미션(2026-11-13) — 3v3 수성군이 완성돼 있으면 [행동 방침]으로 (옛 부대 현황의 [수비군 설정] 자리)
  const policyMission = guidesOn && squad.id === 'def-3v3' && garrisonMissionPending(profile);
  const quiet = view !== 'main' || picking !== null || swapRow !== null || cardOf !== null || heldOf !== null;
  const guide = useGuide(
    profile, onChange,
    quiet ? null
      : policyMission ? pendingGuide(profile, 'squadView', { squad: true })
        : pendingGuide(profile, 'squadEdit', { squad: isNew && squad.id === 'atk-3v3', filled: filledN }),
    'squadEdit',
  );
  const cueRow = mission && filledN < size ? filledN : null;

  const save = (): void => onSave((p, nowMs) => applyDraft(p, squad, draft, nowMs), picks);

  // ── 걸음: 배치 편집 ──
  if (view === 'deploy') {
    return (
      <SquadDeployScreen
        profile={profile}
        onProfile={onChange}
        mission={mission}
        squad={{ ...squad, picks }}
        // 배치를 만든 부대원에서 지금 부대원으로 줄 차례대로 물려받는다(68·69쪽)
        initial={remapDeployment(draft.deployFor, picks, draft.deploy)}
        isNew={draft.deployFor.length === 0}
        doneLabel={t('squad.deploy.done')}
        onBack={() => setView('main')}
        onSave={(deploy) => { setDraft((d) => ({ ...d, deployFor: picks, deploy })); setDeployed(true); setView('main'); }}
      />
    );
  }

  // ── 걸음: 행동 방침 (수성군) — 초안을 얹은 계정 위에서 고치고, 저장한 방침만 초안으로 가져온다 ──
  if (view === 'policy' && workSquad) {
    return (
      <GarrisonPolicyScreen
        profile={work}
        squad={workSquad}
        onBack={() => setView('main')}
        onChange={(next) => {
          const policy = squadById(next, squad.id)?.policy;
          if (JSON.stringify(policy) !== JSON.stringify(workSquad.policy)) setDraft((d) => ({ ...d, policy }));
          // 안내 무관의 「들었다」는 곧장 계정에 — 초안이 아니다
          if (next.guide !== work.guide) onChange({ ...profile, ...(next.guide ? { guide: next.guide } : {}) });
        }}
      />
    );
  }

  // ── 본판 ──
  const cardRows = cardOf ? officerRankRows(work, 'all') : [];
  const card = cardOf ? cardRows.find((r) => r.officer === cardOf) ?? null : null;
  const now = Date.now();

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-edit scr-squad-members"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadEdit" data-squad={squad.id} data-mode={squad.mode} data-new={isNew ? '1' : '0'} data-dirty={dirty ? '1' : '0'}>
        <button className="btn ghost sm" data-action="back" onClick={() => (dirty ? setLeaving(true) : onBack())}>
          {stripBackArrow(t('squad.cancel'))}
        </button>
        <span className="place-nm">{t('squad.edit.title')}</span>
      </div>

      <div className="place-body sqe-body">
        {/* 맨 위 판 — 부대 관리에서 누른 그 줄을 단 머리째로, 초안대로 */}
        <section className="place-panel sqd-list sqe-top" data-field="line">
          <SquadHead role={squad.role} />
          <SquadLine profile={work} mode={squad.mode} role={squad.role} squad={workSquad} />
        </section>

        {/* 구성원 변경 — 농지 보초병 배치와 같은 줄(기물 · 명단 · 레벨 · 상태 · 병기구), 자리는 늘 다섯 */}
        <section className="place-panel sqe-members" data-field="members">
          <h2 className="cap sqe-ttl" data-field="count" data-count={picks.length}>
            {t('squad.members.title', { n: picks.length, max: size })}
          </h2>
          <div className="frm-grow frm-thead" aria-hidden="true">
            <span className="pc">{t('squad.col.piece')}</span>
            <span className="nm">{t('squads.col.members')}</span>
            <span className="st">{t('squad.col.status')}</span>
            <span className="eq">{t('squad.col.equip')}</span>
          </div>
          <div className="frm-grows">
            {Array.from({ length: SQUAD_ROWS }, (_, i) => {
              if (i >= size) {
                // 3v3의 아래 두 줄 — 자리가 없다(흐리게)
                return (
                  <div key={i} className="frm-grow sqe-row" data-row={i} data-locked="1">
                    <span className="pc" />
                    <span className="frm-slot-wide"><span className="frm-stroke frm-stroke-locked">{t('squad.slot.none')}</span></span>
                  </div>
                );
              }
              const slot = draft.slots[i]!;
              const pc = slot.piece === 'King' ? <PieceArt piece="King" side={squad.role} /> : (
                <button className="frm-pc-btn" data-action="swapPiece" data-field={`piece-${i}`} data-piece={slot.piece} title={t('farm.piece.change')}
                  onClick={(e) => { e.stopPropagation(); setSwapRow(i); }}>
                  <PieceArt piece={slot.piece} side={squad.role} />
                </button>
              );
              const data = slot.officer ? officerById.get(slot.officer) : undefined;
              const inst = slot.officer ? profile.roster[slot.officer] : undefined;
              if (!slot.officer || !data || !inst) {
                return (
                  <div key={i} className="frm-grow sqe-row" data-row={i} data-piece={slot.piece} data-empty="1">
                    <span className="pc">{pc}</span>
                    <span className="frm-slot-wide">
                      <button
                        className="frm-stroke frm-stroke-open" data-action="pickOfficer" data-row={i} data-piece={slot.piece}
                        data-guide-cue={cueRow === i ? '' : undefined}
                        onClick={(e) => { e.stopPropagation(); setPicking(i); }}
                      >
                        {t('squad.slot.open')}
                      </button>
                    </span>
                  </div>
                );
              }
              const hurt = isInjured(inst, now);
              const glow = STAND_GLOW[data.grade];
              return (
                <div
                  key={i} className="frm-grow sqe-row" data-row={i} data-piece={slot.piece} data-officer={slot.officer}
                  role="button" tabIndex={0} onClick={() => setCardOf(slot.officer as OfficerId)}
                >
                  <span className="pc">{pc}</span>
                  <span className="nm">
                    <span className="frm-stand" data-grade={data.grade}>
                      {glow && <BlinkGlow tone={glow} className="frm-stand-glow" />}
                      <OfficerStand officer={data.id} title={pickOfficerName(data)} />
                    </span>
                    <span className="nm-text">{pickOfficerName(data)}</span>
                    <LevelBadge level={inst.level} />
                  </span>
                  <span className="st" data-field="status" data-injured={hurt ? '1' : '0'}>
                    <HealthIcon hurt={hurt} label={hurt ? t('squad.status.injured') : t('squad.status.ok')} />
                  </span>
                  <span className="eq" data-field="held"><HeldThumb profile={work} officer={slot.officer as OfficerId} /></span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 명령 — 한 줄씩(2026-11-17 기획자): 부대 배치 · AI 수비 방침(수성군만) · 변경내용 저장. 아이템은 장수 카드의 [아이템]으로 옮겼다 —
            칸이 넓어져 이름을 다 쓴다 */}
        <section className="place-panel sqd-acts sqe-acts">
          {/* 왜 배치가 안 되는지 — 다 채운 뒤에만 말한다. 채우는 중에 「3명이 필요하다」를 띄우면 방해만 된다 */}
          {/* 다 채운 뒤에만 무관이 말한다(2026-11-19 기획자 — 판 안의 줄을 걷었다) */}
          <Say text={picks.length === size && !check.ok ? check.reason : null} who="army" level={profile.cityLevel} name="why" />
          <div className="sqe-grid">
            {/* [부대 배치] · [AI 수비 방침]은 미색 판(부대 관리의 [뒤로 가기]와 같은 그림), [저장 및 뒤로가기]만 옥색 — 이 화면의 한 수 (2026-11-17 기획자) */}
            <button className="btn" data-action="toDeploy" disabled={!complete}
              data-guide-cue={mission && cueRow === null && complete && !deployed ? '' : undefined} onClick={() => setView('deploy')}>
              <FitLabel text={t('squad.cmd.deploy')} />
            </button>
            <button className="btn" data-action="garrisonPolicy" disabled={squad.role !== 'defense' || !complete}
              data-guide-cue={policyMission && complete ? '' : undefined} onClick={() => setView('policy')}>
              <FitLabel text={t('squad.cmd.policy')} />
            </button>
            <button className="btn primary" data-action="saveSquad" data-guide-cue={mission && deployed ? '' : undefined} onClick={save}>
              <FitLabel text={t('squad.cmd.save')} />
            </button>
          </div>
        </section>
      </div>

      {picking !== null && (
        <OfficerPickModal
          profile={profile}
          onChange={onChange}
          title={t('squad.pickTitle', { piece: draft.slots[picking]!.piece })}
          cardPick
          onPick={(officer) => { assign(picking, officer); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}

      {/* 기물 바꾸기 — King 밖의 다섯 기물. 다른 줄에 있는 기물을 고르면 두 줄이 맞바꾼다 */}
      {swapRow !== null && (
        <div className="modal-back" data-modal="swapPiece" onClick={() => setSwapRow(null)}>
          {/* 목판 팝업(나가기 팝업과 같은 화풍) · 기물 칸은 가는 금테 — 고른 칸의 금빛 네온 · 어두운 칸 바탕은 그대로 (2026-11-17 기획자) */}
          <div className="modal mod-plank frm-swap sqe-swap" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{t('farm.piece.change')}</p>
            <div className="frm-swap-grid">
              {SWAP_PIECES.map((p) => (
                <button key={p} className="frm-swap-pc" data-piece={p} data-on={draft.slots[swapRow]!.piece === p ? '1' : '0'}
                  onClick={() => { swapPiece(swapRow, p); setSwapRow(null); }}>
                  <PieceArt piece={p} side={squad.role} />
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

      {/* 병기 줄(그림 아래 · 책략 위)은 안 넘긴다(`equip` 없음) — 지닌 것은 [아이템] 단추 오른쪽 한 곳에만(2026-11-17 기획자) */}
      {card && (
        <OfficerCardModal
          row={card}
          onClose={() => setCardOf(null)}
          action={{
            kind: 'release', label: t('farm.guard.remove'),
            onPress: () => { release(card.officer as OfficerId); setCardOf(null); },
            // 맨 위 [아이템] — 오른쪽에 지금 지닌 것(없으면 빈 칸), 누르면 병기 · 아이템 고르기. 해제하기는 맨 아래로 (2026-11-17 기획자)
            // 이름만 — 지닌 것 그림은 안 얹는다(누르면 고르기 팝업이 보여 준다, 2026-11-17 기획자)
            lead: {
              label: t('squad.cmd.items'), action: 'heldOpen',
              onPress: () => setHeldOf(card.officer as OfficerId),
            },
          }}
        />
      )}

      {heldOf && (
        <HeldPicker
          profile={work}
          officer={heldOf}
          onPick={(op) => setDraft((d) => ({ ...d, held: [...d.held, op] }))}
          onClose={() => setHeldOf(null)}
        />
      )}

      {leaving && (
        <div className="modal-back" data-modal="leaveSquad" onClick={() => setLeaving(false)}>
          {/* 목판 팝업(환경설정 · 입장과 같은 화풍). [계속 고치기]는 미색 판, [나가기]는 붉은 판 — 「버리고 나간다」 (2026-11-17 기획자).
              폭 · 본문 높이는 가장 긴 언어로 못 박는다(`.sqe-leave`) — 언어마다 팝업 크기가 달라지지 않게 */}
          <div className="modal mod-plank sqe-leave" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl" data-field="leaveTitle">{t('squad.leave.title')}</p>
            {/* 단추 이름 「[저장]」은 줄바꿈으로 안 갈린다 — 첫 줄이든 둘째 줄이든 통째로 (2026-11-17 기획자) */}
            <p className="row" data-field="leaveBody"><LeaveBody /></p>
            <button className="btn wide" data-action="leaveStay" onClick={() => setLeaving(false)}>
              <span className="lbl">{t('squad.leave.no')}</span>
            </button>
            <button className="btn wide sqe-leave-go" data-action="leaveYes" onClick={onBack}>
              <span className="lbl">{t('squad.leave.yes')}</span>
            </button>
          </div>
        </div>
      )}
      {guide.node}
    </ScreenChrome>
  );
}

/**
 * 「바꾼 내용은 [저장]을 눌러야 남습니다.」 — 문구의 `{btn}` 자리에 단추 이름을 **줄바꿈 안 되는 칸**으로 끼운다.
 * 어순 · 조사는 언어마다 문구 표가 정하고(장터 [구매]의 `BuyLabel`과 같은 방식), 화면은 자리만 안다
 */
function LeaveBody(): React.JSX.Element {
  const [before, after = ''] = t('squad.leave.body', { btn: '\u0000' }).split('\u0000');
  // 한 덩어리(span)로 감싼다 — 본문 칸(`.row`)이 flex라 글 조각이 따로 서면 「은 」의 끝 칸이 지워져 「내용은[저장]을」이 됐다
  return <span>{before}<span className="nobr" data-field="leaveBtnName">[{t('squad.cmd.save')}]</span>{after}</span>;
}

/** 기물 아이콘 — 돌격대는 남군 색, 수성군은 북군 색(부대 관리와 같다) */
function PieceArt({ piece, side }: { piece: PieceType; side: SquadRole }): React.JSX.Element {
  return <img className="frm-piece" src={pieceArtUrl(piece, side === 'attack')} alt={piece} title={piece} draggable={false} data-field="piece" />;
}

/** 들고 가는 것 — 아이템이 있으면 아이템, 없으면 병기구(`heldFor`, 판에 실리는 것과 같은 셈) */
function HeldThumb({ profile, officer }: { profile: PlayerProfile; officer: OfficerId }): React.JSX.Element {
  const id = heldFor(profile, officer);
  const item = id ? marketItemById.get(id) : undefined;
  const equip = !item && id ? equipmentById.get(id) : undefined;
  // 병기도 아이템과 같은 정사각 칸 + 후광 — 대장간의 3:1 목록 그림은 안 쓴다(2026-11-17 기획자)
  if (item || equip) {
    return (
      <span className="sqe-item" data-item={id} title={item ? pickMarketItemName(item) : pickEquipName(equip!)}>
        <HeldArt id={id!} />
      </span>
    );
  }
  return <span className="none" title={t('officers.equip.none')}>—</span>;
}

/**
 * 지닌 것 한 칸 — 금테 · 어두운 바탕에 병기 · 아이템 그림. **비었으면 「지급」 그림**(`ic_equip_give`, 2026-11-17 기획자 —
 * 처음엔 흐린 「+」였다). 고르기 팝업의 고정 칸 · 카드의 [아이템] 단추가 같은 칸을 쓴다.
 */
/**
 * 병기 · 아이템 그림 + 뒤의 후광 — 대장간 · 장터와 같은 섬광(`equipBlink` · `itemBlink`, 레벨이 높을수록 자주 · 금).
 * 부대원 줄 · 고르기 팝업의 칸 · 고정 칸이 같은 것을 쓴다. 상자(`.sqe-item` · `.sqh-tile`)가 크기 · 자르기를 정한다.
 */
function HeldArt({ id }: { id: string }): React.JSX.Element | null {
  const item = marketItemById.get(id);
  const equip = item ? undefined : equipmentById.get(id);
  if (!item && !equip) return null;
  return (
    <>
      <BlinkGlow tone={item ? itemBlink(item.unlockLevel) : equipBlink(equip!.unlockLevel)} className="held-glow" />
      <img src={item ? `market-items/${id}.png` : `blacksmith/${id}.png`} alt="" />
    </>
  );
}

function HeldTile({ profile, officer }: { profile: PlayerProfile; officer: OfficerId }): React.JSX.Element {
  const id = heldFor(profile, officer);
  const item = id ? marketItemById.get(id) : undefined;
  const equip = !item && id ? equipmentById.get(id) : undefined;
  if (!item && !equip) {
    return (
      <span className="sqh-tile sqh-empty" data-field="heldTile" data-held="" title={t('squad.held.empty')}>
        <GameIcon name="equip-give" label={t('squad.held.empty')} />
      </span>
    );
  }
  return (
    <span className="sqh-tile" data-field="heldTile" data-held={id} title={item ? pickMarketItemName(item) : pickEquipName(equip!)}>
      <HeldArt id={id!} />
    </span>
  );
}

/**
 * 병기 · 아이템 고르기 — 장수 카드의 [아이템] (2026-11-17 기획자).
 *
 * ```
 * ┌ 목판 ─────────────────────────┐
 * │  「가후」의 병기 · 아이템         │
 * │  [지닌 것 칸]  대감도      [회수] │  ← 고정 칸 · 오른쪽 끝 회수(글자 없이 그림만, 언제나 눌린다)
 * │  (◉ 병기)      (◉ 아이템)       │  ← 동전 토글, 폭 1:1
 * │  ▣ ▣ ▣ ▣ / ▣ ▣ ▣ ▣  ‹ 1/2 ›     │  ← 보유한 것 그림 목록(종류마다 한 칸 · 「n개」, 쪽마다 8) — 누르면 지급
 * │  [ 뒤로 가기 ]                   │
 * └──────────────────────────────┘
 * ```
 *
 * 고른 것은 초안으로 쌓이고(`HeldOp`) 화면은 초안을 얹은 계정(`work`)을 다시 그린다 — 고정 칸 · 남은 수 · 「누가 쥐고 있나」가 곧바로 바뀐다.
 * 계정에 얹히는 것은 [변경내용 저장] 때다.
 */
/** 고르기 팝업 한 쪽의 칸 수 — 넷 × 두 줄 */
const HELD_PAGE = 8;

function HeldPicker({ profile, officer, onPick, onClose }: {
  /** 초안을 얹은 계정 */
  profile: PlayerProfile;
  officer: OfficerId;
  onPick: (op: HeldOp) => void;
  onClose: () => void;
}): React.JSX.Element {
  useLang();
  const carrying = profile.marketCarry?.[officer];
  const myKey = equippedKey(profile, officer);
  const [tab, setTab] = useState<'weapon' | 'item'>(carrying ? 'item' : 'weapon');
  // 병기는 종류마다 한 칸 — 「n개」는 아무도 안 낀 자루 수(아이템의 「남은 수」와 같은 뜻, 2026-11-17 기획자: 표기 통일).
  // 누르면 안 낀 자루 하나를 준다 — 남이 낀 것을 빼앗아 오는 길은 없다(빼려면 그 장수의 카드에서 회수).
  const weaponKeys = Object.keys(profile.forgeOwned).filter((k) => equipmentById.has(equipmentIdOfKey(k))).sort();
  const weapons = [...new Set(weaponKeys.map(equipmentIdOfKey))];
  const freeKeys = (equipId: string): string[] =>
    weaponKeys.filter((k) => equipmentIdOfKey(k) === equipId && !profile.forgeOwned[k]);
  const myWeapon = !carrying && myKey ? equipmentIdOfKey(myKey) : null;
  const items = [...new Set(marketUnits(profile).map((u) => u.item))];
  const left = (item: string): number =>
    marketHeldCount(profile, item) - carriedCount(profile, item) + (carrying === item ? 1 : 0);
  // 한 쪽에 넷 × 두 줄 = 8 — 장터 아이템 16종 · 병기 15종이 두 쪽에 든다(2026-11-17 기획자: 두 줄 + 쪽 줄 = 세 줄).
  // 탭을 열면 지금 지닌 것이 있는 쪽부터
  const list = (k: 'weapon' | 'item'): string[] => (k === 'weapon' ? weapons : items);
  const pageOf = (k: 'weapon' | 'item'): number => {
    const i = list(k).indexOf((k === 'weapon' ? myWeapon : carrying) ?? '');
    return i < 0 ? 0 : Math.floor(i / HELD_PAGE);
  };
  const [page, setPage] = useState(() => pageOf(tab));
  const pickTab = (k: 'weapon' | 'item'): void => { setTab(k); setPage(pageOf(k)); };
  const pageCount = Math.max(1, Math.ceil(list(tab).length / HELD_PAGE));
  const onPage = (xs: string[]): string[] => xs.slice(page * HELD_PAGE, (page + 1) * HELD_PAGE);
  const heldId = heldFor(profile, officer);
  // [설정 완료] — 연 때와 지닌 것이 달라졌으면 「저장되었습니다」 미니 팝업 → [확인]으로 카드에, 그대로면 곧장 카드에 (2026-11-17 기획자).
  // 비교는 「무엇을 쥐었나」(병기는 자루까지) — 바꿨다 되돌린 것은 바뀐 것이 아니다
  const nowKey = carrying ?? myKey ?? '';
  const [openedKey] = useState(nowKey);
  const [savedNote, setSavedNote] = useState(false);
  const finish = (): void => (nowKey !== openedKey ? setSavedNote(true) : onClose());
  const heldItem = heldId ? marketItemById.get(heldId) : undefined;
  const heldEquip = heldId && !heldItem ? equipmentById.get(heldId) : undefined;
  // 이름 밑 줄 — 효과 설명(2026-11-17 기획자: 「병기」 · 「아이템」 대신)
  const heldText = heldItem ? pickMarketItemText(heldItem) : heldEquip ? pickEquipText(heldEquip) : null;
  const heldName = heldId ? (marketItemById.get(heldId) ? pickMarketItemName(marketItemById.get(heldId)!) : pickEquipName(equipmentById.get(heldId)!)) : null;

  return (
    <div className="modal-back" data-modal="heldPick" onClick={finish}>
      <div className="modal mod-plank sqh-pick" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('squad.held.title', { officer: pickOfficerNameById(officer, officer) })}</p>
        {/* 고정 칸 — 왼쪽은 지금 지닌 것, 오른쪽 끝은 회수(같은 크기 · 글자 없이 그림만 — 2026-11-17 기획자).
            회수는 **언제나 눌린다** — 빈손이면 아무 일도 없다(초안에 빈 수를 쌓으면 「저장하지 않고 나갈까요?」가 괜히 뜬다) */}
        {/* 머리 한 줄 — 왼쪽 「보유」(지닌 것 칸 위) · 오른쪽 「회수」(회수 칸 위) (2026-11-17 기획자) */}
        <div className="sqh-now-head" aria-hidden>
          <span>{t('squad.held.head.own')}</span>
          <span>{t('squad.held.head.revoke')}</span>
        </div>
        <div className="sqh-now">
          <HeldTile profile={profile} officer={officer} />
          <span className="sqh-now-txt">
            <b data-field="heldName">{heldName ?? t('squad.held.empty')}</b>
            <small data-field="heldText">{heldText ?? t('squad.held.tapGive')}</small>
          </span>
          <button className="sqh-now-btn" data-action="heldRevoke" onClick={() => (heldId ? onPick({ officer, kind: 'none' }) : undefined)}>
            <span className="sqh-tile"><GameIcon name="equip-revoke" label={t('forge.assign.revoke')} /></span>
          </button>
        </div>
        {/* 병기 | 아이템 — 동전 둘(`ic_equip_tab_*`, 회수 단추와 같은 메달)이 패널 폭을 1:1로. 고른 쪽은 동전에 금빛 네온 · 글자가 빛난다
            (2026-11-17 기획자 — 남군 · 북군 반반 판에서 바꿨다) */}
        <div className="sqh-tabs" role="tablist">
          {(['weapon', 'item'] as const).map((k) => (
            <button key={k} className={`sqh-tab${tab === k ? ' on' : ''}`} role="tab" aria-selected={tab === k}
              data-tab={k} data-on={tab === k ? '1' : '0'} onClick={() => pickTab(k)}>
              <GameIcon name={k === 'weapon' ? 'equip-tab-weapon' : 'equip-tab-item'} label="" />
              <span className="sqh-tab-lbl">{t(k === 'weapon' ? 'squad.held.tab.weapon' : 'squad.held.tab.item')}</span>
            </button>
          ))}
        </div>
        <div className="sqh-grid" data-tab={tab}>
          {tab === 'weapon' && (weapons.length === 0 ? <p className="sqh-none">{t('squad.held.noWeapon')}</p> : onPage(weapons).map((id) => {
            const equip = equipmentById.get(id)!;
            const free = freeKeys(id);
            const mine = myWeapon === id;
            return (
              <button key={id} className="sqh-cell" data-equip={id} data-on={mine ? '1' : '0'} disabled={!mine && free.length === 0} title={pickEquipName(equip)}
                onClick={() => (mine || !free[0] ? undefined : onPick({ officer, kind: 'weapon', key: free[0] }))}>
                <span className="sqh-tile"><HeldArt id={id} /></span>
                <span className="sqh-cap">{t('squad.items.left', { n: free.length })}</span>
              </button>
            );
          }))}
          {tab === 'item' && (items.length === 0 ? <p className="sqh-none">{t('squad.held.noItem')}</p> : onPage(items).map((id) => {
            const item = marketItemById.get(id)!;
            const n = left(id);
            const mine = carrying === id;
            return (
              <button key={id} className="sqh-cell" data-item={id} data-on={mine ? '1' : '0'} disabled={!mine && n <= 0} title={pickMarketItemName(item)}
                onClick={() => (mine ? undefined : onPick({ officer, kind: 'item', item: id }))}>
                <span className="sqh-tile"><HeldArt id={id} /></span>
                <span className="sqh-cap">{t('squad.items.left', { n: Math.max(0, n) })}</span>
              </button>
            );
          }))}
        </div>
        {/* 쪽은 늘 그린다 — 한 쪽뿐이어도 자리를 지켜 탭을 바꿀 때 판 높이가 안 흔들린다 */}
        <Pager page={page} pageCount={pageCount} onPage={setPage} actionPrefix="held" field="heldPager" />
        {/* 옥색 두루마리 [설정 완료] — 옛 [뒤로 가기] (2026-11-17 기획자) */}
        <button className="btn primary wide" data-action="heldClose" onClick={finish}>
          <span className="lbl">{t('squad.held.done')}</span>
        </button>
      </div>
      {savedNote && (
        <div className="modal-back sqh-saved-back" data-modal="heldSaved" onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <div className="modal mod-plank sqh-saved" onClick={(e) => e.stopPropagation()}>
            <p className="sqh-saved-msg">{t('squad.held.saved')}</p>
            {/* 한 줄 전체 — 지금 쥔 것의 이름을 금빛으로, 회수했으면 「미보유」 (2026-11-17 기획자) */}
            <p className="sqh-saved-name" data-field="heldSavedName" data-held={heldId ?? ''}>{heldName ?? t('squad.held.none')}</p>
            <button className="btn primary wide" data-action="heldSavedOk" onClick={onClose}>
              <span className="lbl">{t('squad.held.ok')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 명령 판 단추의 글자 — 부대 관리의 [뒤로 가기]와 같은 크기로 서되, 한 줄에 안 드는 언어는 그 단추만 들 만큼 줄인다
 * (2026-11-18 기획자 — 「크기를 언어마다 통일할 필요는 없다」). 언어 · 글자가 바뀌면 다시 잰다
 */
function FitLabel({ text }: { text: string }): React.JSX.Element {
  const lang = useLang();
  const ref = useFitText<HTMLSpanElement>(`${lang}|${text}`);
  return <span className="lbl" ref={ref}>{text}</span>;
}
