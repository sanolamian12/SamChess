/**
 * 게임 아이콘 — 이름 → 그림 경로 (2026-10-26, `Design/아이콘_제작목록_이미지프롬프트.md`).
 *
 * 그림은 `assets/icons/ui/{장}/ic_*.png`를 `tools/build_ui.py`가 `public/icons/{장}/`에 128²로 굽는다. 이름은 의뢰서의 id에서
 * `ic_`를 떼고 밑줄을 하이픈으로 바꾼 것이다(`ic_stat_hp` → `stat-hp`). 「재사용」 줄은 이미 있던 그림을 그대로 가리킨다.
 * 이름이 리터럴 타입이라 **없는 이름을 적으면 `typecheck`가 깨진다.**
 *
 * 놓는 규칙(기획자 확정 2026-10-26): **좁은 자리**(표 머리 · 칩 · 수치 라벨)는 아이콘이 글자를 **대신**하고 글자는 `title`로,
 * **단추 · 상태 줄**처럼 문장이 있는 자리는 아이콘 + 글자. 그림이 안 오면(에셋이 없는 빌드) 글자로 물러난다.
 * React 화면은 `screens/GameIcon.tsx`, 전투 화면(DOM)은 아래 `gameIconEl()`을 쓴다. 크기는 `style.css`의 「게임 아이콘」 절.
 */

export const GAME_ICONS = {
  'battle-point': 'icons/stat/battle-point.png',
  'stat-at': 'icons/stat/stat-at.png',
  'stat-chance': 'icons/stat/stat-chance.png',
  'stat-charges': 'icons/stat/stat-charges.png',
  'stat-crit': 'icons/stat/stat-crit.png',
  'stat-hp': 'icons/stat/stat-hp.png',
  'stat-instakill': 'icons/stat/stat-instakill.png',
  'stat-level': 'icons/stat/stat-level.png',
  'stat-mp': 'icons/stat/stat-mp.png',
  'rec-draw': 'icons/record/rec-draw.png',
  'rec-fallen': 'icons/record/rec-fallen.png',
  'rec-lose': 'icons/record/rec-lose.png',
  'rec-points': 'icons/record/rec-points.png',
  'rec-win': 'icons/record/rec-win.png',
  'goal-convert': 'icons/outcome/goal-convert.png',
  'goal-hpbelow': 'icons/outcome/goal-hpbelow.png',
  'goal-killcount': 'icons/outcome/goal-killcount.png',
  'goal-killtarget': 'icons/outcome/goal-killtarget.png',
  'goal-protect': 'icons/outcome/goal-protect.png',
  'goal-reach': 'icons/outcome/goal-reach.png',
  'goal-survive': 'icons/outcome/goal-survive.png',
  'goal-timeup': 'icons/outcome/goal-timeup.png',
  'goal-unitlost': 'icons/outcome/goal-unitlost.png',
  'out-king': 'icons/outcome/out-king.png',
  'out-objective': 'icons/outcome/out-objective.png',
  'out-supply': 'icons/outcome/out-supply.png',
  'out-surrender': 'icons/outcome/out-surrender.png',
  'out-timelimit': 'icons/outcome/out-timelimit.png',
  'out-wipe': 'icons/outcome/out-wipe.png',
  'emperor': 'icons/officer/emperor.png',
  'grade-score': 'icons/officer/grade-score.png',
  'mode-3v3': 'icons/officer/mode-3v3.png',
  'mode-5v5': 'icons/officer/mode-5v5.png',
  'opp-ai': 'icons/officer/opp-ai.png',
  'opp-online': 'icons/officer/opp-online.png',
  'st-healthy': 'icons/officer/st-healthy.png',
  'st-injured': 'icons/officer/st-injured.png',
  'st-recover': 'icons/officer/st-recover.png',
  'bld-academy': 'icons/city/bld-academy.png',
  'bld-barracks': 'icons/city/bld-barracks.png',
  'bld-farm': 'icons/city/bld-farm.png',
  'bld-forge': 'icons/city/bld-forge.png',
  'bld-hospital': 'icons/city/bld-hospital.png',
  'bld-market': 'icons/city/bld-market.png',
  'bld-max': 'icons/city/bld-max.png',
  'bld-palace': 'icons/city/bld-palace.png',
  'bld-soon': 'icons/city/bld-soon.png',
  'build-credit': 'icons/city/build-credit.png',
  'city-upgrade': 'icons/city/city-upgrade.png',
  'grain-full': 'icons/city/grain-full.png',
  'bandit': 'icons/facility/bandit.png',
  'equip-give': 'icons/facility/equip-give.png',
  'equip-none': 'icons/facility/equip-none.png',
  'equip-revoke': 'icons/facility/equip-revoke.png',
  'forge-assign': 'icons/facility/forge-assign.png',
  'forge-craft': 'icons/facility/forge-craft.png',
  'grain-rate': 'icons/facility/grain-rate.png',
  'guard': 'icons/facility/guard.png',
  'hosp-admit': 'icons/facility/hosp-admit.png',
  'hosp-cooldown': 'icons/facility/hosp-cooldown.png',
  'hosp-ward': 'icons/facility/hosp-ward.png',
  'raid-cleared': 'icons/facility/raid-cleared.png',
  'raid-looted': 'icons/facility/raid-looted.png',
  'raid-none': 'icons/facility/raid-none.png',
  'mail-empty': 'icons/shop/mail-empty.png',
  'mail-gift': 'icons/shop/mail-gift.png',
  'mk-checkout': 'icons/shop/mk-checkout.png',
  'mk-soldout': 'icons/shop/mk-soldout.png',
  'mk-stock': 'icons/shop/mk-stock.png',
  'mk-storage': 'icons/shop/mk-storage.png',
  'seal-forge': 'icons/seal/seal-forge.png',
  'seal-graincap': 'icons/seal/seal-graincap.png',
  'seal-grainrate': 'icons/seal/seal-grainrate.png',
  'seal-heal': 'icons/seal/seal-heal.png',
  'seal-raidloot': 'icons/seal/seal-raidloot.png',
  'seal-raidresp': 'icons/seal/seal-raidresp.png',
  'seal-research': 'icons/seal/seal-research.png',
  'cam-focus': 'icons/control/cam-focus.png',
  'cmd-ready': 'icons/control/cmd-ready.png',
  'cmd-reset': 'icons/control/cmd-reset.png',
  'cmd-unique': 'icons/control/cmd-unique.png',
  'set-account': 'icons/control/set-account.png',
  'set-bgm': 'icons/control/set-bgm.png',
  'set-fx': 'icons/control/set-fx.png',
  'set-language': 'icons/control/set-language.png',
  'set-voice': 'icons/control/set-voice.png',
  'skill-preview': 'icons/control/skill-preview.png',
  'mk-claim': 'icons/mark/mk-claim.png',
  'mk-done': 'icons/mark/mk-done.png',
  'mk-edit': 'icons/mark/mk-edit.png',
  'mk-filter': 'icons/mark/mk-filter.png',
  'mk-infinite': 'icons/mark/mk-infinite.png',
  'mk-lock': 'icons/mark/mk-lock.png',
  'mk-logout': 'icons/mark/mk-logout.png',
  'mk-minus': 'icons/mark/mk-minus.png',
  'mk-new': 'icons/mark/mk-new.png',
  'mk-noskill': 'icons/mark/mk-noskill.png',
  'mk-plus': 'icons/mark/mk-plus.png',
  'mk-replay': 'icons/mark/mk-replay.png',
  'mk-rotate': 'icons/mark/mk-rotate.png',
  'mk-sort': 'icons/mark/mk-sort.png',
  'mk-swap': 'icons/mark/mk-swap.png',
  'mk-swapbtn': 'icons/mark/mk-swapbtn.png',
  'mk-tap': 'icons/mark/mk-tap.png',
  'mk-trash': 'icons/mark/mk-trash.png',
  'mk-view': 'icons/mark/mk-view.png',
  'mk-warn': 'icons/mark/mk-warn.png',
  // 재사용 — 있는 그림을 그대로 (의뢰서 「재사용」)
  'stat-damage': 'ui/cmd/attack.png',
  'stat-barrier': 'blacksmith/shield.png',
  'stat-wt': 'ui/cmd/endTurn.png',
  'rec-kills': 'ui/cmd/attack.png',
  'rec-sorties': 'icons/battle.png',
  'rec-rank': 'icons/medal-gold.png',
  'st-healing': 'market-items/tang-yak.png',
  'raid-alert': 'icons/raid-prepare.png',
  'mk-topup': 'market/pack-large.png',
  'mk-shop': 'icons/city/bld-market.png',
  'item-active': 'market-items/pok-yak.png',
  'item-passive': 'market-items/tae-pyeong-yo-sul.png',
  'cmd-taketurn': 'ui/gi/turnover.png',
  'cmd-intel': 'market-items/cheok-hu-gi.png',
  'mk-inprogress': 'ui/cmd/endTurn.png',
  // 자원 — 장터가 굽는 그림 그대로 (금화 · 군량 · 자재 · 장수 카드)
  'res-gold': 'market/gold.png',
  'res-grain': 'market/grain.png',
  'res-materials': 'market/materials.png',
  'res-card': 'market/market_card.png',
  'res-recycle': 'market/recycle.png',
  // 기존 탭 아이콘 — 도시 · 장수 (랭킹 메뉴의 그림)
  'tab-city': 'icons/tab-city.png',
  'tab-officer': 'icons/tab-officer.png',
} as const;

export type GameIconName = keyof typeof GAME_ICONS;

export const gameIconUrl = (name: GameIconName): string => GAME_ICONS[name];

/**
 * 전투 화면(DOM)용 — `<span class="gic" data-ic>` 안에 그림. `text`면 글자를 뒤에 붙이고, 아니면 글자는 `title` · `aria-label`.
 * 그림이 실패하면 글자로 바꾼다(`GameIcon`과 같은 물러나기).
 */
export function gameIconEl(name: GameIconName, label: string, text = false): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'gic';
  el.dataset['ic'] = name;
  const img = document.createElement('img');
  img.src = gameIconUrl(name);
  img.alt = text ? '' : label;
  img.draggable = false;
  img.onerror = () => { img.remove(); if (!text) el.append(label); };
  el.append(img);
  if (text) {
    const s = document.createElement('span');
    s.className = 'gic-t';
    s.textContent = label;
    el.append(s);
  } else {
    el.title = label;
  }
  return el;
}
