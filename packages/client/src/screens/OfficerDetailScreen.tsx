/**
 * 장수 상세 (pptx 38쪽)
 *
 * 37쪽 원문 — 「목록에서 표출되는 정보 외 + 고유 기술(있다면) / HP, MP, 공격력
 * (최소-최대) / 습득한 책략(지원책 OR 환술) 목록 / 장수 서사·스토리 /
 * 보유한 장수카드 수, 레벨업이 가능하다면 [레벨업] 버튼 활성화」.
 *
 * ────────────────────────────────────────────────────────────────
 * 세 가지가 여기서 갈린다
 * ────────────────────────────────────────────────────────────────
 *
 * | 자리 | 지금 |
 * |---|---|
 * | **[레벨/스킬 관리]** | 지금까지 쓰던 레벨업 화면. **B(39쪽)가 통째로 갈아 끼운다** |
 * | **[전적 보기]** | 잠겨 있다 — 기물별·모드별 전적은 C1(40쪽)이 만든다 |
 * | **인물 소개** | 자리만 있다. G1이 엑셀에 열을 더하면 채워진다 |
 *
 * **없으면 그 줄째로 사라진다.** 인물 소개도, 고유기술이 없는 C·D급도 마찬가지다 —
 * 「인물 소개: (없음)」처럼 빈 자리를 남기면 데이터가 빠진 것인지 원래 없는 것인지
 * 구별되지 않는다. `assets/`가 없으면 건너뛰는 것과 같은 규약이다.
 *
 * **`AT: 2-4`는 화면이 계산하지 않는다.** `atRange()`가 `FORMULA.damage`를 지나간다 —
 * 데미지가 매 타격 내림이라 `AT 2.5`는 평타 2 · 크리티컬 5다 (GDD §4.2).
 */

import { useEffect, useState } from 'react';
import { officerById, skillById, tacticById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import { atRange, canLevelUp, cardsToLevelUp, statsOf, tacticsOf, totalTally } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { backdropStyle, placeBackdrop } from './backdrop.ts';
import { OfficerArt } from './OfficerArt.tsx';
import { SkillModal } from './SkillModal.tsx';
import { playSfx } from '../audio/sfx.ts';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

export function OfficerDetailScreen({ profile, officer, onList, onLevels, onRecords }: {
  profile: PlayerProfile;
  officer: OfficerId;
  onList: () => void;
  onLevels: () => void;
  onRecords: () => void;
}): React.JSX.Element {
  useLang();
  const [skillOpen, setSkillOpen] = useState(false);
  // 장수 하나를 펼쳐 볼 때마다 — 다른 장수로 넘어가도 다시 한 번
  useEffect(() => { playSfx('paper'); }, [officer]);

  const inst = profile.roster[officer];
  const data = officerById.get(officer);
  // 보유에서 빠졌는데 상세가 열려 있으면(계정 초기화 등) 일람으로 돌린다
  if (!inst || !data) return <div className="scr scr-officer"><p className="hint" onClick={onList}>{t('officer.toList')}</p></div>;

  const stats = statsOf(inst);
  const at = atRange(inst);
  // 전적도 화면이 더하지 않는다 — 칸을 세는 자리는 `records.ts` 하나다 (저장 형식 v3)
  const tally = totalTally(inst);
  const skill = data.uniqueSkill ? skillById.get(data.uniqueSkill) : undefined;
  const need = cardsToLevelUp(inst.level);
  const have = profile.cards[officer] ?? 0;
  const levelReady = canLevelUp(profile, officer).ok;

  // 성장 스택을 직접 펴지 않는다 — `tacticsOf()`가 단일 출처다 (저장 형식 v2)
  const tactics = tacticsOf(inst).map((id) => tacticById.get(id)).filter((x) => !!x);
  const bySchool = {
    support: tactics.filter((x) => x.school === 'support'),
    illusion: tactics.filter((x) => x.school === 'illusion'),
  };

  return (
    <div
      className="scr scr-officer scr-dim"
      data-screen="officer-detail"
      data-officer={officer}
      style={backdropStyle(placeBackdrop('palace', profile.cityLevel))}
    >
      {/* 38쪽의 상단 세 갈래. 「전적 보기」는 C1(40쪽)이 열었다 */}
      <header className="ofc-nav">
        <button className="btn ghost sm" data-action="list" onClick={onList}>{t('officer.toList')}</button>
        <button className="btn sm" data-action="levels" onClick={onLevels}>{t('officer.levels')}</button>
        <button className="btn sm" data-action="records" onClick={onRecords}>{t('officer.records')}</button>
      </header>

      <section className="block ofc-detail">
        <div className="ofc-bio">
          <OfficerArt officer={data.id} className="ofc-art" />
          <div className="ofc-who">
            <h2 className="nm">
              <span className="gr" data-grade={data.grade}>[{data.grade}]</span>
              {' '}{data.name}{' '}
              <span className="lv">Lv{inst.level}</span>
            </h2>
            <p className="row"><span className="k">{t('officer.might')}</span>: {data.might}</p>
            <p className="row"><span className="k">{t('officer.intellect')}</span>: {data.intellect}</p>
            <p className="row"><span className="k">{t('officer.leadership')}</span>: {data.leadership}</p>
            {/* 전적은 한 줄 요약이다 — 기물별·모드별은 [전적 보기](40쪽)가 편다 */}
            <p className="row dim" data-field="record">{data.faction} · {t('officer.record', {
              p: tally.plays, w: tally.wins, d: tally.draws, l: tally.losses, k: tally.kills,
            })}</p>
          </div>
        </div>

        {/* 고유기술은 「있다면」이다 — C·D급 134명에게는 이 단추가 없다 */}
        {skill && (
          <button className="btn wide ofc-skill" data-action="skill" onClick={() => setSkillOpen(true)}>
            <span className="lbl">{t('officer.skill')}</span>
            <span className="sub">「{skill.name}」 SP {skill.spCost}</span>
          </button>
        )}

        {/* 인물 소개 — G1이 채운다. 없으면 이 줄째로 사라진다 */}
        {data.story && (
          <p className="ofc-story" data-field="story">
            <span className="k">{t('officer.story')}</span> : {data.story}
          </p>
        )}

        <p className="ofc-stats" data-field="stats">
          HP: {stats.hp},  MP: {stats.mp},  AT: {at.min}-{at.max}
        </p>

        <div className="ofc-tactics">
          <span className="k">{t('officer.tactics')}</span>
          {tactics.length === 0 && <span className="dim">{t('officer.tactics.none')}</span>}
          {(['support', 'illusion'] as const).map((school) => (
            bySchool[school].length > 0 && (
              <span key={school} className="ofc-school" data-school={school}>
                <span className="cap">{t(school === 'support' ? 'officer.support' : 'officer.illusion')}</span>
                {bySchool[school].map((x) => (
                  <span key={x.id} className={`chip ${school}`} title={x.text}>{x.name}</span>
                ))}
              </span>
            )
          ))}
        </div>
      </section>

      <footer className="foot ofc-cards">
        <span className="k">{t('officer.cards')}</span>
        <span className="v" data-field="cards">
          {need === null ? t('officer.cards.max') : t('officer.cards.have', { have, need })}
        </span>
        {/* 「레벨업이 가능하다면 [레벨업] 버튼 활성화」(37쪽). 판정은 meta가 한다 */}
        <button
          className="btn primary sm"
          data-action="toLevelUp"
          disabled={!levelReady}
          onClick={onLevels}
        >
          {t('officers.flagFull')}
        </button>
      </footer>

      {skillOpen && skill && <SkillModal skill={skill} onClose={() => setSkillOpen(false)} />}
    </div>
  );
}
