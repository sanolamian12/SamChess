/**
 * 새 편성 만들기 — 첫 걸음 (pptx 43쪽)
 *
 * ```
 * [← 목록으로]      새 편성 만들기
 *  부대 이름   [                    ]   부대 이름을 입력해주세요.
 *  구성을 선택해주세요.   [3 vs 3]  [5 vs 5]
 *                                          [다음]
 * ```
 *
 * **걸음을 따로 둔 화면으로 뺐다.** 편성 화면 안에서 `이름 아직 ? 이것 : 저것`으로
 * 접을 수도 있었지만, B에서 상태 셋을 한 화면에 접었다가 「재설계 — Lv2 고르는 중」이
 * 떠 있는 것을 **700px 스크린샷을 찍고서야** 본 적이 있다. 43쪽도 화면을 나눠 그렸다.
 *
 * **참여 인원은 여기서만 정한다.** 만든 뒤에는 못 바꾼다(`updateSquad`가 던진다) —
 * 모드가 바뀌면 구성도 배치 좌표도 통째로 뜻이 없어진다.
 */

import { useState } from 'react';
import { SQUAD_NAME_MAX, validateSquadName } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import type { BattleMode } from '@samchess/rules';
import { currentSession } from '../meta/auth.ts';
import { placeBackdrop } from './backdrop.ts';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

const MODES: BattleMode[] = ['3v3', '5v5'];

export function SquadNameScreen({ profile, initial, onBack, onNext }: {
  profile: PlayerProfile;
  /** 다음 걸음(부대원)에서 [뒤로 가기]로 돌아왔을 때 적어 둔 값 — 다시 치지 않게 */
  initial?: { name: string; mode: BattleMode };
  onBack: () => void;
  onNext: (name: string, mode: BattleMode) => void;
}): React.JSX.Element {
  useLang();
  const [name, setName] = useState(initial?.name ?? '');
  const [mode, setMode] = useState<BattleMode | null>(initial?.mode ?? null);

  // **이름 판정은 규칙이 한다** — 12자·중복을 화면이 다시 적으면 조용히 갈린다
  const check = validateSquadName(profile, name);
  const ready = check.ok && mode !== null;

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-squad-new"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="squadNew">
        {/* 그림 화살표(`::before`)를 입혔으므로 문구의 「← 」는 뗀다 — 병영·부대
            목록과 같은 자리(`RankingCommon.tsx`의 `stripBackArrow` 머리말).
            **편성 화면(`SquadEditScreen`)은 아직 안 뗀다** — 거기는 리스킨 전이라
            글자 화살표가 유일한 신호다. 같은 문구를 두 화면이 나눠 쓰지만 뜻이
            갈리는 것은 「그림이 있는가」뿐이라, 문구 자체는 안 건드린다. */}
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('squad.cancel'))}
        </button>
        <span className="place-nm">{t('squad.new.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel sqd-form">
          <label className="sqd-label" htmlFor="squad-name">{t('squad.new.name')}</label>
          <input
            id="squad-name"
            className="field"
            data-field="name"
            value={name}
            maxLength={SQUAD_NAME_MAX}
            placeholder={t('squad.new.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="hint" data-field="nameNote" data-count={[...name.trim()].length}>
            {t('squad.new.limit', { max: SQUAD_NAME_MAX, n: [...name.trim()].length })}
          </p>
          {/* 빈 이름은 위 안내가 이미 말한다 — 중복 같은 **다른 이유**만 따로 적는다 */}
          {name.trim() !== '' && !check.ok && (
            <p className="note" data-field="nameWhy">{check.reason}</p>
          )}

          <p className="sqd-label">{t('squad.new.mode')}</p>
          <div className="sqd-modes">
            {MODES.map((m) => (
              <button
                key={m}
                className={`btn${mode === m ? ' primary' : ''}`}
                data-mode={m}
                data-on={mode === m ? '1' : '0'}
                onClick={() => setMode(m)}
              >
                {m === '3v3' ? '3 vs 3' : '5 vs 5'}
              </button>
            ))}
          </div>

          <button
            className="btn wide primary"
            data-action="next"
            disabled={!ready}
            onClick={() => mode && onNext(name.trim(), mode)}
          >
            {t('squad.new.next')}
          </button>
        </section>

        {/* [뒤로 가기] — 판 **아래** 따로 선 단추 판(70쪽). 제목 바의 [목록으로]와
            같은 일이지만, 손이 판을 따라 내려온 자리에 문이 하나 더 있어야 한다
            (대장간 팝업의 [뒤로 가기]와 같은 판단). */}
        <section className="place-panel sqd-acts">
          <button className="btn wide" data-action="backBottom" onClick={onBack}>
            {stripBackArrow(t('match.back'))}
          </button>
        </section>
      </div>
    </ScreenChrome>
  );
}
