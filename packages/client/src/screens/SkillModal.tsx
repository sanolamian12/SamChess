/**
 * 고유기술 팝업 (pptx 38쪽 아래)
 *
 * ```
 * 기술 명   : 賈詡之策 (가후지책)   ← 한자 원문이 먼저, 괄호 안은 지금 언어의 읽는 법
 * 기술 유래 : 두 세줄 정도          ← G1이 채운다. 없으면 이 줄이 사라진다
 * 기술 효과 : 한, 두줄 정도의 설명
 * 소모 SP  : 6                     ← 2026-09-03, SP를 이름 줄에서 옮겼다
 * 발동 시간 : 0.3일 후 / 즉시        ← [뒤로] 바로 위(2026-09-07 시전 지연)
 *                              [발동 영상 보기]   ← 2026-09-18
 *                                   [뒤로]
 * ```
 *
 * **[발동 영상 보기]는 전투의 연출 그 자체를 튼다** (2026-09-18 기획자 지정). 두루마리·
 * 기술 장면·라벨·효과 설명·시작 효과음·성우 대사·배경음악 멈춤까지 `SkillFx`를 그대로
 * 쓰고, 다른 것은 **덮는 자리**(판이 아니라 화면 전체, `.skl-fx`)와 **시계**(Phaser의
 * `update` 대신 `requestAnimationFrame`)뿐이다. 따로 만들면 전투 연출을 고칠 때
 * 미리보기만 옛 모습으로 남는다. 전투와 달리 **눌러서 닫을 수 있다** — 판이 멈춰
 * 기다리는 것이 아니라서 8.2초를 붙들 이유가 없다.
 *
 * **배너는 없어도 된다.** `public/skills/{기술id}.jpg` 40장은 전투의 발동 연출과
 * 같은 그림인데, 에셋이 리포에 없어(기획자 방침) 받아 오기 전에는 404다 —
 * 그때는 그림 자리만 사라지고 글자는 그대로다.
 *
 * **환경설정 팝업과 같은 껍데기(`.modal-back` · `.modal`)를 쓴다.** 팝업이 화면마다
 * 다른 모양이면 「닫는 곳」을 눈으로 찾게 된다.
 */

import { useEffect, useRef } from 'react';
import type { UniqueSkillData } from '@samchess/data';
import { skillArtUrl } from '../ui/art.ts';
import { SkillFx } from '../ui/skillFx.ts';
import { holdBgm } from '../audio/bgm.ts';
import { playSfx } from '../audio/sfx.ts';
import { playSkillVoice, stopSkillVoice } from '../audio/skillVoice.ts';
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
  const preview = useSkillPreview(skill.id);
  return (
    <div className="modal-back" data-modal="skill" onClick={onClose}>
      {/* 발동 영상 — 팝업 위를 통째로 덮는다. 누르면 닫히고, 팝업까지 닫히지 않게 여기서 멈춘다 */}
      <div
        ref={preview.host}
        className="skl-fx"
        onClick={(e) => { e.stopPropagation(); preview.stop(); }}
      />
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
        <button className="btn wide" data-action="preview" onClick={() => preview.play(name, text)}>
          {t('skill.preview')}
        </button>
        <button className="btn wide" data-action="close" onClick={onClose}>{t('skill.close')}</button>
      </div>
    </div>
  );
}

/**
 * 전투의 고유기술 연출(`SkillFx`)을 팝업 안에서 튼다. 소리 셋은 전투(`BattleScene`)와 같다.
 *
 * `SkillFx`는 제 층(`host`)의 자식을 직접 만든다 — React는 그 층을 빈 `div`로만 안다.
 * 시계는 연출이 도는 동안만 돈다(`fx.active`가 꺼지면 다음 프레임을 안 건다).
 */
function useSkillPreview(skillId: string): {
  host: React.RefObject<HTMLDivElement | null>;
  play: (name: string, text: string) => void;
  stop: () => void;
} {
  const host = useRef<HTMLDivElement | null>(null);
  const fx = useRef<SkillFx | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const player = new SkillFx(node, {
      start: () => { holdBgm(true); playSfx('specialskillstart'); },
      action: (id) => playSkillVoice(id),
      end: () => holdBgm(false),
    });
    // 팝업을 여는 순간 받아 둔다 — 누르는 순간 받으면 첫 재생의 두루마리가 건너뛴다
    player.preload([skillId]);
    fx.current = player;
    return () => {
      cancelAnimationFrame(frame.current);
      if (player.active) stopSkillVoice();
      player.stop();          // 도는 중에 화면이 바뀌어도 배경음악을 붙든 채 두지 않는다
      fx.current = null;
    };
  }, [skillId]);

  const play = (name: string, text: string): void => {
    const player = fx.current;
    if (!player) return;
    cancelAnimationFrame(frame.current);
    player.play(skillId, name, text);
    let last = performance.now();
    const tick = (now: number): void => {
      player.update(now - last);
      last = now;
      if (player.active) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    const player = fx.current;
    if (!player?.active) return;
    cancelAnimationFrame(frame.current);
    stopSkillVoice();
    player.stop();
  };

  return { host, play, stop };
}
