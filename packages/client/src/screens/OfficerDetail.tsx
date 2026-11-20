/**
 * 내 장수의 상세 — **궁궐 장수 일람 · 병영(부대 편집 · 장수 고르기) · 대장간(지급할 장수 고르기)이 함께 쓰는 한 화면** (2026-11-19 기획자).
 *
 * 예전에는 자리마다 장수 카드(`OfficerCardModal`)를 각자 띄우며 단추를 따로 달았다 — 궁궐은 [레벨/스킬 관리] · [전적 보기],
 * 부대 편집은 [아이템] · [해제하기]. 같은 장수가 어디서 열었느냐에 따라 다른 화면이었다. 이제 이 컴포넌트 하나가
 * 카드에 실을 값(낀 병기 · 부상과 [입원] · 레벨업 카드 수)을 계정에서 내고, 단추는 언제나 **[아이템] · [강화] · [뒤로 가기]**,
 * 그 자리의 한 수(옥색 [선택하기] · 붉은 [해제하기])가 있으면 그 밑이다.
 *
 * - **[아이템]** — 병기 · 아이템 고르기(`HeldPicker`, 부대 편집의 것 그대로). 보통은 고르는 순간 계정에 얹고,
 *   부대 편집처럼 초안에 모으는 자리는 `held`로 대신한다(그 자리의 초안 계정 · 얹는 함수).
 * - **[강화]**(옛 [레벨/스킬 관리], 2026-11-20 기획자) — 카드 위에 겹쳐 뜨는 레벨업 고르기(`LevelUpPanel`). 올리거나 닫으면 카드로 돌아온다.
 *
 * 카드는 **장수 id로만** 연다 — 행째 들고 있으면 그 순간의 스냅샷이라, 카드 위에서 레벨을 올려도 옛 값이 남는다(2026-09-03).
 * 매 렌더 계정에서 다시 찾는다. 다른 계정의 장수(랭킹)는 이걸 안 쓰고 `OfficerCardModal`만 띄운다 — 관리할 수 없으니까.
 */
import { useEffect, useMemo, useState } from 'react';
import type { OfficerId } from '@samchess/rules';
import {
  canLevelUp, cardsToLevelUp, equippedBy, freeRooms, hospitalRooms, injuryHealsAt, isHealing, isInjured, nextRoomFreeAt, officerLevelCap,
  officerRankRows, pendingGuide,
} from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { OfficerCardModal } from './RankingCommon.tsx';
import type { CardAction, CardInjury } from './RankingCommon.tsx';
import { LevelUpPanel } from './LevelUpPanel.tsx';
import { HeldPicker, applyHeld } from './SquadMembersScreen.tsx';
import type { HeldOp } from './SquadMembersScreen.tsx';
import { formatHealLeft } from './healTime.ts';
import { CityActionRejected, healOnServer } from '../meta/city.ts';
import { useGuide } from './useGuide.tsx';

export function OfficerDetailModal({ profile, officer, onChange, onClose, action, held, guide = false }: {
  profile: PlayerProfile;
  officer: OfficerId;
  /** 레벨업 · 입원 · (초안이 아니면) 아이템 — 곧장 계정에 */
  onChange: (p: PlayerProfile) => void;
  onClose: () => void;
  /** 그 자리의 한 수 — 맨 아래(옥색 [선택하기] · 붉은 [해제하기]) */
  action?: CardAction;
  /**
   * 아이템을 계정 대신 **초안**에 모으는 자리(부대 편집) — 고르기 팝업이 볼 계정(초안을 얹은 것)과 고른 것을 받는 함수.
   * 낀 병기 줄도 이 계정에서 낸다(저장하면 이렇게 된다는 값)
   */
  held?: { profile: PlayerProfile; onPick: (op: HeldOp) => void };
  /** 장수 상세의 첫 안내(`officer.card`)를 띄울 자리인가 — 궁궐 장수 일람만 */
  guide?: boolean;
}): React.JSX.Element | null {
  useLang();
  const [managing, setManaging] = useState(false);
  const [picking, setPicking] = useState(false);
  // 부상은 시각으로 풀린다 — 화면 층이 시계를 읽는다(meta는 시계를 안 든다). 열려 있는 동안 남은 시간이 흐르게 주기적으로 다시 읽는다
  const [now, setNow] = useState(() => Date.now());
  const [healBusy, setHealBusy] = useState(false);
  const [healError, setHealError] = useState<string | null>(null);

  // 「보기」 카드 — 모드를 안 줘 3v3 · 5v5 통산이다
  const row = useMemo(() => officerRankRows(profile, 'all').find((r) => r.officer === officer) ?? null, [profile, officer]);
  const inst = profile.roster[officer];
  const hurt = !!inst && isInjured(inst, now);
  useEffect(() => {
    if (!hurt) return;
    // 표기가 분 단위라 초마다 그릴 까닭이 없다 — 병원 화면과 같은 주기
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, [hurt]);
  useEffect(() => { setHealError(null); setManaging(false); setPicking(false); }, [officer]);

  // 장수 상세를 처음 열었다 — 파트마다 한 마디(2026-11-14 기획자). 레벨/스킬 관리 · 아이템 고르기를 연 동안은 미룬다
  const cardGuide = useGuide(
    profile, onChange,
    guide && row && !managing && !picking ? pendingGuide(profile, 'officerCard') : null,
    `card-${officer}`,
  );

  if (!row || !inst) return null;

  const heal = (): void => {
    setHealBusy(true);
    setHealError(null);
    void (async () => {
      try {
        const next = await healOnServer(officer);
        if (next) onChange(next); else setHealError(t('server.offline'));
      } catch (e) {
        setHealError(e instanceof CityActionRejected ? e.message : String(e));
      } finally {
        setHealBusy(false);
        setNow(Date.now());
      }
    })();
  };
  const injury: CardInjury | undefined = hurt ? {
    left: (injuryHealsAt(inst) ?? now) - now,
    healing: isHealing(inst, now),
    // 「병원이 있으면 [입원]」 — 없으면 단추째로 없다. 막히는 이유는 병원 화면과 같은 문구
    ...(hospitalRooms(profile) > 0 ? {
      heal: {
        blocked: freeRooms(profile, now) > 0 ? null
          : t('hospital.admit.full', { time: formatHealLeft((nextRoomFreeAt(profile, now) ?? now) - now) }),
        busy: healBusy,
        error: healError,
        onHeal: heal,
      },
    } : {}),
  } : undefined;
  // 낀 병기 — 없으면 줄째로 사라진다. **부대 편집(초안)에서는 안 싣는다** — 지닌 것은 [아이템]을 눌러 보는 한 곳에만(2026-11-17 기획자)
  const equip = held ? undefined : equippedBy(profile, officer);
  // [강화] 오른쪽 「{보유} / {필요} (카드)」 — `cardsToLevelUp()`이 단일 출처
  const need = cardsToLevelUp(row.level);
  const have = profile.cards[officer] ?? 0;
  const eligible = canLevelUp(profile, officer).ok;
  // 카드는 넉넉한데 꺼져 있다 = 도시 레벨 상한 — 그것만 말한다(카드 모자람은 숫자가 말한다)
  const cap = officerLevelCap(profile);
  const levelsNote = need !== null && have >= need && inst.level >= cap
    ? t('levelup.cityCap', { city: profile.cityLevel, cap }) : null;

  return (
    <>
      <OfficerCardModal
        row={row}
        onClose={onClose}
        onItems={() => setPicking(true)}
        onLevels={() => setManaging(true)}
        levelsCards={{ have, need }}
        levelsEligible={eligible}
        levelsNote={managing ? null : levelsNote}
        {...(equip ? { equip } : {})}
        {...(injury ? { injury } : {})}
        {...(action ? { action } : {})}
      />
      {/* 카드 위에 겹쳐 뜨는 판 — 닫으면 카드로 돌아온다 */}
      {managing && (
        <LevelUpPanel profile={profile} officer={officer} onChange={onChange} onClose={() => setManaging(false)} />
      )}
      {picking && (
        <HeldPicker
          profile={held?.profile ?? profile}
          officer={officer}
          onPick={held?.onPick ?? ((op) => onChange(applyHeld(profile, op)))}
          onClose={() => setPicking(false)}
        />
      )}
      {cardGuide.node}
    </>
  );
}
