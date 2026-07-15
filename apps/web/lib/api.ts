import type { GuessResult, HintData, TodayInfo } from "./types";

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

export async function fetchGiveup(): Promise<{
  answer: { id: number; name_ko: string | null; name_en: string | null; image?: string | null };
}> {
  const r = await fetch(`${BASE}/api/giveup`, { method: "POST" });
  if (!r.ok) throw new Error("giveup failed");
  return r.json();
}
