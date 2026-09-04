/**
 * 전투 화면 — React가 자리를 만들고 Phaser가 그 안에서 돈다.
 *
 * 전투 UI(HUD·대화창·제어 패널·팝업)는 DOM을 직접 다루고 id로 자리를 찾는다.
 * 그래서 여기서는 **그 자리들을 그려 주기만** 하고, 붙는 것은 `bootBattle`이 한다.
 * 전투 UI를 React로 다시 쓰지 않는 이유는 이미 잘 돌고 있고, 중요한 계약
 * (「버튼 활성 여부는 validate()에 묻는다」)은 프레임워크와 무관하기 때문이다.
 *
 * ────────────────────────────────────────────────────────────────
 * 상대는 **여기서 만들지 않는다** ★ (F · 45쪽)
 * ────────────────────────────────────────────────────────────────
 *
 * 매칭(`MatchScreen`)이 정한 상대를 그대로 받는다. 예전에는 이 화면이 등급 점수로
 * AI를 뽑았는데, 그러면 **화면이 「찾았습니다!」에서 보여 준 상대와 실제로 싸우는
 * 상대가 다를 수 있다** — 같은 시드로 같은 것을 두 번 만드는 데 기대는 구조였다.
 * 상대를 값으로 들고 오면 그 어긋남이 원천적으로 없다.
 *
 * 온라인이 붙으면 상대는 서버가 준다 — **이 화면은 그때도 안 바뀐다.**
 *
 * ────────────────────────────────────────────────────────────────
 * 배치 프리셋은 **전투가 시작되기 전에** 깐다 (E · 42쪽 · §5-14)
 * ────────────────────────────────────────────────────────────────
 *
 * `createBattle()`이 5×5 중앙에 세운 뒤, 저장된 배치가 있으면 `deploy` 의도를 한 번
 * 적용하고 그 상태로 재생을 시작한다. 그 뒤는 평소대로 **30초 동안 사람이 고친다** —
 * 프리셋은 「초기값」이지 「확정」이 아니다.
 *
 * **어긋난 프리셋은 아무 말 없이 안 깐다.** `squadDeployment()`가 `null`을 주면
 * 그냥 기본 배치다(구성을 고쳤거나 남군 좌표를 북군에 쓴 경우). 여기서 막으면
 * 「부대를 고쳤더니 전투에 못 들어간다」가 된다.
 *
 * ────────────────────────────────────────────────────────────────
 * 판정 주체도 **여기서 정해 넘긴다** (`BattleTransport`)
 * ────────────────────────────────────────────────────────────────
 *
 * AI 대전은 `LocalTransport` — 같은 프로세스의 룰 엔진이 판정한다. 온라인이면
 * 이 한 줄에 **방에 붙는 것**이 들어오고, `bootBattle` 아래의 씬·재생기·UI는
 * 한 글자도 안 바뀐다. 상대를 값으로 받는 계약(위)의 짝이다 —
 * **누구와 싸우는가도, 누가 판정하는가도 이 화면이 만들지 않는다.**
 */

import { useEffect, useRef } from 'react';
import { apply, createBattle, validate } from '@samchess/rules';
import type { BattleMode, Side } from '@samchess/rules';
import {
  applyBattleResult, battlePower, refundGrain, squadDeployment, toRosterEntries,
} from '@samchess/meta';
import type {
  BattleOutcome, BattleResult, BattleRewards, MatchOpponent, PlayerProfile, RosterPick, Squad,
} from '@samchess/meta';
import { bootBattle, countFallen, countKills } from '../battle/boot.ts';
import { LocalTransport } from '../battle/transport.ts';
import type { BattleTransport } from '../battle/transport.ts';
import { settleAiBattle } from '../meta/aiBattle.ts';
import { loadProfile } from '../meta/storage.ts';
import { BattleStage } from './BattleStage.tsx';

/** 온라인 정산(H3d)을 기다리는 한도 — 서버가 항상 이보다 훨씬 빨리 답한다.
 * 안 오면 「서버가 못 닿았다」로 보고 로컬 반영으로 물러난다 */
const SETTLE_TIMEOUT_MS = 3000;

export interface BattleDone {
  profile: PlayerProfile;
  screen: {
    mode: BattleMode;
    result: BattleResult;
    outcome: string;
    /** 이미 반영된 보상. **무승부는 고르기 전이라 `null`이다** */
    rewards: BattleRewards | null;
    /** 아직 반영하지 않은 결과 — 무승부의 택1을 기다린다 */
    pending: BattleOutcome | null;
    /** 양쪽 전투력. 결과 화면이 「예상 승률 12%를 뒤집었다」를 보여 준다 (§5-23) */
    power: { mine: number; theirs: number };
    seed: number;
    /**
     * **성립하지 않은 판**이다 — 배치 중 이탈 · 양쪽 이탈 · 양쪽 유휴 (GDD §3.9).
     * 전적도 보상도 없고 **환불만** 있다. `null`이면 평범한 결말이다.
     */
    voided: { reason: 'left' | 'idle'; refunded: boolean } | null;
  };
}

const OUTCOME_LABEL: Record<string, string> = {
  kingDown: '군주 격파', wipeOut: '전멸', surrender: '항복', timeLimit: '판정승', draw: '무승부',
};

export function BattleScreen({ profile, mode, picks, seed, squad, opponent, online, onDone }: {
  profile: PlayerProfile;
  mode: BattleMode;
  picks: RosterPick[];
  seed: number;
  /** 출전한 부대. 배치 프리셋과 이력의 부대 이름이 여기서 온다 (E) */
  squad: Squad | null;
  /** 매칭이 정한 상대. **사람이든 AI든 같은 모양이다** (F) */
  opponent: MatchOpponent;
  /**
   * 온라인이면 **이미 방에 붙은 판정 주체**가 들어온다 (H2).
   *
   * `initial`이 동기로 있어야 재생기가 첫 프레임을 그리므로, 방에 붙는 일은 이
   * 화면보다 **먼저** 끝나 있어야 한다 — 그래서 만들어진 것을 받는다.
   * `null`이면 AI 대전이고 `LocalTransport`를 여기서 만든다.
   */
  online?: BattleTransport | null;
  onDone: (result: BattleDone) => void;
}): React.JSX.Element {
  // 최신 콜백을 담아 둔다 — Phaser는 한 번만 띄우고 다시 만들지 않는다
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // **부상을 안고 싸운다** — 시각을 여기서 넣는다(GDD §5.7). 전투력(`power`)은
    // 이 값을 안 보므로 부상으로 매칭을 흔들 수 없다.
    const startedAt = Date.now();
    const myEntries = toRosterEntries(profile, picks, startedAt);
    const foeEntries = opponent.entries;

    /*
     * **내가 어느 진영인가를 정하는 자리는 하나다.** 편성·배치 프리셋·재생기가
     * 전부 이 값을 본다 — 예전에는 세 군데에 `'P1'`이 각각 적혀 있었다.
     *
     * 오프라인은 언제나 남군이다. **온라인에서는 서버가 정해 주고**, 그 값이
     * 이미 판정 주체에 실려 들어온다(`transport.humanSide`) — 북군이 걸리면
     * `squad.deploy.P2`가 그때 처음 쓰인다(서버가 깐다).
     */
    // AI 대전이면 로컬 판정 주체를 그대로 들고 있는다 — 판이 끝난 뒤 사람이 낸
    // 의도 로그를 서버 재생 검증에 실어 보내야 한다(§5-96, `getIntentLog()`)
    let localTransport: LocalTransport | null = null;
    const transport: BattleTransport = online ?? makeLocal();
    const humanSide: Side = transport.humanSide ?? 'P1';

    function makeLocal(): BattleTransport {
      // `deploy` 단계로 시작한다 — 배치 → (상대 준비) → 정찰 → 전투 (GDD §3.9).
      // 상대(AI)는 곧바로 준비를 마치므로 「매칭 대기」는 눈에 보이지 않는다.
      let initial = createBattle({
        matchId: `${opponent.kind}-${seed}`,
        seed,
        mode,
        rosters: { P1: myEntries, P2: foeEntries },
      });
      /*
       * 저장된 배치를 초기값으로 깐다 (E · §5-14). **판정은 규칙이 한다** —
       * `squadDeployment()`가 구역·중복·구성을 보고 어긋나면 `null`을 준다.
       * 엔진에도 한 번 더 물어 본다(`validate`) — 화면이 통과시킨 것을 엔진이 거부하면
       * `apply`가 던져 전투 화면이 통째로 죽는다. 여기는 **없어도 되는 편의**라
       * 무슨 일이 있어도 전투를 막지 않아야 한다.
       *
       * **온라인에서는 이 일을 서버가 한다** — 프리셋을 `enlist`에 실어 보내고
       * `openRoom()`이 같은 판정으로 깐다. 두 군데서 깔면 한쪽이 언젠가 안 깐다.
       */
      const preset = squad ? squadDeployment(profile, squad, 'P1') : null;
      if (preset && validate(initial, 'P1', { t: 'deploy', placements: preset }).ok) {
        initial = apply(initial, 'P1', { t: 'deploy', placements: preset }).state;
      }
      // **AI 대전의 판정 주체는 같은 프로세스의 룰 엔진이다** — 서버가 꺼져 있어도 돈다
      const t = new LocalTransport(initial, 'P1');
      localTransport = t;
      return t;
    }

    // 양쪽 전투력은 **전투가 시작될 때의 값**이다 (D · GDD §7.1). 전적에 그대로 남겨
    // 두면 눈금(`POWER_SCALE`)이 나중에 바뀌어도 그때의 판단이 보존된다(§5-23).
    const power = { mine: battlePower(mode, myEntries), theirs: battlePower(mode, foeEntries) };

    const handle = bootBattle({
      transport,
      onFinish: async (state, close) => {
        /*
         * **성립하지 않은 판은 여기서 갈린다** (GDD §3.9 이탈 표).
         *
         * 배치 중에 상대가 사라졌거나 · 양쪽이 사라졌거나 · 양쪽이 손을 놓아 방이
         * 접혔다. 전적도 보상도 **안 남긴다** — `applyBattleResult`를 아예 안 부르는
         * 유일한 갈래다. 돌려받는지는 **서버가 말한다**(`refund`) — 사라진 쪽은
         * 안 돌려받아야 「끊는 것이 거절보다 싸지면 안 된다」가 선다(§5-65).
         */
        if (close) {
          const refunded = close.refund.includes(humanSide);
          done.current({
            profile: refunded ? refundGrain(profile, mode) : profile,
            screen: {
              mode, result: 'draw', outcome: '', rewards: null, pending: null, power, seed,
              voided: { reason: close.reason, refunded },
            },
          });
          return;
        }

        // 엔진은 진짜 무승부를 낸다 — `winner: null` (실측 0.02%). 메타 층이 그걸
        // `boolean`으로 뭉개고 있었고, v3에서 세 결말로 폈다
        const result: BattleResult =
          state.winner === humanSide ? 'win' : state.winner === null ? 'draw' : 'lose';
        const outcome: BattleOutcome = {
          result, mode, opponent: opponent.kind, picks, kills: countKills(state, humanSide), power,
          // HP 0으로 퇴각한 내 장수 — 승패와 무관하게 부상이 된다 (GDD §5.7)
          fallen: countFallen(state, humanSide),
          // 시각은 **화면이 넣는다** — meta는 시계를 읽지 않는다 (C2의 군량 충전과 같은 규약)
          at: Date.now(),
          // 이력의 빈 칸 둘이 여기서 채워진다 (§4-7② — F). **AI면 둘 다 `null`이다** —
          // AI에게는 계정도 부대도 없고, 화면이 그때 「AI」라고 적는다
          opponentId: opponent.id, mySquad: squad?.name ?? null, theirSquad: opponent.squadName,
        };
        const label = state.winner === null
          ? OUTCOME_LABEL['draw']! : OUTCOME_LABEL[state.outcome ?? ''] ?? '';

        // **무승부는 여기서 반영하지 않는다.** 셋 중 하나를 고르기 전까지 계정은
        // 그대로다 — 「고르는 도중」이라는 상태를 저장하지 않기 위함이다 (GDD §6.4)
        if (result === 'draw') {
          done.current({
            profile,
            screen: {
              mode, result, outcome: label, rewards: null, pending: outcome, power, seed,
              voided: null,
            },
          });
          return;
        }
        /*
         * **온라인 대전은 `BattleRoom` 자신이 이미 판정을 끝낸 값을 받는다** (H3d) —
         * 재생 검증(AI 경로)조차 필요 없다, Colyseus가 곧 판정 주체였으므로. 로컬
         * `applyBattleResult` + `PUT`으로 계정을 직접 바꾸는 대신, 서버가 `'settled'`로
         * 통보한 보상을 받고 프로필은 `loadProfile()`로 **다시 읽는다** — 클라이언트가
         * 계산한 값을 정본으로 삼지 않는다는 뜻이다.
         *
         * **못 받으면(타임아웃·서버 다운) 지금 방식으로 물러난다** — AI 경로와 같은 결.
         */
        if (opponent.kind === 'online') {
          const rewards = (await transport.waitForSettled?.(SETTLE_TIMEOUT_MS)) ?? null;
          const fresh = rewards ? await loadProfile() : null;
          if (rewards && fresh) {
            done.current({
              profile: fresh,
              screen: { mode, result, outcome: label, rewards, pending: null, power, seed, voided: null },
            });
            return;
          }
        }

        /*
         * **AI 대전은 서버가 재생해서 검증한다** (§5-96) — 사람이 낸 의도만 보내면
         * 서버가 계정에서 다시 뽑은 로스터·같은 시드로 다시 만든 AI 상대로 처음부터
         * 다시 재생해 같은 결말이 나오는지 본다. 화면·속도는 그대로다(재생은 판이
         * 끝난 **뒤**에만 일어난다) — `applyBattleResult`를 여기서 직접 부르지 않는다.
         *
         * **실패하면(네트워크·서버 다운) 지금 방식으로 물러난다** — "서버가 꺼져
         * 있어도 게임은 돈다"(§5-61)가 AI 대전 결과 반영에도 선다. 그 순간에만
         * 치팅 표면이 예전 수준으로 돌아간다(정상 운영에서는 안 일어나는 경로).
         */
        if (opponent.kind === 'ai') {
          const settled = await settleAiBattle({
            mode, seed, targetPower: power.mine,
            exclude: myEntries.map((e) => e.officer),
            picks, squadId: squad?.id ?? null,
            humanIntents: localTransport?.getIntentLog() ?? [],
            // **판이 시작된 시각**을 함께 보낸다 — 부상은 시간이 지나면 낫는데
            // 서버는 판이 끝난 뒤에 재생하므로, 지금 시각으로 다시 재면 이미
            // 나은 것으로 보여 재생이 어긋난다(§12). 서버가 범위를 눌러 담는다.
            startedAt,
          });
          if (settled) {
            done.current({
              profile: settled.profile,
              screen: {
                mode, result, outcome: label, rewards: settled.rewards, pending: null, power, seed,
                voided: null,
              },
            });
            return;
          }
        }

        const applied = applyBattleResult(profile, outcome, seed);
        done.current({
          profile: applied.profile,
          screen: {
            mode, result, outcome: label, rewards: applied.rewards, pending: null, power, seed,
            voided: null,
          },
        });
      },
    });
    return () => handle.destroy();
    // 전투는 한 번 시작하면 끝까지 간다. 프로필이 바뀌어도 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BattleStage />;
}
