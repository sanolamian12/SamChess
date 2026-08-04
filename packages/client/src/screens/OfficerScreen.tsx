/**
 * 장수 관리 — 일람 · 정보 · 레벨업 (GDD §5 「장수 관리 메뉴」 · §4.2)
 *
 * 레벨업은 **능력 향상 택1 + 책략 택1**이다. 같은 장수라도 여기서 빌드가 갈린다.
 * **실패는 없다** — 2026-08-04에 확정했다(GDD §4.3). 카드만 채우면 반드시 오른다.
 *
 * > **「개발용 카드 지급」은 게임 규칙이 아니다.** AI 대전이 카드를 주지 않기로 확정되어
 * > 오프라인만으로는 성장을 시험할 수 없다. 온라인·상점이 붙으면 지운다.
 */

import { useState } from 'react';
import { officerById, skillById, tacticById } from '@samchess/data';
import type { OfficerId } from '@samchess/rules';
import {
  GRADE_SCORE, addCard, applyLevelUp, canLevelUp, cardsToLevelUp, poolCap, poolUsed,
  statsOf, tacticChoices,
} from '@samchess/meta';
import type { PlayerProfile, StatPick } from '@samchess/meta';
import { OfficerArt } from './OfficerArt.tsx';

const STAT_LABEL: Record<StatPick, string> = { hp: 'HP +5', mp: 'MP +2', at: 'AT +1' };

export function OfficerScreen({ profile, onChange, onBack }: {
  profile: PlayerProfile;
  onChange: (p: PlayerProfile) => void;
  onBack: () => void;
}): React.JSX.Element {
  const owned = Object.values(profile.roster)
    .map((inst) => ({ inst, data: officerById.get(inst.officer)! }))
    .filter((x) => x.data)
    .sort((a, b) => GRADE_SCORE[b.data.grade] - GRADE_SCORE[a.data.grade] || b.inst.level - a.inst.level);

  const [selected, setSelected] = useState<OfficerId | null>(owned[0]?.inst.officer ?? null);
  const [stat, setStat] = useState<StatPick>('hp');
  const [school, setSchool] = useState<'support' | 'illusion'>('support');

  const inst = selected ? profile.roster[selected] : undefined;
  const data = selected ? officerById.get(selected) : undefined;
  const cards = selected ? profile.cards[selected] ?? 0 : 0;
  const need = inst ? cardsToLevelUp(inst.level) : null;
  const check = selected ? canLevelUp(profile, selected) : { ok: false as const, reason: '' };
  const choices = inst ? tacticChoices(inst.level + 1) : { support: [], illusion: [] };

  return (
    <div className="scr scr-officers">
      <header className="bar">
        <button className="btn ghost sm" onClick={onBack}>← 뒤로</button>
        <span className="ttl">장수 관리</span>
        <span className="tail">{poolUsed(profile)}/{poolCap(profile)}명</span>
      </header>

      <section className="block">
        <div className="pool">
          {owned.map(({ inst: it, data: d }) => (
            <button
              key={it.officer}
              className={`card${selected === it.officer ? ' here' : ''}`}
              data-officer={it.officer}
              onClick={() => setSelected(it.officer)}
            >
              <OfficerArt officer={d.id} className="thumb" />
              <span className="nm">{d.name}</span>
              <span className="gr" data-grade={d.grade}>{d.grade}{it.level}</span>
              <span className="ab">{it.record.wins}승 {it.record.losses}패</span>
              {(profile.cards[it.officer] ?? 0) > 0 && <span className="tag">카드 {profile.cards[it.officer]}</span>}
            </button>
          ))}
        </div>
      </section>

      {inst && data && (
        <section className="block grow detail">
          <div className="head">
            <OfficerArt officer={data.id} className="big" />
            <div className="info">
              <h2 className="nm">{data.name} <span className="gr" data-grade={data.grade}>{data.grade}{inst.level}</span></h2>
              <p className="row">HP {statsOf(inst).hp} · MP {statsOf(inst).mp} · AT {statsOf(inst).at}</p>
              <p className="row">무력 {data.might} · 지력 {data.intellect} · 통솔 {data.leadership}</p>
              <p className="row dim">{data.faction} · {inst.record.wins}승 {inst.record.losses}패 · {inst.record.kills}처치</p>
            </div>
          </div>

          {data.uniqueSkill && (
            <div className="skill">
              <b>「{skillById.get(data.uniqueSkill)?.name}」</b>
              <span> SP {skillById.get(data.uniqueSkill)?.spCost}</span>
              <p>{skillById.get(data.uniqueSkill)?.text}</p>
            </div>
          )}

          <div className="tactics">
            <span className="cap">책략 {inst.tactics.length}종</span>
            {inst.tactics.length === 0 && <span className="dim">아직 없다 — 레벨업으로 배운다</span>}
            {inst.tactics.map((id) => {
              const t = tacticById.get(id);
              return t ? <span key={id} className={`chip ${t.school}`}>{t.name}</span> : null;
            })}
          </div>

          <div className="levelup">
            <h3 className="cap">
              레벨업 {need === null ? '— 최대 레벨' : `— 카드 ${cards}/${need}`}
            </h3>
            {need !== null && (
              <>
                <div className="pick">
                  <span className="k">능력</span>
                  {(['hp', 'mp', 'at'] as StatPick[]).map((s) => (
                    <button key={s} className={`opt${stat === s ? ' on' : ''}`} onClick={() => setStat(s)}>
                      {STAT_LABEL[s]}
                    </button>
                  ))}
                </div>
                <div className="pick">
                  <span className="k">책략</span>
                  {(['support', 'illusion'] as const).map((s) => (
                    <button
                      key={s}
                      className={`opt${school === s ? ' on' : ''}`}
                      disabled={choices[s].length === 0}
                      onClick={() => setSchool(s)}
                    >
                      {s === 'support' ? '지원' : '환술'}
                      {' — '}
                      {choices[s].map((id) => tacticById.get(id)?.name).filter(Boolean).join(' + ') || '없음'}
                    </button>
                  ))}
                </div>
                <button
                  className="btn primary wide"
                  disabled={!check.ok}
                  data-action="levelUp"
                  onClick={() => onChange(applyLevelUp(profile, inst.officer, stat, school))}
                >
                  Lv{inst.level} → Lv{inst.level + 1}
                </button>
                {!check.ok && <p className="note">{check.reason}</p>}
              </>
            )}
          </div>

          {/* 게임 규칙이 아니다 — AI 대전이 카드를 주지 않아 성장 흐름을 시험할 길이 없어서 둔 문 */}
          <div className="devtools">
            <span className="cap">개발용</span>
            <button className="btn ghost sm" onClick={() => onChange(addCard(profile, inst.officer, 5))}>
              카드 +5
            </button>
            <span className="dim">시험용 통로다. 온라인·상점이 붙으면 없앤다.</span>
          </div>
        </section>
      )}
    </div>
  );
}
