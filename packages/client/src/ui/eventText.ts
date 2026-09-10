/**
 * `BattleEvent[]` → 시스템 대화창에 띄울 문장 (기획 pptx 21쪽)
 *
 * ```
 * 조운이 이동했다. (A3 → E3)
 * 조운이 「공포」를 시전했다. (유봉)
 * 책략이 성공했다! (유봉 공포)
 * 조운이 고유기술을 발동했다!
 * 「간뇌도지」 2.9일 동안 …
 * 조운이 퇴각했다.
 * ```
 *
 * **엔진이 만든 이벤트만 읽는다.** 화면이 상태를 뒤져 "무슨 일이 있었는지" 추측하지 않는다 —
 * 온라인 대전에서 서버가 보내 주는 것이 바로 이 이벤트 배열이라, 여기서 만든 문장은
 * 판정 주체가 서버로 바뀌어도 그대로 쓰인다.
 *
 * 한 가지 이벤트가 한 줄이 되지는 않는다. 「책략 시전」은 성패와 효과가 **뒤따르는
 * 이벤트에 들어 있어서**, 시전 이벤트를 만나면 그 뒤를 훑어 한 줄로 합친다.
 */

import type { BattleEvent, BattleState, StatusId, UnitId, Vec2 } from '@samchess/rules';
import { officerById, skillById, tacticById } from '@samchess/data';
import { currentLang, t } from '../i18n/index.ts';
import {
  armyName, outcomeLabel, statusDesc, statusKind, statusLabel, terrainLabel,
} from '../i18n/engineLabel.ts';
import { pickOfficerName, pickSkillName, pickSkillText, pickTacticName } from '../i18n/story.ts';

/** 한 줄. `tone`은 표시 색만 가른다 */
export interface LogLine {
  text: string;
  tone: 'plain' | 'good' | 'bad' | 'skill';
}

/**
 * 격자 좌표 → 사람이 읽는 칸 이름. 열은 A~Y(25), 행은 1~20.
 * pptx의 "(A3 → E3)" 표기를 그대로 따른다.
 */
export const cellName = (p: Vec2): string => `${String.fromCharCode(65 + p.x)}${p.y + 1}`;

/** 받침 유무로 조사를 고른다. 한글이 아니면 앞쪽을 쓴다. */
function josa(word: string, pair: '이가' | '을를' | '은는' | '와과'): string {
  const last = word.charCodeAt(word.length - 1);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  const batchim = hangul && (last - 0xac00) % 28 !== 0;
  const [withB, without] = [pair[0]!, pair[1]!];
  return batchim ? withB : without;
}

/*
 * ────────────────────────────────────────────────────────────────
 * 문장은 통째로 키 하나, 조사는 **값**에 붙인다 (2026-09-11 다국어)
 * ────────────────────────────────────────────────────────────────
 *
 * 「누가 무엇을 했다」는 언어마다 어순이 달라, 조각을 이어 붙이면 한국어 어순이
 * 그대로 굳는다. 그래서 `ko.json`에 문장을 통째로 두고(`"{who} 이동했다. …"`)
 * 각 언어가 제 어순으로 다시 쓴다 — 장비 이름 다국어(2026-09-10)가 **값만**
 * 갈아 끼우면 됐던 것과 다른 점이 이것이다.
 *
 * 그러면 조사가 갈 곳이 없어진다. 「유비**가**」/「관우**가**」는 **값에 따라**
 * 달라지므로 문장 쪽에 못 적는다 — 그래서 값에 붙인다. 붙이는 것은 **한국어일
 * 때뿐**이고(`subj`·`obj`), 다른 언어는 이름이 그대로 들어가 문장 쪽의 `が`·`'s`
 * 같은 것이 제자리를 지킨다. `josa()`가 한국어 전용인 채로 남아도 되는 이유다.
 */

/** 지금 화면이 한국어인가 — 조사를 붙일지 정하는 유일한 판단 */
const isKo = (): boolean => currentLang() === 'ko';

/** 주어 자리의 값. 한국어면 「이/가」를 붙이고, 다른 언어는 그대로 둔다. */
const subj = (word: string): string => (isKo() ? word + josa(word, '이가') : word);

/**
 * 「…」로 감싼 이름 + 조사. 조사는 **괄호 안의 이름**을 보고 고르고 괄호 **밖**에
 * 붙는다 — 「삼고초려」**가**. 예전에는 이 자리 하나만 조사를 안 쓰고 「이」를
 * 그대로 적어 두어 「「삼고초려」이 무산됐다」가 나왔다(2026-09-11에 회귀가 잡았다).
 */
const quoted = (name: string, pair: '이가' | '을를'): string =>
  `「${name}」${isKo() ? josa(name, pair) : ''}`;

/**
 * `from`부터 **잇달아 같은 지형으로 바뀐** 이벤트가 몇 개인가 (최소 1).
 *
 * 범위로 까는 지형(손권 「수성지주」의 3×3)이 칸마다 이벤트를 하나씩 내는데,
 * 말풍선에서는 그것이 한 사건이다. 세는 자리를 함수 하나로 두어 본문과 요약이
 * 같은 수를 쓴다.
 */
function sameTerrainRun(events: readonly BattleEvent[], from: number): number {
  const first = events[from]!;
  if (first.e !== 'terrainChanged') return 1;
  let n = 1;
  while (from + n < events.length) {
    const next = events[from + n]!;
    if (next.e !== 'terrainChanged' || next.terrain !== first.terrain) break;
    n++;
  }
  return n;
}

/**
 * 지속 피해·지형 피해의 출처를 사람 말로. 공격 피해는 여기서 다루지 않는다.
 *
 * **셋 다 이미 이름이 있는 것들이다** — 「지속 피해」는 상태이상 `dot`이고,
 * 「화계」·「성지」는 지형이다. 그래서 문구를 따로 적지 않고 그 표에서 가져온다.
 * 따로 적으면 지형 이름을 고칠 때 로그만 옛 이름으로 남는다.
 *
 * `meditate`는 **일부러 빠져 있다** — 명상은 MP 줄(`mpChanged`)이 이미 적으므로
 * HP 줄까지 내면 한 사건이 두 줄이 된다.
 */
function reasonLabel(reason: string): string | undefined {
  switch (reason) {
    case 'dot': return statusLabel('dot');
    case 'terrain:fire': return terrainLabel('fire');
    case 'terrain:holy': return terrainLabel('holy');
    default: return undefined;
  }
}

export function describeEvents(state: BattleState, events: readonly BattleEvent[]): LogLine[] {
  const name = (id: UnitId | null | undefined): string => {
    const unit = id ? state.units[id] : undefined;
    if (!unit) return '?';
    const officer = officerById.get(unit.officer);
    return officer ? pickOfficerName(officer) : unit.officer;
  };

  const out: LogLine[] = [];
  const push = (text: string, tone: LogLine['tone'] = 'plain'): void => { out.push({ text, tone }); };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    switch (ev.e) {
      case 'moved':
        push(t('log.moved', {
          who: subj(name(ev.unit)), from: cellName(ev.from), to: cellName(ev.to),
        }));
        break;

      case 'attacked': {
        const hit = t(ev.critical ? 'log.attacked.critical' : 'log.attacked.hit',
          { target: name(ev.target), damage: ev.damage });
        push(t('log.attacked', { who: subj(name(ev.unit)), hit }), ev.critical ? 'good' : 'plain');
        break;
      }

      case 'tacticCast': {
        const who = subj(name(ev.unit));
        const def = tacticById.get(ev.tactic);
        const label = def ? pickTacticName(def) : ev.tactic;
        // 대상과 효과는 이 이벤트에 없다 — 뒤따르는 이벤트에서 읽는다
        const effects = collectEffects(state, events, i + 1, name);
        const target = effects.targets[0];
        const tactic = quoted(label, '을를');
        push(target
          ? t('log.tacticCast.at', { who, tactic, target })
          : t('log.tacticCast', { who, tactic }));
        if (ev.resisted) push(t('log.tacticFailed'), 'bad');
        else {
          push(effects.summary
            ? t('log.tacticOk.detail', { summary: effects.summary })
            : t('log.tacticOk'), 'good');
        }
        break;
      }

      case 'uniqueSkillCast': {
        const who = subj(name(ev.unit));
        const skill = skillById.get(ev.skill);
        // 지연이 걸린 기술은 아직 **거는 중**이다 — 「발동했다」로 적으면 효과가
        // 이미 걸린 줄 알고 다음 수를 둔다 (2026-09-07).
        const delayed = (skill?.castDelay ?? 0) > 0;
        push(t(delayed ? 'log.skillCast.delayed' : 'log.skillCast', { who }), 'skill');
        if (skill) {
          push(t('log.skillText', { name: pickSkillName(skill), text: pickSkillText(skill) }), 'skill');
        }
        if (delayed) {
          push(t('log.skillCast.takes', { days: (skill!.castDelay / 100).toFixed(1) }), 'skill');
        }
        break;
      }

      case 'uniqueSkillResolved': {
        const skill = skillById.get(ev.skill);
        push(t('log.skillResolved', {
          who: name(ev.unit),
          skill: quoted(skill ? pickSkillName(skill) : ev.skill, '이가'),
        }), 'skill');
        break;
      }

      case 'uniqueSkillFizzled': {
        const skill = skillById.get(ev.skill);
        // 왜 아무 일도 안 일어났는지 적는다 — 안 적으면 「썼는데 안 걸렸다」로 보인다
        push(t('log.skillFizzled', {
          who: subj(name(ev.unit)),
          skill: quoted(skill ? pickSkillName(skill) : ev.skill, '이가'),
        }), 'bad');
        break;
      }

      case 'uniqueSkillRestored':
        push(t('log.skillRestored', { who: name(ev.unit) }), 'good');
        break;

      case 'unitDied':
        push(t('log.died', { who: subj(name(ev.unit)) }), 'bad');
        break;

      case 'unitRevived':
        push(t('log.revived', { who: subj(name(ev.unit)), at: cellName(ev.at) }), 'good');
        break;

      case 'controlChanged': {
        const who = subj(name(ev.unit));
        if (ev.by === null) push(t('log.controlEnded', { who }));
        else {
          push(t(ev.permanent ? 'log.controlled.permanent' : 'log.controlled',
            { who, by: name(ev.by) }), 'bad');
        }
        break;
      }

      case 'hpChanged': {
        // 공격 피해는 「공격했다」 줄이 이미 적었다. 여기서는 도트·지형만 남긴다.
        const reason = reasonLabel(ev.reason);
        if (!reason) break;
        const vars = { who: subj(name(ev.unit)), reason, amount: Math.abs(ev.delta) };
        push(t(ev.delta < 0 ? 'log.damaged' : 'log.healed', vars), ev.delta < 0 ? 'bad' : 'good');
        break;
      }

      case 'mpChanged':
        if (ev.reason === 'meditate') {
          push(t('log.meditated', { who: subj(name(ev.unit)), amount: ev.delta }));
        }
        break;

      case 'terrainChanged': {
        /*
         * **이어진 같은 지형은 한 줄로 접는다** — 손권 「수성지주」가 3×3으로
         * 커지면서(2026-09-10) 그대로 두면 「…에 성지가 생겼다」가 아홉 줄
         * 쏟아져 그 앞의 시전 한 줄이 대화창 밖으로 밀린다. 첫 칸이 중심이다
         * (엔진의 `areaTiles()`가 중심을 맨 앞에 둔다).
         *
         * ★ **넓이는 안 적고 중심 한 칸만 말한다** (2026-09-10 기획자 지정).
         * 한때 「E5 일대 9칸에 …」로 칸 수를 붙였는데, 로그가 알려 줄 것은
         * 「어디에 생겼나」이고 **넓이는 판에 그려져 있다**(`battle/terrain.ts`가
         * 칸마다 깔아 준다). 그래서 접는 것은 그대로 두되(아홉 줄은 여전히 한
         * 줄이다) 문장은 한 칸짜리와 같은 꼴로 둔다 — 세는 값(`run`)은 몇 개를
         * 건너뛸지에만 쓴다.
         */
        const run = sameTerrainRun(events, i);
        i += run - 1;
        const at = cellName(ev.pos);
        if (!ev.terrain) { push(t('log.terrainGone', { at })); break; }
        // 조사는 이 파일의 `subj()`가 정한다 — 「성지이(가)」 같은 괄호 꼴은
        // 나머지 줄이 이미 안 쓴다
        push(t('log.terrainMade', { at, what: subj(terrainLabel(ev.terrain)) }));
        break;
      }

      case 'battleEnded': {
        // 진영은 **이름으로** 적는다 — 예전에는 `P1`이 그대로 나가 「P1 승리」로
        // 떴다(2026-09-11에 회귀가 잡았다). HUD는 처음부터 이름을 쓰고 있었다.
        const how = outcomeLabel(ev.outcome);
        push(ev.winner ? t('log.win', { army: armyName(ev.winner), how }) : t('log.draw', { how }),
          ev.winner ? 'good' : 'plain');
        break;
      }

      // 시계·SP·제어권 이동은 HUD가 상시 보여준다. 대화창에 적으면 실제 사건이 묻힌다.
      default:
        break;
    }
  }
  return out;
}

/**
 * 책략 시전 직후의 이벤트들을 훑어 "무엇이 걸렸는가"를 한 줄로 요약한다.
 * 다음 시전·공격·이동이 나오면 거기서 끊는다 — 남의 결과까지 끌어오지 않기 위함이다.
 */
function collectEffects(
  state: BattleState,
  events: readonly BattleEvent[],
  from: number,
  name: (id: UnitId | null | undefined) => string,
): { summary: string; targets: string[] } {
  const parts: string[] = [];
  const targets: string[] = [];

  for (let i = from; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.e === 'tacticCast' || ev.e === 'uniqueSkillCast' || ev.e === 'uniqueSkillResolved'
      || ev.e === 'attacked'
      || ev.e === 'moved' || ev.e === 'turnEnded' || ev.e === 'timeAdvanced') break;

    switch (ev.e) {
      case 'statusApplied':
        targets.push(name(ev.unit));
        parts.push(t('log.effect.status', { who: name(ev.unit), what: statusLabel(ev.status) }));
        break;
      case 'statusExpired':
        targets.push(name(ev.unit));
        parts.push(t('log.effect.statusExpired', { who: name(ev.unit), what: statusLabel(ev.status) }));
        break;
      case 'hpChanged':
        targets.push(name(ev.unit));
        parts.push(t('log.effect.hp', {
          who: name(ev.unit), delta: `${ev.delta > 0 ? '+' : ''}${ev.delta}`,
        }));
        break;
      case 'wtChanged':
        targets.push(name(ev.unit));
        parts.push(t('log.effect.wt', { who: name(ev.unit), to: ev.to }));
        break;
      case 'terrainChanged': {
        // 위와 같은 이유로 접는다 — 요약 한 줄이 성채 아홉 칸으로 채워지면
        // 정작 무엇이 걸렸는지가 안 보인다. **넓이는 안 적고 중심 한 칸만
        // 말하는 것도 본문(`describeEvents`)과 같다** — 같은 사건을 두 자리가
        // 각각 적으므로 한쪽만 고치면 조용히 갈라진다(실제로 그럴 뻔했다).
        const run = sameTerrainRun(events, i);
        i += run - 1;
        const what = ev.terrain ? terrainLabel(ev.terrain) : t('log.effect.terrainRemoved');
        parts.push(t('log.effect.terrain', { at: cellName(ev.pos), what }));
        break;
      }
      case 'controlChanged':
        targets.push(name(ev.unit));
        parts.push(t('log.effect.control', { who: name(ev.unit) }));
        break;
      default:
        break;
    }
  }
  // 같은 대상에 여러 줄이 붙으면 시끄럽다. 앞의 둘만 적는다.
  const list = parts.slice(0, 2).join(', ');
  const summary = parts.length > 2 ? t('log.effect.more', { list, n: parts.length - 2 }) : list;
  return { summary, targets: [...new Set(targets)] };
}

/**
 * 상태이상 설명 — 배지를 눌렀을 때 띄운다.
 *
 * **분류(`kind`)만 엔진에서 오고 이름·설명은 화면의 문구 표에서 온다** — 엔진이
 * UI 언어를 알면 안 되기 때문이다(`i18n/engineLabel.ts` 머리말 참조).
 */
export const statusInfo = (status: StatusId): { label: string; desc: string; kind: string } => ({
  label: statusLabel(status), desc: statusDesc(status), kind: statusKind(status),
});
