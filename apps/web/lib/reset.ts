// 매일 게임이 초기화되는 시각(Asia/Seoul 기준) 관련 순수 함수.
// KST 오전 9시 경계 — 백엔드 RESET_HOUR과 일치시킬 것.

export const RESET_HOUR = 9;

/** 현재 "퍼즐 날짜"(YYYY-MM-DD). 서버 워커의 kstDate와 동일 규칙(오전 9시 경계). */
export function clientPuzzleDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - RESET_HOUR * 3_600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/** 다음 초기화(매일 오전 RESET_HOUR시 KST)까지 남은 ms. 클라이언트 타임존과 무관하게 동작. */
export function msUntilNextReset(now: Date = new Date()): number {
  // 로컬 타임존에 KST 벽시계 값을 심은 Date — 두 Date의 차(duration)는 타임존 무관.
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const target = new Date(kst);
  target.setHours(RESET_HOUR, 0, 0, 0);
  if (kst.getTime() >= target.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - kst.getTime();
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
