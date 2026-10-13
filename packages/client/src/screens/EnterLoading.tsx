/**
 * 입성 로딩 화면 — [입장]을 누른 뒤 메인 화면이 뜰 때까지 (2026-10-13)
 *
 * ```
 *          ╭───────────╮
 *          │  (가마)    │   ← `ui/gate-move.png`, 교군꾼 걸음처럼 들썩인다
 *          ╰───────────╯
 *   ┌──────── 옻칠 판 ────────┐
 *   │         입  성          │
 *   │        ●━━━━○          │   ← 두 걸음: 계정 확인 → 도시 불러오기
 *   │  (원반) 계정을 확인하는 중… │
 *   └─────────────────────────┘
 * ```
 *
 * ────────────────────────────────────────────────────────────────
 * 왜 필요한가 — 「잘못 입력했나」로 읽혔다
 * ────────────────────────────────────────────────────────────────
 *
 * 로그인은 왕복이 **둘**이다 — 인증(`signIn`)과 프로필(`loadProfile`). 첫 왕복 동안은
 * [입장] 단추 글자만 「처리 중..」으로 바뀌었고, 인증이 끝나면 단추가 **다시 「입장」으로
 * 돌아온 채** 프로필을 기다렸다. 막 켜진 서버라 그 둘째 왕복이 길면 화면은 입장 팝업
 * 그대로 멈춰 있어, 사람에게는 「눌렀는데 안 됐다 = 잘못 입력했나」로 읽혔다(기획자 실기).
 * 「멈춘 것」과 「기다리는 것」은 다르다 — `BusyVeil` 머리말의 그 이야기다.
 *
 * 규약은 `BusyVeil`과 같다 — **막는 일은 처음부터, 보이는 것만 뜸을 들여**(180ms).
 * 그림도 같은 옻칠 판(`panel-busy`)과 금빛 원반이다(「기다린다」는 뜻이 같으면 같은 그림).
 * 다른 점은 둘: 성 안으로 드는 가마(메인 화면 성문의 그 그림)가 들썩이고, 지금 몇째
 * 걸음인지가 보인다. 걸음을 글자로만 바꾸면 「멈췄다가 다시 돈다」가 안 보인다.
 *
 * `solo`는 저장된 세션으로 곧장 들어오는 길(`App.tsx`의 `booting`) — 간판 화면이 아직
 * 없어 뒤에 비칠 그림이 없으므로 바탕을 덮는다.
 */

import { t } from '../i18n/index.ts';
import { useLang } from '../i18n/useLang.ts';

/** 입성의 두 걸음 — 인증 왕복 · 프로필 왕복 */
export type EnterPhase = 'auth' | 'city';

const STEPS: readonly EnterPhase[] = ['auth', 'city'];

/** `BusyVeil`의 `SHOW_AFTER_MS`와 같은 값 — 왕복이 짧으면 번쩍임만 남는다 */
const SHOW_AFTER_MS = 180;

export function EnterLoading({ phase, solo = false }: {
  phase: EnterPhase;
  solo?: boolean;
}): React.JSX.Element {
  useLang();
  const at = STEPS.indexOf(phase);
  return (
    <div
      className="ent-loading"
      data-modal="enterLoading"
      data-phase={phase}
      data-solo={solo ? '' : undefined}
      style={{ animationDelay: `${SHOW_AFTER_MS}ms` }}
      role="status"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
    >
      <img className="ent-palanquin" src="ui/gate-move.png" alt="" aria-hidden="true" />
      <div className="ent-box">
        <p className="ent-ttl">{t('enter.title')}</p>
        <ol className="ent-steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <li key={s} className="ent-step" data-state={i < at ? 'done' : i === at ? 'now' : 'next'} />
          ))}
        </ol>
        <div className="ent-msg">
          <span className="busy-spin" aria-hidden="true" />
          <span className="busy-lbl" data-field="enterMsg">{t(`enter.${phase}`)}</span>
        </div>
      </div>
    </div>
  );
}
