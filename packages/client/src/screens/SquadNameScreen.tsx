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

export function SquadNameScreen({ profile, onBack, onNext }: {
  profile: PlayerProfile;
  onBack: () => void;
  onNext: (name: string, mode: BattleMode) => void;
}): React.JSX.Element {
  useLang();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<BattleMode | null>(null);

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
          <p className="hint" data-field="nameNote">
            {name.trim() === '' ? t('squad.new.limit', { max: SQUAD_NAME_MAX }) : (check.ok ? '' : check.reason)}
          </p>

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
      </div>
    </ScreenChrome>
  );
}
