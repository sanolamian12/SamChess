/**
 * 튜토리얼 목록 — 병영의 [튜토리얼] (G3, 2026-10-22 기획자 · 2026-11-11 갈래 둘로 다시 짬).
 *
 * | 자리 | 무엇 |
 * |---|---|
 * | 제목 판 | 「튜토리얼」 |
 * | 목록 판(`.tut-list`) | 고른 갈래의 판들 — 한 줄에 표(클리어 · 다음 목표 · 잠김) · 이름 · 한 줄 설명 |
 * | 아래 명령 판(`.tut-tabs`) | [전투 기초] [S급 장수 튜토리얼] [뒤로 가기] — [전투 기초]가 처음 골린 칸이다 |
 *
 * **무엇이 보이고 켜지는지는 규칙이 정한다**(`tutorialList` — 기본 1 → 2 → 3 차례로 열리고, 일기토 → 설전은 기본 셋 뒤에 차례로 켜지고,
 * S급은 보유해야 보이고 기본 셋 뒤에 켜지며 **그 전투의 역사 순서**로 선다). 화면은 그리기만 한다. 클리어 여부는 단추 그림이 아니라 **줄 왼쪽의 표**로 가른다 —
 * 끝낸 판은 파란 체크(소개 패널의 「깼으면 파랗다」와 같은 그림), 그 갈래에서 다음에 할 판은 가리키는 손 + 「다음 목표」.
 *
 * 일기토 · 설전은 전투 기초의 넷째 · 다섯째 자리다(2026-11-12 — 그 전까지 「준비 중」으로 잠가 두던 자리). 필수가 아니다.
 * S급 판 가운데 아직 판이 없는 것만 「준비 중」(`data-status="soon"`)이다.
 *
 * 줄은 여전히 `data-action="tutorial"` · `data-tutorial` · `data-status`를 단다(스모크 · 내관 안내가 이것으로 찾는다).
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { isBasicsTab, tutorialList, tutorialReady } from '@samchess/meta';
import type { PlayerProfile, TutorialId } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { pickOfficerNameById } from '../i18n/story.ts';
import { t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';
import { placeBackdrop } from './backdrop.ts';
import { ScreenChrome } from './ScreenChrome.tsx';
import { GameIcon } from './GameIcon.tsx';
import { tutorialIntro } from './tutorialIntro.ts';
import { Pager } from './PagerButton.tsx';
import { useSteadyPage } from './useSteadyPage.ts';

/** S급 갈래의 한 쪽에 놓는 판 수 */
const S_PAGE = 5;
import { portraitUrl } from '../ui/art.ts';
import type { GameIconName } from '../ui/gameIcon.ts';

type Tab = 'basic' | 's';
/** 줄 왼쪽의 표 — 끝냄 · 다음 목표 · 잠김 · 준비 중. 빈 값은 표 없음(열려 있지만 다음 목표는 아니다) */
type Mark = 'done' | 'next' | 'locked' | 'soon' | '';

/**
 * 전투 기초 다섯 판의 얼굴 (2026-11-11 기획자) — 기물 여섯은 3v3 · 5v5의 기물 그림, 책략과 아이템은 전투 명령 판의 [책략],
 * 고유기술은 새로 그린 그림, 일기토 · 설전은 대결 신청 단추의 그림. S급 판은 그 장수의 초상이 얼굴이다.
 */
const BASIC_ICON: Record<string, GameIconName> = {
  'basic-1': 'mode-5v5', 'basic-2': 'tut-tactic', 'basic-3': 'tut-unique', 'basic-duel': 'cmd-duel', 'basic-debate': 'cmd-debate',
};

interface Row {
  key: string; id?: TutorialId; status: string; name: string; sub: string; mark: Mark; enabled: boolean;
  /** 소개 패널의 제목 — 줄의 이름(`name`)과 다를 때만(S급: 줄은 `tut.s.row`, 패널은 늘 「{장수}의 전장」) */
  title?: string;
  /** 줄 왼쪽의 얼굴 — 기본 판은 아이콘, S급은 장수 초상 */
  icon?: GameIconName; officer?: string;
  /** 이름 오른쪽에 작게 — S급 판의 해 · 곳(「213년 · 유수구」, 2026-11-13 기획자) */
  era?: string;
}

/** 줄 한 칸의 속 — 보이는 줄과 높이를 재는 숨은 줄(`.tut-measure`)이 같은 것을 그린다 */
function RowBody({ r }: { r: Row }): React.JSX.Element {
  return (
    <>
      <span className="tut-face">
        {r.icon && <GameIcon name={r.icon} label={r.name} />}
        {r.officer && <img className="tut-portrait" src={portraitUrl(r.officer)} alt="" draggable={false} />}
      </span>
      <span className="tut-txt">
        <span className="tut-head">
          <span className="tut-name">{r.name}</span>
          {r.era && <span className="tut-era">{r.era}</span>}
        </span>
        <span className="tut-sub">{r.sub}</span>
      </span>
      {/* 오른쪽 표 — 끝냄은 승리 메달 위에 파란 붓글씨 「완료」, 다음 목표는 위아래로 둥실 뜨는 투구 메달 위에 노란 「다음」,
          잠김 · 준비 중은 자물쇠 위에 회색 「잠김」 (2026-11-11 기획자) */}
      {(r.mark === 'locked' || r.mark === 'soon') && (
        <span className="tut-stamp" data-mark="locked">
          <GameIcon name="mk-lock" label={t('tut.mark.locked')} />
          <span className="tut-stamp-t">{t('tut.mark.locked')}</span>
        </span>
      )}
      {r.mark === 'done' && (
        <span className="tut-stamp" data-mark="done">
          <GameIcon name="rec-win" label={t('tut.mark.done')} />
          <span className="tut-stamp-t">{t('tut.mark.done')}</span>
        </span>
      )}
      {r.mark === 'next' && (
        <span className="tut-stamp" data-mark="next">
          <GameIcon name="tut-next" label={t('tut.mark.next')} className="tut-float" />
          <span className="tut-stamp-t">{t('tut.mark.next')}</span>
        </span>
      )}
    </>
  );
}

export function TutorialListScreen({ profile, onBack, onPlay }: {
  profile: PlayerProfile;
  onBack: () => void;
  onPlay: (id: TutorialId) => void;
}): React.JSX.Element {
  const lang = useLang();
  const [tab, setTab] = useState<Tab>('basic');
  /** 판을 누르면 곧장 들어가지 않고 **소개 패널**을 띄운다(2026-10-26 기획자) — 한 줄 이야기 · 클리어 목표 · 클리어 여부 ·
      [입장하기] [돌아가기] */
  const [intro, setIntro] = useState<{ id: TutorialId; title: string; done: boolean } | null>(null);

  const all = tutorialList(profile);
  const basics: Row[] = all.filter((r) => isBasicsTab(r.id)).map(({ id, status }) => ({
    key: id, id, status, name: t(`tut.${id}` as StringKey), icon: BASIC_ICON[id]!,
    // 잠긴 일기토는 「기본 튜토리얼을 끝내면 열립니다」(기본 셋이 연다), 나머지는 「앞 튜토리얼을 먼저」(설전은 일기토가 연다)
    sub: status === 'locked' ? t(id === 'basic-duel' ? 'tut.status.sLocked' : 'tut.status.locked') : t(`tut.${id}.sub` as StringKey),
    mark: status === 'done' ? 'done' : status === 'locked' ? 'locked' : '', enabled: status !== 'locked',
  }));
  const sRows: Row[] = all.filter((r) => r.id.startsWith('s-')).map(({ id, status }) => {
    const officer = id.slice(2);
    const ready = tutorialReady(id);
    const nm = pickOfficerNameById(officer, officer);
    return {
      // 줄의 제목은 `tut.s.row` — 「{장수}의 전장」이 두 줄로 접히는 언어(영 · 서 · 이 · 포 · 몽)는 이름만 적는다(2026-11-13 기획자).
      // 소개 패널은 자리가 넉넉해 늘 「{장수}의 전장」(`tut.s`)
      key: id, id, status: ready ? status : 'soon', name: t('tut.s.row', { name: nm }), officer,
      title: t('tut.s', { name: nm }),
      // 아랫줄은 그 전장의 한 줄 이야기(2026-11-13 기획자 — 옛 「이 장수의 고유기술을 써 보는 전장」을 갈음)
      era: t(`tut.s.${officer}.era` as StringKey),
      sub: status === 'locked' ? t('tut.status.sLocked') : !ready ? t('tut.s.sub') : t(`tut.s.${officer}.line` as StringKey),
      mark: !ready ? 'soon' : status === 'done' ? 'done' : status === 'locked' ? 'locked' : '',
      enabled: ready && status !== 'locked',
    };
  });
  // 다음 목표 — 그 갈래에서 아직 안 끝낸, 열린 판 가운데 맨 앞 하나
  for (const rows of [basics, sRows]) {
    const next = rows.find((r) => r.enabled && r.status === 'open');
    if (next) next.mark = 'next';
  }
  /**
   * S급 갈래는 다섯 줄씩 쪽을 넘긴다 (2026-11-11 기획자 — S급은 서른까지 는다). 처음 열면 「다음 목표」가 있는 쪽부터.
   * 전투 기초는 다섯 줄 그대로라 쪽이 없다.
   */
  const pageCount = Math.max(1, Math.ceil(sRows.length / S_PAGE));
  const [sPage, setSPage] = useState(() => Math.max(0, Math.floor(sRows.findIndex((r) => r.mark === 'next') / S_PAGE)));
  const page = Math.min(sPage, pageCount - 1);
  // 판 높이는 쪽을 넘겨도 그대로 — 가장 긴 쪽에 맞춘다(`useSteadyPage`, 2026-11-13 기획자)
  const listRef = useRef<HTMLElement>(null);
  const shown = useSteadyPage(listRef, page, tab === 's' ? pageCount : 1, [tab, sRows.length]);
  const rows = tab === 'basic' ? basics : sRows.slice(shown * S_PAGE, (shown + 1) * S_PAGE);

  /**
   * **모든 칸의 높이를 하나로** (2026-11-13 기획자 — 「제일 높은 칸에 맞춰 통일하면 더 정돈되어 보인다」).
   * 두 갈래 · 모든 쪽의 줄을 판 폭 그대로 숨은 칸(`.tut-measure`, 높이 0)에 깔아 두고, 그 가운데 가장 높은 줄의 높이를
   * `--tut-row-h`로 판에 건다 — 보이는 줄은 전부 그 높이로 선다. 그리기 전에(`useLayoutEffect`) 재서 깜빡이지 않는다.
   * 들어올 때 · 언어가 바뀔 때 · 판 폭이 바뀔 때 다시 잰다(언어마다 글 길이가 달라 칸 높이도 언어마다 다르다).
   * 숨은 줄에는 `data-action`을 안 단다 — 스모크가 `[data-action="tutorial"]`로 줄을 집는다.
   */
  const measureRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(0);
  const rowSig = [...basics, ...sRows].map((r) => `${r.key}:${r.mark}:${r.status}`).join();
  useLayoutEffect(() => {
    const list = listRef.current;
    const box = measureRef.current;
    if (!list || !box) return;
    let max = 0;
    for (const el of box.children) max = Math.max(max, (el as HTMLElement).getBoundingClientRect().height);
    if (max > 0) list.style.setProperty('--tut-row-h', `${Math.ceil(max)}px`);
  }, [lang, rowSig, listWidth]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(list.getBoundingClientRect().width);
      setListWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  return (
    <ScreenChrome
      backdrop={placeBackdrop('barracks', profile.cityLevel)}
      className="scr-place scr-place-barracks scr-tutorials"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="tutorials">
        <span className="place-nm">{t('tut.title')}</span>
      </div>

      <section ref={listRef} className="place-panel tut-list" data-tab={tab}>
        {/* 높이를 재는 숨은 칸 — 두 갈래의 모든 줄(위 `--tut-row-h` 참조) */}
        <div ref={measureRef} className="tut-measure" aria-hidden>
          {[...basics, ...sRows].map((r) => <div key={r.key} className="tut-row"><RowBody r={r} /></div>)}
        </div>
        {rows.length === 0 && <p className="hint tut-empty">{t('tut.s.empty')}</p>}
        {rows.map((r) => (
          <button
            key={r.key}
            className="tut-row"
            data-action={r.id ? 'tutorial' : undefined}
            data-tutorial={r.id}
            data-status={r.status}
            data-mark={r.mark || undefined}
            disabled={!r.enabled}
            onClick={() => r.id && setIntro({ id: r.id, title: r.title ?? r.name, done: r.status === 'done' })}
          >
            <RowBody r={r} />
          </button>
        ))}
        {tab === 's' && pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setSPage} ends field="tutPager" />}
      </section>

      <div className="place-body">
        <section className="place-panel bar-doors tut-tabs">
          {(['basic', 's'] as const).map((k) => (
            <button
              key={k}
              className={`btn wide${tab === k ? ' on' : ''}`}
              data-action="tutTab" data-tab={k} aria-pressed={tab === k}
              onClick={() => setTab(k)}
            >
              <span className="lbl">{t(k === 'basic' ? 'tut.tab.basic' : 'tut.tab.s')}</span>
              {/* 고른 갈래는 오른쪽에 큰 확인 체크 — 고른 것과 안 고른 것이 한눈에 갈린다 (2026-11-11 기획자) */}
              {tab === k && <GameIcon name="tut-picked" label="" className="tut-picked" />}
            </button>
          ))}
          <button className="btn wide" data-action="back" onClick={onBack}>
            <span className="lbl">{t('tut.back')}</span>
          </button>
        </section>
      </div>

      {intro && (
        <IntroPanel
          {...intro}
          onEnter={() => { const id = intro.id; setIntro(null); onPlay(id); }}
          onClose={() => setIntro(null)}
        />
      )}
    </ScreenChrome>
  );
}

/** 소개 패널 — 판 이름 · 한 줄 이야기 · 승리 조건 · 패배 조건(메달 + 짧은 글) · 클리어 표 + [입장하기]/[다시하기] · [돌아가기].
    가리개를 누르면 [돌아가기]와 같다 */
function IntroPanel({ id, title, done, onEnter, onClose }: {
  id: TutorialId; title: string; done: boolean; onEnter: () => void; onClose: () => void;
}): React.JSX.Element {
  const info = tutorialIntro(id);
  return (
    <div className="modal-back" data-modal="tutorialIntro" data-tutorial={id} onClick={onClose}>
      <div className="modal mod-plank tut-intro" onClick={(e) => e.stopPropagation()}>
        <p className="modal-ttl">{title}</p>
        <p className="tut-intro-story" data-field="story">{info.story}</p>
        <div className="tut-intro-sec" data-field="goals">
          <span className="cap">{t('tut.intro.goals')}</span>
          <ul>{info.win.map((g, i) => <li key={i}><GameIcon name={g.icon} label={g.text} text /></li>)}</ul>
        </div>
        {info.lose.length > 0 && (
          <div className="tut-intro-sec lose" data-field="lose">
            <span className="cap">{t('tut.intro.lose')}</span>
            <ul>{info.lose.map((g, i) => <li key={i}><GameIcon name={g.icon} label={g.text} text /></li>)}</ul>
          </div>
        )}
        <div className="srt-modal-acts">
          {/* [입장하기] / [다시하기] — 단추 안 글자 왼쪽에 클리어 표(글자만 한 크기): 안 깼으면 붉은 체크 인장, 깼으면 파랗다(기획자 2026-10-26).
              「한 번이라도 해 봤나」는 기록이 없다(서버는 깬 판만 적는다) — 깬 판이면 [다시하기] */}
          <button className="btn primary wide tut-intro-go" data-action="introEnter" data-field="cleared" data-done={done ? '1' : '0'} onClick={onEnter}>
            <GameIcon name={done ? 'mk-done-blue' : 'mk-done'} label={t(done ? 'tut.intro.retry' : 'tut.intro.enter')} text />
          </button>
          <button className="btn wide" data-action="introBack" onClick={onClose}>{t('tut.intro.back')}</button>
        </div>
      </div>
    </div>
  );
}
