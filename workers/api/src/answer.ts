import type { Game } from "@bomantle/core";

/** 매일 게임이 초기화되는 시각(Asia/Seoul 기준, 0~23시). */
export const RESET_HOUR = 9;

/**
 * Asia/Seoul 기준 "게임 날짜" YYYY-MM-DD.
 * 하루 경계가 자정이 아니라 오전 RESET_HOUR시 → 그만큼 시간을 당겨서 날짜를 계산.
 * 예) 08:59 KST는 아직 전날 퍼즐, 09:00 KST부터 새 퍼즐.
 */
export function kstDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - RESET_HOUR * 3_600_000);
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(shifted); // en-CA -> YYYY-MM-DD
}

const EPOCH = "2026-01-01";

/** 퍼즐 번호 = EPOCH 이후 경과 일수 + 1. */
export function puzzleNumber(date: string): number {
  const d = Date.parse(date + "T00:00:00Z");
  const e = Date.parse(EPOCH + "T00:00:00Z");
  return Math.floor((d - e) / 86400000) + 1;
}

/** 결정론적 정수 해시(FNV-1a). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 시드 하나로 같은 난수열을 재현하는 32비트 PRNG(mulberry32). 순열 생성 전용. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 시드 기반 Fisher-Yates 셔플. 입력 배열은 건드리지 않는다. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 음수도 안전한 나머지(퍼즐 번호가 EPOCH 이전이면 음수가 된다). */
function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

/**
 * 프랜차이즈 기준 이름(콜론/대시 앞부분).
 *
 * 두 곳에서 쓴다: 정답 풀의 프랜차이즈 묶음(아래)과, 추측이 정답과 같은 시리즈인지
 * 판정하는 `/api/guess`. 두 판정이 갈리면 "같은 시리즈"라고 알려준 게임이 정답 풀에는
 * 형제로 안 잡히는 모순이 생기므로 규칙을 한 곳에 둔다.
 */
export function baseName(g: Game): string {
  const n = g.name_ko ?? g.name_en ?? String(g.id);
  return n.split(/[:\-(]/)[0].trim();
}

/**
 * 정답 풀에 들어올 수 있는 보드라이프 종합 순위 상한.
 *
 * 데이터셋이 랭킹 목록(상위 5,500)에서 **보드라이프 등록 전체**(~2만)로 넓어지면서
 * `rank != null`이 더 이상 아무것도 걸러내지 못하게 됐다. 예전에는 "데이터에 있다"가
 * 곧 "목록권 안"이었지만 지금은 순위가 전 게임에 붙기 때문이다. 그 경계를 명시적으로
 * 되살린 값 — 유사도 순위·자동완성은 전체를 쓰되 **정답만** 여기 안에서 고른다.
 */
export const POOL_MAX_RANK = 5500;

/**
 * 정답 후보 풀. 잘 알려지고 단독 플레이 가능한 게임만:
 *  - 종합 순위 POOL_MAX_RANK 이내, 난이도/인원 데이터 존재, 태그 2개 이상
 *  - 평가 수 minReviews개 이상 (마이너·인지도 낮은 게임 정답에서 제외)
 *  - **같은 BGG 게임**(bgg_id)은 가장 높은 랭킹 1개만 — 같은 게임의 판·에디션 변형 제거
 *  - 랭킹 상위 위주(기본 1200개)
 *
 * 묶음 키가 예전엔 `baseName`(제목 앞부분)이었다. 그러면 "브라스: 버밍엄"과 "브라스: 랭커셔",
 * "도미니언"과 "도미니언: 장막뒤의 사람들"처럼 **BGG 기준으로 다른 게임**이 하나로 묶여
 * 진 쪽이 정답에서 영구 제외됐다(탈락 56개 중 52개). 이제 형제를 맞혔을 때 "같은 시리즈"
 * 배지가 뜨므로(isSameSeries) 형제가 각자 정답이 돼도 억울하지 않다.
 * bgg_id가 없는 게임은 이름 기준으로 폴백한다(실측 자격 게임은 전부 bgg_id가 있다).
 */
export function buildAnswerPool(games: Game[], limit = 1200, minReviews = 50): number[] {
  const eligible = games.filter(
    (g) =>
      g.rank != null &&
      g.rank <= POOL_MAX_RANK &&
      g.weight != null &&
      g.categories.length >= 2 &&
      g.players_min != null &&
      (g.review_count ?? 0) >= minReviews,
  );
  const bestByKey = new Map<string, Game>();
  for (const g of eligible) {
    const key = g.bgg_id != null ? `bgg:${g.bgg_id}` : `name:${baseName(g)}`;
    const cur = bestByKey.get(key);
    if (!cur || (g.rank ?? 1e9) < (cur.rank ?? 1e9)) bestByKey.set(key, g);
  }
  return [...bestByKey.values()]
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
    .slice(0, limit)
    .map((g) => g.id);
}

/**
 * 날짜로 풀에서 정답 id 선택(KV 오버라이드 없을 때).
 *
 * 날짜를 직접 해시해 뽑으면(예전 방식) 매일 **독립 추첨**이라 이미 나온 정답이 금방
 * 다시 걸린다 — 실측으로 365일 중 82일이 재출현했고 최단 간격은 5일이었다. 풀이
 * 565개나 되는데 1년에 283개밖에 못 쓰는 셈이라, 매일 하는 사람은 한 주 안에 같은
 * 답을 두 번 본다.
 *
 * 그래서 추첨이 아니라 **순열을 소진**한다. 풀 전체를 사이클마다 한 번 섞어 두고
 * 퍼즐 번호 순서대로 하나씩 꺼내므로, 한 사이클(= 풀 크기, 현재 565일) 안에서는
 * 중복이 구조적으로 불가능하다. 사이클이 넘어가면 새 시드로 다시 섞여 순서가 바뀐다.
 *
 * 서버 상태는 여전히 없다 — 날짜만 있으면 같은 답이 재현된다.
 */
export function dailyAnswerFromSeed(date: string, pool: number[]): number {
  if (pool.length === 0) throw new Error("answer pool is empty");
  // 퍼즐 1번이 순열의 0번째가 되도록 0-base로 맞춘다.
  const n = pool.length;
  const i = puzzleNumber(date) - 1;
  return shuffled(pool, hash(`cycle:${Math.floor(i / n)}`))[mod(i, n)];
}

/** YYYY-MM-DD에 일수를 더한다(UTC 자정 기준 — 날짜 문자열 산술 전용). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 정답 일정 — 풀이 바뀌어도 **지난 정답과 진행 중인 판이 흔들리지 않게** 시대를 나눈다.
 *
 * 순열은 풀 내용에 따라 통째로 달라진다. 풀 규칙을 바꾸거나 데이터를 재크롤하면 같은
 * 날짜의 정답이 바뀌어, 지난 문제 다시 풀기가 엉뚱한 답을 내고 사이클 무중복 보장도
 * 깨진다. 그래서:
 *
 *  - `from` 이전 날짜: 그 시점 풀을 **얼려 둔 목록**(`legacyPool`, pool_v1.json)으로
 *    예전과 똑같이 계산한다. games.json이 바뀌어도 결과가 그대로다.
 *  - `from` 이후 첫 사이클: 새 풀에서 **구 시대 현재 사이클에 이미 나온 정답을 뒤로 미룬**
 *    순서. 시대가 바뀌는 날 바로 며칠 전 정답이 다시 나오는 일을 막는다.
 *  - 그다음 사이클부터는 새 풀을 평범하게 섞는다.
 */
export interface AnswerSchedule {
  legacyPool: number[];
  pool: number[];
  /** 새 풀이 적용되는 첫 날짜(YYYY-MM-DD) */
  from: string;
}

const eraCache = new WeakMap<AnswerSchedule, Map<number, number[]>>();

/** 새 시대 c번째 사이클의 순열(메모이즈 — 요청마다 셔플하지 않는다). */
function eraCycle(s: AnswerSchedule, c: number): number[] {
  let m = eraCache.get(s);
  if (!m) eraCache.set(s, (m = new Map()));
  const hit = m.get(c);
  if (hit) return hit;

  let order: number[];
  if (c === 0) {
    // 구 시대의 현재 사이클에서 이미 나온 정답들.
    const lastLegacy = puzzleNumber(s.from) - 1; // 마지막 구 시대 퍼즐 번호
    const n = s.legacyPool.length;
    const cycleStart = lastLegacy > 0 ? Math.floor((lastLegacy - 1) / n) * n + 1 : 1;
    const used = new Set<number>();
    for (let p = cycleStart; p <= lastLegacy; p++) {
      used.add(dailyAnswerFromSeed(addDays(s.from, p - lastLegacy - 1), s.legacyPool));
    }
    const fresh = s.pool.filter((id) => !used.has(id));
    const seen = s.pool.filter((id) => used.has(id));
    order = [
      ...shuffled(fresh, hash(`v2:cycle:0:fresh`)),
      ...shuffled(seen, hash(`v2:cycle:0:seen`)),
    ];
  } else {
    order = shuffled(s.pool, hash(`v2:cycle:${c}`));
  }
  m.set(c, order);
  return order;
}

/** 날짜의 정답 id(KV 오버라이드 제외). 시대 구분은 AnswerSchedule 참고. */
export function answerForDate(date: string, s: AnswerSchedule): number {
  if (date < s.from) return dailyAnswerFromSeed(date, s.legacyPool);
  if (s.pool.length === 0) throw new Error("answer pool is empty");
  const i = puzzleNumber(date) - puzzleNumber(s.from);
  const n = s.pool.length;
  return eraCycle(s, Math.floor(i / n))[i % n];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 지난 문제 요청의 날짜 검증. 형식이 맞고, 퍼즐 1번 이후이며, **오늘을 넘지 않을 때만**
 * 그 날짜를 돌려준다 — 미래 날짜를 받으면 내일 정답을 미리 풀 수 있다.
 * 파라미터가 없으면 오늘. 잘못된 값이면 null(호출부가 400).
 */
export function resolvePuzzleDate(param: string | null, today: string): string | null {
  if (param == null || param === "") return today;
  if (!DATE_RE.test(param)) return null;
  // 2026-02-31 같은 값은 Date가 3월로 넘겨 버리므로 왕복해서 같은지 본다.
  const t = Date.parse(param + "T00:00:00Z");
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== param) return null;
  if (puzzleNumber(param) < 1 || param > today) return null;
  return param;
}
