// 플레이 통계(누적) — localStorage 기반. 날짜별 진행 저장(bomantle:DATE)과 별개로
// 완료한 날들을 집계한다. 정답명 등 민감 정보는 담지 않는다.

const KEY = "bomantle:stats";

/** 추측 횟수 분포 버킷(작을수록 좋음). 표시 순서 고정. */
export const GUESS_BUCKETS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7-10",
  "11-20",
  "21+",
] as const;
export type GuessBucket = (typeof GUESS_BUCKETS)[number];

export interface Stats {
  version: number;
  /** 완료(정답+포기)한 날 수 */
  played: number;
  /** 정답 맞힌 날 수 */
  wins: number;
  /** 현재 연속 정답 일수 */
  curStreak: number;
  /** 역대 최고 연속 정답 일수 */
  maxStreak: number;
  /** 마지막으로 맞힌 게임 날짜(연속 판정용) */
  lastWinDate: string | null;
  /** 추측 횟수 버킷 -> 정답 횟수 */
  dist: Record<string, number>;
  /** 이미 집계한 날짜 -> 결과(중복 집계 방지) */
  recorded: Record<string, "win" | "giveup">;
}

function empty(): Stats {
  return {
    version: 1,
    played: 0,
    wins: 0,
    curStreak: 0,
    maxStreak: 0,
    lastWinDate: null,
    dist: {},
    recorded: {},
  };
}

export function loadStats(): Stats {
  if (typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...(JSON.parse(raw) as Partial<Stats>) };
  } catch {
    return empty();
  }
}

function save(s: Stats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

/** 추측 횟수 -> 분포 버킷 라벨. */
export function bucketOf(n: number): GuessBucket {
  if (n <= 6) return String(n) as GuessBucket;
  if (n <= 10) return "7-10";
  if (n <= 20) return "11-20";
  return "21+";
}

/** date2가 date1 바로 다음 퍼즐 날짜(하루 뒤)인가. YYYY-MM-DD 기준. */
function isNextDay(date1: string, date2: string): boolean {
  const a = Date.parse(date1 + "T00:00:00Z");
  const b = Date.parse(date2 + "T00:00:00Z");
  return b - a === 86_400_000;
}

/**
 * 하루 결과를 집계한다. 같은 날짜는 한 번만 반영(idempotent).
 * @param date  퍼즐 날짜(YYYY-MM-DD, 서버 기준)
 * @param solved 정답 여부(false = 포기)
 * @param guesses 추측 횟수(정답일 때 분포에 반영)
 */
export function recordResult(date: string, solved: boolean, guesses: number): Stats {
  const s = loadStats();
  if (s.recorded[date]) return s; // 이미 집계됨
  s.recorded[date] = solved ? "win" : "giveup";
  s.played += 1;
  if (solved) {
    s.wins += 1;
    if (s.lastWinDate && isNextDay(s.lastWinDate, date)) s.curStreak += 1;
    else s.curStreak = 1;
    s.lastWinDate = date;
    if (s.curStreak > s.maxStreak) s.maxStreak = s.curStreak;
    const b = bucketOf(guesses);
    s.dist[b] = (s.dist[b] ?? 0) + 1;
  } else {
    s.curStreak = 0; // 포기는 연속 끊김
  }
  save(s);
  return s;
}

/** 정답률(%) 정수. 플레이 0이면 0. */
export function winRate(s: Stats): number {
  return s.played ? Math.round((s.wins / s.played) * 100) : 0;
}
