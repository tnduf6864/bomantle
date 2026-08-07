import type {
  AnswerInfo,
  GuessResult,
  HintData,
  PercentileResult,
  RankingPage,
  TodayInfo,
  TodayStats,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export async function fetchToday(): Promise<TodayInfo> {
  const r = await fetch(`${BASE}/api/today`);
  if (!r.ok) throw new Error("today failed");
  return r.json();
}

export async function fetchGuess(gameId: number): Promise<GuessResult> {
  const r = await fetch(`${BASE}/api/guess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId }),
  });
  if (!r.ok) throw new Error("guess failed");
  return r.json();
}

export async function fetchHint(level: number): Promise<HintData> {
  const r = await fetch(`${BASE}/api/hint?level=${level}`);
  if (!r.ok) throw new Error("hint failed");
  return r.json();
}

// 접속 집계 핑(+1). 하루 1회만 호출할 것 — dedupe는 호출부(localStorage) 책임.
export async function fetchVisit(): Promise<{ visitors: number | null }> {
  const r = await fetch(`${BASE}/api/visit`, { method: "POST" });
  if (!r.ok) throw new Error("visit failed");
  return r.json();
}

// 정답 공개 후 전체 유사도 순위 한 페이지. 정답 자신은 목록에 없다(1위 = 가장 가까운 게임).
export async function fetchRanking(offset = 0, limit = 100): Promise<RankingPage> {
  const r = await fetch(`${BASE}/api/ranking?offset=${offset}&limit=${limit}`);
  if (!r.ok) throw new Error("ranking failed");
  return r.json();
}

/**
 * 결과 제출 + 오늘 맞힌 사람 중 내 백분위 조회. 같은 cid로 다시 호출해도 기록은
 * 첫 제출로 고정되고 순위만 재계산된다(서버 멱등) → 새로고침·탭 복귀 시 그냥 다시 부르면 된다.
 * @returns 서버에 집계가 비활성(로컬 개발 등)이면 null — 호출부는 UI를 감춘다.
 */
export async function fetchResult(
  cid: string,
  hints: number,
  guesses: number,
  solved: boolean,
): Promise<PercentileResult | null> {
  const r = await fetch(`${BASE}/api/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cid, hints, guesses, solved }),
  });
  if (!r.ok) throw new Error("result failed");
  const data = (await r.json()) as PercentileResult | { available: false };
  return "available" in data ? null : data;
}

/** 오늘 전체 현황(익명 집계). 쓰기 없음 — 제출과 무관하게 아무나 볼 수 있다. */
export async function fetchStats(): Promise<TodayStats | null> {
  const r = await fetch(`${BASE}/api/stats`);
  if (!r.ok) throw new Error("stats failed");
  const data = (await r.json()) as TodayStats | { available: false };
  return "available" in data ? null : data;
}

export async function fetchGiveup(): Promise<{ answer: AnswerInfo }> {
  const r = await fetch(`${BASE}/api/giveup`, { method: "POST" });
  if (!r.ok) throw new Error("giveup failed");
  return r.json();
}
