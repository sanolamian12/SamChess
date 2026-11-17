/**
 * 환경설정 팝업 — 헤더 오른쪽 기어를 누르면 뜬다 (pptx 33쪽 오른쪽)
 *
 * ```
 * 환 경 설 정
 *   ID        ⟨ID⟩ / [로그인 안 함]
 *   Language  한국어
 *     음성 더빙   한국어   ← 보여 주기만 한다. 더빙은 Language를 따른다 (2026-10-23)
 *             KR EN ES IT JA / MN BR PT CN TW  (한 줄에 다섯, 두 줄)
 *   배경 음악      🏹 ▯ ▯ ▯ ▯ ▯   ← 과녁 다섯 = 20~100% (`VolumeRange`)
 *   효과음(음성)   🏹 ▯ ▯ ▯ ▯ ▯
 *   화면 모드  ◁가로 세로▷   ← 화살표 목판 둘을 대칭으로 — 고른 쪽은 초록 판 · 빛나는 글자
 * ```
 *
 * **어느 화면에서 열든 같은 팝업이다.** 간판·메인·궁궐·병영·장터가 전부 `ScreenChrome`을
 * 통해 이걸 연다 — 화면마다 따로 두면 항목이 하나 늘 때 다섯 군데를 고치게 된다.
 *
 * **언어를 바꿔도 판이 안 움직인다** (2026-11-17 기획자) — 판 폭은 화면의 90%로 고정, 언어 칩 열은 가장 큰 칩 하나의 크기로,
 * 줄 이름 · 가로/세로 칸은 **열 언어 중 가장 큰 것**의 크기로 박는다(`useSteadyBoxes`). 예전에는 「Modo de pantalla」처럼 긴 이름이
 * 두 줄로 접혀 언어마다 판 높이가 15px씩 출렁였다.
 *
 * ────────────────────────────────────────────────────────────────
 * 지금 실제로 동작하는 것과 자리만 잡아 둔 것
 * ────────────────────────────────────────────────────────────────
 *
 * | 항목 | 지금 |
 * |---|---|
 * | Language | **동작한다** — 고르면 곧바로 바뀌고 새로고침해도 남는다 |
 * | 음성 더빙 | **보여 주기만** — Language의 매칭(`DUB_FOR`)을 따른다. 따로 고르는 단추는 2026-10-23에 걷었다(둘을 따로 고르니 더 헷갈렸다) |
 * | 배경 음악 · 효과음(음성) | **동작한다** — 다섯 칸(`audio/volume.ts`). 옛 끔 · 켬 스위치를 갈았다 |
 * | ID · ID 기억 | **자리만.** 계정·로그인은 별도 세션에서 붙인다(기획자 지정) |
 * | 화면 모드 | **세로 고정.** 프레임이 1:2라 지금은 고를 것이 없다 |
 *
 * 자리만 잡아 둔 것을 「눌리는데 아무 일도 없는 스위치」로 두지 않는다 — 잠가 두고
 * 왜 잠겼는지 한 줄로 적는다. 「왜 안 되지」를 남기지 않기 위해서다.
 */

import { useLayoutEffect, useRef } from 'react';
import { useFitText } from './useFitText.ts';
import { VolumeRange } from './VolumeRange.tsx';
import { DUB_LANGS, LANGS, inLang, setLang, t } from '../i18n/index.ts';
import type { StringKey } from '../i18n/index.ts';
import { useDubLang } from '../i18n/useDubLang.ts';
import { useLang } from '../i18n/useLang.ts';

/**
 * 판 안의 칸 크기를 **열 언어 중 가장 큰 것**으로 박는다 (2026-11-17 기획자 — 언어를 바꿀 때마다 판의 크기 · 줄이 들쭉날쭉하지 않게).
 *
 * `data-steady="<묶음>"`이 붙은 요소를 묶음마다 모아, 각 요소를 **한 줄로(nowrap)** 그려 본 가장 큰 폭 · 높이를 묶음 전원에 입힌다.
 * `data-steady-keys="키 키"`가 있으면 그 문구를 열 언어로(`inLang`) 하나씩 끼워 재고, 없으면 지금 글자 그대로 잰다(언어 칩 — 글자가 언어를 안 탄다).
 * 잴 때는 요소를 복제해 **같은 부모 안에** 숨겨 둔다 — 같은 선택자 규칙(글자 크기 · 테 두께)을 그대로 받아야 잰 값이 실제 크기다.
 *
 * 값은 `em`으로 적는다 — 판(`#frame`)이 창 크기를 따라 `rem`째 커지고 줄어도 다시 잴 필요가 없다. 글꼴은 언어를 안 탄다
 * (메타 화면은 시스템 글꼴이다 — `--serif`를 바꾸는 몽골어도 이 판의 글자에는 안 닿는다). 그래서 **열 때 한 번** 재고
 * 늦게 오는 글꼴을 위해 `fonts.ready` 뒤 한 번 더 잰다.
 *
 * **DOM을 직접 쓴다** — 크기를 React state로 들고 `style` prop으로 내리면, 잴 때 지운 값이 직전 값과 같을 때 React가
 * 「바뀐 것 없음」으로 보고 안 되돌린다(2026-08-25 옛 `useTwoChipSize`가 CN↔TW에서 밟았다). **`ResizeObserver`도 안 단다** —
 * 제가 바꾼 크기를 제가 관찰하면 끝없이 돈다.
 */
function useSteadyBoxes(): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const measure = (): void => {
      const els = Array.from(root.querySelectorAll<HTMLElement>('[data-steady]'));
      for (const el of els) { el.style.width = ''; el.style.height = ''; }
      const groups = new Map<string, { els: HTMLElement[]; w: number; h: number }>();
      for (const el of els) {
        const name = el.dataset['steady']!;
        const g = groups.get(name) ?? { els: [], w: 0, h: 0 };
        groups.set(name, g);
        g.els.push(el);
        const keys = (el.dataset['steadyKeys'] ?? '').split(' ').filter(Boolean) as StringKey[];
        const texts = keys.length > 0
          ? keys.flatMap((k) => LANGS.map((l) => inLang(l.id, () => t(k))))
          : [null];
        const fontPx = parseFloat(getComputedStyle(el).fontSize) || 16;
        for (const text of texts) {
          const probe = el.cloneNode(true) as HTMLElement;
          probe.removeAttribute('data-steady');
          probe.removeAttribute('data-steady-keys');
          if (text !== null) probe.textContent = text;
          Object.assign(probe.style, {
            position: 'absolute', visibility: 'hidden', left: '0', top: '0',
            width: 'max-content', height: 'auto', whiteSpace: 'nowrap', pointerEvents: 'none',
          });
          el.parentElement!.appendChild(probe);
          // 레이아웃 크기(offset*)로 잰다 — 판이 transform으로 줄어 있어도 맞다. 소수점 아래는 올린다(모자라면 접힌다)
          g.w = Math.max(g.w, probe.offsetWidth / fontPx);
          g.h = Math.max(g.h, probe.offsetHeight / fontPx);
          probe.remove();
        }
      }
      for (const g of groups.values()) {
        if (!(g.w > 0) || !(g.h > 0)) continue;   // 아직 자리 잡기 전(폭 0)이면 손대지 않는다 — CSS 기본값이 낫다
        for (const el of g.els) {
          const fontPx = parseFloat(getComputedStyle(el).fontSize) || 16;
          // 묶음의 em은 첫 요소 글자 크기 기준이다 — 묶음 안 글자 크기는 같게 둔다(언어 칩끼리 · 가로/세로끼리 · 줄 이름 하나씩)
          el.style.width = `${(g.w + 1 / fontPx).toFixed(3)}em`;
          el.style.height = `${g.h.toFixed(3)}em`;
        }
      }
    };

    measure();
    document.fonts?.ready.then(measure).catch(() => { /* 못 재도 첫 값으로 돈다 */ });
  }, []);

  return ref;
}

export function SettingsModal({ signedIn, onClose }: {
  signedIn: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const lang = useLang();
  const dub = useDubLang();
  const steady = useSteadyBoxes();
  const idValue = signedIn ?? `[${t('settings.signedOut')}]`;
  const langLabel = LANGS.find((l) => l.id === lang)?.label ?? '';
  const dubLabel = DUB_LANGS.find((d) => d.id === dub)?.label ?? '';
  const titleRef = useFitText<HTMLHeadingElement>(t('settings.title'));
  const idRef = useFitText<HTMLSpanElement>(idValue);
  const langRef = useFitText<HTMLSpanElement>(langLabel);
  const dubRef = useFitText<HTMLSpanElement>(dubLabel);

  return (
    <div className="modal-back" onClick={onClose}>
      {/* 안쪽을 누르는 것은 닫기가 아니다 — 바깥을 눌러야 닫힌다 */}
      {/* `.mod-plank`가 목판·명패 화풍이다 — 간판의 언어·크레딧·입장 팝업과 같은
          화풍을 쓰므로 2026-09-11에 `[data-modal="settings"]` 선택자에서 클래스로
          꺼냈다(`style.css`의 「목판 팝업 화풍」절). `data-modal`은 그대로 **어느
          팝업인가**를 가리키고, 스모크가 그걸로 고른다. 폭 · 칸 고정은 `.set-modal`(이 팝업만) */}
      <div className="modal mod-plank set-modal" data-modal="settings" ref={steady} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-ttl fit" ref={titleRef}>{t('settings.title')}</h2>

        {/* 로그인 안 한 계정도 한 줄이다(2026-08-25 피드백) — 예전엔 「ID ⟨값⟩」줄과
            「로그인 됨/안 함」줄을 따로 뒀는데, 값이 없을 때 대괄호로 그 자리를
            대신하면 한 줄로 충분하다. */}
        <div className="opt-row" data-field="account">
          <span className="k" data-steady="account" data-steady-keys="settings.account">{t('settings.account')}</span>
          <span className="v dim fit" ref={idRef}>{idValue}</span>
        </div>

        {/* 지금 언어 이름은 「Language」와 같은 줄, 칩 열 개는 그 아래로
            (2026-08-25 피드백) — 예전엔 이름이 칩 아래(`.hint`)에 따로 떨어져
            있었다. */}
        <div className="opt-row" data-field="language">
          <span className="k" data-steady="language" data-steady-keys="settings.language">{t('settings.language')}</span>
          <span className="v dim fit" ref={langRef}>{langLabel}</span>
        </div>
        {/* 음성 더빙 — Language 바로 아래, 조금 들여 **보여 주기만** 한다(2026-10-23 기획자). 화면 문구는 열 언어인데
            더빙은 다섯 뿐이라 문화권이 가장 가까운 쪽(`i18n`의 `DUB_FOR`)이 따라온다. 따로 고르는 단추는 걷었다 —
            Language와 더빙을 각각 고르게 하니 조절할 때 더 헷갈렸다 */}
        <div className="opt-row opt-sub" data-field="dub">
          <span className="k" data-steady="voice" data-steady-keys="settings.voice">{t('settings.voice')}</span>
          <span className="v dim fit" ref={dubRef}>{dubLabel}</span>
        </div>

        {/* 언어 칩 열 개 — 가장 큰 칩 하나의 크기로 전부 맞춘다(2026-11-17 기획자) */}
        <div className="langs">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={`opt${lang === l.id ? ' on' : ''}`}
              data-lang={l.id}
              data-steady="langChip"
              onClick={() => setLang(l.id)}
            >{l.short}</button>
          ))}
        </div>

        {/* 소리 — 배경 음악 · 효과음(음성) 두 갈래, 과녁 다섯 칸(2026-10-23 기획자 — 옛 끔 · 켬을 갈았다) */}
        <VolumeRange channel="bgm" label={t('settings.bgm')} steadyKey="settings.bgm" />
        <VolumeRange channel="fx" label={t('settings.fx')} steadyKey="settings.fx" />

        {/* 화면 모드 — 화살표 목판 둘을 대칭으로(2026-11-17 기획자): 고른 쪽은 초록 판(`to_end`) + 빛나는 글자, 안 고른 쪽은
            갈색 판(`to_next`) + 빛 없는 글자(`style.css`의 `.set-side`). 프레임이 1:2 고정이라 가로는 고를 게 없다(pptx 20쪽) — 그래서 잠가 두되, 「눌리는데 아무 일도 없는
            스위치」가 되지 않게 세로만 실제로 선택된 상태로 보여 준다. 두 칸 폭은 열 언어의 가로 · 세로 중 가장 긴 글자로 */}
        <div className="opt-row" data-field="orientation">
          <span className="k" data-steady="orientation" data-steady-keys="settings.orientation">{t('settings.orientation')}</span>
          <div className="v set-sides" role="tablist">
            {(['landscape', 'portrait'] as const).map((o) => {
              const on = o === 'portrait';
              return (
                <button
                  key={o}
                  role="tab"
                  className={`set-side${on ? ' on' : ''}`}
                  data-orientation={o}
                  data-on={on ? '1' : '0'}
                  aria-selected={on}
                  disabled
                >
                  <span className="set-side-t" data-steady="orientChip" data-steady-keys="settings.landscape settings.portrait">
                    {t(o === 'portrait' ? 'settings.portrait' : 'settings.landscape')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* **`data-action`으로 건다** — 스모크가 `.btn.ghost`로 잡고 있다가 단추
            모양이 바뀌자 조용히 못 찾았다(「검사는 글자가 아니라 `data-*`로 건다」) */}
        <button className="btn primary wide" data-action="settingsClose" onClick={onClose}>{t('settings.close')}</button>
      </div>
    </div>
  );
}
