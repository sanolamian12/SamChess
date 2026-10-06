/**
 * 레벨/스킬 관리 — 장수 카드(`OfficerCardModal`) 위에 겹쳐 뜨는 판 (2026-09-02)
 *
 * 장수 일람의 「보기」 카드에서 [레벨/스킬 관리]를 누르면 예전에는 전면 화면
 * (`LevelUpScreen`)으로 넘어갔다 — 카드가 이미 보여 준 그림·능력치·책략·인물
 * 소개를 다시 보여줄 뿐인 화면으로, 디자인도 궁궐 나머지와 다른 옛 평면
 * 화풍이었다. 이 패널은 **전면 전환 없이** 카드 위에 겹쳐 뜬다 — [뒤로]는
 * 곧 [X]이고, 닫으면 그 자리(카드)로 돌아온다. [전적 보기]로 가는 길은 없다
 * (카드 자체의 [전적 보기]가 이미 있다).
 *
 * ────────────────────────────────────────────────────────────────
 * 「관리」 몸통을 다시 그렸다 — HP·MP·AT·스탯 찍은 횟수·지원책/환술 갈라 적기
 * 대신 「보유 책략」 한 목록
 * ────────────────────────────────────────────────────────────────
 *
 * 카드가 이미 HP·MP·AT를 보여준다(`OfficerCard`의 `.ofcard-bar-lv`) — 여기서
 *또 적으면 같은 화면 안에 같은 숫자가 두 번 뜬다. 지원책·환술을 줄로 가르던
 * 것도 「목록 하나, 학파는 색으로만」로 접었다 — 지원책은 초록,
 * 환술은 보라(GDD의 학파 색과 같다, `.ofc-tactics .chip`이 이미 쓰던 색).
 *
 * **2026-09-03 재지정 — 두루마리 한 장에 흘려 담는다.** 한 책략이 한 줄씩
 * 먹던 버튼형 목록을 접고, 두 줄 높이의 두루마리(`ui/field-frame.png`) 안에
 * 「이름+아이콘」을 나열한다(`.lvp-tactic-field`). 아이콘 그림은 **아직
 * 없다** — `TacticIcon`이 없으면 조용히 빼므로 파일만 나중에 놓으면 뜬다.
 *
 * ────────────────────────────────────────────────────────────────
 * 「고르기」·재설계 확인은 새로 안 그린다
 * ────────────────────────────────────────────────────────────────
 *
 * [레벨 업]을 누르면 여는 능력·책략 선택 UI(`Picker`)는 이 파일 끝에 있다 —
 * 예전 전면 화면(`LevelUpScreen.tsx`)이 내보내던 것을 그 화면을 지우며(2026-10-06) 옮겨 왔다.
 *
 * ★ **[재설계]는 여기서 지웠다** (2026-09-24, pptx 88쪽 — 기획자 확정). 둔갑천서는 이제
 * **장터 [도시 물자]에서 사고 그 자리에서 쓴다**(`MarketScreen`의 재설계). 두 곳에 두면
 * 값·설명이 한쪽만 낡는다.
 *
 * ────────────────────────────────────────────────────────────────
 * 이중 모달 — 뒤 패널(카드)은 눌리지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * `.lvp-back`이 화면 전체를 덮는 두 번째 가리개다(`.modal-back`보다 `z-index`가
 * 높다) — 카드의 [X]를 포함해 뒤에 있는 모든 것이 이 가리개 아래 깔려 클릭을
 * 받지 못한다. **앞에 뜬 패널만** 조작된다.
 *
 * **판의 윗변은 카드 그림(`.ofcard-art`)이 끝나는 바로 그 지점이다**
 * (2026-09-02 두 번째 지정 — "캐릭터 이미지가 끝나는 바로 끝지점으로"). 재는
 * 자리는 `useOfficerCardOverlayPos()`(`RankingCommon.tsx`) 하나다 — 전적 보기
 * 판(`RecordsPanel.tsx`)도 같은 훅을 쓴다(그 파일 머리말 참조).
 *
 * ────────────────────────────────────────────────────────────────
 * 세 번째 지정 — 개발용은 상점으로, 글자 크기 통일, 버튼 화풍 통일
 * ────────────────────────────────────────────────────────────────
 *
 * **개발용 카드·금화 지급은 지웠다** — 상점(`MarketScreen`)이 생겨 그리로
 * 옮겼다(장수를 고를 수 있게 목록으로 늘렸다, 여긴 한 명뿐이라 못 하던 것).
 * **[레벨 업]·[재설계]는 같은 참나무 목판**을 쓴다 — `.primary`(옥색)를
 * 빼기만 하면 `.scr-officers .btn:not(.ghost):not(.primary)`가 [재설계]와
 * 똑같이 입힌다, 새 규칙을 안 만든다. **작은 안내 글자 셋**(보유 카드 줄·
 * 「보유 책략」 이름표·빈 상태 "없음")은 전부 `.lvp-line`(.72rem, 옅은 잿빛) —
 * 예전엔 각자 다른 클래스(`.row`·`.cap`·`.dim`)를 썼다가 크기가 제각각으로
 * 보였다. **재설계 잠김 이유 문구는 지웠다** — "Lv1은 아직 올린 적이 없다"
 * 처럼 뻔한 이유까지 늘 띄워 둘 필요는 없다는 피드백이다(단, 그 판단은 이
 * 패널에 한정한다 — 전면 화면 `LevelUpScreen`은 원래 방침대로 그대로 보여준다).
 */

import { useRef, useState } from 'react';
import { officerById, tacticById } from '@samchess/data';
import { isTerrainTactic } from '@samchess/rules';
import type { OfficerId, TacticId } from '@samchess/rules';
import {
  canLevelUp, officerLevelCap, cardsToLevelUp, growthPreview, statPicksOf, tacticChoices, tacticsOf,
} from '@samchess/meta';
import type { OfficerInstance, PlayerProfile, StatPick, StatPreview } from '@samchess/meta';
import { levelUpOnServer } from '../meta/city.ts';
import { useOfficerCardOverlayPos } from './RankingCommon.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName, pickTacticName, pickTacticText } from '../i18n/story.ts';
import { GradeBadge } from './GradeBadge.tsx';

export function LevelUpPanel({ profile, officer, onChange, onClose }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  useLang();
  const [picking, setPicking] = useState(false);
  /** 레벨업을 서버가 거절했거나 못 닿았다 — 그 말을 그대로 적는다 (2026-09-14, A1) */
  const [respecNote, setRespecNote] = useState<string | null>(null);
  /** 레벨업을 서버에 보내는 중 — [확정]을 두 번 눌러도 한 번만 나간다 (2026-09-14, A2) */
  const committing = useRef(false);
  // 'top' — 카드(`.ofcard`) 시작점과 같은 y에서 뜬다(2026-09-03 재지정 —
  // "장수정보 패널과 똑같이"). `RecordsPanel`이 이미 같은 이유로 쓰던 앵커다
  // (`RankingCommon.tsx`의 `useOfficerCardOverlayPos` 주석 참조) — 예전 기본값
  // `'art'`(그림 아래)보다 위쪽 여유가 커져, 「고르기」 걸음의 내용이 늘어도
  // 안 잘리고 판 안 스크롤이 잘 안 생긴다.
  const { backRef, backStyle, modalStyle } = useOfficerCardOverlayPos('top');

  const inst = profile.roster[officer];
  const data = officerById.get(officer);

  // 카드에서 이미 보유 확인을 했으니 정상 경로로는 안 온다 — 방어만 해 둔다
  if (!inst || !data) return null;

  const need = cardsToLevelUp(inst.level);
  const owned = tacticsOf(inst).map((id) => tacticById.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const picks = statPicksOf(inst);
  const taps: Record<StatPick, number> = {
    hp: picks.filter((p) => p === 'hp').length,
    mp: picks.filter((p) => p === 'mp').length,
    at: picks.filter((p) => p === 'at').length,
  };

  return (
    <div
      className="lvp-back"
      ref={backRef}
      data-modal="levelup"
      onClick={onClose}
      style={backStyle}
    >
      <div
        className="place-panel lvp-modal"
        data-screen="levelup-panel"
        data-officer={officer}
        data-step={picking ? 'levelup' : 'manage'}
        data-growth={inst.growth.length}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ofcard-close" data-action="closeLevelUp" onClick={onClose} aria-label={t('ranking.card.close')}>
          <img className="ofcard-close-icon" src="icons/close.png" alt="" />
        </button>

        <h3 className="lvp-title">
          <GradeBadge grade={data.grade} />
          {' '}{pickOfficerName(data)}{' '}
          {/* 고르는 중에는 **올라갈 레벨**을 보여준다 */}
          <span className="lv" data-level={inst.level + (picking ? 1 : 0)}>
            Lv{inst.level + (picking ? 1 : 0)}
          </span>
        </h3>

        {picking ? (
          <Picker
            inst={inst}
            onCommit={(stat, school) => {
              /*
               * **레벨업은 서버가 한다** (2026-09-14, A2) — `roster`·`cards`가 서버 소유라 로컬로
               * 올려 `PUT`하면 되돌아간다. 고르기 걸음은 **결과가 올 때까지 닫지 않고**, 그 사이
               * [확정]을 또 눌러도 한 번만 나간다(카드가 넉넉하면 두 단계가 오른다).
               */
              if (committing.current) return;
              committing.current = true;
              setRespecNote(null);
              void (async () => {
                try {
                  const fromServer = await levelUpOnServer(officer, stat, school);
                  if (fromServer) onChange(fromServer);
                  else setRespecNote(t('server.offline'));
                } catch (err) {
                  setRespecNote(err instanceof Error ? err.message : String(err));
                } finally {
                  committing.current = false;
                  setPicking(false);
                }
              })();
            }}
          />
        ) : (
          <>
            <p className="lvp-line" data-field="cards">
              {t('levelup.cards')}
              {' : '}
              {need === null
                ? t('officer.cards.max')
                : t('officer.cards.have', { have: profile.cards[officer] ?? 0, need })}
            </p>

            {/* 「스탯 찍은 횟수」 — 전면 화면(`LevelUpScreen`의 `Manage`)과 같은
                클래스를 그대로 쓴다(`.lv-taps`는 스코프 없는 공용 규칙이다). */}
            <div className="lv-taps" data-taps={`${taps.hp}/${taps.mp}/${taps.at}`}>
              <span className="k">{t('levelup.taps')}</span>
              {(['hp', 'mp', 'at'] as StatPick[]).map((key) => (
                <span key={key} className="lv-tap" data-tap={key}>
                  {key.toUpperCase()} <b>×{taps[key]}</b>
                </span>
              ))}
            </div>

            {/* 「보유 책략」 — 두루마리 한 장 위에 「이름+아이콘」을 흘려 담는다 */}
            <div className="lvp-tactics">
              {/* `data-field`가 이름표와 빈 상태("없음")를 가른다 — 아이콘은
                  이름표에만 붙는다(`style.css`의 `.lvp-line[data-field]::before`) */}
              <span className="lvp-line" data-field="tactics">{t('levelup.tactics')}</span>
              <div className="lvp-tactic-field" data-count={owned.length}>
                {owned.length === 0
                  ? <span className="lvp-line">{t('levelup.none')}</span>
                  : owned.map((x) => (
                    <span key={x.id} className="lvp-tactic" data-school={x.school} data-tactic={x.id} title={pickTacticText(x)}>
                      {pickTacticName(x)}
                      <TacticIcon id={x.id} />
                    </span>
                  ))}
              </div>
            </div>

            <button
              className="btn wide"
              data-action="levelUp"
              disabled={!canLevelUp(profile, officer).ok}
              onClick={() => setPicking(true)}
            >
              {need === null ? t('levelup.max') : t('levelup.go', { need })}
            </button>
            {respecNote && <p className="note" data-field="respecNote">{respecNote}</p>}
            {/* 장수 레벨의 상한은 도시 레벨이다 (2026-09-14) — 전면 화면(`LevelUpScreen`)과 같은 줄 */}
            {need !== null && inst.level >= officerLevelCap(profile) && (
              <p className="note" data-field="levelCap">
                {t('levelup.cityCap', { city: profile.cityLevel, cap: officerLevelCap(profile) })}
              </p>
            )}
          </>
        )}
      </div>

    </div>
  );
}

/**
 * 책략 아이콘 — `public/tactics/{책략 id}.png`.
 *
 * **그림이 아직 하나도 없다**(2026-09-03 — 판때기를 먼저 그려 두고 아이콘은
 * 나중에 굽는다). 없으면 자리를 비우고 이름만 남긴다 — `assets/` 방침이
 * "이름의 표준은 파일명, 없으면 건너뛴다"이고, 기어(`ScreenChrome`의
 * `icons/settings.png`)가 이미 같은 `onError` 물러남을 쓴다. 그림이 구워지는
 * 날 이 컴포넌트는 **한 줄도 안 바뀐다** — 파일만 놓으면 뜬다.
 */
function TacticIcon({ id }: { id: string }): React.JSX.Element | null {
  const [art, setArt] = useState(true);
  if (!art) return null;
  return (
    <img className="lvp-tactic-icon" src={`tactics/${id}.png`} alt="" onError={() => setArt(false)} />
  );
}

// ── 고르기 (예전 `LevelUpScreen.tsx`에서 옮겨 왔다, 2026-10-06) ──

type School = 'support' | 'illusion';

/** `2.5` → `2.5`, `2` → `2`. 소수점 뒤 0을 남기면 「+2.0」처럼 어수선하다 */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** 「고르기」 — 능력 택1 + 책략 택1. 재설계 뒤에도 **이 판 그대로** 다시 밟는다.
    예전 전면 화면(`LevelUpScreen`, 2026-10-06 삭제)에서 옮겨 왔다. */
function Picker({ inst, onCommit, onBack }: {
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
