/**
 * 환경설정 팝업 — 헤더 오른쪽 기어를 누르면 뜬다 (pptx 33쪽 오른쪽)
 *
 * ```
 * 환 경 설 정
 *   ID        ⟨ID⟩ / 로그인 됨
 *   ID 기억   [ ]
 *   Language  KR
 *   화면 모드  세로
 * ```
 *
 * **어느 화면에서 열든 같은 팝업이다.** 간판·메인·궁궐·병영·장터가 전부 `ScreenChrome`을
 * 통해 이걸 연다 — 화면마다 따로 두면 항목이 하나 늘 때 다섯 군데를 고치게 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 지금 실제로 동작하는 것과 자리만 잡아 둔 것
 * ────────────────────────────────────────────────────────────────
 *
 * | 항목 | 지금 |
 * |---|---|
 * | Language | **동작한다** — 고르면 곧바로 바뀌고 새로고침해도 남는다 |
 * | 배경음악 | **동작한다** — `M` 키와 같은 스위치다(HANDOFF 「음소거 단추를 어디에 둘지」) |
 * | ID · ID 기억 | **자리만.** 계정·로그인은 별도 세션에서 붙인다(기획자 지정) |
 * | 화면 모드 | **세로 고정.** 프레임이 1:2라 지금은 고를 것이 없다 |
 *
 * 자리만 잡아 둔 것을 「눌리는데 아무 일도 없는 스위치」로 두지 않는다 — 잠가 두고
 * 왜 잠겼는지 한 줄로 적는다. 「왜 안 되지」를 남기지 않기 위해서다.
 */

import { bgmMuted, setBgmMuted } from '../audio/bgm.ts';
import { LANGS, setLang, t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function SettingsModal({ signedIn, onClose }: {
  signedIn: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const lang = useLang();
  const muted = bgmMuted();

  return (
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다 */}
      <div className="modal" data-modal="settings" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl">{t('settings.title')}</h2>

        <div className="opt-row">
          <span className="k">{t('settings.account')}</span>
          <span className="v dim">{signedIn ?? '—'}</span>
        </div>
        <div className="opt-row">
          <span className="k" />
          <span className="v dim">{signedIn ? t('settings.signedIn') : t('settings.signedOut')}</span>
        </div>

        <div className="opt-row">
          <span className="k">{t('settings.language')}</span>
          <div className="v langs">
            {LANGS.map((l) => (
              <button
                key={l.id}
                className={`opt${lang === l.id ? ' on' : ''}`}
                data-lang={l.id}
                onClick={() => setLang(l.id)}
              >{l.short}</button>
            ))}
          </div>
        </div>
        <p className="hint">{LANGS.find((l) => l.id === lang)?.label}</p>

        <div className="opt-row">
          <span className="k">{t('settings.sound')}</span>
          <button
            className={`opt v${muted ? '' : ' on'}`}
            data-action="mute"
            onClick={() => setBgmMuted(!muted)}
          >{muted ? t('settings.soundOff') : t('settings.soundOn')}</button>
        </div>

        <div className="opt-row">
          <span className="k">{t('settings.orientation')}</span>
          {/* 프레임이 1:2 고정이라 고를 것이 없다 (pptx 20쪽) */}
          <button className="opt v on" disabled>{t('settings.portrait')}</button>
        </div>

        <button className="btn ghost wide" onClick={onClose}>{t('settings.close')}</button>
      </div>
    </div>
  );
}
