/**
 * 수성전 연습 판의 [적 방침] — 수비군(북군)이 어떤 방침으로 두는지 보여 준다 (`?demo=1&siege=1`, 2026-10-31).
 *
 * **연습 판 전용이다** — 진짜 공성전에서는 방침이 공격자에게 안 보인다(GDD §8.8). 그래서 판 위에는 아무것도 안 그리고
 * 구석의 단추 하나로만 연다. 행 · 조건 · 방침 이름은 수비군 설정 화면(`GarrisonPolicyScreen`)과 같은 문구(`gp.*`)를 쓰고,
 * 이 화면에만 있는 머리글 몇 줄은 개발용이라 한국어로 적는다.
 */

import { useState } from 'react';
import { combatantById, skillById, tacticById } from '@samchess/data';
import type { DefensePolicy, OfficerId, PieceType, TacticId } from '@samchess/rules';
import { t } from '../i18n/index.ts';
import { pickOfficerNameById, pickSkillName, pickTacticNameById } from '../i18n/story.ts';

const officerName = (id: OfficerId): string => pickOfficerNameById(id, combatantById.get(id)?.name ?? id);
const tacticName = (id: TacticId): string => pickTacticNameById(id, tacticById.get(id)?.name ?? id);

export interface SiegePolicyView {
  policy: DefensePolicy;
  /** 수비군 명단 — 행동 방침은 기물에 붙으므로 장수 이름을 곁에 적으려고 받는다 */
  defenders: readonly { officer: OfficerId; piece: PieceType; level: number }[];
  power: { P1: number; P2: number };
  chance: number;
}

export function SiegePolicyPopup({ view }: { view: SiegePolicyView }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { policy, defenders, power, chance } = view;
  return (
    <>
      <button className="sdp-open" data-action="enemyPolicy" onClick={() => setOpen(true)}>적 방침</button>
      {open && (
        <div className="modal-back sdp-back" data-modal="enemyPolicy" onClick={() => setOpen(false)}>
          <div className="modal sdp-modal" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">적 방침 (수비군 · 북군)</p>
            <p className="sdp-power" data-field="power">
              전투력 — 나 {power.P1} · 적 {power.P2} · 예상 승률 {Math.round(chance * 100)}% (전투력만 본 값 — 수성전은 수비가 유리하다)
            </p>

            <h4>{t('gp.tab.stance')}</h4>
            <table className="sdp-table" data-field="stances">
              <tbody>
                {defenders.map((d) => {
                  const st = policy.stances[d.piece] ?? (d.piece === 'King' ? 'hold' : 'advance');
                  return (
                    <tr key={d.piece} data-piece={d.piece} data-stance={st}>
                      <td>{d.piece}</td>
                      <td>{officerName(d.officer)} Lv{d.level}</td>
                      <td><b>{t(`gp.stance.${st}`)}</b><br /><small>{t(`gp.stance.${st}.d`)}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h4>{t('gp.tab.tactic')}</h4>
            {policy.tactics.length === 0 ? <p className="sdp-none">{t('gp.tab.tactic.off')}</p> : (
              <table className="sdp-table" data-field="tactics">
                <thead><tr><th>{t('gp.col.rank')}</th><th>{t('gp.col.caster')}</th><th>{t('gp.col.when')}</th><th>{t('gp.col.tactic')}</th><th>{t('gp.col.chance')}</th></tr></thead>
                <tbody>
                  {policy.tactics.map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{r.caster ? officerName(r.caster) : t('gp.anyone')}</td>
                      <td>{t(`gp.when.${r.when}`)}</td>
                      <td>{tacticName(r.tactic)}</td>
                      <td>{r.minChance === undefined ? t('gp.chance.any') : t('gp.chance.min', { n: r.minChance })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4>{t('gp.tab.skill')}</h4>
            {policy.skills.length === 0 ? <p className="sdp-none">{t('gp.tab.skill.off')}</p> : (
              <table className="sdp-table" data-field="skills">
                <thead><tr><th>{t('gp.col.rank')}</th><th>{t('gp.col.caster')}</th><th>{t('gp.col.skill')}</th><th>{t('gp.col.when')}</th></tr></thead>
                <tbody>
                  {policy.skills.map((r, i) => {
                    const skill = skillById.get(combatantById.get(r.officer)?.uniqueSkill ?? '');
                    return (
                      <tr key={r.officer}>
                        <td>{i + 1}</td>
                        <td>{officerName(r.officer)}</td>
                        <td>{skill ? pickSkillName(skill) : '—'}</td>
                        <td>{t(`gp.when.${r.when}`)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="sdp-note">한 차례: 고유기술 → 지금 이기는 수 → 행동(칠 수 있으면 공격) → 못 쳤으면 책략. 팝업 바깥을 누르면 닫힌다.</p>
          </div>
        </div>
      )}
    </>
  );
}
