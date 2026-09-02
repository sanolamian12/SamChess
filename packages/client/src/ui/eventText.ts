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

import { STATUS_META, TERRAIN_META } from '@samchess/rules';
import type { BattleEvent, BattleState, UnitId, Vec2 } from '@samchess/rules';
import { officerById, skillById, tacticById } from '@samchess/data';
import { pickOfficerName } from '../i18n/story.ts';

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

/** 지형 이름의 단일 출처는 엔진의 `TERRAIN_META`다 — 화면이 따로 적어 두면 조용히 어긋난다 */
const TERRAIN_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TERRAIN_META).map(([id, meta]) => [id, meta.label]),
);

/** 지속 피해·지형 피해의 출처를 사람 말로. 공격 피해는 여기서 다루지 않는다. */
const REASON_LABEL: Record<string, string> = {
  dot: '지속 피해',
  'terrain:fire': '화계',
  'terrain:holy': '성지',
  meditate: '명상',
};

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
        push(`${name(ev.unit)}${josa(name(ev.unit), '이가')} 이동했다. (${cellName(ev.from)} → ${cellName(ev.to)})`);
        break;

      case 'attacked': {
        const who = name(ev.unit);
        const hit = `${name(ev.target)} −${ev.damage}${ev.critical ? ' 크리티컬!' : ''}`;
        push(`${who}${josa(who, '이가')} 공격했다. (${hit})`, ev.critical ? 'good' : 'plain');
        break;
      }

      case 'tacticCast': {
        const who = name(ev.unit);
        const label = tacticById.get(ev.tactic)?.name ?? ev.tactic;
        // 대상과 효과는 이 이벤트에 없다 — 뒤따르는 이벤트에서 읽는다
        const effects = collectEffects(state, events, i + 1, name);
        const target = effects.targets[0];
        push(`${who}${josa(who, '이가')} 「${label}」${josa(label, '을를')} 시전했다.`
          + (target ? ` (${target})` : ''));
        if (ev.resisted) push('책략이 실패했다.', 'bad');
        else push(`책략이 성공했다!${effects.summary ? ` (${effects.summary})` : ''}`, 'good');
        break;
      }

      case 'uniqueSkillCast': {
        const who = name(ev.unit);
        const skill = skillById.get(ev.skill);
        push(`${who}${josa(who, '이가')} 고유기술을 발동했다!`, 'skill');
        if (skill) push(`「${skill.name}」 ${skill.text}`, 'skill');
        break;
      }

      case 'uniqueSkillRestored':
        push(`${name(ev.unit)}의 고유기술이 다시 활성화됐다.`, 'good');
        break;

      case 'unitDied': {
        const who = name(ev.unit);
        push(`${who}${josa(who, '이가')} 퇴각했다.`, 'bad');
        break;
      }

      case 'unitRevived': {
        const who = name(ev.unit);
        push(`${who}${josa(who, '이가')} ${cellName(ev.at)}에서 되살아났다!`, 'good');
        break;
      }

      case 'controlChanged': {
        const who = name(ev.unit);
        if (ev.by === null) push(`${who}${josa(who, '이가')} 정신을 차렸다.`);
        else {
          push(`${who}${josa(who, '이가')} ${name(ev.by)}에게 조종당한다.${ev.permanent ? ' (영구)' : ''}`, 'bad');
        }
        break;
      }

      case 'hpChanged': {
        // 공격 피해는 「공격했다」 줄이 이미 적었다. 여기서는 도트·지형만 남긴다.
        const label = REASON_LABEL[ev.reason];
        if (!label || ev.reason === 'meditate') break;
        const who = name(ev.unit);
        push(ev.delta < 0
          ? `${who}${josa(who, '이가')} ${label}로 ${-ev.delta} 피해를 입었다.`
          : `${who}${josa(who, '이가')} ${label}로 ${ev.delta} 회복했다.`,
          ev.delta < 0 ? 'bad' : 'good');
        break;
      }

      case 'mpChanged':
        if (ev.reason === 'meditate') {
          const who = name(ev.unit);
          push(`${who}${josa(who, '이가')} 명상했다. (MP +${ev.delta})`);
        }
        break;

      case 'terrainChanged':
        push(ev.terrain
          ? `${cellName(ev.pos)}에 ${TERRAIN_LABEL[ev.terrain] ?? ev.terrain}이(가) 생겼다.`
          : `${cellName(ev.pos)}의 지형이 사라졌다.`);
        break;

      case 'battleEnded': {
        const how = { kingDown: '군주 격파', wipeOut: '전멸', surrender: '항복', timeLimit: '판정승', draw: '무승부' }[ev.outcome];
        push(ev.winner ? `${ev.winner} 승리 — ${how}` : `무승부 — ${how}`, ev.winner ? 'good' : 'plain');
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
    if (ev.e === 'tacticCast' || ev.e === 'uniqueSkillCast' || ev.e === 'attacked'
      || ev.e === 'moved' || ev.e === 'turnEnded' || ev.e === 'timeAdvanced') break;

    switch (ev.e) {
      case 'statusApplied':
        targets.push(name(ev.unit));
        parts.push(`${name(ev.unit)} ${STATUS_META[ev.status].label}`);
        break;
      case 'statusExpired':
        targets.push(name(ev.unit));
        parts.push(`${name(ev.unit)} ${STATUS_META[ev.status].label} 해제`);
        break;
      case 'hpChanged':
        targets.push(name(ev.unit));
        parts.push(`${name(ev.unit)} HP ${ev.delta > 0 ? '+' : ''}${ev.delta}`);
        break;
      case 'wtChanged':
        targets.push(name(ev.unit));
        parts.push(`${name(ev.unit)} WT ${ev.to}`);
        break;
      case 'terrainChanged':
        parts.push(`${cellName(ev.pos)} ${ev.terrain ? TERRAIN_LABEL[ev.terrain] ?? ev.terrain : '지형 제거'}`);
        break;
      case 'controlChanged':
        targets.push(name(ev.unit));
        parts.push(`${name(ev.unit)} 조종`);
        break;
      default:
        break;
    }
  }
  // 같은 대상에 여러 줄이 붙으면 시끄럽다. 앞의 둘만 적는다.
  const summary = parts.slice(0, 2).join(', ') + (parts.length > 2 ? ` 외 ${parts.length - 2}건` : '');
  return { summary, targets: [...new Set(targets)] };
}

/** 상태이상 설명 — 배지를 눌렀을 때 띄운다. 분류·이름·설명 전부 엔진의 `STATUS_META`가 출처다. */
export const statusInfo = (status: keyof typeof STATUS_META): { label: string; desc: string; kind: string } =>
  STATUS_META[status];
