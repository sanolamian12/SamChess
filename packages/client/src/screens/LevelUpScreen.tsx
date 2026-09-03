/**
 * 레벨/스킬 관리 · 재설계 (pptx 39쪽 · GDD §4.2 · §4.3)
 *
 * ```
 * [관리]                          [고르기]
 * [S] 가후 Lv1                     [S] 가후 Lv2
 * 보유 카드 / 다음 레벨까지         HP: 10,  +5  → 15      ← 물리 성장
 * HP: 10, MP: 5, AT: 2-4           MP: 5,   +0  → 5
 * ×0  ×0  ×0  (스탯 찍은 횟수)      AT: 2-4, +0  → 2-4
 * 보유 지원책 / 보유 환술            Lv2 책략(택1)  [증폭] [공포]   ← 책략 성장
 * [레벨 업 (3장 소모)]              책략 설명
 * [재설계 (둔갑천서 10냥)]          [확정]  [뒤로]
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 재설계는 「되감기」다 — 화면이 하나뿐인 이유 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 39쪽의 「초기화했을 때 레벨 업그레이드 하는 UI 제공 필요」는 **새 화면을 만들라는
 * 말이 아니었다.** 재설계가 쓴 카드를 전부 돌려주고 Lv1로 되돌리므로, 그 뒤는
 * 여기 있는 **레벨업 절차 그대로**다. 「초기화했을 때의 UI」란 곧 이 화면이다.
 *
 * 그래서 이 화면에 걸음이 둘뿐이다 — **관리**와 **고르기**. 재설계는 화면이 아니라
 * 확인 한 번이고, 누르고 나면 Lv1짜리 관리 화면으로 돌아온다.
 *
 * ────────────────────────────────────────────────────────────────
 * 숫자는 화면이 만들지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 증분 미리보기(`+5 → 15`)는 `growthPreview()`가, 공격력 범위는 그 안의
 * `FORMULA.damage`가, 「카드 N장을 돌려받는다」는 `cardsSpentOn()`이 낸다.
 * 「화면이 미리 보여 주는 숫자는 엔진이 낸다」 — 공격 확인창이 `forecastAttack()`,
 * 책략이 `illusionChance()`에 묻는 것과 같은 자리다. 실제로 `AT +1`이 화면 글자에만
 * 남아 있던 적이 있다(2026-08-12에 0.5로 내렸는데 데이터·엔진만 따라갔다).
 *
 * > **「개발용」은 게임 규칙이 아니다.** AI 대전이 카드를 주지 않고 상점도 아직
 * > 없어서, 오프라인에서는 성장도 재설계도 시험할 길이 없다. 온라인·상점이 붙으면 지운다.
 *
 * **궁궐·병영·랭킹과 같은 틀을 쓴다**(`ScreenChrome` + `.place-bar`/`.place-body`/
 * `.place-panel`, 2026-09-02 — `OfficerListScreen.tsx` 머리말 참조). 스모크가
 * `[data-screen="levelup"]`의 부분 트리에서 `.lv-taps`·`.ofc-who .nm`을 찾고
 * `[data-screen="levelup"] [data-action="back"]`처럼 그 안에서 뒤로 단추를 좁혀
 * 찾으므로(`tools/smoke_meta.ts`), `data-screen`·`data-step`·`data-growth`·
 * `data-officer`는 `place-bar`·`place-body`를 함께 감싸는 `.lv-frame` 하나에 둔다.
 *
 * **이 전체 화면 말고 모달 버전도 있다**(`LevelUpPanel.tsx`, 2026-09-02) — 장수
 * 일람의 「보기」 카드(`OfficerCardModal`) 안 [레벨/스킬 관리]는 여기로 옮겨오지
 * 않고 그 카드 위에 겹쳐 뜨는 패널로 연다(전면 화면 전환 없이). 「고르기」
 * (`Picker`)와 재설계 확인(`RespecModal`)은 **UI가 완전히 같아야** 하므로 이
 * 파일에서 내보내 그대로 재사용한다 — 「관리」 몸통(HP·MP·AT·스탯 찍은 횟수·
 * 지원책/환술 갈라 적기)만 그쪽에서 「보유 책략」 한 목록으로 다시 그린다.
 */

import { useState } from 'react';
import { officerById, tacticById } from '@samchess/data';
import { isTerrainTactic } from '@samchess/rules';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  RESPEC_GOLD, addCard, applyLevelUp, applyRespec, atRange, canLevelUp, canRespec,
  cardsSpentOn, cardsToLevelUp, growthPreview, statPicksOf, statsOf, tacticChoices, tacticsOf,
} from '@samchess/meta';
import type { OfficerInstance, PlayerProfile, StatPick, StatPreview } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName, pickTacticName, pickTacticText } from '../i18n/story.ts';

type School = 'support' | 'illusion';

/** `2.5` → `2.5`, `2` → `2`. 소수점 뒤 0을 남기면 「+2.0」처럼 어수선하다 */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export function LevelUpScreen({ profile, officer, onChange, onBack, onRecords }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onChange: (p: PlayerProfile) => void;
  onBack: () => void;
  onRecords: () => void;
}): React.JSX.Element {
  useLang();
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState(false);

  const inst = profile.roster[officer];
  const data = officerById.get(officer);
  if (!inst || !data) {
    return (
      <ScreenChrome
        backdrop={placeBackdrop('palace', profile.cityLevel)}
        className="scr-levelup"
        account={currentSession()?.email ?? null}
      >
        <div className="place-body"><p className="hint" onClick={onBack}>{t('officer.toList')}</p></div>
      </ScreenChrome>
    );
  }

  const need = cardsToLevelUp(inst.level);
  const respecOk = canRespec(profile, officer);
  const refund = cardsSpentOn(inst.level);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('palace', profile.cityLevel)}
      className="scr-levelup"
      account={currentSession()?.email ?? null}
    >
      <div
        className="lv-frame"
        data-screen="levelup"
        data-officer={officer}
        data-step={picking ? 'levelup' : 'manage'}
        data-growth={inst.growth.length}
      >
        <div className="place-bar">
          <button className="btn ghost sm" data-action="back" onClick={onBack}>{t('officer.toList')}</button>
          <span className="place-nm">{pickOfficerName(data)}</span>
        </div>

        <div className="place-body">
          {/* 39쪽 목업의 나머지 한 갈래. [전적 보기]는 C1(40쪽)이 열었다 */}
          <div className="place-panel">
            <div className="ofc-nav">
              <button className="btn sm" data-action="records" onClick={onRecords}>{t('officer.records')}</button>
            </div>
          </div>

          <section className="place-panel block ofc-detail">
            <div className="ofc-bio">
              <OfficerArt officer={data.id} className="ofc-art" />
              <div className="ofc-who">
                <h2 className="nm">
                  <span className="gr" data-grade={data.grade}>[{data.grade}]</span>
                  {' '}{pickOfficerName(data)}{' '}
                  {/* 고르는 중에는 **올라갈 레벨**을 보여준다 — 39쪽 목업이 Lv2로 적혀 있다 */}
                  <span className="lv" data-level={inst.level + (picking ? 1 : 0)}>
                    Lv{inst.level + (picking ? 1 : 0)}
                  </span>
                </h2>
                {!picking && (
                  <p className="row dim" data-field="cards">
                    <span className="k">{t('levelup.cards')}</span>
                    {' : '}
                    {need === null
                      ? t('officer.cards.max')
                      : t('officer.cards.have', { have: profile.cards[officer] ?? 0, need })}
                  </p>
                )}
              </div>
            </div>

            {picking
              ? (
                <Picker
                  inst={inst}
                  onCommit={(stat, school) => { onChange(applyLevelUp(profile, officer, stat, school)); setPicking(false); }}
                  onBack={() => setPicking(false)}
                />
              )
              : <Manage inst={inst} />}
          </section>

          {!picking && (
            <section className="place-panel block lv-acts">
              <button
                className="btn primary wide"
                data-action="levelUp"
                disabled={!canLevelUp(profile, officer).ok}
                onClick={() => setPicking(true)}
              >
                {need === null ? t('levelup.max') : t('levelup.go', { need })}
              </button>
              <button
                className="btn wide"
                data-action="respec"
                disabled={!respecOk.ok}
                onClick={() => setAsking(true)}
              >
                {t('respec.open', { gold: RESPEC_GOLD })}
              </button>
              {/* 「단추는 눌리지 않게 두고 **왜인지 적는다**」 — 감추면 「고장인가」가 남는다 */}
              {!respecOk.ok && <p className="note">{respecOk.reason}</p>}
            </section>
          )}

          {/* 게임 규칙이 아니다 — AI 대전이 카드를 주지 않고 상점도 없어 시험할 길이 없다.
              `.devtools`는 점선 테두리로 일부러 도드라져야 하므로 `.place-panel`과
              클래스를 합치지 않는다(합치면 두 규칙의 `border`·`background`가
              부딪혀 점선이 사라진다) — 대신 판 안에 얹는다. */}
          {!picking && (
            <div className="place-panel">
              <div className="devtools">
                <span className="cap">개발용</span>
                <button className="btn ghost sm" data-dev="cards" onClick={() => onChange(addCard(profile, officer, 5))}>
                  카드 +5
                </button>
                <button
                  className="btn ghost sm"
                  data-dev="gold"
                  onClick={() => onChange({ ...profile, gold: profile.gold + RESPEC_GOLD })}
                >
                  금화 +{RESPEC_GOLD}
                </button>
                <span className="dim">시험용 통로다. 온라인·상점이 붙으면 없앤다.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {asking && (
        <RespecModal
          level={inst.level}
          refund={refund}
          onClose={() => setAsking(false)}
          onConfirm={() => { onChange(applyRespec(profile, officer)); setAsking(false); }}
        />
      )}
    </ScreenChrome>
  );
}

/**
 * 재설계 확인 (둔갑천서).
 *
 * **되돌릴 수 없고 값이 나가는 한 수**라 한 번 묻는다 — Lv9를 눌러 Lv1로 만드는
 * 것이 손가락 하나로 끝나면 안 된다. 「무엇이 어떻게 되는가」를 숫자로 적는다.
 */
export function RespecModal({ level, refund, onClose, onConfirm }: {
  level: number; refund: number; onClose: () => void; onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-back" data-modal="respec" onClick={onClose}>
      <div className="modal lv-respec" onClick={(e) => e.stopPropagation()}>
        <p className="row"><b>{t('respec.title')}</b></p>
        <p className="row" data-field="respecWhat">{t('respec.what', { level, refund })}</p>
        <p className="row dim">{t('respec.cost', { gold: RESPEC_GOLD })}</p>
        <div className="lv-acts">
          <button className="btn primary wide" data-action="respecConfirm" onClick={onConfirm}>
            {t('levelup.confirm')}
          </button>
          <button className="btn ghost wide" data-action="close" onClick={onClose}>{t('respec.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 관리 화면의 몸통 — 능력치 · 스탯 찍은 횟수 · 보유 책략 두 줄 */
function Manage({ inst }: { inst: OfficerInstance }): React.JSX.Element {
  const stats = statsOf(inst);
  const at = atRange(inst);
  const picks = statPicksOf(inst);
  const taps: Record<StatPick, number> = {
    hp: picks.filter((p) => p === 'hp').length,
    mp: picks.filter((p) => p === 'mp').length,
    at: picks.filter((p) => p === 'at').length,
  };
  const owned = tacticsOf(inst).map((id) => tacticById.get(id)).filter((x) => !!x);

  return (
    <>
      <p className="ofc-stats" data-field="stats">
        HP: {stats.hp},  MP: {stats.mp},  AT: {at.min}-{at.max}
      </p>

      {/* 「값, 스탯 찍은 횟수」(39쪽). **어디에 몇 번 썼는지**가 재설계의 판단 근거다 */}
      <div className="lv-taps" data-taps={`${taps.hp}/${taps.mp}/${taps.at}`}>
        <span className="k">{t('levelup.taps')}</span>
        {(['hp', 'mp', 'at'] as StatPick[]).map((key) => (
          <span key={key} className="lv-tap" data-tap={key}>
            {key.toUpperCase()} <b>×{taps[key]}</b>
          </span>
        ))}
      </div>

      {/* 「보유 지원책 / 보유 환술」 — 두 줄로 갈라 적는다(39쪽) */}
      {(['support', 'illusion'] as School[]).map((school) => (
        <div key={school} className="ofc-tactics lv-owned" data-owned={school}>
          <span className="k">{t(school === 'support' ? 'levelup.support' : 'levelup.illusion')}</span>
          {owned.filter((x) => x.school === school).length === 0
            ? <span className="dim">{t('levelup.none')}</span>
            : owned.filter((x) => x.school === school).map((x) => (
              <span key={x.id} className={`chip ${school}`} title={pickTacticText(x)}>{pickTacticName(x)}</span>
            ))}
        </div>
      ))}
    </>
  );
}

/** 「고르기」 — 능력 택1 + 책략 택1. 재설계 뒤에도 **이 화면 그대로** 다시 밟는다.
    `LevelUpPanel.tsx`(장수 정보 패널 위에 뜨는 모달 버전)도 그대로 가져다 쓴다 —
    고르기 UI는 두 화면에서 똑같아야 하므로 내보낸다. */
export function Picker({ inst, onCommit, onBack }: {
  inst: OfficerInstance;
  onCommit: (stat: StatPick, school: School) => void;
  /** 없으면 [뒤로]를 안 그린다 — `LevelUpPanel.tsx`(카드 위 모달)는 우상단
      [X]가 이미 그 역할을 하므로 안 넘긴다. `LevelUpScreen.tsx`(전면 화면)는
      X가 없어 반드시 넘긴다. */
  onBack?: () => void;
}): React.JSX.Element {
  const [stat, setStat] = useState<StatPick>('hp');
  const [school, setSchool] = useState<School>('support');

  const level = inst.level + 1;
  // **「보여주는 증분」과 「실제 결과」는 다른 값이다** (2026-09-03 다섯·여섯 번째 지정).
  //
  // | 칸 | 뜻 | 예 (HP를 골랐을 때 MP 줄) |
  // |---|---|---|
  // | `now`  | 지금 값 | `5` |
  // | `add`  | **고르면** 오를 양 — 회색, 실제로는 안 더해진다 | `+2` |
  // | `next` | **실제로** 적용될 값 — 안 고른 줄은 `now` 그대로 | `5` |
  //
  // 그래서 `next`·`range`는 「지금 고른 것」 기준(`growthPreview(inst, stat)`)을
  // 그대로 두고, `add`만 줄마다 제 것을 골라 따로 물어 얹는다. 회색 증분까지
  // 오른쪽 결과에 반영하면 「MP가 7이 된다」는 거짓말이 된다 — 실제로 오르는 건
  // 고른 하나뿐이다. 어느 쪽이든 숫자를 내는 것은 언제나 엔진이다.
  const gains = new Map((['hp', 'mp', 'at'] as StatPick[]).map(
    (key) => [key, growthPreview(inst, key).find((r) => r.key === key)!.add] as const,
  ));
  const rows = growthPreview(inst, stat).map((row) => ({ ...row, add: gains.get(row.key)! }));
  const choices = tacticChoices(level);
  // 그 레벨에 지원이 없으면(지금 데이터에는 없지만) 고를 수 있는 쪽으로 물러난다
  const pickedSchool: School = choices[school].length > 0 ? school : (school === 'support' ? 'illusion' : 'support');

  return (
    <>
      <div className="lv-pick" data-picker={level}>
        <span className="k k-physical">{t('levelup.physical')}</span>
        <div className="lv-stats">
          {rows.map((row) => (
            <button
              key={row.key}
              className={`opt lv-stat-row${stat === row.key ? ' on' : ''}`}
              data-stat={row.key}
              data-add={fmt(row.add)}
              onClick={() => setStat(row.key)}
            >
              {/* 칸 자체는 80%, 나머지는 체크 칩(`.lv-check`) — 2026-09-03
                  세 번째 지정. 칸의 배경 그림은 **지금 없다**(어울리는 액자를
                  기다리는 중, `style.css`의 `.scr-officers .lv-stat` 주석과
                  `docs/PROMPT.md`의 「능력치 줄 명패」 절 참조). */}
              <span className="lv-stat">
                <span className="c-k">{row.key.toUpperCase()}</span>
                <span className="c-now">{show(row, 'now')}</span>
                <span className="c-add">+{fmt(row.add)}</span>
                <span className="c-arrow">→</span>
                <span className="c-next">{show(row, 'next')}</span>
              </span>
              <span className="lv-check" aria-hidden="true">
                <img className="lv-check-icon" src="icons/confirm.png" alt="" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/*
        「책략 택1」(39쪽) — **두루마리 두 장을 위아래로**(2026-09-03 네 번째
        지정). 위가 지원책, 아래가 환술이고, 각 두루마리의 첫 줄이 「책략 이름 +
        체크할 나무 판」, 그 아래가 설명이다.

        예전에는 이름 줄(택1 단추)과 설명 상자가 **따로** 있었다 — 고른 쪽 설명만
        보이니 둘을 견주려면 번갈아 눌러야 했고, 글 길이에 따라 상자 높이가
        흔들려 그걸 막는 겹쳐 재기 장치(`.lv-desc-stack`)까지 있었다. 둘 다 늘
        펼쳐 두면 견주기도 되고 높이도 애초에 안 흔들린다 — 그래서 그 장치는
        같이 지웠다. 스모크가 찾는 `data-field="tacticDesc"`는 설명이 사는
        자리를 그대로 따라 여기로 옮겼다.
      */}
      <div className="lv-pick">
        <span className="k k-tactic">{t('levelup.tactic', { level })}</span>
        <div className="lv-tactics" data-field="tacticDesc">
          {(['support', 'illusion'] as School[]).map((s) => {
            const list = choices[s]
              .map((id: TacticId) => tacticById.get(id))
              .filter((x): x is NonNullable<typeof x> => !!x);
            return (
              <button
                key={s}
                className={`opt lv-tactic-row${pickedSchool === s ? ' on' : ''}`}
                data-school={s}
                disabled={list.length === 0}
                onClick={() => setSchool(s)}
              >
                <span className="lv-tactic-head">
                  {/* Lv6·7의 지원은 「화계 + 진화」처럼 **한 쌍이 한 선택지**다 —
                      소모 MP는 둘이 다르므로(화계 2 · 진화 1) 이름마다 따로 붙인다.
                      「MP」는 `Lv`·`HP`/`AT`처럼 이 게임이 번역 없이 그대로 쓰는
                      약어라 i18n 키를 만들지 않는다(능력치 줄도 `row.key`를 그대로
                      대문자로 찍는다). */}
                  <span className="lv-tactic-label">
                    {list.length === 0
                      ? t('levelup.none')
                      : list.map((x, i) => (
                        <span key={x.id}>
                          {i > 0 ? ' + ' : ''}
                          {pickTacticName(x)}{' '}
                          <span className="lv-tactic-mp">(MP: {x.mpCost})</span>
                        </span>
                      ))}
                  </span>
                  <span className="lv-check" aria-hidden="true">
                    <img className="lv-check-icon" src="icons/confirm.png" alt="" />
                  </span>
                </span>
                {list.map((x) => (
                  <span key={x.id} className="lv-tactic-text">{pickTacticText(x)}</span>
                ))}
                {/* 발동 조건 — `FORMULA.supportRate`·`illusionRate`·`terrainRate`를
                    말로 옮긴 문구이고, 공식이 바뀌면 `levelup.trigger.*` 열 언어를
                    같이 고쳐야 한다(`style.css`의 `.lv-tactic-cond` 주석 참조).
                    **학파가 아니라 책략이 정한다** — 지원책이면서 칸에 거는
                    화계·진화는 겨눌 상대가 없어 공식이 다르다(2026-09-03). 갈래를
                    화면이 다시 적지 않도록 엔진의 `isTerrainTactic()`에 묻는다. */}
                {list.length > 0 && (
                  <span className="lv-tactic-cond">
                    {t(list.every((x) => isTerrainTactic(x))
                      ? 'levelup.trigger.terrain'
                      : s === 'support' ? 'levelup.trigger.support' : 'levelup.trigger.illusion')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lv-acts">
        <button className="btn primary wide" data-action="confirm" onClick={() => onCommit(stat, pickedSchool)}>
          {t('levelup.confirm')}
        </button>
        {onBack && (
          <button className="btn ghost wide" data-action="stepBack" onClick={onBack}>{t('levelup.back')}</button>
        )}
      </div>
    </>
  );
}

/** 한 칸의 표시. **`AT`만 범위다** — 데미지가 매 타격 내림이라 `2.5`는 평타 2 · 크리티컬 5 */
function show(row: StatPreview, when: 'now' | 'next'): string {
  if (!row.range) return fmt(row[when]);
  const r = row.range[when];
  return `${r.min}-${r.max}`;
}
