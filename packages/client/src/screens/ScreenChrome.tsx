/**
 * 화면 틀 — 배경 그림 + 「제목 · 기어」 헤더 (pptx 33·35쪽)
 *
 * 간판·메인·궁궐·병영·장터가 전부 이걸 두른다. 세 가지를 한자리에 모아 둔 이유는
 * 각각 다르다.
 *
 * | 모은 것 | 왜 |
 * |---|---|
 * | 배경 그림 | 그림이 **없어도 화면이 돌아야** 한다. 그 물러나기를 한 곳에서만 적는다 |
 * | 헤더 | 제목과 기어의 자리가 화면마다 달라지면 기어를 눈으로 찾게 된다 |
 * | 환경설정 팝업 | 어느 화면에서 열든 같은 팝업이다 (`SettingsModal` 주석 참조) |
 *
 * **배경은 `<div>`의 `background-image`다.** `<img>`로 깔면 그 위에 올리는 것들의
 * 쌓임 순서를 일일이 정해야 하고, `cover`로 채우는 것도 CSS 쪽이 짧다.
 */

import { useState } from 'react';
import { backdropStyle } from './backdrop.ts';
import { SettingsModal } from './SettingsModal.tsx';
import { t } from '../i18n/index.ts';

export function ScreenChrome({ backdrop, className, account, children }: {
  /** `backgrounds/…png`. 없으면(에셋 미수신) 바탕색만 남는다 */
  backdrop: string;
  className: string;
  /** 로그인한 ID. 아직 계정이 붙지 않아 늘 `null`이다 — 환경설정이 이 값을 보여준다 */
  account?: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const [settings, setSettings] = useState(false);

  return (
    <div className={`scr scr-bg ${className}`} style={backdropStyle(backdrop)}>
      <header className="scr-head">
        <h1 className="brand">{t('game.title')}</h1>
        <button className="gear" data-action="settings" aria-label={t('settings.title')} onClick={() => setSettings(true)}>
          <GearIcon />
        </button>
      </header>

      {children}

      {settings && <SettingsModal signedIn={account ?? null} onClose={() => setSettings(false)} />}
    </div>
  );
}

/**
 * 기어. 그림 파일을 두지 않고 그린다 — 아이콘 하나 때문에 에셋 파이프라인을 늘리면
 * 「없으면 건너뛴다」 규칙에 걸려 **기어가 안 보이는 화면**이 생길 수 있다.
 */
function GearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" strokeLinecap="round" />
    </svg>
  );
}
