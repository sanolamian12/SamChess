/**
 * 컬렉션 도시 효과의 표지 (2026-10-15, `Design/컬렉션_기획.md` §3).
 *
 * 두 조각이다 — 모양은 전투의 고유기술 SP 칸(「~~6~~ 5」 + 붉은 인장)을 그대로 따른다.
 *  - `Span` — 시간 값. 컬렉션이 바꿨으면 「~~1분~~ 30초」, 아니면 값만
 *  - `CityBonusMark` — 붉은 인장. 누르면 그 값을 바꾼 컬렉션마다 한 줄(`effectLine`). 바꾼 것이 없으면 안 그린다
 *
 * **숫자는 meta가 낸다** — 여기서는 받은 두 값(기본 · 지금)을 그리기만 한다. 어느 컬렉션이 걸렸는지도
 * meta의 `cityBonusSources()`가 고른다(판정 시각까지 같은 함수).
 */

import { Fragment, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CollectionCityKey, CollectionData } from '@samchess/data';
import { cityBonusSources } from '@samchess/meta';
import type { PlayerProfile } from '@samchess/meta';
import { t, tParts } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { collectionTitle, effectLine } from './collectionText.ts';

/** 걸리는 시간 한 줄 — 0인 단위는 안 적는다(「57분」 · 「30초」 · 「3분 36초」 · 「1시간」) */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? t('collection.city.dur.hm', { h, m }) : t('collection.city.dur.h', { h });
  if (m > 0) return s > 0 ? t('collection.city.dur.ms', { m, s }) : t('collection.city.dur.m', { m });
  return t('collection.city.dur.s', { s });
}

/** 번역 문장 안에 `Span` · 인장 같은 노드를 끼운다 — 문장을 쪼개 번역하면 어순이 다른 언어에서 깨진다 */
export function Sentence({ k, vars }: {
  k: StringKey;
  vars: Record<string, string | number | React.ReactNode>;
}): React.JSX.Element {
  return <>{tParts(k, vars).map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/**
 * 시간 값 — 컬렉션이 바꿨으면 「~~1분~~ → 54초」. **화살표를 꼭 넣는다** — 「~~1분~~ 54초」는 취소선이 안 보이는
 * 바탕(옥색 단추)에서 「1분 54초」로 읽혔다. `mark`를 주면 인장을 값 바로 뒤에 붙인다(문장 끝에 두면 혼자 줄을 넘긴다).
 */
export function Span({ base, now, mark }: { base: number; now: number; mark?: React.ReactNode }): React.JSX.Element {
  if (base === now) return <>{formatSpan(now)}</>;
  return (
    <span className="cbm-changed" data-city-from={base} data-city-to={now}>
      <s className="cbm-was">{formatSpan(base)}</s>
      <span className="cbm-arrow" aria-hidden="true">→</span>
      <b className="cbm-now">{formatSpan(now)}</b>
      {mark}
    </span>
  );
}

/**
 * 붉은 인장 — 키들 중 하나라도 걸린 컬렉션이 있으면 선다. `atMs`는 판정 시각(meta와 같은 규약 —
 * 진행 중인 일이면 그 일을 시작한 때, 아니면 지금).
 */
export function CityBonusMark({ profile, keys, atMs }: {
  profile: PlayerProfile;
  keys: readonly CollectionCityKey[];
  atMs?: number;
}): React.JSX.Element | null {
  useLang();
  const ref = useRef<HTMLButtonElement>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [noArt, setNoArt] = useState(false);
  const seen = new Set<string>();
  const list: CollectionData[] = [];
  for (const k of keys) {
    for (const c of cityBonusSources(profile, k, atMs)) if (!seen.has(c.id)) { seen.add(c.id); list.push(c); }
  }
  if (list.length === 0) return null;
  const title = t('collection.battle.fx');
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`cbm${noArt ? ' cbm-css' : ''}`}
        data-city-bonus={keys.join(' ')}
        data-source={list.map((c) => c.id).join(',')}
        title={title}
        aria-label={title}
        onClick={(e) => {
          e.stopPropagation();
          // 팝업은 **화면(`.scr`) 바로 밑**에 올린다 — 판 안에 두면 가리개가 판만 덮는다(`market/parts.tsx`의 `Layer`)
          setLayer((ref.current?.closest('.scr') as HTMLElement | null) ?? document.body);
        }}
      >
        {!noArt && <img src="ui/badge-active.png" alt="" onError={() => setNoArt(true)} />}
      </button>
      {layer && createPortal(
        <div className="modal-back" data-modal="cityBonus" onClick={() => setLayer(null)}>
          <div className="modal cbm-pop" onClick={(e) => e.stopPropagation()}>
            <p className="modal-ttl">{title}</p>
            <ul className="cbm-list">
              {list.map((c) => (
                <li key={c.id} data-collection={c.id}>
                  <b>{collectionTitle(c)}</b>
                  <span>{effectLine(c)}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn wide" data-action="close" onClick={() => setLayer(null)}>
              <span className="lbl">{t('forge.confirm.ok')}</span>
            </button>
          </div>
        </div>,
        layer,
      )}
    </>
  );
}
