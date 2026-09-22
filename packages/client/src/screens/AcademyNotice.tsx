/**
 * 태학 연구 완료 — 축하 팝업 (GDD §5.12, 2026-09-22 기획자 지정).
 *
 * **전투가 아닌 모든 화면에서** 뜬다 — 1시간 뒤 사람이 어디 있을지 모른다. 그래서
 * 태학 화면이 아니라 `App.tsx`가 그린다(도적떼 알림 `RaidAlert`와 같은 자리).
 * 무엇이 끝났는지는 서버가 `academy.notice`에 적어 두고, [확인]이 `POST /academy/ack`로
 * 비운다 — 오프라인 중에 끝나도, 다른 기기로 들어와도 한 번은 뜬다.
 *
 * 「N명에게 일괄 적용」의 N은 `officersUsingUpgrade()`(meta)가 센다 — 화면이 성장 스택을
 * 직접 펴지 않는다(`tacticsOf()`만 부른다는 규칙).
 */

import { tacticById } from '@samchess/data';
import { officersUsingUpgrade, upgradeDef } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { pickTacticName, pickTacticText } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function AcademyNotice({ profile, busy, onOk }: {
  profile: PlayerProfile;
  busy: boolean;
  onOk: () => void;
}): React.JSX.Element | null {
  useLang();
  const items = (profile.academy?.notice ?? []).map((id) => upgradeDef(id)).filter((d) => !!d);
  if (items.length === 0) return null;
  return (
    <div className="modal-back" data-modal="academyNotice">
      <div className="modal frg-confirm acd-notice">
        <p className="modal-ttl">{t('academy.notice.title')}</p>
        {items.map((up) => {
          const base = up.base ? tacticById.get(up.base) : undefined;
          const baseName = base ? pickTacticName(base) : '';
          const n = officersUsingUpgrade(profile, up.id);
          return (
            <div key={up.id} className="acd-notice-item" data-tactic={up.id}>
              <p className="acd-notice-nm">{pickTacticName(up)}</p>
              <p className="frg-confirm-body">{pickTacticText(up)}</p>
              <p className="frg-confirm-body acd-notice-apply" data-field="apply" data-count={n}>
                {n > 0 ? t('academy.notice.apply', { base: baseName, n }) : t('academy.notice.none', { base: baseName })}
              </p>
            </div>
          );
        })}
        <div className="frg-confirm-acts">
          <button className="btn wide primary" data-action="academyNoticeOk" disabled={busy} onClick={onOk}>
            {t('academy.notice.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
