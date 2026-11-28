/**
 * 건물 한 장 — 도시 관리의 건물 줄 · 증축 고르기의 줄 오른쪽 [보기](`mk-view`)를 누르면 뜬다 (2026-11-23 기획자).
 * 도시 관리(`CityScreen.tsx`)에서 나왔다 — 증축 고르기(`CityUpgrade.tsx`)도 「오르면 무엇을 하나」를 같은 한 장으로 보여 준다.
 */

import {
  academyOf, academyTopics, buildingRows, forgeQuota, forgeShelf, grainPerHour, researchedWeapons, hospitalRooms, poolUsed, researchTopics,
} from '@samchess/meta';
import { EQUIPMENT, marketItemsForMarket } from '@samchess/data';
import type { BuildingRow, PlayerProfile } from '@samchess/meta';
import type { BuildingId } from '@samchess/data';
import { BUILDING_BONUS_KEYS, buildingCanText, buildingNameText, buildingStatusText } from './buildingText.ts';
import { CityBonusMark } from './CityBonus.tsx';
import { TacticIcon } from './TacticIcon.tsx';
import { HeldArt } from './SquadMembersScreen.tsx';
import { pickEquipName, pickMarketItemName, pickTacticName } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import { BuildingIcon, GameIcon } from './GameIcon.tsx';
import { gameIconUrl } from '../ui/gameIcon.ts';
import { BuildingLevelBadge } from './LevelBadge.tsx';

/**
 * 그 건물이 한 단계 오른 뒤의 계정 · 줄 — 증축 고르기의 한 장이 쓴다(안 지었으면 Lv1). 숫자는 규칙(`buildingRows` · `hospitalRooms` …)이 낸다 —
 * 그래서 줄만이 아니라 **계정째** 한 단계 올린 것을 넘긴다(병원 치료실 수처럼 계정에서 읽는 값이 있다)
 */
export function nextBuilding(profile: PlayerProfile, id: BuildingId): { profile: PlayerProfile; row: BuildingRow } | null {
  const next = { ...profile, buildings: { ...profile.buildings, [id]: (profile.buildings[id] ?? 0) + 1 } };
  const row = buildingRows(next).find((r) => r.id === id);
  return row ? { profile: next, row } : null;
}

/**
 * 살 수 있는 것 · 만들 수 있는 것 한 개 — **둥근 금테 배지** (2026-11-23 기획자, 장수 상세 [아이템] 단추의 배지와 같은 꼴:
 * 금빛 고리 안 검은 원에 그림). 이름은 올리면(`title`)
 */
function PeekBadge({ src, name, kind, id, off = false }: { src: string; name: string; kind: string; id?: string; off?: boolean }): React.JSX.Element {
  // 아이템 · 병기구는 그림 뒤에 후광 — 부대 · [아이템] 단추와 같은 `HeldArt`(레벨이 높을수록 자주 · 금, 2026-11-23 기획자)
  return (
    <span className={`cty-peek-badge${off ? ' cty-peek-off' : ''}`} title={name} data-kind={kind}>
      <span className="cty-peek-badge-in">{id ? <HeldArt id={id} /> : <img src={src} alt={name} draggable={false} />}</span>
    </span>
  );
}

/**
 * 건물 한 장의 본문 줄 (2026-11-23 기획자 — 건물마다 따로 정했다). 숫자는 전부 규칙 함수가 낸다.
 *
 * | 건물 | 첫 줄 | 둘째 줄 |
 * |---|---|---|
 * | 궁궐 | 장수 n명까지 등용 가능 | 현원 n [장수] — 최대는 첫 줄이 말한다 |
 * | 병영 | 군량 n까지 비축 가능 | 현재 n [군량] |
 * | 장터 | 구매 가능: [금화][자재][장수 카드] — 살 것 · 만들 것은 둥근 금테 배지(`PeekBadge`) | 아이템 구매 가능: 그 레벨까지 열린 아이템 그림(Lv1부터, 2026-11-28) |
 * | 병원 | [부상] n명 치료 가능, [치료실] n — 한 줄 | |
 * | 대장간 | 연구 가능: 그 레벨까지의 병기 그림(아직 연구 안 한 것은 흑백) | 연구 n개 · 진열 n개(축하까지 봐 장터에 오른 것) — 2026-11-28 연구로 |
 * | 태학 | 연구 가능: 그 레벨이 여는 개량 책략 셋(끝냈으면 고르지 않은 둘을 흑백으로) | 끝냈으면 연구: [고른 엠블럼], 아니면 연구: 끝낸 수/열린 수 |
 * | 농지 | 시간당 군량 n 생산 | (컬렉션으로 요율이 달라졌을 때만) 지금 요율 |
 */
function peekLines(profile: PlayerProfile, row: BuildingRow, future: boolean): { field: string; body: React.ReactNode }[] {
  const lines = peekLinesAll(profile, row, future);
  // 증축 고르기의 한 장(`future`)은 지금 형편 줄(현원 · 군량 · 만든 수 · 연구한 것)을 뺀다 (2026-11-23 기획자)
  return future ? lines.filter((l) => l.field !== 'status') : lines;
}

function peekLinesAll(profile: PlayerProfile, row: BuildingRow, future: boolean): { field: string; body: React.ReactNode }[] {
  const lv = row.level;
  switch (row.id) {
    case 'palace':
      return [
        { field: 'can', body: buildingCanText(row) },
        { field: 'status', body: <>{t('city.peek.pool', { n: poolUsed(profile) })}<GameIcon name="tab-officer" label={t('city.cond.officers')} /></> },
      ];
    case 'barracks':
      return [
        { field: 'can', body: buildingCanText(row) },
        { field: 'status', body: <>{t('city.peek.grain', { n: profile.grain })}<GameIcon name="res-grain" label={t('market.grain')} /></> },
      ];
    case 'market': {
      // 증축 고르기의 한 장(`future`)은 **그 레벨에서 새로 열리는 것만** 「신규 아이템」으로 (2026-11-23 기획자)
      const items = marketItemsForMarket(lv).filter((m) => !future || m.unlockLevel === lv);
      return [
        { field: 'buy', body: <>{t('city.peek.buy')}
          <PeekBadge src={gameIconUrl('res-gold')} name={t('market.gold')} kind="gold" />
          <PeekBadge src={gameIconUrl('res-materials')} name={t('city.materials')} kind="materials" />
          <PeekBadge src={gameIconUrl('res-card')} name={t('market.status.cards')} kind="card" /></> },
        ...(items.length ? [{ field: 'items', body: <>{t(future ? 'city.peek.newItems' : 'city.peek.items')}
          {items.map((m) => <PeekBadge key={m.id} src={`market-items/${m.id}.png`} name={pickMarketItemName(m)} kind="item" id={m.id} />)}</> }] : []),
      ];
    }
    case 'hospital': {
      const n = hospitalRooms(profile);
      return [{ field: 'can', body: <>
        <GameIcon name="st-injured" label={t('city.peek.injured')} />{t('city.peek.heal', { n })},
        <GameIcon name="hosp-ward" label={t('city.bld.label.hospital')} />{n}</> }];
    }
    case 'forge': {
      // 그 레벨까지 고를 수 있는 병기 — 증축 고르기의 한 장(`future`)은 새로 열리는 셋만. 지금 한 장은 연구한 것만 또렷이(2026-11-28)
      const done = researchedWeapons(profile);
      const shown = EQUIPMENT.filter((e) => (future ? e.unlockLevel === lv : e.unlockLevel <= lv))
        .sort((a, b) => a.unlockLevel - b.unlockLevel || a.order - b.order);
      return [
        { field: 'craft', body: <>{t(future ? 'city.peek.newCraft' : 'city.peek.craft', { n: forgeQuota(lv) })}
          {shown.map((e) => (
            <PeekBadge key={e.id} src={`blacksmith/${e.id}.png`} name={pickEquipName(e)} kind="equip" id={e.id} off={!future && !done.has(e.id)} />
          ))}</> },
        { field: 'status', body: t('city.peek.forgeCount', { done: done.size, shelf: forgeShelf(profile).length }) },
      ];
    }
    case 'academy': {
      // 레벨마다 셋 가운데 **하나만** 연구한다 — 이 레벨에서 끝냈으면 첫 줄은 고르지 않은 둘을 흑백으로, 고른 것은 둘째 줄 「연구: [엠블럼]」 (2026-11-23 기획자)
      const chosen = future ? undefined : academyOf(profile).done.find((d) => d.level === lv)?.tactic;
      const topics = academyTopics(lv).filter((tc) => tc.id !== chosen);
      const chosenDef = chosen ? academyTopics(lv).find((tc) => tc.id === chosen) : undefined;
      return [
        { field: 'research', body: <>{t('city.peek.research')}
          {topics.map((tc) => <TacticIcon key={tc.id} id={tc.id} label={pickTacticName(tc)} className={`cty-peek-tac${chosen ? ' cty-peek-off' : ''}`} />)}</> },
        chosenDef
          ? { field: 'status', body: <>{t('city.peek.researched')}<TacticIcon id={chosenDef.id} label={pickTacticName(chosenDef)} className="cty-peek-tac" /></> }
          : { field: 'status', body: t('city.peek.researchDone', { done: academyOf(profile).done.length, n: researchTopics(profile) }) },
      ];
    }
    default: {
      const can = buildingCanText(row);
      const status = buildingStatusText(profile, row);
      const more = status !== can && (row.id !== 'farm' || grainPerHour(profile) !== (row.effect?.now ?? 0));
      return more ? [{ field: 'can', body: can }, { field: 'status', body: status }] : [{ field: 'can', body: can }];
    }
  }
}

/**
 * 건물 한 장 — 건물 줄 오른쪽 [보기](`mk-view`)를 누르면 뜬다 (2026-11-23 기획자). 줄에서 걷은 기능 · 현황을 여기서 본다.
 * 꼴은 책략 설명 두루마리(`.tac-modal` · 오른쪽 아래 체크 닫기)이고 제목은 가운데 「[그림] [배지] 이름」, 한 줄 띄고 본문(`peekLines`).
 * 컬렉션 도시 효과 인장은 마지막 줄 끝에(옛 줄 끝 자리)
 */
export function BuildingPeek({ profile, row, onClose, future = false }: {
  profile: PlayerProfile; row: BuildingRow; onClose: () => void;
  /** 증축 고르기에서 연 한 장 — `row`는 오른 뒤의 줄이고, 지금 형편 줄 · 컬렉션 인장은 안 싣는다 */
  future?: boolean;
}): React.JSX.Element {
  const lines = peekLines(profile, row, future);
  const bonus = future ? undefined : BUILDING_BONUS_KEYS[row.id];
  return (
    <div className="modal-back cty-peek-back" data-modal="building" onClick={onClose}>
      <div className="tac-modal cty-peek" data-building={row.id} data-level={row.level} onClick={(e) => e.stopPropagation()}>
        <p className="cty-peek-ttl">
          <BuildingIcon id={row.id} label={buildingNameText(row.id)} />
          <span className="cty-peek-lv" title={row.level > 0 ? undefined : t('city.bld.none')}><BuildingLevelBadge level={Math.max(1, row.level)} /></span>
          <b>{buildingNameText(row.id)}</b>
        </p>
        {lines.map(({ field, body }, i) => (
          <p key={field} className="cty-peek-line" data-field={field}>
            {body}
            {i === lines.length - 1 && bonus && <CityBonusMark profile={profile} keys={bonus} />}
          </p>
        ))}
        <button className="tac-close" data-action="closeBuilding" onClick={onClose} aria-label={t('ranking.card.close')}>
          <img src="icons/confirm.png" alt="" />
        </button>
      </div>
    </div>
  );
}
