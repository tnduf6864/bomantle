import type { ScoredGame } from "@bomantle/core";

// 정답 공개 후 보여주는 "전체 유사도 순위" 목록의 페이지네이션.
// 랭킹 배열 자체는 getDayState가 이미 계산·캐시하므로 여기서는 자르기만 한다.

/** 한 페이지 기본 크기. 클라 렌더 부담과 요청 수의 절충. */
export const DEFAULT_LIMIT = 100;
/** 한 번에 내려줄 수 있는 최대 개수. 이 이상은 렌더가 무거워 의미가 없다. */
export const MAX_LIMIT = 200;

export interface Page {
  offset: number;
  limit: number;
}

/** 쿼리스트링을 안전한 페이지 범위로 해석. 비정상 입력은 기본값으로 떨어진다. */
export function parsePage(params: URLSearchParams, total: number): Page {
  return {
    offset: clampInt(params.get("offset"), 0, 0, Math.max(0, total)),
    limit: clampInt(params.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT),
  };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * 랭킹의 한 페이지. 이름은 담지 않는다 — 웹이 games.json을 이미 갖고 있어
 * id만 주면 클라에서 해석할 수 있고, 페이로드가 30배쯤 작아진다.
 */
export function sliceRanking(ranking: ScoredGame[], page: Page): ScoredGame[] {
  return ranking.slice(page.offset, page.offset + page.limit);
}
