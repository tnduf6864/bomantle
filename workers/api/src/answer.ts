import type { Game } from "@bomantle/core";

/** Asia/Seoul 기준 "YYYY-MM-DD". */
export function kstDate(now: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(now); // en-CA -> YYYY-MM-DD
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
 * 정답 후보 풀. 잘 알려지고 단독 플레이 가능한 게임만:
 *  - 랭킹/난이도/인원 데이터 존재, 태그 2개 이상
 *  - 평가 수 50개 이상 (마이너·인지도 낮은 게임 정답에서 제외)
 *  - 같은 프랜차이즈는 가장 높은 랭킹 1개만 (아줄:신트라 등 확장 제외)
 *  - 랭킹 상위 위주(기본 1200개)
 */
export function buildAnswerPool(games: Game[], limit = 1200): number[] {
  const eligible = games.filter(
    (g) =>
      g.rank != null &&
      g.weight != null &&
      g.categories.length >= 2 &&
      g.players_min != null &&
      (g.review_count ?? 0) >= 50,
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
