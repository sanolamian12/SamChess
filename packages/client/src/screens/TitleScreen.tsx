/**
 * 간판·로그인 화면 — 게임 URL로 들어오면 가장 먼저 뜨는 화면 (pptx 33·34쪽)
 *
 * ```
 * ┌──────────────────────────┐
 * │ 만민의 삼국지        ⚙   │  ← 제목 · 환경설정 (ScreenChrome)
 * │                          │
 * │      (시간대 배경)        │  ← openBackground.png 의 지금 시간대 칸
 * │                          │
 * │  [ ID                 ]  │
 * │  [        입장        ]  │
 * │  [      계정 생성      ]  │
 * └──────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 이 세션에서 붙인 것은 **길**뿐이다
 * ────────────────────────────────────────────────────────────────
 *
 * 계정 생성과 로그인의 실제 구현(인증·SSO·중복 확인)은 **별도 세션**에서 하기로
 * 기획자가 정했다. 지금 「입장」은 곧바로 메인으로 간다.
 *
 * 그래서 ID 칸을 **막지 않았다.** 눌리지도 않는 칸을 두면 「고장인가」로 보이고,
 * 반대로 아예 빼 두면 나중에 붙일 때 화면 배치를 다시 잡게 된다. 지금은 적은 값이
 * 그냥 쓰이지 않을 뿐이고, 그 사실을 화면 아래 한 줄로 적어 둔다.
 */

import { useState } from 'react';
import { currentBand, openBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function TitleScreen({ onEnter, onSignUp }: {
  onEnter: () => void;
  onSignUp: () => void;
}): React.JSX.Element {
  useLang();                                  // 언어를 바꾸면 이 화면도 다시 그린다
  const [id, setId] = useState('');
  // 배경은 **화면이 뜰 때 한 번** 정한다. 매 렌더마다 새 `Date`를 만들면 자정에 걸친
  // 판에서 그림이 깜빡일 수 있고, 어차피 한 화면에 머무는 동안 바뀔 일이 아니다.
  const [band] = useState(currentBand);

  return (
    <ScreenChrome backdrop={openBackdrop(band)} className="scr-title" account={null}>
      <div className="title-form">
        <input
          className="field"
          value={id}
          maxLength={20}
          placeholder={t('title.id')}
          data-field="id"
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
        />
        <button className="btn primary wide" data-action="enter" onClick={onEnter}>{t('title.enter')}</button>
        <button className="btn wide" data-action="signup" onClick={onSignUp}>{t('title.signup')}</button>
        <p className="hint">{t('title.later')}</p>
      </div>
    </ScreenChrome>
  );
}
