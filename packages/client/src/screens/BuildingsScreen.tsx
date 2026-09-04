/**
 * 건물 관리 (pptx 56쪽 · 2026-09-04 두 번째 손질에서 도시 관리에서 갈라져 나왔다)
 *
 * ```
 * [← 도시 관리로]        건물 관리
 *  건물                남은 건설 기회 6회
 *  궁궐   Lv1  캐릭터 풀 60 → 110   [증축]
 *  …
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 도시 관리에서 뗐나 ★
 * ────────────────────────────────────────────────────────────────
 *
 * 도시 관리(41쪽)가 **현황판**이 됐다 — 지은 것과 그 값을 읽는 자리다. 짓고
 * 올리는 **행위**는 여기 하나로 모은다. 한 화면이 「지금 어떤가」와 「무엇을
 * 할까」를 같이 지면 잠긴 단추 일곱과 그 이유가 현황을 덮는데, Lv1 계정은
 * 일곱 줄이 **전부 잠겨 있다**(도시 Lv2부터 만질 수 있다) — 아무것도 못 하는
 * 단추 일곱이 화면의 절반이었다.
 *
 * **「남은 건설 기회」도 여기서만 뜬다** — 쓸 데가 없는 화면(현황판)에 숫자만
 * 떠 있으면 「이걸로 뭘 하라는 거지」가 남는다. 기회를 실제로 쓰는 자리가 여기다.
 *
 * 판정도 계산도 서버가 한다(`POST /city/build`) — `PUT /profile`이 `buildings`·
 * `buildCredits`를 버리므로 로컬로 계산해 올리면 조용히 삼켜진다. 못 닿으면
 * 로컬로 물러나고(§5-61), 규칙이 거부한 것(400)은 그대로 보여 준다.
 */

import { useState } from 'react';
import { applyBuild, buildCreditsLeft, buildingLevel, buildingRows } from '@samchess/meta';
import type { BuildingRow, PlayerProfile } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import { buildingStatusText } from './buildingText.ts';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { buildOnServer } from '../meta/city.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function BuildingsScreen({ profile, onBack, onChange }: {
  profile: PlayerProfile;
  onBack: () => void;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  useLang();
  /** 서버가 거부한 이유. **규칙이 한 말을 그대로 보여 준다** — 화면이 다시 짓지 않는다 */
  const [refused, setRefused] = useState<string | null>(null);
  /** 서버 왕복 중에는 두 번 누르지 못하게 한다 — 기회를 두 번 쓴다 */
  const [busy, setBusy] = useState(false);
  /**
   * 방금 무엇이 끝났나 — **닫아야** 새 줄이 보인다(도시 증축과 같은 결, 2026-09-04).
   *
   * **레벨은 서버가 준 계정에서 읽는다**(`+1`로 짐작하지 않는다). `isNew`는
   * 「없던 것을 세웠나」로, 팝업의 제목이 그것으로 갈린다.
   */
  const [done, setDone] = useState<{ id: BuildingId; level: number; isNew: boolean } | null>(null);

  const rows = buildingRows(profile);
  const credits = buildCreditsLeft(profile);

  /**
   * 한 줄에 적을 말. 기본은 규칙이 낸 `row.line`(증분)이고 **셋만 갈아 끼운다.**
   *
   * | 건물 | 왜 |
   * |---|---|
   * | 시장·대장간 | 값이 아예 없어(품목 표 미정) 규칙이 낼 줄이 없다. 「구매 장비 — 품목 미정」은 **없는 것**만 말하고 **하는 일**을 안 말한다 |
   * | 아직 없는 농지 | 「시간당 군량 2」는 지금 값(1)과 헷갈린다 — 지으면 **얼마가 느는지**(+1)가 판단에 필요한 값이다 |
   *
   * 늘어나는 폭도 규칙이 낸 값에서 뺀다(`next − now`) — 엑셀이 바뀌면 따라온다.
   * 문장이 i18n에 있는 이유는 `CityScreen`의 같은 자리와 같다(엑셀 문장은 번역이 없다).
   */
  const lineOf = (row: BuildingRow): string => {
    if (row.id === 'market') return t('city.bld.market.what');
    if (row.id === 'forge') return t('city.bld.forge.what');
    if (row.id === 'farm' && row.level === 0 && row.effect?.next != null) {
      return t('city.bld.farm.gain', { n: row.effect.next - row.effect.now });
    }
    return row.line ?? t('city.bld.pending', { what: row.purpose });
  };

  const build = (id: BuildingId): void => {
    setRefused(null);
    setBusy(true);
    void (async () => {
      try {
        // **레벨은 「받은 계정」에서 읽는다** — `+1`로 짐작하면 서버가 다른 판정을
        // 했을 때 팝업만 거짓말을 한다(도시 증축과 같은 규약)
        const wasNew = buildingLevel(profile, id) === 0;
        const fromServer = await buildOnServer(id);
        const next = fromServer ?? applyBuild(profile, id, Date.now());
        onChange(next);
        setDone({ id, level: buildingLevel(next, id), isNew: wasNew });
      } catch (err) {
        setRefused(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScreenChrome
      backdrop={placeBackdrop('palace', profile.cityLevel)}
      className="scr-city"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="buildings" data-city-level={profile.cityLevel}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('city.records.back'))}
        </button>
        <span className="place-nm">{t('city.buildings.manage')}</span>
      </div>

      <div className="place-body">
        {/* **못 짓는 줄도 빼지 않는다** — 무엇이 있는지 안 보이면 도시를 왜
            올리는지 알 수 없다. 대신 잠긴 단추 옆에 규칙이 이유를 적는다.
            (현황판인 도시 관리는 반대로 **지은 것만** 그린다 — 뜻이 다르다) */}
        <section className="place-panel cty-blds">
          <p className="cty-blds-head">
            <span className="cap">{t('city.buildings')}</span>
            <b className="v" data-field="credits">
              {credits === null
                ? t('city.credits.free')
                : t('city.credits.n', { n: credits })}
            </b>
          </p>

          {rows.map((row) => (
            <div className="cty-bld" key={row.id} data-building={row.id} data-level={row.level}>
              <span className="nm">{row.name}</span>
              <span className="lv">{row.level > 0 ? `Lv${row.level}` : t('city.bld.none')}</span>
              {/* **「지었나」로 갈라 고르는 것은 여전히 규칙이다**(`row.line`) —
                  화면은 규칙이 낼 줄이 없는 셋만 갈아 끼운다(`lineOf` 주석) */}
              <span className="fx">{lineOf(row)}</span>
              <button
                className="btn ghost sm"
                data-action="build"
                disabled={!row.can.ok || busy}
                title={row.can.ok ? '' : row.can.reason}
                onClick={() => build(row.id)}
              >
                {row.level === 0 ? t('city.bld.make') : t('city.bld.up')}
              </button>
            </div>
          ))}

          {/* 잠긴 단추만 두면 「고장인가」가 남는다 — **첫 줄의 이유만** 적는다.
              일곱 줄이 같은 이유(도시 레벨·기회 소진)로 잠기는 것이 보통이라
              일곱 번 적으면 시끄럽다 */}
          {rows.every((r) => !r.can.ok) && rows[0] && !rows[0].can.ok && (
            <p className="note" data-field="whyBuild">{rows[0].can.reason}</p>
          )}
          {/* 화면은 눌리는데 서버가 거부한 경우 — 서버가 한 말을 그대로 옮긴다 */}
          {refused && <p className="note" data-field="refused">{refused}</p>}
        </section>
      </div>

      {/* 끝났다 — 확인을 누르면 새 레벨이 적힌 줄이 드러난다 (도시 증축과 같은 결) */}
      {done && (
        <BuildDoneModal
          profile={profile}
          id={done.id}
          level={done.level}
          isNew={done.isNew}
          onClose={() => setDone(null)}
        />
      )}

      {/* 짓기·증축도 서버 왕복이다 — 왕복이 길면 가리개가 뜬다(`BusyVeil.tsx`) */}
      {busy && <BusyVeil label={t('city.build.busy')} />}
    </ScreenChrome>
  );
}

/**
 * 짓기·증축이 **끝났다** — 도시 증축의 축하 팝업(`.cty-done`)과 **같은 판**을 쓴다.
 *
 * 판을 새로 만들지 않는 이유는 뜻이 같아서다 — 「값을 치르고 무언가가 한 칸
 * 올라갔다」. 갈리는 것은 제목과 가운데 줄뿐이다.
 *
 * ★ **한글 조사를 짓지 않는다.** 「태학이 / 농지가」처럼 받침에 따라 갈리는 말을
 * 만들려면 이름마다 규칙이 필요하고, 그건 열 언어로 번역될 수도 없다. 그래서
 * **이름과 값을 각자 제 줄에** 놓는다 — 「태학」 / 「장수 훈련 · 보정 2」.
 * 값 문장은 도시 관리·산 너머와 **같은 자리**(`buildingText.ts`)가 낸다.
 */
function BuildDoneModal({ profile, id, level, isNew, onClose }: {
  profile: PlayerProfile; id: BuildingId; level: number; isNew: boolean; onClose: () => void;
}): React.JSX.Element {
  const row = buildingRows(profile).find((r) => r.id === id);
  const credits = buildCreditsLeft(profile);
  return (
    <div className="modal-back" data-modal="buildDone" onClick={onClose}>
      <div className="modal cty-modal cty-done" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl" data-field="doneTitle">
          {t(isNew ? 'city.bld.done.built' : 'city.bld.done.up')}
        </p>
        <p className="cty-done-lv" data-field="doneLevel">Lv{level}</p>
        <p className="row" data-field="doneName">{row?.name ?? id}</p>
        {row && <p className="row dim">{buildingStatusText(profile, row)}</p>}
        {credits !== null && <p className="row dim">{t('city.credits.n', { n: credits })}</p>}
        <button className="btn primary wide" data-action="doneOk" onClick={onClose}>
          {t('city.done.ok')}
        </button>
      </div>
    </div>
  );
}
