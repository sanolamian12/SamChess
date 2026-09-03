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
 * 것도 「버튼형 목록 하나, 학파는 색으로만」로 접었다 — 지원책은 초록,
 * 환술은 보라(GDD의 학파 색과 같다, `.ofc-tactics .chip`이 이미 쓰던 색).
 *
 * ────────────────────────────────────────────────────────────────
 * 「고르기」·재설계 확인은 새로 안 그린다
 * ────────────────────────────────────────────────────────────────
 *
 * [레벨 업]을 누르면 여는 능력·책략 선택 UI(`Picker`)와 재설계 확인
 * (`RespecModal`)은 전면 화면과 **완전히 같아야** 한다 — 여기서 다시 그리면
 * 언젠가 한쪽만 고쳐 어긋난다. `LevelUpScreen.tsx`가 내보낸 것을 그대로 쓴다.
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

import { useState } from 'react';
import { officerById, tacticById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  RESPEC_GOLD, applyLevelUp, applyRespec, canLevelUp, canRespec,
  cardsSpentOn, cardsToLevelUp, statPicksOf, tacticsOf,
} from '@samchess/meta';
import type { PlayerProfile, StatPick } from '@samchess/meta';
import { Picker, RespecModal } from './LevelUpScreen.tsx';
import { useOfficerCardOverlayPos } from './RankingCommon.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName, pickTacticName, pickTacticText } from '../i18n/story.ts';

export function LevelUpPanel({ profile, officer, onChange, onClose }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  useLang();
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState(false);
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
  const respecOk = canRespec(profile, officer);
  const refund = cardsSpentOn(inst.level);
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
          <span className="gr" data-grade={data.grade}>{data.grade}</span>
          {' '}{pickOfficerName(data)}{' '}
          {/* 고르는 중에는 **올라갈 레벨**을 보여준다 */}
          <span className="lv" data-level={inst.level + (picking ? 1 : 0)}>
            Lv{inst.level + (picking ? 1 : 0)}
          </span>
        </h3>

        {picking ? (
          <Picker
            inst={inst}
            onCommit={(stat, school) => { onChange(applyLevelUp(profile, officer, stat, school)); setPicking(false); }}
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

            {/* 「보유 책략」 — 지원책·환술을 한 목록으로, 학파는 색으로만 가른다 */}
            <div className="lvp-tactics">
              {/* `data-field`가 이름표와 빈 상태("없음")를 가른다 — 아이콘은
                  이름표에만 붙는다(`style.css`의 `.lvp-line[data-field]::before`) */}
              <span className="lvp-line" data-field="tactics">{t('levelup.tactics')}</span>
              {owned.length === 0
                ? <span className="lvp-line">{t('levelup.none')}</span>
                : owned.map((x) => (
                  <div key={x.id} className="lvp-tactic-row" data-school={x.school} title={pickTacticText(x)}>
                    {pickTacticName(x)}
                  </div>
                ))}
            </div>

            <button
              className="btn wide"
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
          </>
        )}
      </div>

      {asking && (
        <RespecModal
          level={inst.level}
          refund={refund}
          onClose={() => setAsking(false)}
          onConfirm={() => { onChange(applyRespec(profile, officer)); setAsking(false); }}
        />
      )}
    </div>
  );
}
