/**
 * 도시 이름 변경 — 메인 머리의 도시 이름 오른쪽 둥근 배지(붓) (2026-11-19 기획자 — 궁궐 현황판에서 옮겼다).
 *
 * 서버가 한다(금화 · 쿨다운이 서버 소유, A1). 못 닿으면 물러나지 않고 내관이 말한다. 팝업 · 가리개 · 기다림 막은
 * **화면(`.scr`) 바로 밑으로 포털** — 메인 머리 줄 안에 두면 그 줄에 갇혀 화면 위쪽에 붙었다(장터 인장 팝업 `CityBonus`와 같은 결).
 * 포털이라도 React 이벤트는 단추의 부모로 올라간다 — 팝업 클릭을 막는 것은 `RenameModal`이 한다.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CITY_NAME_MAX, CITY_RENAME_GOLD, canRenameCity, normalizeCityName } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import { renameCityOnServer } from '../meta/city.ts';
import { BusyVeil } from './BusyVeil.tsx';
import { GameIcon } from './GameIcon.tsx';
import { Say } from './Steward.tsx';
import { errorText, reasonText } from '../i18n/reason.ts';

export function CityRenameButton({ profile, onChange }: {
  profile: PlayerProfile;
  onChange: (next: PlayerProfile) => void;
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const layer = (): HTMLElement => (ref.current?.closest('.scr') as HTMLElement | null) ?? document.body;
  const rename = (name: string): void => {
    setRenaming(false);
    setRefused(null);
    setBusy(true);
    void (async () => {
      try {
        const fromServer = await renameCityOnServer(name);
        if (fromServer) onChange(fromServer);
        else setRefused(t('server.offline'));
      } catch (err) {
        setRefused(errorText(err));
      } finally {
        setBusy(false);
      }
    })();
  };
  return (
    <>
      {/* 붓 아이콘(`mk-edit`)을 둥근 배지로, 글자 없이. 이름은 올리면 · 낭독기에 */}
      <button ref={ref} className="city-rename" data-action="rename" title={t('city.rename')} aria-label={t('city.rename')} onClick={() => setRenaming(true)}>
        <GameIcon name="mk-edit" label={t('city.rename')} />
      </button>
      <Say text={refused} level={profile.cityLevel} name="refused" />
      {renaming && createPortal(<RenameModal profile={profile} onClose={() => setRenaming(false)} onConfirm={rename} />, layer())}
      {busy && createPortal(<BusyVeil />, layer())}
    </>
  );
}

/**
 * 도시 이름 변경 확인 — 랭킹·매칭에 노출될 이름이라 값싼 재설정을 막는
 * 관문(2026-08-25 기획: 금화 소모 + 3일 쿨다운). 값이 나가고 되돌릴 수 없는
 * 수라 증축과 같은 결로 한 번 묻는다. **왜 안 되는지는 `canRenameCity()`가
 * 말한다** — 잠긴 단추만 두면 화면이 「고장인가」로 읽힌다.
 */
function RenameModal({ profile, onClose, onConfirm }: {
  profile: PlayerProfile; onClose: () => void; onConfirm: (name: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(profile.cityName);
  const check = canRenameCity(profile, name, Date.now());
  // 빈 이름 · 지금과 같은 이름은 말하지 않는다 — 이름을 바꾸러 들어온 판이라 [변경한다]가 막힌 까닭이 빤하다(2026-11-19 기획자).
  // 쿨다운 · 금화처럼 판만 봐서는 모를 것만 내관이 말한다
  const typed = normalizeCityName(name);
  const why = !check.ok && typed && typed !== profile.cityName ? reasonText(check) : null;

  return (
    <div className="modal-back" data-modal="rename" onClick={onClose}>
      <div className="modal mod-plank cty-modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{t('city.rename.title')}</p>
        <input
          className="field"
          autoComplete="off"
          value={name}
          maxLength={CITY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && check.ok) onConfirm(name); }}
          autoFocus
        />
        <p className="row dim" data-field="cost">{t('city.rename.cost', { gold: CITY_RENAME_GOLD })}</p>
        <Say text={why} level={profile.cityLevel} name="why" />
        <div className="cty-acts">
          <button
            className="btn primary wide"
            data-action="renameConfirm"
            disabled={!check.ok}
            onClick={() => onConfirm(name)}
          >
            {t('city.rename.ok')}
          </button>
          <button className="btn wide" data-action="renameCancel" onClick={onClose}>
            {t('city.rename.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
