/**
 * 전투 결과 — 세 결말과 보상 (GDD §6.4, 2026-08-18 개편 · 2026-10-12 화풍)
 *
 * ────────────────────────────────────────────────────────────────
 * 무승부는 **고른 뒤에** 반영된다 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 승리·패배는 전투가 끝나는 순간 이미 계정에 들어가 있고, 이 화면은 그것을 보여
 * 주기만 한다. 무승부만 여기서 **묻고 나서** `applyBattleResult()`를 부른다 —
 * 「고르는 도중」이라는 상태를 저장하지 않는 것이 규칙이고(재설계와 같은 결),
 * 그래서 고르기 전에 나가면 전적도 보상도 남지 않는다. 다만 지금은 나가는 단추가
 * **마지막 장에만** 있어(아래) 화면에서는 고르지 않고 나갈 길이 없다.
 *
 * 판정을 화면이 하지 않는다는 규약은 그대로다 — 무엇을 주는지는 meta가 정하고
 * 여기서는 **고른 것을 넘길 뿐**이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 두루마리 한 장을 넘겨 읽는다 (2026-10-12 기획자 확정)
 * ────────────────────────────────────────────────────────────────
 *
 * 결말마다 다른 배경(`resultBackdrop`) 위에 두루마리가 가운데에서 펼쳐지고, 글자만
 * 지웠다 다시 쓰며 장을 넘긴다: **결말 → 보상 → 전과.** 누르거나 `PAGE_MS`가 지나면
 * 다음 장이다. 무승부 택1은 **고를 때까지** 기다린다. [다시 편성]·[도시로]는
 * **마지막 장에서만** 선다 — 택1 중에 나가 버려 보상을 놓치는 길을 닫는다.
 *
 * 두루마리는 승리 = 황금, 무승부·성립 안 함 = 비취, 패배 = 낡은 것(`SKIN`). 낙관(勝·和·敗)은
 * 한자를 읽는 사람만 알아봐서 뺐다(기획자 지정).
 *
 * **성립하지 않은 판은 결말이 아니다** — 승/무/패 제목도, 보상도, 예상 승률도, 전과도
 * 뜨지 않는다. 뜨면 「무승부를 당했다」로 읽히고, 그건 §5-68이 일부러 안 준 것이다.
 */

import { useCallback, useEffect, useState } from 'react';
import { officerById } from '@samchess/data';
import {
  DRAW_REWARDS, GRAIN_REWARD, MATERIAL_REWARD, applyBattleResult, grainCost, winChance,
} from '@samchess/meta';
import type {
  BattleOutcome, BattleResult, BattleRewards, DrawReward, PlayerProfile,
} from '@samchess/meta';
import type { BattleMode, Grade } from '@samchess/rules';
import { drawResultRequest, settleDrawResult } from '../meta/battleResult.ts';
import { currentSession } from '../meta/auth.ts';
import { OfficerActionArt, OfficerArt } from './OfficerArt.tsx';
import { GradeBadge } from './GradeBadge.tsx';
import { Halo } from './market/parts.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { resultBackdrop } from './backdrop.ts';
import type { ResultBackdropId } from './backdrop.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';

const TITLE: Record<BattleResult, 'result.win' | 'result.draw' | 'result.lose'> = {
  win: 'result.win', draw: 'result.draw', lose: 'result.lose',
};

const PICK_LABEL: Record<DrawReward, 'result.pick.card' | 'result.pick.material' | 'result.pick.grain'> = {
  card: 'result.pick.card', material: 'result.pick.material', grain: 'result.pick.grain',
};

/** 택1 칸의 그림 — 장터와 같은 그림이다 */
const PICK_ART: Record<DrawReward, string> = {
  card: 'market/market_card.png', material: 'market/materials.png', grain: 'market/grain.png',
};

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

type Page = 'title' | 'reward' | 'record';

/**
 * 결말 제목의 글자 크기(cqw). 한국어 「승리」는 붓글씨로 크게 쓰는데, 다른 언어는 글자 수가 많고
 * 붓글씨 서체가 없는 글자(키릴 · 로마자)는 넓은 세리프로 물러나 종이를 넘친다(「Ялагдал」 실측).
 * 종이 안쪽 폭(약 70cqw)의 85%에 들게 줄인다 — 한자 · 가나 · 한글은 한 글자가 1em, 나머지는 약 0.65em.
 */
function titleSize(text: string): number {
  const em = [...text].reduce((n, ch) => n + (/[\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(ch) ? 1 : 0.65), 0);
  return Math.min(17, 60 / Math.max(em, 1));
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function ResultScreen({
  profile, mode, result, outcome, rewards, pending, record, power, seed, voided, onChange, onAgain, onHome,
}: {
  profile: PlayerProfile;
  /** 이 판의 규모 — 환불액(참가비)이 여기서 나온다 */
  mode: BattleMode;
  result: BattleResult;
  outcome: string;
  /** 이미 반영된 보상. 무승부는 고르기 전이라 `null`이다 */
  rewards: BattleRewards | null;
  pending: BattleOutcome | null;
  /** 판의 기록 — 전과 장이 보여 준다. 성립하지 않은 판은 `null` */
  record: BattleOutcome | null;
  power: { mine: number; theirs: number };
  seed: number;
  /**
   * **성립하지 않은 판**이다 (GDD §3.9) — 결말도 보상도 전적도 없고 정산만 있다.
   *
   * 화면을 따로 만들지 않고 이 화면을 재사용한다: 나가는 길([다시 편성]·[도시로])이
   * 이미 여기 있고, 「무슨 일이 있었는지」를 팝업 하나에만 남기면 되짚을 수 없다.
   */
  voided?: { reason: 'left' | 'idle'; refunded: boolean } | null;
  onChange: (profile: PlayerProfile) => void;
  onAgain: () => void;
  onHome: () => void;
}): React.JSX.Element {
  useLang();
  const [given, setGiven] = useState<BattleRewards | null>(rewards);
  const [busy, setBusy] = useState(false);
  const waiting = given === null && pending !== null;

  const pages: Page[] = voided ? ['title', 'reward'] : ['title', 'reward', 'record'];
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const page = pages[idx]!;
  const last = idx === pages.length - 1;
  // 택1을 기다리는 장은 시간이 흘러도, 눌러도 안 넘어간다
  const held = page === 'reward' && waiting;

  const next = useCallback((): void => {
    if (last || held || leaving) return;
    const out = reducedMotion() ? 0 : WIPE_OUT_MS;
    setLeaving(true);
    window.setTimeout(() => { setIdx((i) => i + 1); setLeaving(false); }, out);
  }, [last, held, leaving]);

  // 장마다 `PAGE_MS` 뒤 저절로 넘긴다. 첫 장은 두루마리가 펼쳐지는 시간만큼 더 머문다
  useEffect(() => {
    if (last || held || leaving) return;
    const extra = idx === 0 && !reducedMotion() ? UNROLL_MS : 0;
    const timer = window.setTimeout(next, PAGE_MS + extra);
    return () => window.clearTimeout(timer);
  }, [idx, last, held, leaving, next]);

  /*
   * **서버가 반영한다** (H3d) — `PUT /profile`이 더는 `grain`을 안 믿으므로, 로컬
   * `applyBattleResult` + `PUT`만으로는 무승부로 고른 군량 보상이 조용히 사라진다.
   * **서버가 안 닿으면 그때만** 예전 방식(로컬 반영)으로 물러난다 — 카드·재료는
   * 여전히 `PUT`이 받아 주지만 군량만 놓칠 수 있다는 뜻이다(§5-61과 같은 결의 대가).
   */
  const pick = async (choice: DrawReward): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const outcome = { ...pending!, drawPick: choice };
    const settled = await settleDrawResult(drawResultRequest(outcome, seed));
    if (settled) {
      setGiven(settled.rewards);
      onChange(settled.profile);
      return;
    }
    const applied = applyBattleResult(profile, outcome, seed);
    setGiven(applied.rewards);
    onChange(applied.profile);
  };

  const bg: ResultBackdropId = voided ? 'void' : result;
  const skin = SKIN[bg];

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
        {outcome && <p className="brs-lede">{outcome}</p>}
      </>
    );
  } else if (page === 'reward') {
    sheet = waiting ? (
      /* 무승부 택1 — 양쪽 다 고른다 (§5-10). 고르기 전까지 계정은 그대로다 */
      <div className="brs-pickwrap" data-field="drawPick">
        <h2 className="brs-cap">{t('result.drawPick')}</h2>
        <div className="brs-pick">
          {DRAW_REWARDS.map((choice) => (
            <button
              key={choice}
              className="brs-pick-opt"
              data-pick={choice}
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); void pick(choice); }}
            >
              <img src={PICK_ART[choice]} alt="" />
              <b>{t(PICK_LABEL[choice], { n: GRAIN_REWARD[pending!.mode], m: MATERIAL_REWARD })}</b>
            </button>
          ))}
        </div>
      </div>
    ) : (
      <RewardsPage given={given} />
    );
  } else {
    sheet = <RecordPage record={record!} power={power} />;
  }

  return (
    <ScreenChrome backdrop={resultBackdrop(bg)} className="scr-result" account={currentSession()?.email ?? null}>
      <div
        className="brs-frame"
        data-screen="result"
        data-result={voided ? 'void' : result}
        data-void={voided?.reason}
        data-page={page}
        data-last={last ? '1' : '0'}
      >
        <div className="brs-stage" data-action="next" onClick={next}>
          <figure
            className="brs-scroll"
            data-skin={skin}
            style={{
              '--brs-unroll': `${UNROLL_MS}ms`, '--brs-in': `${WIPE_IN_MS}ms`, '--brs-out': `${WIPE_OUT_MS}ms`,
            } as React.CSSProperties}
          >
            <img className="brs-paper" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
            <img className="brs-roll l" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
            <img className="brs-roll r" src={`ui/result-scroll-${skin}.png`} alt="" draggable={false} />
            {/* 장이 바뀌면 `key`로 새로 만든다 — 쓸어 입히는 애니메이션이 처음부터 다시 돈다 */}
            <div key={idx} className={`brs-sheet${leaving ? ' out' : ''}${idx === 0 ? ' first' : ''}`}>
              {sheet}
            </div>
          </figure>
          {!last && !held && <p className="brs-tap">{t('result.tap')}</p>}
        </div>

        {last && !leaving && (
          <div className="brs-acts">
            <button className="btn wide" data-action="again" onClick={onAgain}>
              <span className="lbl">{t('result.again')}</span>
            </button>
            <button className="btn primary wide" data-action="home" onClick={onHome}>
              <span className="lbl">{t('result.home')}</span>
            </button>
          </div>
        )}
      </div>
    </ScreenChrome>
  );
}

/** 보상 장 — 카드는 장터 뽑기 · 도적떼 결과와 **같은 액자**다(`.mkt-card`, 「카드를 얻었다」는 한 모양) */
function RewardsPage({ given }: { given: BattleRewards | null }): React.JSX.Element {
  const cards = given?.cards ?? [];
  return (
    <div className="brs-rewards" data-field="rewards">
      {cards.length > 0 ? (
        <div className="mkt-cards brs-cards">
          {/* 줄마다 `data-grade`를 단다: 스모크가 글자가 아니라 속성으로 등급을 본다 */}
          {cards.map((c, i) => {
            const o = officerById.get(c.officer);
            return (
              <div
                key={`${c.officer}-${i}`}
                className="mkt-card brs-card"
                data-field="card" data-officer={c.officer} data-grade={c.grade}
                style={{ animationDelay: `${250 + i * 160}ms` }}
              >
                <Halo grade={c.grade as Grade} />
                <div className="mkt-card-frame" style={{ backgroundImage: `url(market/frame-${c.grade}.png)` }}>
                  <OfficerArt officer={c.officer} className="mkt-card-art" />
                </div>
                <span className="mkt-card-name">{o ? pickOfficerName(o) : c.officer}</span>
                <span className="brs-card-grade"><GradeBadge grade={c.grade} /></span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="brs-nocard" data-field="card">{t('result.noCard')}</p>
      )}
      <div className="brs-gains">
        <div className="brs-gain">
          <img src="market/grain.png" alt="" />
          <span className="k">{t('result.grain')}</span>
          <b className="v" data-field="grain">{given && given.grain > 0 ? `+${given.grain}` : t('result.none')}</b>
        </div>
        <div className="brs-gain">
          <img src="market/materials.png" alt="" />
          <span className="k">{t('result.materials')}</span>
          <b className="v" data-field="materials">{given && given.materials > 0 ? `+${given.materials}` : t('result.none')}</b>
        </div>
      </div>
    </div>
  );
}

/** 전과 장 — 출전한 꼬마 장수(판 위의 그 그림)가 줄지어 서고 머리 위에 격파 수, 퇴각한 장수는 흑백이다 */
function RecordPage({ record, power }: { record: BattleOutcome; power: { mine: number; theirs: number } }): React.JSX.Element {
  const fallen = new Set(record.fallen ?? []);
  // 예상 승률은 **엔진이 낸다** — 화면이 로지스틱을 다시 적지 않는다 (D · GDD §7.1)
  const chance = winChance(power.mine, power.theirs);
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
      {/* 「예상 승률 12%를 뒤집은 승리」 — 보상이 아니라 기록이다 (§5-23) */}
      <p className="brs-chance" data-field="chance" data-chance={chance.toFixed(4)}>
        {t('result.expected', { p: Math.round(chance * 100), mine: power.mine, theirs: power.theirs })}
      </p>
    </div>
  );
}
