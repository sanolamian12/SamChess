/**
 * 군량 값 — **글자 「군량」 대신 그림** + 숫자 (2026-09-18 지정).
 *
 * 출정하기의 구성 칩과 매칭의 [전투준비]·[다시 찾기]가 함께 쓴다. 그림은 장터·병영
 * 현황이 쓰는 그 아이콘(`market/grain.png`)이고, **숫자는 부르는 쪽이 규칙에서 받아
 * 온다**(`grainCost()`·`MATCH_DECLINE_GRAIN`) — 화면이 3·5·1을 박으면 값이 바뀌는 날
 * 표시만 조용히 어긋난다.
 *
 * 클래스가 `.srt-`인 것은 출정하기 화면에서 먼저 태어났기 때문이다 — 규칙은 화면으로
 * 좁히지 않은 전역이라 어느 화면에서든 같은 모양이다(글자색만 화면이 정한다).
 */
import { t } from '../i18n/index.ts';

/**
 * `have`를 주면 **`값/보유`**로 적는다(2026-09-18 지정 — 출정하기의 구성 칩이
 * 「3/20」). 참가비와 가진 군량을 한 칸에 나란히 두면 「이걸 몇 번 더 낼 수 있나」가
 * 계산 없이 읽힌다. 매칭의 단추처럼 **이미 낼 것만 말하는 자리**는 `have`를 안 준다.
 */
export function GrainCost({ n, have }: { n: number; have?: number }): React.JSX.Element {
  return (
    <span className="srt-cost" data-field="cost" data-cost={n} data-have={have ?? ''}>
      <img className="srt-grain" src="market/grain.png" alt={t('main.grain')} title={t('main.grain')} />
      <b>{n}</b>
      {have !== undefined && <span className="srt-have">/{have}</span>}
    </span>
  );
}
