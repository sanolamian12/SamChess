/**
 * 전적 보기 — 장수 카드(`OfficerCardModal`) 위에 겹쳐 뜨는 판 (2026-09-03)
 *
 * 장수 일람의 「보기」 카드에서 [전적 보기]를 누르면 예전에는 전면 화면
 * (`RecordsScreen`)으로 넘어갔다 — `LevelUpPanel`이 갈아 끼우기 전의
 * [레벨/스킬 관리]와 같은 처지였다(디자인도 궁궐 나머지와 다른 옛 평면
 * 화풍). 이 패널은 [레벨/스킬 관리]와 **같은 틀**(`.lvp-back`/`.lvp-modal`,
 * `useOfficerCardOverlayPos()`)을 그대로 써서 카드 위에 겹쳐 뜬다 — [뒤로]는
 * 곧 [X]이고, 닫으면 그 자리(카드)로 돌아온다.
 *
 * ────────────────────────────────────────────────────────────────
 * 내용은 `RecordsScreen`에서 그대로 가져온다 — 다시 세지 않는다
 * ────────────────────────────────────────────────────────────────
 *
 * 기물별 표·모드별 합·최근 이력은 전부 `@samchess/meta`(`pieceRows`·`modeRows`·
 * `totalTally`·`recentMatches`)가 낸 값을 그대로 그린다(`RecordsScreen.tsx`와
 * 같은 규칙 — 화면이 숫자를 만들지 않는다). 이력 한 줄(`LogRow`)·필터 문구
 * (`FILTER_KEY`)·결과 문구(`RESULT_KEY`)는 그 파일과 `RankingCommon.tsx`가
 * 이미 내보낸 것을 그대로 쓴다 — 여기서 다시 적으면 언젠가 한쪽만 고쳐
 * 어긋난다.
 *
 * **총 출전·3v3·5v5도 기물별 표와 같은 표 형식이다**(2026-09-03 지정 —
 * "위 기물 별 출전 표와 같은 표 형식으로 넣자") — 예전엔 `sumText()`가
 * 낸 "12전 · 7승 1무 4패 · 적격파 19" 한 줄짜리 문장이었다. 승·무·패를
 * 각자 칸으로 가르니 `sumText()`를 더 안 쓴다(문장 조립 함수라 표 칸에는
 * 안 맞는다) — `RecordTally`의 필드(`plays`·`wins`·`draws`·`losses`·`kills`)를
 * 그대로 한 칸씩 그린다, 다른 화면(`RecordsScreen`)은 여전히 그 문장을 쓴다.
 *
 * **부대 이름·아이콘 같은 카드 고유 정보(그림·이름·등급·Lv)는 다시 안 그린다** —
 * 이미 카드가 보여주고 있다. 대신 `LevelUpPanel`의 `.lvp-title`과 같은 자리에
 * 「등급 · 이름 · Lv」만 다시 얹어 지금 누구의 전적인지 헷갈리지 않게 한다.
 *
 * **판의 윗변은 카드 그림이 아니라 카드 자체가 시작하는 지점이다**
 * (`useOfficerCardOverlayPos('top')`, 2026-09-03 지정 — "이 패널은 좀 더
 * 길어도 되니까, 시작점을 장수 정보 패널과 똑같은 y 위치에서"). 표가
 * 기물별·모드별·최근 이력 셋이라 [레벨/스킬 관리]보다 내용이 길다 — 카드
 * 그림 아래(`'art'`, `LevelUpPanel`의 기준)부터 시작하면 자주 잘린다.
 *
 * **필터는 장수 일람의 [정렬 필터]와 같은 틀**(`.ofc-sortrow` +
 * `.ofc-sort-current` + `SortMenu`)을 쓴다(2026-09-03 지정 — "필터 버튼과
 * 필터 상태 표출 버튼과 같은 구성으로") — 세 버튼을 늘 펴 두던 것 대신,
 * 지금 기준을 보여주는 나무판 하나 + 누르면 뜨는 팝업 하나다. `SortMenu`가
 * 이미 그 모양이라(장수 일람·랭킹 셋) `buttonLabel`만 「필터」로 바꿔 그대로
 * 재사용한다 — 새 컴포넌트를 만들지 않는다.
 *
 * **최근 대전이 없으면 여덟 칸짜리 이력 표 자체를 안 그린다**(2026-09-03
 * 지정 — "최근 대전이 없다면 아예 이 틀을 보여주지 말고, 문구만"). 그
 * 표는 좁은 패널 폭 안에 여덟 칸(구성·부대·전투력·상대·부대·전투력·예상·
 * 결과)을 욱여넣는 그리드라 데이터가 없을 때 머리글만 떠 있으면 칸이
 * 눌려 글자가 겹쳐 보인다 — 어차피 보여줄 값이 없는 머리글이니 아예 뺀다.
 */

import { officerById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { RECORD_FILTERS, modeRows, pieceRows, recentMatches, totalTally } from '@samchess/meta';
import type { PlayerProfile, RecordFilter } from '@samchess/meta';
import { useState } from 'react';
import { FILTER_KEY, SortMenu, useOfficerCardOverlayPos } from './RankingCommon.tsx';
import { LogRow, RECENT } from './RecordsScreen.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { pickOfficerName } from '../i18n/story.ts';

export function RecordsPanel({ profile, officer, onClose }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onClose: () => void;
}): React.JSX.Element | null {
  useLang();
  const [filter, setFilter] = useState<RecordFilter>('all');
  const { backRef, backStyle, modalStyle } = useOfficerCardOverlayPos('top');

  const inst = profile.roster[officer];
  const data = officerById.get(officer);

  // 카드에서 이미 보유 확인을 했으니 정상 경로로는 안 온다 — 방어만 해 둔다
  // (`LevelUpPanel`과 같은 자리)
  if (!inst || !data) return null;

  const pieces = pieceRows(inst, filter);
  const modes = modeRows(inst, filter);
  const total = totalTally(inst, filter);
  const matches = recentMatches(profile, { filter, officer, limit: RECENT });

  return (
    <div className="lvp-back" ref={backRef} data-modal="records" onClick={onClose} style={backStyle}>
      <div
        className="place-panel lvp-modal"
        data-screen="records-panel"
        data-officer={officer}
        data-filter={filter}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ofcard-close" data-action="closeRecords" onClick={onClose} aria-label={t('ranking.card.close')}>
          <img className="ofcard-close-icon" src="icons/close.png" alt="" />
        </button>

        <h3 className="lvp-title">
          <span className="gr" data-grade={data.grade}>{data.grade}</span>
          {' '}{pickOfficerName(data)}{' '}
          <span className="lv">Lv{inst.level}</span>
        </h3>

        {/* 전체 / 온라인 / AI — 장수 일람의 [정렬 필터]와 같은 틀
            (`.ofc-sortrow` + 지금 기준 나무판 + 팝업, 위 파일 머리말 참조) */}
        <div className="ofc-sortrow">
          <span className="ofc-sort-current">{t(FILTER_KEY[filter])}</span>
          <SortMenu
            options={RECORD_FILTERS}
            value={filter}
            onChange={setFilter}
            label={(v) => t(FILTER_KEY[v])}
            buttonLabel={t('records.filterBtn')}
          />
        </div>

        <div className="rec-table">
          <div className="rec-row rec-thead">
            <span className="c-pc">{t('records.col.piece')}</span>
            <span className="c-n">{t('records.col.plays')}</span>
            <span className="c-n">{t('records.col.wins')}</span>
            <span className="c-n">{t('records.col.kills')}</span>
          </div>
          {pieces.map(({ piece, tally }) => (
            <div key={piece} className="rec-row" data-piece={piece} data-plays={tally.plays}>
              <span className="c-pc">{piece}</span>
              <span className="c-n">{tally.plays}</span>
              <span className="c-n">{tally.wins}</span>
              <span className="c-n">{tally.kills}</span>
            </div>
          ))}
        </div>

        {/* 총 출전 · 3v3 · 5v5 — 기물별 합과 언제나 같다(`sumTally()`가 낸다).
            위 기물별 표와 같은 표 형식이다(2026-09-03 지정 — "총 출전, 승 무
            패도 위 기물별 출전 표와 같은 표 형식으로") — 예전엔 「12전 · 7승
            1무 4패 · 적격파 19」 한 줄짜리 문장이었다. */}
        <div className="rec-table rec-sumtable">
          <div className="rec-row rec-thead">
            <span className="c-pc">{t('records.col.category')}</span>
            <span className="c-n">{t('records.col.plays')}</span>
            <span className="c-n">{t('records.result.win')}</span>
            <span className="c-n">{t('records.result.draw')}</span>
            <span className="c-n">{t('records.result.lose')}</span>
            <span className="c-n">{t('records.col.kills')}</span>
          </div>
          <div className="rec-row" data-sum="total">
            <span className="c-pc">{t('records.total')}</span>
            <span className="c-n">{total.plays}</span>
            <span className="c-n">{total.wins}</span>
            <span className="c-n">{total.draws}</span>
            <span className="c-n">{total.losses}</span>
            <span className="c-n">{total.kills}</span>
          </div>
          {/* 「출전 없음」은 기물별 표와 같은 신호(`data-plays="0"` → 옅게, 2026-09-03
              지정 — "한번도 출전한 적이 없으면 위 기물별 출전처럼 흐린 폰트로") */}
          {modes.map(({ mode, tally }) => (
            <div key={mode} className="rec-row" data-sum={mode} data-plays={tally.plays}>
              <span className="c-pc">{mode}</span>
              <span className="c-n">{tally.plays}</span>
              <span className="c-n">{tally.wins}</span>
              <span className="c-n">{tally.draws}</span>
              <span className="c-n">{tally.losses}</span>
              <span className="c-n">{tally.kills}</span>
            </div>
          ))}
        </div>

        <div className="rec-log">
          <h3 className="cap">{t('records.recent')}</h3>
          {/* 값이 없으면 여덟 칸짜리 표 자체를 안 그린다 — 머리글만 뜬 채
              좁은 패널 폭에 눌려 글자가 겹쳐 보이던 것(위 파일 머리말 참조) */}
          {matches.length === 0 ? (
            <p className="hint" data-field="empty">{t('records.empty')}</p>
          ) : (
            <div className="rec-rows">
              <div className="rec-log-row rec-loghead">
                <span className="c-md">{t('records.col.mode')}</span>
                <span className="c-sq">{t('records.col.squad')}</span>
                <span className="c-pw">{t('records.col.power')}</span>
                <span className="c-vs">{t('records.col.vs')}</span>
                <span className="c-sq">{t('records.col.squad')}</span>
                <span className="c-pw">{t('records.col.power')}</span>
                <span className="c-ch">{t('records.col.chance')}</span>
                <span className="c-rs">{t('records.col.result')}</span>
              </div>
              {matches.map((row) => <LogRow key={row.seq} row={row} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
