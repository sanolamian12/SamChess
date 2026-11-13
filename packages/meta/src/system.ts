/**
 * 시스템 상태 · 트래픽 (2026-11-13, 관리자 「시스템」 메뉴) — **서버 프로세스가 스스로 센 숫자**의 모양과, 그것을 1분 칸에 쌓는 규칙.
 *
 * 게임 API(`server-api/src/health.ts`)와 대전 서버(`server/src/health.ts`)가 각자 센다 — 두 프로세스는 서로 import하지 않으므로
 * 모양과 집계 규칙을 여기 둔다(`LiveRoomSummary`와 같은 까닭). 관리자 API는 두 프로세스의 `GET /internal/health`를 물어 합친다.
 *
 * **메모리에만 쌓는다** — 최근 `TRAFFIC_MINUTES`분, 프로세스를 다시 켜면 빈다(2026-11-13 기획자 확정: 추이는 운영이 가까워지면 DB에).
 * 다시 켜진 사실은 `ProcessHealth.startedAt`이 말한다 — 빈 그래프를 「조용했다」로 읽지 않게 화면이 그 시각을 함께 띄운다.
 *
 * 순수하다 — 시각은 인자로 받는다(meta에 시계를 들이지 않는다). 쌓는 함수는 상태를 **고쳐 쓴다**(요청마다 새 배열을 만들지 않게).
 */

/** 몇 분을 들고 있나 — 관리자 「트래픽」 탭의 가로축 */
export const TRAFFIC_MINUTES = 60;
const MINUTE_MS = 60_000;

/**
 * 응답 시간 칸의 위 끝(ms) — p95를 이 칸으로 어림한다(정확한 값을 다 들고 있지 않으려고). 마지막 칸은 그보다 긴 것 전부.
 * 칸 하나가 「이 값 이하」라서 p95는 **그 칸의 위 끝**으로 낸다 — 실제보다 조금 크게 보이는 쪽으로 틀린다.
 */
export const LATENCY_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

/** 대전 서버가 세는 사건 — 대기열 · 방 · 자리 */
export const BATTLE_EVENTS = ['queue.join', 'queue.leave', 'room.open', 'seat.drop', 'seat.back', 'seat.lost', 'seat.leave'] as const;
export type BattleEvent = typeof BATTLE_EVENTS[number];

/** 1분 칸 하나 — 쌓는 중의 모양 */
interface Bucket {
  /** 이 분의 시작(epoch ms, 분 단위로 내림) */
  at: number;
  requests: number;
  client: number;
  server: number;
  /** `LATENCY_BOUNDS` 칸마다 + 마지막 「그보다 긺」 */
  latency: number[];
  routes: Map<string, RouteAcc>;
  events: Map<string, number>;
}

interface RouteAcc { requests: number; client: number; server: number; totalMs: number; maxMs: number; latency: number[] }

/** 한 프로세스의 쌓는 통 — `createTraffic()`으로 만들고 `recordRequest` · `recordEvent`로 채운다 */
export interface TrafficState { buckets: Bucket[] }

export const createTraffic = (): TrafficState => ({ buckets: [] });

const emptyLatency = (): number[] => new Array<number>(LATENCY_BOUNDS.length + 1).fill(0);

function latencySlot(ms: number): number {
  const i = LATENCY_BOUNDS.findIndex((b) => ms <= b);
  return i === -1 ? LATENCY_BOUNDS.length : i;
}

/**
 * 지금 분의 칸 — 없으면 만든다. **시계가 뒤로 가면**(서버 시계 보정) 그 분의 칸을 새로 만들지 않고 마지막 칸에 더한다 —
 * 칸이 시각 순서를 잃으면 그래프가 거꾸로 흐른다.
 */
function bucketAt(s: TrafficState, nowMs: number): Bucket {
  const at = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const last = s.buckets[s.buckets.length - 1];
  if (last && last.at >= at) return last;
  const b: Bucket = { at, requests: 0, client: 0, server: 0, latency: emptyLatency(), routes: new Map(), events: new Map() };
  s.buckets.push(b);
  prune(s, nowMs);
  return b;
}

function prune(s: TrafficState, nowMs: number): void {
  const oldest = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - (TRAFFIC_MINUTES - 1) * MINUTE_MS;
  while (s.buckets.length && s.buckets[0]!.at < oldest) s.buckets.shift();
}

/**
 * 요청 하나 — `route`는 경로 **틀**(`GET /mail/:id/claim`)이어야 한다. 실제 URL을 넣으면 id마다 줄이 생겨 메모리가 끝없이 는다 —
 * 틀이 없는 요청(없는 경로)은 부르는 쪽이 한 이름(`NO_ROUTE`)으로 모은다.
 */
export function recordRequest(s: TrafficState, nowMs: number, route: string, status: number, ms: number): void {
  const b = bucketAt(s, nowMs);
  const slot = latencySlot(ms);
  const client = status >= 400 && status < 500 ? 1 : 0;
  const server = status >= 500 ? 1 : 0;
  b.requests += 1; b.client += client; b.server += server; b.latency[slot]! += 1;
  let r = b.routes.get(route);
  if (!r) { r = { requests: 0, client: 0, server: 0, totalMs: 0, maxMs: 0, latency: emptyLatency() }; b.routes.set(route, r); }
  r.requests += 1; r.client += client; r.server += server; r.totalMs += ms; r.maxMs = Math.max(r.maxMs, ms); r.latency[slot]! += 1;
}

/** 경로 틀이 없는 요청(없는 경로 · 잘못된 URL)을 모으는 이름 */
export const NO_ROUTE = '(없는 경로)';

/** 사건 하나 — 대전 서버의 입장 · 퇴장 · 끊김 … */
export function recordEvent(s: TrafficState, nowMs: number, name: string): void {
  const b = bucketAt(s, nowMs);
  b.events.set(name, (b.events.get(name) ?? 0) + 1);
}

/** 칸 셈에서 p95 — 칸이 비면 `null` */
export function p95Of(latency: readonly number[]): number | null {
  const total = latency.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const need = Math.ceil(total * 0.95);
  let seen = 0;
  for (let i = 0; i < latency.length; i += 1) {
    seen += latency[i]!;
    // 마지막 칸(「그보다 긺」)은 위 끝이 없다 — 가장 긴 경계를 넘었다는 뜻으로 그 경계를 낸다(화면이 「>」를 붙인다)
    if (seen >= need) return LATENCY_BOUNDS[Math.min(i, LATENCY_BOUNDS.length - 1)]!;
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1]!;
}

/** p95가 가장 긴 경계를 넘었나 — 화면의 「> 5000ms」 */
export const p95Overflow = (latency: readonly number[]): boolean => {
  const total = latency.reduce((a, b) => a + b, 0);
  return total > 0 && latency[latency.length - 1]! > total * 0.05;
};

// ── 내보내는 모양 ─────────────────────────────────────────────

/** 1분 한 칸 — 관리자에게 내보내는 모양 */
export interface TrafficMinute {
  /** 그 분의 시작(epoch ms) */
  at: number;
  requests: number;
  /** 4xx — 대개 클라이언트 잘못(만료된 토큰 · 없는 계정) */
  client: number;
  /** 5xx — 서버 잘못 */
  server: number;
  /** ms, 그 분에 요청이 없으면 `null` */
  p95: number | null;
  /** 대전 서버의 사건 수 — 게임 API는 빈 칸 */
  events: Partial<Record<string, number>>;
}

/** 경로 하나의 창 전체 합 */
export interface TrafficRoute {
  route: string;
  requests: number;
  client: number;
  server: number;
  avgMs: number;
  maxMs: number;
  p95: number | null;
  /** p95가 가장 긴 경계(5000ms)를 넘었다 */
  p95Over: boolean;
}

/** 최근 `TRAFFIC_MINUTES`분 — 칸은 오래된 것부터 **빠짐없이**(요청이 없던 분도 0으로) */
export interface TrafficWindow {
  minutes: TrafficMinute[];
  /** 요청 수가 많은 순 */
  routes: TrafficRoute[];
}

/** 지금 시각까지의 창 — 빈 분도 채워 낸다(그래프의 가로축이 시각과 맞게) */
export function trafficWindow(s: TrafficState, nowMs: number): TrafficWindow {
  prune(s, nowMs);
  const end = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const byAt = new Map(s.buckets.map((b) => [b.at, b]));
  const minutes: TrafficMinute[] = [];
  for (let i = TRAFFIC_MINUTES - 1; i >= 0; i -= 1) {
    const at = end - i * MINUTE_MS;
    const b = byAt.get(at);
    minutes.push(b
      ? { at, requests: b.requests, client: b.client, server: b.server, p95: p95Of(b.latency), events: Object.fromEntries(b.events) }
      : { at, requests: 0, client: 0, server: 0, p95: null, events: {} });
  }
  const acc = new Map<string, RouteAcc>();
  for (const b of s.buckets) {
    for (const [route, r] of b.routes) {
      const a = acc.get(route) ?? { requests: 0, client: 0, server: 0, totalMs: 0, maxMs: 0, latency: emptyLatency() };
      a.requests += r.requests; a.client += r.client; a.server += r.server; a.totalMs += r.totalMs; a.maxMs = Math.max(a.maxMs, r.maxMs);
      r.latency.forEach((n, i) => { a.latency[i]! += n; });
      acc.set(route, a);
    }
  }
  const routes = [...acc].map(([route, a]): TrafficRoute => ({
    route, requests: a.requests, client: a.client, server: a.server,
    avgMs: Math.round(a.totalMs / a.requests), maxMs: Math.round(a.maxMs), p95: p95Of(a.latency), p95Over: p95Overflow(a.latency),
  })).sort((x, y) => y.requests - x.requests || x.route.localeCompare(y.route));
  return { minutes, routes };
}

/** 창의 마지막 `n`분 합 — 상태 탭 · 대시보드 카드의 한 줄 */
export interface TrafficRecent { minutes: number; requests: number; client: number; server: number; p95: number | null }

export function trafficRecent(w: TrafficWindow, n: number): TrafficRecent {
  const tail = w.minutes.slice(-n);
  const sum = (k: 'requests' | 'client' | 'server') => tail.reduce((a, m) => a + m[k], 0);
  // 분마다의 p95를 다시 p95로 접을 수 없다 — 가장 나쁜 분을 낸다(「최근 5분에 이만큼 느린 때가 있었다」)
  const p = tail.map((m) => m.p95).filter((v): v is number => v !== null);
  return { minutes: n, requests: sum('requests'), client: sum('client'), server: sum('server'), p95: p.length ? Math.max(...p) : null };
}

// ── 프로세스 상태 ─────────────────────────────────────────────

export type ServiceId = 'game-api' | 'battle' | 'admin-api';

/**
 * 프로세스 하나가 `GET /internal/health`로 내는 것. 메모리 · 이벤트 루프는 Node가 재고, 나머지는 프로세스마다 덧붙인다.
 * 시각은 전부 epoch ms(그 프로세스의 시계).
 */
export interface ProcessHealth {
  service: ServiceId;
  /** `호스트:pid` — 여러 대가 뜨면 줄이 갈린다(지금은 한 대 가정) */
  instance: string;
  startedAt: number;
  at: number;
  /** `SAMCHESS_ENV` — development · production */
  env: string;
  node: string;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  /**
   * 이벤트 루프 — **지난 1분**(첫 1분은 켜진 뒤부터). `utilization`은 바빴던 비율(0~1), `p99` · `max`는 지연(ms).
   * 지연이 수십 ms를 넘으면 그 프로세스가 무거운 일에 막혀 요청이 줄 서 기다린다는 뜻이다.
   *
   * ★ 지연은 **측정 바닥을 뺀 값**이다(히스토그램의 `min`을 뺀다). Windows는 타이머 눈금이 약 15.6ms라 Node의
   * `monitorEventLoopDelay`가 쉬는 프로세스에서도 15 · 31ms를 낸다 — 그대로 실으면 늘 「막혔다」로 보인다(2026-11-13 실측:
   * 쉴 때 p50 31ms, 실제 지연 0.1ms). 바닥을 빼면 쉴 때 약 2ms, 200ms 막힘은 215ms로 그대로 잡힌다. Linux는 바닥이 0에 가깝다.
   */
  eventLoop: { utilization: number; p99: number; max: number };
  traffic: TrafficWindow;
  /** 게임 API · 관리자 API의 DB 연결 풀 — 대전 서버는 DB를 직접 안 쓴다 */
  db?: { max: number; total: number; idle: number; waiting: number };
  /** 대전 서버만 */
  battle?: { rooms: number; players: number; connected: number; queue: number; matching: number };
}
