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

/** 프랜차이즈 기준 이름(콜론/대시 앞부분). 확장·리메이크 묶음용. */
function baseName(g: Game): string {
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
 *  - 같은 프랜차이즈는 가장 높은 랭킹 1개만 (아줄:신트라 등 확장 제외)
 *  - 랭킹 상위 위주(기본 1200개)
 *
 * 실측 풀 크기(전수 크롤 21,194개 기준): minReviews 50→565개, 100→322개, 200→145개.
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
  // 프랜차이즈별 최상위만
  const bestByBase = new Map<string, Game>();
  for (const g of eligible) {
    const key = baseName(g);
    const cur = bestByBase.get(key);
    if (!cur || (g.rank ?? 1e9) < (cur.rank ?? 1e9)) bestByBase.set(key, g);
  }
  return [...bestByBase.values()]
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
    .slice(0, limit)
    .map((g) => g.id);
}

/** 날짜 시드로 풀에서 정답 id 선택(KV 오버라이드 없을 때). */
export function dailyAnswerFromSeed(date: string, pool: number[]): number {
  return pool[hash(date) % pool.length];
}
