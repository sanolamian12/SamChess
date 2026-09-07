/**
 * 고유기술 팝업 (pptx 38쪽 아래)
 *
 * ```
 * 기술 명   : 賈詡之策 (가후지책)   ← 한자 원문이 먼저, 괄호 안은 지금 언어의 읽는 법
 * 기술 유래 : 두 세줄 정도          ← G1이 채운다. 없으면 이 줄이 사라진다
 * 기술 효과 : 한, 두줄 정도의 설명
 * 소모 SP  : 6                     ← 2026-09-03, SP를 이름 줄에서 옮겼다
 * 발동 시간 : 0.3일 후 / 즉시        ← [뒤로] 바로 위(2026-09-07 시전 지연)
 *                                   [뒤로]
 * ```
 *
 * **배너는 없어도 된다.** `public/skills/{기술id}.jpg` 40장은 전투의 발동 연출과
 * 같은 그림인데, 에셋이 리포에 없어(기획자 방침) 받아 오기 전에는 404다 —
 * 그때는 그림 자리만 사라지고 글자는 그대로다.
 *
 * **환경설정 팝업과 같은 껍데기(`.modal-back` · `.modal`)를 쓴다.** 팝업이 화면마다
 * 다른 모양이면 「닫는 곳」을 눈으로 찾게 된다.
 */

import type { UniqueSkillData } from '@samchess/data';
import { skillArtUrl } from '../ui/art.ts';
import { t } from '../i18n/index.ts';
import { pickCastDelay, pickStory, pickSkillName, pickSkillText } from '../i18n/story.ts';

export function SkillModal({ skill, onClose }: {
  skill: UniqueSkillData;
  onClose: () => void;
}): React.JSX.Element {
  const origin = pickStory(skill.origin);
  const name = pickSkillName(skill);
  const text = pickSkillText(skill);
  // 배경 패널이 등급별로 두 장(S+E급 / A+B급)이다 — `style.css`의
  // `.ofc-skill-modal[data-tier-group]` 참조.
  const tierGroup = skill.tier === 'S' || skill.tier === 'E' ? 's-e' : 'a-b';
  return (
    <div className="modal-back" data-modal="skill" onClick={onClose}>
      <div className="modal ofc-skill-modal" data-tier-group={tierGroup} onClick={(e) => e.stopPropagation()}>
        <img
          className="ofc-banner"
          alt=""
          src={skillArtUrl(skill.id)}
          onError={(e) => { e.currentTarget.classList.add('no-art'); }}
        />
        <p className="row">
          <span className="k">{t('skill.name')}</span> : <b>{skill.hanja}</b>
          <span className="reading">({name})</span>
        </p>
        {/* S/E급 고사 유래만 채워져 있다 — 없으면(A/B급) 줄째로 빠진다 */}
        {origin && (
          <p className="row" data-field="origin">
            <span className="k">{t('skill.origin')}</span> : {origin}
          </p>
        )}
        <p className="row" data-field="effect">
          <span className="k">{t('skill.effect')}</span> : {text}
        </p>
        <p className="row" data-field="sp">
          <span className="k">{t('skill.sp')}</span> : {skill.spCost}
        </p>
        {/*
          발동 시간 — 「즉시」 또는 「0.3일 후」 (2026-09-07 시전 지연, GDD §3.6).
          **지연이 0인 기술도 줄을 띄운다** — 「즉시」라고 적혀 있어야 「이 기술은
          시간이 안 걸린다」를 읽을 수 있다. 줄째로 빼면 27종은 시전 지연이라는
          개념 자체를 모른 채 지나간다(`origin`은 없으면 빼는데, 그건 「없는 것」이고
          이쪽은 「즉시라는 값」이라 다르다).
        */}
        <p className="row" data-field="castDelay">
          <span className="k">{t('skill.castDelay')}</span> : {pickCastDelay(skill)}
        </p>
        <button className="btn wide" data-action="close" onClick={onClose}>{t('skill.close')}</button>
      </div>
    </div>
  );
}
