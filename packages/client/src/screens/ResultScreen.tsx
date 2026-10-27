/**
 * 전투 결과 — 세 결말과 보상 (GDD §6.4, 2026-08-18 개편 · 2026-10-12 화풍)
 *
 * ────────────────────────────────────────────────────────────────
 * 보상은 **이미 반영된 채로** 온다
 * ────────────────────────────────────────────────────────────────
 *
 * 승 · 무 · 패 모두 전투가 끝나는 순간 계정에 들어가 있고, 이 화면은 그것을 보여 주기만 한다.
 * 무승부의 「셋 중 택1」은 2026-10-27에 없어졌다 — 무승부는 패배와 같은 보상이다(GDD §6.4).
 *
 * ────────────────────────────────────────────────────────────────
 * 두루마리 한 장을 넘겨 읽는다 (2026-10-12 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 결말마다 다른 배경(`resultBackdrop`) 위에 두루마리가 가운데에서 펼쳐지고, 글자만
 * 지웠다 다시 쓰며 장을 넘긴다: **결말 → 보상 → 전과.** 누르거나 `PAGE_MS`가 지나면
 * 다음 장이다. 나가는 단추 [도시로]는 **마지막 장에서만** 선다.
 *
 * 두루마리는 승리 = 황금, 무승부·성립 안 함 = 비취, 패배 = 낡은 것(`SKIN`). 낙관(勝·和·敗)은
 * 한자를 읽는 사람만 알아봐서 뺐다(기획자 지정).
 *
 * **성립하지 않은 판은 결말이 아니다** — 승/무/패 제목도, 보상도, 예상 승률도, 전과도
 * 뜨지 않는다. 뜨면 「무승부를 당했다」로 읽히고, 그건 §5-68이 일부러 안 준 것이다.
 */

import { useCallback, useEffect, useState } from 'react';
import { officerById } from '@samchess/data';
import { grainCost, totalTally } from '@samchess/meta';
import type { BattleOutcome, BattleResult, BattleRewards, PlayerProfile } from '@samchess/meta';
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
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';
import { GameIcon } from './GameIcon.tsx';
import type { GameIconName } from '../ui/gameIcon.ts';

/** 결말 → 메달 (`battle.outcome.*`와 같은 열쇠). 무승부는 전적의 「무」 메달 */
const OUTCOME_ICON: Record<string, GameIconName> = {
  kingDown: 'out-king', wipeOut: 'out-wipe', supplyTaken: 'out-supply', surrender: 'out-surrender',
  timeLimit: 'out-timelimit', draw: 'rec-draw', objective: 'out-objective',
};

const TITLE: Record<BattleResult, 'result.win' | 'result.draw' | 'result.lose'> = {
  win: 'result.win', draw: 'result.draw', lose: 'result.lose',
};

/** 이번 판으로 오른 전적 칸 — 전과 장이 초록으로 크게 쓴다 */
const BUMP: Record<BattleResult, 'w' | 'd' | 'l'> = { win: 'w', draw: 'd', lose: 'l' };

/** 결말 → 두루마리. 성립하지 않은 판은 무승부와 같은 비취 두루마리다(기획자 지정) */
const SKIN: Record<ResultBackdropId, 'win' | 'draw' | 'lose'> = {
  win: 'win', draw: 'draw', lose: 'lose', void: 'draw',
};

/** 한 장이 머무는 시간 — 누르면 그 전에 넘어간다 */
export const PAGE_MS = 5000;
/** 두루마리가 가운데에서 다 펼쳐지는 시간. 첫 장의 글자는 그 뒤에 쓰인다 */
export const UNROLL_MS = 900;
/** 글자를 쓸어 지우는 시간 — 다음 장은 그 뒤에 들어온다 */
export const WIPE_OUT_MS = 450;
/** 글자를 쓸어 입히는 시간 */
export const WIPE_IN_MS = 800;
/** 두루마리째 어두워지는 시간 — 사이 연출(받은 카드 공개)은 다 어두워진 뒤에 뜬다 */
export const VEIL_IN_MS = 450;
/** 다시 밝아지는 시간 — 다음 장의 글자를 쓸어 입히는 시간과 같다(밝아지며 글자가 쓰인다) */
export const VEIL_OUT_MS = WIPE_IN_MS;

type Page = 'title' | 'reward' | 'record';

/**
 * 결말 제목의 글자 크기(cqw). 한국어 「승리」는 붓글씨로 크게 쓰는데, 다른 언어는 글자 수가 많고
 * 붓글씨 서체가 없는 글자(키릴 · 로마자)는 넓은 세리프로 물러나 종이를 넘친다(「Ялагдал」 실측).
 * 종이 안쪽 폭(약 70cqw)의 85%에 들게 줄인다 — 한자 · 가나 · 한글은 한 글자가 1em, 나머지는 약 0.65em.
 */
export function titleSize(text: string): number {
  const em = [...text].reduce((n, ch) => n + (/[\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(ch) ? 1 : 0.65), 0);
  return Math.min(17, 60 / Math.max(em, 1));
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function ResultScreen({
  profile, mode, result, outcome, outcomeKind, rewards, record, voided, onHome,
}: {
  profile: PlayerProfile;
  /** 이 판의 규모 — 환불액(참가비)이 여기서 나온다 */
  mode: BattleMode;
  result: BattleResult;
  outcome: string;
  /** 결말 판정값 — 결말 줄 앞의 메달(`OUTCOME_ICON`) */
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
  const pages: Page[] = voided ? ['title', 'reward'] : ['title', 'reward', 'record'];

  const bg: ResultBackdropId = voided ? 'void' : result;

  const render = (page: Page): React.ReactNode => {
    let sheet: React.ReactNode;
    if (voided) {
      sheet = page === 'title' ? (
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
      );
    } else if (page === 'title') {
      sheet = (
        <>
          <h1 className="brs-ttl" style={{ fontSize: `${titleSize(t(TITLE[result]))}cqw` }}>{t(TITLE[result])}</h1>
          {outcome && (
            <p className="brs-lede" data-outcome={outcomeKind}>
              {outcomeKind && OUTCOME_ICON[outcomeKind] ? <GameIcon name={OUTCOME_ICON[outcomeKind]!} label={outcome} text /> : outcome}
            </p>
          )}
        </>
      );
    } else if (page === 'reward') {
      sheet = <RewardsPage given={rewards} />;
    } else {
      sheet = <RecordPage record={record!} profile={profile} />;
    }
    return sheet;
  };

  return (
    <ResultScroll
      bg={bg}
      pages={pages}
      // 받은 장수 카드는 카드 판으로 — 결말 장과 보상 장 사이에 (2026-10-15 · 10-20 기획자 지정, 농지 승리와 같다)
      interlude={!voided && rewards && rewards.cards.length > 0
        ? { at: 'reward', render: (done) => <CardRewardReveal cards={rewards.cards} onDone={done} /> }
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
 * 두루마리 껍데기 — 결말별 배경 · 펼침 · 장 넘기기 · 마지막 장의 나가는 단추.
 *
 * 대전 결과(`ResultScreen`)와 도적떼 방어전 결과(`RaidResultScreen`, 2026-10-13)가 함께 쓴다.
 * 장의 차례와 내용만 부르는 쪽이 정하고, 넘기는 시간표(`PAGE_MS` · 펼침 · 쓸어 입히기)는 여기 하나다 —
 * 두 화면이 따로 들고 있으면 한쪽만 낡는다.
 */
export function ResultScroll<P extends string>({ bg, pages, interlude, render, attrs, acts }: {
  bg: ResultBackdropId;
  pages: readonly P[];
  /**
   * **장 사이의 연출** — `at` 장으로 넘어갈 때 한 번 (2026-10-20 기획자 지정: 받은 카드 공개).
   * 앞 장의 글자를 지운 뒤 두루마리째 어두워지고(`VEIL_IN_MS`), 다 어두워지면 `render(done)`이 뜬다.
   * `done`이 오면 어둠이 걷히면서 `at` 장의 글자가 쓰인다 — 연출 동안 그 장의 글자는 그리지 않는다.
   */
  interlude?: { at: P; render: (done: () => void) => React.ReactNode } | null;
  render: (page: P) => React.ReactNode;
  /** 틀(`.brs-frame`)에 다는 `data-*` — 스모크가 고르는 자리 */
  attrs: Record<`data-${string}`, string | undefined>;
  /** 마지막 장에서만 서는 나가는 단추 */
  acts: React.ReactNode;
}): React.JSX.Element {
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  /** 장 사이 연출의 걸음 — 어두워지는 중 → 연출 → 밝아지는 중 → 끝(`null`) */
  const [veil, setVeil] = useState<'dim' | 'show' | 'lift' | null>(null);
  const [interluded, setInterluded] = useState(false);
  const page = pages[idx]!;
  const last = idx === pages.length - 1;
  const held = veil !== null;
  const veiled = veil === 'dim' || veil === 'show';
  const skin = SKIN[bg];

  const next = useCallback((): void => {
    if (last || held || leaving) return;
    const out = reducedMotion() ? 0 : WIPE_OUT_MS;
    const gate = interlude != null && !interluded && pages[idx + 1] === interlude.at;
    setLeaving(true);
    window.setTimeout(() => {
      setIdx((i) => i + 1);
      setLeaving(false);
      if (gate) { setInterluded(true); setVeil('dim'); }
    }, out);
  }, [last, held, leaving, interlude, interluded, pages, idx]);

  // 어두워지기 · 밝아지기는 시간으로만 넘어간다. 연출(`show`)은 `done`이 넘긴다
  useEffect(() => {
    if (veil !== 'dim' && veil !== 'lift') return;
    const ms = reducedMotion() ? 0 : veil === 'dim' ? VEIL_IN_MS : VEIL_OUT_MS;
    const timer = window.setTimeout(() => setVeil(veil === 'dim' ? 'show' : null), ms);
    return () => window.clearTimeout(timer);
  }, [veil]);

  // 장마다 `PAGE_MS` 뒤 저절로 넘긴다. 첫 장은 두루마리가 펼쳐지는 시간만큼 더 머문다
  useEffect(() => {
    if (last || held || leaving) return;
    const extra = idx === 0 && !reducedMotion() ? UNROLL_MS : 0;
    const timer = window.setTimeout(next, PAGE_MS + extra);
    return () => window.clearTimeout(timer);
  }, [idx, last, held, leaving, next]);

  return (
    <ScreenChrome backdrop={resultBackdrop(bg)} className="scr-result" account={currentSession()?.email ?? null}>
      <div className="brs-frame" {...attrs} data-page={page} data-last={last ? '1' : '0'} data-veil={veil ?? undefined}>
        <div className="brs-stage" data-action="next" onClick={next}>
          <figure
            className="brs-scroll"
            data-skin={skin}
            style={{
              '--brs-unroll': `${UNROLL_MS}ms`, '--brs-in': `${WIPE_IN_MS}ms`, '--brs-out': `${WIPE_OUT_MS}ms`,
            } as React.CSSProperties}
          >
            {/* 그림자는 세 겹을 **감싼 이 층**에 건다 — 그림마다 걸면 펼침의 `clip-path`가 그림자를 그림 상자(네모)로 자른다 */}
            <div className="brs-art">
              <img className="brs-paper" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
              <img className="brs-roll l" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
              <img className="brs-roll r" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
            </div>
            {/* 장이 바뀌면 `key`로 새로 만든다 — 쓸어 입히는 애니메이션이 처음부터 다시 돈다 */}
            {/* 장 사이 연출 동안은 다음 장의 글자를 그리지 않는다 — 밝아지기 시작할 때 새로 붙어 쓸어 입혀진다 */}
            {!veiled && (
              <div key={idx} className={`brs-sheet${leaving ? ' out' : ''}${idx === 0 ? ' first' : ''}`}>
                {render(page)}
              </div>
            )}
          </figure>
          {!last && !held && <p className="brs-tap">{t('result.tap')}</p>}
        </div>

        {last && !leaving && <div className="brs-acts">{acts}</div>}
      </div>
      {/* 두루마리까지 배경으로 보고 어둡게 — 연출은 이 어둠 위에 뜬다(연출 제 가리개는 `.brs-gacha`가 걷는다) */}
      {veil && <div className="brs-veil" data-veil={veil} style={{ '--brs-veil-in': `${VEIL_IN_MS}ms`, '--brs-veil-out': `${VEIL_OUT_MS}ms` } as React.CSSProperties} />}
      {veil === 'show' && interlude && <div className="brs-gacha">{interlude.render(() => setVeil('lift'))}</div>}
    </ScreenChrome>
  );
}

/**
 * 보상 장 — 「승리」처럼 **「보상」을 크게** 쓰고, 그 아래 한 줄에 **장수 · 군량 · 재료** (2026-10-12 기획자 지정).
 * 받은 장수는 카드 액자가 아니라 **판 위의 꼬마 캐릭터**로 서고 이름은 그 오른쪽이다. 카드가 2장(승리에서 C·D가 나와 덤이
 * 붙은 경우)이어도 한 줄에 들도록 군량 · 재료는 아이콘 아래 글자로 세운다 — 옆으로 눕히면 종이 폭을 넘는다.
 */
export function RewardsPage({ given }: { given: BattleRewards | null }): React.JSX.Element {
  const cards = given?.cards ?? [];
  return (
    <div className="brs-rewards" data-field="rewards">
      <h1 className="brs-ttl brs-ttl-sub" style={{ fontSize: `${Math.min(12, titleSize(t('result.rewards')))}cqw` }}>
        {t('result.rewards')}
      </h1>
      <div className="brs-rewardrow" data-cards={cards.length}>
        {/* 줄마다 `data-grade`를 단다: 스모크가 글자가 아니라 속성으로 등급을 본다 */}
        {cards.map((c, i) => {
          const o = officerById.get(c.officer);
          return (
            <div
              key={`${c.officer}-${i}`}
              className="brs-card"
              data-field="card" data-officer={c.officer} data-grade={c.grade}
              style={{ animationDelay: `${250 + i * 160}ms` }}
            >
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
        {cards.length === 0 && <p className="brs-nocard" data-field="card">{t('result.noCard')}</p>}
        {/* 군량 · 재료 — 카드가 2장이면 두 줄로 겹쳐 한 칸이 된다(`style.css`의 `[data-cards="2"]`) */}
        <div className="brs-gainset">
          <div className="brs-gain">
            <img src="market/grain.png" alt="" />
            <span><span className="k">{t('result.grain')}</span>{' '}
              <b className="v" data-field="grain">{given && given.grain > 0 ? `+${given.grain}` : t('result.none')}</b></span>
          </div>
          <div className="brs-gain">
            <img src="market/materials.png" alt="" />
            <span><span className="k">{t('result.materials')}</span>{' '}
              <b className="v" data-field="materials">{given && given.materials > 0 ? `+${given.materials}` : t('result.none')}</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 전과 장 — 출전한 꼬마 장수(판 위의 그 그림)가 줄지어 서고 머리 위에 격파 수, 퇴각한 장수는 흑백이다.
 * 이름 아래는 그 장수의 **통산 승 / 무 / 패**이고, **이번 판으로 오른 칸**을 초록으로 조금 크게 쓴다 (2026-10-12 기획자 지정 —
 * 예상 승률 · 전투력 줄을 이것으로 갈았다. 예상 승률은 이력에 그대로 남는다). 합은 meta의 `totalTally()`가 낸다 —
 * 화면이 전적 칸을 직접 더하지 않는다(「한 번만 세고 표는 합으로 낸다」). 보상이 이미 반영된 계정을 읽으므로 이번 판이 들어 있다.
 */
function RecordPage({ record, profile }: { record: BattleOutcome; profile: PlayerProfile }): React.JSX.Element {
  const fallen = new Set(record.fallen ?? []);
  const mine = record.mySquad ?? t('result.squadNone');
  // AI에게는 부대가 없다 — 이력과 같은 자리에서 「AI」라고 적는다
  const theirs = record.theirSquad ?? (record.opponent === 'ai' ? t('result.ai') : t('result.squadNone'));
  const bump = BUMP[record.result];
  return (
    <div className="brs-record" data-field="record">
      <h2 className="brs-cap">{t('result.vs', { mine, theirs })}</h2>
      <ul className="brs-units" data-n={record.picks.length}>
        {record.picks.map((p) => {
          const o = officerById.get(p.officer);
          const out = fallen.has(p.officer);
          const kills = record.kills?.[p.officer] ?? 0;
          const inst = profile.roster[p.officer];
          const tally = inst ? totalTally(inst) : null;
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
              {tally && (
                <span className="brs-wdl" data-field="wdl" data-w={tally.wins} data-d={tally.draws} data-l={tally.losses} data-bump={bump}>
                  <b className={bump === 'w' ? 'up' : ''}>{tally.wins}</b> / <b className={bump === 'd' ? 'up' : ''}>{tally.draws}</b>
                  {' / '}<b className={bump === 'l' ? 'up' : ''}>{tally.losses}</b>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
