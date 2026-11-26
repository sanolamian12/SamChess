/**
 * 전투 결과 — 세 결말과 보상 (GDD §6.4, 2026-08-18 개편 · 2026-10-12 화풍 · 2026-11-26 연출)
 *
 * ────────────────────────────────────────────────────────────────
 * 보상은 **이미 반영된 채로** 온다
 * ────────────────────────────────────────────────────────────────
 *
 * 승 · 무 · 패 모두 전투가 끝나는 순간 계정에 들어가 있고, 이 화면은 그것을 보여 주기만 한다.
 * 무승부의 「셋 중 택1」은 2026-10-27에 없어졌다 — 무승부는 패배와 같은 보상이다(GDD §6.4).
 *
 * ────────────────────────────────────────────────────────────────
 * 두루마리 위로 하나씩 「쿵」 튀어나온다 (2026-11-26 기획자)
 * ────────────────────────────────────────────────────────────────
 *
 * ```
 * 0초     두루마리가 번쩍하며 조금 커졌다 제 크기로 · 「결과표출」         (승리면 승리 곡 + 0.5초 뒤 환호)
 * 1초     큰 글씨 「승 리」 — 같은 강조 · 같은 소리
 * +0.7초  이긴 사유(적 전멸 · 군량고 탈취 · 적 King 격퇴 · 임무 완료) — 같은 강조 · 같은 소리
 * +0.7초씩 받은 보상 줄(군량 +n · 재료 +n · 캐릭터 보상 n명) — **안 준 보상은 줄째 없다**
 * 누르면   글자가 슬며시 사라지고 「보상」이 「승 리」처럼 튀어나온 뒤 → 화면이 어두워지고 캐릭터 보상(장수 모집 결과와 같은 무대)
 * 닫으면   다시 밝아지며 「보상」 아래 받은 장수 줄 → (대전이면) 전과 장
 * ```
 *
 * 줄 하나가 튀어나오는 것과 그 소리는 **같은 타이머 한 번**이 낸다(`ResultScroll`의 `popped`) — CSS 늦춤과 소리 시각을 따로 적으면
 * 둘이 갈린다. 튀어나오는 중에 누르면 남은 줄이 한꺼번에 서고(소리는 그 한 번), 다 선 뒤에 누르면 다음 장이다.
 * 캐릭터 보상이 없으면 「보상」 장은 없다 — 받은 것은 이미 첫 장에 다 적혔다.
 *
 * 두루마리는 승리 = 황금, 무승부·성립 안 함 = 비취, 패배 = 낡은 것(`SKIN`). 글자는 굵은 명조(견명조 결)다 —
 * 웹에서 어느 기기든 같게 「Nanum Myeongjo」 800을 쓰고, 한글 밖의 문자는 언어마다 세리프로 물러난다.
 *
 * **성립하지 않은 판은 결말이 아니다** — 승/무/패 제목도, 보상도, 예상 승률도, 전과도
 * 뜨지 않는다. 뜨면 「무승부를 당했다」로 읽히고, 그건 §5-68이 일부러 안 준 것이다. 그 장은 예전처럼 쓸어 입힌다(`plain`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { officerById } from '@samchess/data';
import { grainCost } from '@samchess/meta';
import type { BattleOutcome, BattleResult, BattleRewards, PlayerProfile, TutorialId } from '@samchess/meta';
import type { BattleMode, Grade } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { OfficerActionArt, OfficerArt } from './OfficerArt.tsx';
import { GradeBadge } from './GradeBadge.tsx';
import { Halo } from './market/parts.tsx';
import { CardRewardReveal } from './market/CardRewardReveal.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { resultBackdrop } from './backdrop.ts';
import type { ResultBackdropId } from './backdrop.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { GameIcon } from './GameIcon.tsx';
import type { GameIconName } from '../ui/gameIcon.ts';
import { playSfx } from '../audio/sfx.ts';

/** 결말 → 메달 (`battle.outcome.*`와 같은 열쇠). 무승부는 전적의 「무」 메달 */
const OUTCOME_ICON: Record<string, GameIconName> = {
  kingDown: 'out-king', wipeOut: 'out-wipe', supplyTaken: 'out-supply', surrender: 'out-surrender',
  timeLimit: 'out-timelimit', draw: 'rec-draw', objective: 'out-objective',
};

/** 큰 글씨 — 「승 리」처럼 한 글자씩 띄운다(한 · 중 · 일, 2026-11-26 기획자) */
const BIG: Record<BattleResult, StringKey> = {
  win: 'result.big.win', draw: 'result.big.draw', lose: 'result.big.lose',
};

/**
 * **이긴 사유** (2026-11-26 기획자) — 적 전멸(도적떼 · 사람 대전 · 공성전) · 군량고 탈취(사람 대전) · 적 King 격퇴(사람 대전 · 공성전) ·
 * 임무 완료(튜토리얼) · 상대 항복 · 판정승. **진 판 · 비긴 판은 사유 줄이 없다**(같은 날 기획자 — 옛 결말 글 「군주 격파」가
 * 진 쪽에서 내가 이긴 것처럼 읽혔고, 비긴 판의 「무승부」는 큰 글씨와 같은 말이다).
 */
const WIN_WHY: Record<string, StringKey> = {
  wipeOut: 'result.why.wipeOut', supplyTaken: 'result.why.supplyTaken', kingDown: 'result.why.kingDown', objective: 'result.why.objective',
  // 같은 날 기획자 — 상대 항복(누른 항복 · 정찰 뒤 이탈 · 턴 넘김 3번이 다 이것) · 판정승(시간 상한의 HP 합)도 사유를 붙인다
  surrender: 'result.why.surrender', timeLimit: 'result.why.timeLimit',
};

/** 이긴 사유 줄의 글 — 넷 밖이면 `null`(줄째 없다) */
export const winWhy = (kind: string | null | undefined): string | null =>
  (kind && WIN_WHY[kind] ? t(WIN_WHY[kind]!) : null);

/** 결말 → 두루마리. 성립하지 않은 판은 무승부와 같은 비취 두루마리다(기획자 지정) */
const SKIN: Record<ResultBackdropId, 'win' | 'draw' | 'lose'> = {
  win: 'win', draw: 'draw', lose: 'lose', void: 'draw',
};

/** 줄이 다 선 뒤 이만큼 머물면 저절로 다음 장 — 누르면 그 전에 넘어간다 */
export const PAGE_MS = 3500;
/** 두루마리가 번쩍하며 서는 시간 — CSS `brs-scroll-pop`과 같은 값 */
export const SCROLL_POP_MS = 600;
/** 두루마리가 선 뒤 첫 줄(큰 글씨)까지 — 「두루마리가 보인 뒤 1초 뒤」 */
export const FIRST_BEAT_MS = 1000;
/** 다음 장의 첫 줄까지 — 앞 장의 글자가 다 사라진 뒤 */
export const NEXT_BEAT_MS = 250;
/** 줄과 줄 사이 */
export const BEAT_STEP_MS = 700;
/** 승리 곡이 시작되고 환호가 얹히기까지 */
export const CHEER_DELAY_MS = 500;
/** 글자가 슬며시 사라지는 시간 — CSS `brs-fade-out`과 같은 값. 다음 장은 그 뒤에 */
export const FADE_OUT_MS = 650;
/** 「보상」이 선 뒤 화면이 어두워지기 시작하기까지 */
export const INTERLUDE_AFTER_MS = 900;
/** 두루마리째 어두워지는 시간 — 사이 연출(캐릭터 보상)은 다 어두워진 뒤에 뜬다 */
export const VEIL_IN_MS = 450;
/** 다시 밝아지는 시간 */
export const VEIL_OUT_MS = 700;
/** 밝아지기 시작하고 받은 장수 줄(`tail`)이 튀어나오기까지 */
const TAIL_AFTER_MS = 300;
/** 성립하지 않은 판의 장 — 예전처럼 쓸어 입히는 시간 */
const WIPE_IN_MS = 800;

type Page = 'title' | 'reward' | 'record';

/**
 * 한 장의 내용.
 * - `beats` — 차례로 「쿵」 튀어나오는 줄들(소리와 함께). 자리는 처음부터 잡혀 있어 줄이 설 때 다른 줄이 밀리지 않는다
 * - `tail` — 사이 연출(캐릭터 보상)이 끝나고 밝아질 때 튀어나오는 줄
 * - `plain` — 튀어나오지 않고 쓸어 입히는 장(전과 · 성립 안 한 판)
 * - `extra` — 장에 함께 그리되 튀어나오지 않는 것(내관의 말)
 */
export interface ResultSheet {
  beats?: readonly React.ReactNode[];
  tail?: React.ReactNode;
  plain?: React.ReactNode;
  extra?: React.ReactNode;
}

/**
 * 결말 제목의 글자 크기(cqw). 다른 언어는 글자 수가 많고 키릴 · 로마자는 넓어 종이를 넘친다(「Ялагдал」 실측).
 * 종이 안쪽 폭(약 70cqw)의 85%에 들게 줄인다 — 한자 · 가나 · 한글은 한 글자가 1em, 나머지(띄어쓰기 포함)는 약 0.65em.
 */
export function titleSize(text: string): number {
  const em = [...text].reduce((n, ch) => n + (/[ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/.test(ch) ? 1 : 0.65), 0);
  return Math.min(15, 60 / Math.max(em, 1));
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** 큰 글씨 한 줄 — 「승 리」 · 「보 상」 자리 */
export function BigLine({ text, max = 15, field }: { text: string; max?: number; field?: string }): React.JSX.Element {
  return <h1 className="brs-ttl" data-field={field} style={{ fontSize: `${Math.min(max, titleSize(text))}cqw` }}>{text}</h1>;
}

/** 사유 한 줄 — 메달이 있으면 앞에 */
function WhyLine({ text, kind, field }: { text: string; kind?: string | undefined; field?: string }): React.JSX.Element {
  const icon = kind ? OUTCOME_ICON[kind] : undefined;
  return (
    <p className="brs-lede" data-outcome={kind} data-field={field}>
      {icon ? <GameIcon name={icon} label={text} text /> : text}
    </p>
  );
}

/**
 * 받은 보상 줄들 — **준 것만**(0이면 줄째 없다, 2026-11-26 기획자). 캐릭터 보상은 이름 없이 수만(「캐릭터 보상 1명」) —
 * 누구인지는 「보상」 장의 연출이 보여 준다. 한 줄씩 튀어나오도록 배열로 돌려준다.
 */
export function gainBeats(given: BattleRewards | null): React.ReactNode[] {
  if (!given) return [];
  const out: React.ReactNode[] = [];
  if (given.grain > 0) {
    out.push(
      <p className="brs-gain" data-field="gain-grain">
        <img src="market/grain.png" alt="" />
        <span className="k">{t('result.grain')}</span> <b className="v" data-field="grain">+{given.grain}</b>
      </p>,
    );
  }
  if (given.materials > 0) {
    out.push(
      <p className="brs-gain" data-field="gain-materials">
        <img src="market/materials.png" alt="" />
        <span className="k">{t('result.materials')}</span> <b className="v" data-field="materials">+{given.materials}</b>
      </p>,
    );
  }
  if (given.cards.length > 0) {
    out.push(
      <p className="brs-gain" data-field="cardCount" data-n={given.cards.length}>
        <img src="market/market_card.png" alt="" />
        <span className="k">{t('result.cardCount', { n: given.cards.length })}</span>
      </p>,
    );
  }
  return out;
}

/** 「보상」 장 — 큰 글씨 「보 상」, 캐릭터 보상 연출이 끝나면 그 아래 받은 장수 줄 */
export function rewardSheet(given: BattleRewards): ResultSheet {
  return {
    beats: [<BigLine key="t" text={t('result.rewards')} max={13} field="rewardsTitle" />],
    tail: <RewardCards cards={given.cards} />,
  };
}

export function ResultScreen({
  profile, mode, result, outcomeKind, rewards, record, voided, onHome,
}: {
  profile: PlayerProfile;
  /** 이 판의 규모 — 환불액(참가비)이 여기서 나온다 */
  mode: BattleMode;
  result: BattleResult;
  /** 결말 글 — 지금은 안 그린다(사유 줄은 `outcomeKind`에서 낸다). 부르는 자리가 여럿이라 받기는 한다 */
  outcome: string;
  /** 결말 판정값 — 사유 줄의 글 · 메달(`WIN_WHY` · `OUTCOME_ICON`) */
  outcomeKind?: string | undefined;
  /** 이미 반영된 보상. 성립하지 않은 판은 `null`이다 */
  rewards: BattleRewards | null;
  /** 판의 기록 — 전과 장이 보여 준다. 성립하지 않은 판은 `null` */
  record: BattleOutcome | null;
  /**
   * **성립하지 않은 판**이다 (GDD §3.9) — 결말도 보상도 전적도 없고 정산만 있다.
   *
   * 화면을 따로 만들지 않고 이 화면을 재사용한다: 나가는 길([도시로])이
   * 이미 여기 있고, 「무슨 일이 있었는지」를 팝업 하나에만 남기면 되짚을 수 없다.
   */
  voided?: { reason: 'left' | 'idle'; refunded: boolean } | null;
  onHome: () => void;
}): React.JSX.Element {
  useLang();
  const cards = !voided && rewards ? rewards.cards : [];
  const pages: Page[] = voided ? ['title', 'reward'] : cards.length > 0 ? ['title', 'reward', 'record'] : ['title', 'record'];
  const bg: ResultBackdropId = voided ? 'void' : result;
  const why = result === 'win' ? winWhy(outcomeKind) : null;

  const render = (page: Page): ResultSheet => {
    if (voided) {
      return {
        plain: page === 'title' ? (
          <>
            <h1 className="brs-ttl small">{t('result.void')}</h1>
            <p className="brs-lede" data-field="voidWhy">{t(`result.void.${voided.reason}`)}</p>
          </>
        ) : (
          <div className="brs-refund" data-field="voidSettle">
            <img src="market/grain.png" alt="" />
            <p data-field="refund">
              {voided.refunded ? t('result.void.refunded', { n: grainCost(mode) }) : t('result.void.kept')}
            </p>
          </div>
        ),
      };
    }
    if (page === 'title') {
      return {
        beats: [
          <BigLine key="big" text={t(BIG[result])} field="verdict" />,
          ...(why ? [<WhyLine key="why" text={why} kind={outcomeKind} field="why" />] : []),
          ...gainBeats(rewards),
        ],
      };
    }
    if (page === 'reward') return rewardSheet(rewards!);
    return { plain: <RecordPage record={record!} /> };
  };

  return (
    <ResultScroll
      bg={bg}
      pages={pages}
      // 받은 장수 카드는 「보상」이 선 뒤 화면을 어둡게 하고 장수 모집 결과와 같은 무대로 (2026-11-26 기획자)
      interlude={cards.length > 0
        ? { at: 'reward', render: (done) => <CardRewardReveal cards={cards} onDone={done} /> }
        : null}
      render={render}
      attrs={{ 'data-screen': 'result', 'data-result': voided ? 'void' : result, 'data-void': voided?.reason }}
      acts={(
        // 나가는 길은 [도시로] 하나 — 폭 전체 (2026-10-12 기획자 지정. [다시 편성]은 걷었다)
        <button className="btn primary wide" data-action="home" onClick={onHome}>
          <span className="lbl">{t('result.home')}</span>
        </button>
      )}
    />
  );
}

/**
 * **튜토리얼 승리** (2026-11-11 기획자) — 대전 · 도적떼를 이겼을 때와 같은 승리 두루마리: 「승 리」 → 「임무 완료」 → 보상.
 * 보상은 처음 끝낸 판만이다(군량 1 · 자재 1 · C~D급 카드 1장, 서버가 이미 반영해 보낸다 — `meta/tutorial.ts`의
 * `completeTutorial`). 다시 한 판이면 보상 줄 대신 「이미 받았다」고 적는다. 전과 장은 없다(전적에 안 센다).
 * 나가는 길은 튜토리얼 목록이다 — 다음 판을 고르러 간다.
 */
export function TutorialResultScreen({ id, rewards, onBack }: {
  id: TutorialId;
  rewards: BattleRewards | null;
  onBack: () => void;
}): React.JSX.Element {
  useLang();
  const cards = rewards?.cards ?? [];
  const pages: ('title' | 'reward')[] = cards.length > 0 ? ['title', 'reward'] : ['title'];
  const render = (page: 'title' | 'reward'): ResultSheet => page === 'title' ? {
    beats: [
      <BigLine key="big" text={t('result.big.win')} field="verdict" />,
      <WhyLine key="why" text={t('result.why.objective')} kind="objective" field="tutorial" />,
      ...(rewards ? gainBeats(rewards) : [<p key="already" className="brs-lede brs-already" data-field="rewards" data-already="1">{t('tut.result.already')}</p>]),
    ],
  } : rewardSheet(rewards!);
  return (
    <ResultScroll
      bg="win"
      pages={pages}
      interlude={cards.length > 0
        ? { at: 'reward', render: (done) => <CardRewardReveal cards={cards} onDone={done} /> }
        : null}
      render={render}
      attrs={{ 'data-screen': 'tutorialResult', 'data-result': 'win', 'data-tutorial': id }}
      acts={(
        <button className="btn primary wide" data-action="tutorials" onClick={onBack}>
          <span className="lbl">{t('tut.result.back')}</span>
        </button>
      )}
    />
  );
}

/**
 * 두루마리 껍데기 — 결말별 배경 · 번쩍 서기 · 줄마다 「쿵」 · 장 넘기기 · 사이 연출 · 마지막 장의 나가는 단추.
 *
 * 대전 결과(`ResultScreen`) · 도적떼 방어전 결과(`RaidResultScreen`) · 튜토리얼 결과가 함께 쓴다.
 * 장의 차례와 내용만 부르는 쪽이 정하고, 시간표(줄 사이 · 머무는 시간 · 사이 연출)는 여기 하나다 —
 * 세 화면이 따로 들고 있으면 한쪽만 낡는다.
 */
export function ResultScroll<P extends string>({ bg, pages, interlude, render, attrs, acts }: {
  bg: ResultBackdropId;
  pages: readonly P[];
  /**
   * **장 사이의 연출** — `at` 장의 줄(`beats`)이 다 선 뒤 한 번 (2026-11-26 기획자: 「보상」 → 캐릭터 보상).
   * 두루마리째 어두워지고(`VEIL_IN_MS`), 다 어두워지면 `render(done)`이 뜬다. `done`이 오면 어둠이 걷히며 그 장의 `tail`이 튀어나온다.
   */
  interlude?: { at: P; render: (done: () => void) => React.ReactNode } | null;
  render: (page: P) => ResultSheet;
  /** 틀(`.brs-frame`)에 다는 `data-*` — 스모크가 고르는 자리 */
  attrs: Record<`data-${string}`, string | undefined>;
  /** 마지막 장에서만 서는 나가는 단추 */
  acts: React.ReactNode;
}): React.JSX.Element {
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  /** 이 장에서 선 줄의 수 — 줄이 서는 것과 그 소리를 **같은 타이머**가 낸다 */
  const [popped, setPopped] = useState(0);
  const [tailShown, setTailShown] = useState(false);
  /** 장 사이 연출의 걸음 — 어두워지는 중 → 연출 → 밝아지는 중 → 끝(`null`) */
  const [veil, setVeil] = useState<'dim' | 'show' | 'lift' | null>(null);
  const [interluded, setInterluded] = useState(false);
  const timers = useRef<number[]>([]);
  const page = pages[idx]!;
  const last = idx === pages.length - 1;
  const held = veil !== null;
  const skin = SKIN[bg];
  const sheet = render(page);
  const beats = sheet.beats ?? [];
  const gated = interlude != null && interlude.at === page && !interluded;
  const settled = popped >= beats.length && (!sheet.tail || tailShown);

  const clearTimers = (): void => { timers.current.forEach((id) => window.clearTimeout(id)); timers.current = []; };

  // 두루마리가 서는 소리 · 승리면 곡 0.5초 뒤 환호 (곡은 `App`이 화면을 바꾸며 이미 틀었다)
  useEffect(() => {
    playSfx('result_pop');
    const cheer = bg === 'win' ? window.setTimeout(() => playSfx('victory_cheer'), CHEER_DELAY_MS) : 0;
    return () => window.clearTimeout(cheer);
  }, [bg]);

  // 이 장의 줄을 하나씩 세운다 — 서는 순간 「결과표출」
  useEffect(() => {
    if (leaving) return undefined;
    const n = (render(pages[idx]!).beats ?? []).length;
    const from = idx === 0 ? SCROLL_POP_MS + FIRST_BEAT_MS : NEXT_BEAT_MS;
    const quick = reducedMotion();
    for (let i = 0; i < n; i++) {
      timers.current.push(window.setTimeout(() => {
        setPopped(i + 1);
        playSfx('result_pop');
      }, quick ? 0 : from + i * BEAT_STEP_MS));
    }
    return clearTimers;
    // 장이 바뀔 때만 — `render`는 렌더마다 새 함수다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, leaving]);

  // 줄이 다 섰고 사이 연출이 걸린 장이면 — 잠시 뒤 어두워진다
  useEffect(() => {
    if (!gated || held || leaving || popped < beats.length) return undefined;
    const id = window.setTimeout(() => { setInterluded(true); setVeil('dim'); }, reducedMotion() ? 0 : INTERLUDE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [gated, held, leaving, popped, beats.length]);

  // 어두워지기 · 밝아지기는 시간으로만 넘어간다. 연출(`show`)은 `done`이 넘긴다. 밝아지기 시작하면 `tail`이 튀어나온다
  useEffect(() => {
    if (veil !== 'dim' && veil !== 'lift') return undefined;
    const quick = reducedMotion();
    const ids: number[] = [];
    if (veil === 'lift') {
      ids.push(window.setTimeout(() => { setTailShown(true); playSfx('result_pop'); }, quick ? 0 : TAIL_AFTER_MS));
    }
    const ms = quick ? 0 : veil === 'dim' ? VEIL_IN_MS : VEIL_OUT_MS;
    ids.push(window.setTimeout(() => setVeil(veil === 'dim' ? 'show' : null), ms));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [veil]);

  const next = useCallback((): void => {
    if (last || held || leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      setIdx((i) => i + 1);
      setPopped(0);
      setTailShown(false);
      setLeaving(false);
    }, reducedMotion() ? 0 : FADE_OUT_MS);
  }, [last, held, leaving]);

  /** 누르기 — 줄이 서는 중이면 남은 줄을 한꺼번에, 사이 연출을 기다리는 중이면 곧장 어둡게, 다 섰으면 다음 장 */
  const tap = (): void => {
    if (held || leaving) return;
    if (popped < beats.length) {
      clearTimers();
      setPopped(beats.length);
      playSfx('result_pop');
      return;
    }
    if (gated) { setInterluded(true); setVeil('dim'); return; }
    next();
  };

  // 다 서면 `PAGE_MS` 뒤 저절로 넘긴다
  useEffect(() => {
    if (last || held || leaving || !settled || gated) return undefined;
    // 안내 내관이 이 장을 말하는 동안은 넘기지 않는다 (2026-11-14 — 첫 결과 안내가 가리킨 보상 칸이 말하는 도중 넘어갔다).
    // 기다리는 내관(`data-phase="wait"`)은 세지 않는다 — 결말 장에서는 내관이 넘어가기를 기다린다(`Steward`의 `HOLD_SELECTOR`)
    let timer = 0;
    const tick = (): void => {
      if (document.querySelector('.stw:not([data-phase="wait"])')) timer = window.setTimeout(tick, 500);
      else next();
    };
    timer = window.setTimeout(tick, PAGE_MS);
    return () => window.clearTimeout(timer);
  }, [idx, last, held, leaving, settled, gated, next]);

  return (
    <ScreenChrome backdrop={resultBackdrop(bg)} className="scr-result" account={currentSession()?.email ?? null}>
      <div className="brs-frame" {...attrs} data-page={page} data-last={last ? '1' : '0'} data-veil={veil ?? undefined}
        data-settled={settled ? '1' : '0'}>
        <div className="brs-stage" data-action="next" onClick={tap}>
          <figure
            className="brs-scroll"
            data-skin={skin}
            style={{ '--brs-pop': `${SCROLL_POP_MS}ms`, '--brs-in': `${WIPE_IN_MS}ms`, '--brs-out': `${FADE_OUT_MS}ms` } as React.CSSProperties}
          >
            {/* 그림자는 세 겹을 **감싼 이 층**에 건다 */}
            <div className="brs-art">
              <img className="brs-paper" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
            </div>
            {/* 서는 순간의 번쩍 — 두루마리 위에 한 번 */}
            <span className="brs-flash" aria-hidden />
            {/* 장이 바뀌면 `key`로 새로 만든다 */}
            <div key={idx} className={`brs-sheet${sheet.plain ? ' plain' : ''}${leaving ? ' out' : ''}${idx === 0 ? ' first' : ''}`}>
              {sheet.plain ?? (
                <>
                  {/* 서기 전의 줄도 자리는 잡아 둔다 — 줄이 설 때 다른 줄이 밀리지 않게 */}
                  {beats.map((b, i) => (
                    <div key={i} className="brs-beat" data-wait={i < popped ? undefined : '1'} aria-hidden={i < popped ? undefined : true}>{b}</div>
                  ))}
                  {sheet.tail && (
                    <div className="brs-beat brs-tail" data-wait={tailShown ? undefined : '1'} aria-hidden={tailShown ? undefined : true}>{sheet.tail}</div>
                  )}
                </>
              )}
              {sheet.extra}
            </div>
          </figure>
          {!last && !held && settled && !gated && <p className="brs-tap">{t('result.tap')}</p>}
        </div>

        {last && !leaving && settled && <div className="brs-acts">{acts}</div>}
      </div>
      {/* 두루마리까지 배경으로 보고 어둡게 — 연출은 이 어둠 위에 뜬다(연출 제 가리개는 `.brs-gacha`가 걷는다) */}
      {veil && <div className="brs-veil" data-veil={veil} style={{ '--brs-veil-in': `${VEIL_IN_MS}ms`, '--brs-veil-out': `${VEIL_OUT_MS}ms` } as React.CSSProperties} />}
      {veil === 'show' && interlude && <div className="brs-gacha">{interlude.render(() => setVeil('lift'))}</div>}
    </ScreenChrome>
  );
}

/**
 * 받은 장수 줄 — 「보상」 장에서 캐릭터 보상 연출이 끝난 뒤 튀어나온다. 장수는 판 위의 꼬마 캐릭터로 서고 이름은 그 오른쪽이다.
 * 줄마다 `data-grade`를 단다: 스모크가 글자가 아니라 속성으로 등급을 본다.
 */
function RewardCards({ cards }: { cards: BattleRewards['cards'] }): React.JSX.Element {
  return (
    <div className="brs-rewards" data-field="rewards">
      <div className="brs-rewardrow" data-cards={cards.length}>
        {cards.map((c, i) => {
          const o = officerById.get(c.officer);
          return (
            <div key={`${c.officer}-${i}`} className="brs-card" data-field="card" data-officer={c.officer} data-grade={c.grade}>
              <span className="brs-card-fig">
                <Halo grade={c.grade as Grade} />
                <OfficerActionArt officer={c.officer} className="brs-chibi" />
              </span>
              <span className="brs-card-id">
                <GradeBadge grade={c.grade} />
                <b>{o ? pickOfficerName(o) : c.officer}</b>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 전과 장 — 출전한 꼬마 장수(판 위의 그 그림)가 줄지어 서고 머리 위에 격파 수, 퇴각한 장수는 흑백이다.
 * 이름 아래의 장수별 통산 승 / 무 / 패(2026-10-12)는 2026-11-20에 걷었다 — 장수 전적 칸이 없어졌다(기획자: 전적은 부대로 본다).
 */
function RecordPage({ record }: { record: BattleOutcome }): React.JSX.Element {
  const fallen = new Set(record.fallen ?? []);
  const mine = record.mySquad ?? t('result.squadNone');
  // AI에게는 부대가 없다 — 이력과 같은 자리에서 「AI」라고 적는다
  const theirs = record.theirSquad ?? (record.opponent === 'ai' ? t('result.ai') : t('result.squadNone'));
  return (
    <div className="brs-record" data-field="record">
      <h2 className="brs-cap">{t('result.vs', { mine, theirs })}</h2>
      <ul className="brs-units" data-n={record.picks.length}>
        {record.picks.map((p) => {
          const o = officerById.get(p.officer);
          const out = fallen.has(p.officer);
          const kills = record.kills?.[p.officer] ?? 0;
          return (
            <li key={p.officer} className={`brs-unit${out ? ' fallen' : ''}`} data-officer={p.officer} data-kills={kills} data-fallen={out ? '1' : '0'}>
              {/* 격파는 아이콘 + 숫자 — 「0 бут цохив」·「3 derrotados」처럼 글자로 적으면 다섯 칸이 서로 겹친다 */}
              <span className="brs-kill" title={t('result.kills', { n: kills })} aria-label={t('result.kills', { n: kills })}>
                <img src="ui/cmd/attack.png" alt="" />{kills}
              </span>
              <span className="brs-fig">
                {/* 퇴각한 장수는 서 있는 그림 그대로 흑백 — 움직이는 것은 살아남은 장수뿐이다 */}
                {out
                  ? <OfficerArt officer={p.officer} className="brs-chibi" primary="portrait" />
                  : <OfficerActionArt officer={p.officer} className="brs-chibi" />}
                {out && <span className="brs-out">{t('result.fallen')}</span>}
              </span>
              <span className="brs-unm">{o ? pickOfficerName(o) : p.officer}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
