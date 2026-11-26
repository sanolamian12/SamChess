/**
 * 결과 화면 눈 확인 — 로그인 · 전투 없이 결과 두루마리만 (2026-11-26).
 *
 *   ?result=win                사람 대전 승리(적 King 격퇴 · 군량 +2 · 재료 +1 · 캐릭터 2명)
 *   ?result=win&why=wipeOut    사유만 바꿔 — wipeOut · supplyTaken · kingDown · surrender
 *   ?result=siege              공성전 승리(적 전멸 · 캐릭터 1명)
 *   ?result=lose · draw        패배 · 무승부(캐릭터 1명)
 *   ?result=raid               도적떼 막아 냄(적 전멸 · 군량 +1 · 캐릭터 1명)
 *   ?result=raidLost           도적떼에 약탈당함
 *   ?result=tutorial           튜토리얼 승리(임무 완료)
 *   &lang=en                   언어
 *
 * 계정은 만들기만 하고 저장하지 않는다. [도시로]는 처음부터 다시 튼다.
 */

import { useRef, useState } from 'react';
import { createProfile } from '@samchess/meta';
import type { BattleOutcome, BattleRewards, PlayerProfile } from '@samchess/meta';
import type { OfficerId } from '@samchess/rules';
import { ResultScreen, TutorialResultScreen } from './ResultScreen.tsx';
import { RaidResultScreen } from './RaidBattleScreen.tsx';
import { useFrameFit } from './useFrameFit.ts';
import { setLang, t } from '../i18n/index.ts';
import type { Lang, StringKey } from '../i18n/index.ts';

const O = (id: string): OfficerId => id as OfficerId;

export function ResultDemo({ params }: { params: URLSearchParams }): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  useFrameFit(frameRef);
  const [round, setRound] = useState(0);
  const lang = params.get('lang');
  if (lang) setLang(lang as Lang);
  const kind = params.get('result') ?? 'win';
  const profile = createProfile('결과성', 1);
  const again = (): void => setRound((n) => n + 1);

  const two: BattleRewards = { grain: 2, materials: 1, cards: [{ officer: O('gan-ong'), grade: 'B' }, { officer: O('go-sun'), grade: 'C' }] };
  const one: BattleRewards = { grain: 1, materials: 0, cards: [{ officer: O('gyeong-mu'), grade: 'D' }] };
  const record: BattleOutcome = {
    result: 'win', mode: '3v3', opponent: 'field', at: 0, power: { mine: 600, theirs: 600 },
    picks: Object.keys(profile.roster).slice(0, 3).map((officer, i) => ({ piece: (['King', 'Rock', 'Bishop'] as const)[i]!, officer: O(officer) })),
  };

  let body: React.JSX.Element;
  if (kind === 'raid' || kind === 'raidLost') {
    const won = kind === 'raid';
    const p: PlayerProfile = {
      ...profile,
      raid: { ...(profile.raid ?? {}), status: won ? 'won' : 'lost', loot: won ? 0 : 4, ...(won ? { rewards: one } : {}) } as NonNullable<PlayerProfile["raid"]>,
    };
    body = <RaidResultScreen key={round} profile={p} banditsLeft={won ? 0 : 2} outcomeKind={won ? (params.get('why') ?? 'wipeOut') : 'wipeOut'} error={null} onFarm={again} />;
  } else if (kind === 'tutorial') {
    body = <TutorialResultScreen key={round} id="basic-1" rewards={{ grain: 1, materials: 1, cards: [one.cards[0]!] }} onBack={again} />;
  } else {
    const result = kind === 'lose' ? 'lose' : kind === 'draw' ? 'draw' : 'win';
    const why = params.get('why') ?? (kind === 'siege' ? 'wipeOut' : result === 'win' ? 'kingDown' : result === 'draw' ? 'draw' : 'kingDown');
    body = (
      <ResultScreen key={round} profile={profile} mode="3v3" result={result} outcome={t(`battle.outcome.${why}` as StringKey)} outcomeKind={why}
        rewards={result === 'win' && kind !== 'siege' ? two : one} record={{ ...record, result }} voided={null} onHome={again} />
    );
  }
  return <div id="frame" className="meta" ref={frameRef}>{body}</div>;
}
