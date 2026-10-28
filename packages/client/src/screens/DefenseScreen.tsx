/**
 * 방어 기록 (2026-10-28, GDD §8.8 단계 5) — 대자보의 [방어 기록 보기]
 *
 * ```
 * ┌ ← 대자보로        방어 기록 ──────┐
 * ┌ 합계 판 ──────────────────────────┐
 * │ 방어 12 · 막음 9 · 승률 75%         │
 * └──────────────────────────────────┘
 * ┌ 기록 판 ──────────────────────────┐
 * │ [막음] 낙양                [다시 보기] │
 * │        3v3 · 10.28 14:02            │
 * │        공격 843 · 수비 901 「초전박살」 │
 * │ [이탈] …                            [다시 보기] │
 * │ [뚫림] … 「이전 규칙의 판」              │
 * │            1 / 3                    │
 * └──────────────────────────────────┘
 * ```
 *
 * 줄은 서버가 읽어 준 것 그대로다(`GET /defense`) — 결말 · 다시 볼 수 있는가(규칙 버전)는 서버 · meta가 정한다.
 * **화면을 여는 것이 곧 「다 봤다」**다(`POST /defense/seen`) — 열 때 받은 줄의 「새로」 표지는 이번 화면에서는 그대로 보인다.
 * [다시 보기]는 그 판의 기록을 받아 리플레이 화면(`DefenseReplayScreen`)으로 간다. 규칙이 바뀐 판은 결과만(기획자 확정).
 */

import { useEffect, useState } from 'react';
import { DEFENSE_PAGE_SIZE, defenseHeld, defenseRate } from '@samchess/meta';
import type { DefenseReplayData, DefenseRow, DefenseSummary, PlayerProfile } from '@samchess/meta';
import { currentSession } from '../meta/auth.ts';
import { fetchDefense, fetchDefenseReplay, markDefenseSeen } from '../meta/defense.ts';
import { rankingBackdrop } from './backdrop.ts';
import { Pager } from './PagerButton.tsx';
import { stripBackArrow } from './RankingCommon.tsx';
import { ScreenChrome } from './ScreenChrome.tsx';
import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ok'; rows: DefenseRow[]; summary: DefenseSummary };

/** `MM.DD HH:mm` — 언어와 무관한 꼴(대장간의 제작일과 같은 까닭: 좁은 칸이 언어마다 무너지지 않게) */
export function formatDefenseAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DefenseScreen({ profile, onBack, onReplay }: {
  profile: PlayerProfile;
  onBack: () => void;
  /** 그 판의 기록을 받았다 — 리플레이로 */
  onReplay: (data: DefenseReplayData) => void;
}): React.JSX.Element {
  useLang();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void fetchDefense().then((r) => {
      if (!live) return;
      setLoad(r ? { state: 'ok', ...r } : { state: 'failed' });
      // 연 것이 곧 본 것이다 — 받은 뒤에 적어야 이번 화면의 「새로」 표지가 남는다
      if (r) void markDefenseSeen();
    });
    return () => { live = false; };
  }, []);

  const rows = load.state === 'ok' ? load.rows : [];
  const pageCount = Math.max(1, Math.ceil(rows.length / DEFENSE_PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(current * DEFENSE_PAGE_SIZE, (current + 1) * DEFENSE_PAGE_SIZE);
  const summary = load.state === 'ok' ? load.summary : null;
  const rate = summary ? defenseRate(summary) : null;

  const replay = async (row: DefenseRow): Promise<void> => {
    if (busy !== null) return;
    setBusy(row.id);
    setErr(null);
    const r = await fetchDefenseReplay(row.id);
    setBusy(null);
    if (r && r !== 'stale') { onReplay(r); return; }
    setErr(t(r === 'stale' ? 'defense.stale' : 'defense.err.replay'));
  };

  return (
    <ScreenChrome
      backdrop={rankingBackdrop(profile.cityLevel)}
      className="scr-ranking scr-ranking-menu scr-board scr-defense"
      account={currentSession()?.email ?? null}
    >
      <div className="place-bar" data-screen="defense" data-load={load.state}>
        <button className="btn ghost sm" data-action="back" onClick={onBack}>
          {stripBackArrow(t('defense.back'))}
        </button>
        <span className="place-nm">{t('defense.title')}</span>
      </div>

      <div className="place-body">
        <section className="place-panel dfs-sum" data-field="summary"
          data-total={summary?.total ?? ''} data-held={summary?.held ?? ''}>
          <p className="row">
            {summary
              ? t('defense.sum', { total: summary.total, held: summary.held, rate: rate === null ? '—' : `${Math.round(rate * 100)}%` })
              : '—'}
          </p>
          <p className="hint">{t('defense.sumHint')}</p>
        </section>

        <section className="place-panel dfs-list">
          {load.state !== 'ok' || rows.length === 0 ? (
            <p className="hint dfs-none" data-field="listState">
              {load.state === 'loading' ? t('defense.loading') : load.state === 'failed' ? t('defense.failed') : t('defense.empty')}
            </p>
          ) : (
            <div className="dfs-rows">
              {pageRows.map((row) => (
                <div key={row.id} className="dfs-row" data-defense={row.id} data-result={row.result}
                  data-replayable={row.replayable ? '1' : '0'} data-seen={row.seen ? '1' : '0'}>
                  <span className="dfs-tag" data-field="result" data-held={defenseHeld(row.result) ? '1' : '0'}>
                    {t(`defense.result.${row.result}`)}
                  </span>
                  <div className="dfs-main">
                    <p className="dfs-head">
                      {!row.seen && <i className="dfs-new" data-field="new">{t('defense.new')}</i>}
                      <b data-field="attacker">{row.attackerCity}</b>
                    </p>
                    <p className="dfs-sub" data-field="when">{row.mode} · {formatDefenseAt(row.at)}</p>
                    <p className="dfs-sub" data-field="powers">
                      {t('defense.powers', { a: row.attackerPower.toLocaleString(), d: row.defenderPower.toLocaleString(), squad: row.defenderSquad })}
                    </p>
                  </div>
                  {row.replayable ? (
                    <button className="btn sm" data-action="replay" disabled={busy !== null} onClick={() => { void replay(row); }}>
                      {t('defense.replay')}
                    </button>
                  ) : (
                    <span className="hint dfs-stale" data-field="stale">{t('defense.staleShort')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {err && <p className="note" data-field="error">{err}</p>}
          <Pager page={current} pageCount={pageCount} onPage={setPage} ends />
        </section>
      </div>
    </ScreenChrome>
  );
}
