/**
 * 태학 연구 완료 — 축하 화면 (GDD §5.12, 2026-09-22 기획자 지정 · 2026-11-20 공용 축하 화면 `Celebrate`로).
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
import { SchoolIcon, TacticIcon } from './TacticIcon.tsx';
import { Celebrate } from './Celebrate.tsx';

export function AcademyNotice({ profile, onOk }: {
  profile: PlayerProfile;
  onOk: () => void;
}): React.JSX.Element | null {
  useLang();
  const items = (profile.academy?.notice ?? []).map((id) => upgradeDef(id)).filter((d) => !!d);
  if (items.length === 0) return null;
  // 판 · 연출은 공용 축하 화면(`Celebrate`, 2026-11-20 기획자 — 「연구 완료」 예시): 두루마리 위에 개량된 책략의 엠블럼이 내려찍힌다.
  // 둘 이상 끝났으면(오프라인 중) 엠블럼은 첫 것, 아래 줄은 전부
  return (
    <Celebrate
      key={items.map((d) => d.id).join('+')}   // 다른 알림이 이어 오면 새로 그린다(닫히는 중인 화면을 재사용하지 않게)
      modal="academyNotice"
      okAction="academyNoticeOk"
      className="acd-cel"
      tone="plain"
      title={t('academy.notice.title')}
      art={<img className="cel-art-img" src="ui/cel-scroll.png" alt="" />}
      badge={<TacticIcon id={items[0]!.id} className="acd-cel-emblem" />}
      onClose={onOk}
    >
      {items.map((up) => {
        const base = up.base ? tacticById.get(up.base) : undefined;
        const baseName = base ? pickTacticName(base) : '';
        const n = officersUsingUpgrade(profile, up.id);
        return (
          <div key={up.id} className="acd-notice-item" data-tactic={up.id}>
            {/* 머리줄 — 태학 [연구하기] 목록과 같은 표식: 연구 레벨 · 학파 칩 · 이름 (2026-09-22 지정) */}
            <p className="acd-notice-nm">
              {up.academyLevel !== undefined && <span className="acd-lv">Lv{up.academyLevel}</span>}
              <SchoolIcon school={up.school} className="acd-school" />
              <span className="acd-name">{pickTacticName(up)}</span>
              <span className="acd-cel-mp" data-field="mp" data-mp={up.mpCost}>(MP: {up.mpCost})</span>
            </p>
            <p className="acd-cel-effect" data-field="effect">{pickTacticText(up)}</p>
            <p className="acd-notice-apply" data-field="apply" data-count={n}>
              {n > 0 ? t('academy.notice.apply', { base: baseName, n }) : t('academy.notice.none', { base: baseName })}
            </p>
          </div>
        );
      })}
    </Celebrate>
  );
}
