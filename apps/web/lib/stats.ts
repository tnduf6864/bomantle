// 플레이 통계(누적) — localStorage 기반. 날짜별 진행 저장(bomantle:DATE)과 별개로
// 완료한 날들을 집계한다. 정답명 등 민감 정보는 담지 않는다.

const KEY = "bomantle:stats";

/** 추측 횟수 분포 버킷(작을수록 좋음). 표시 순서 고정. */
export const GUESS_BUCKETS = [
  "1-3",
  "4-6",
  "7-10",
  "11-20",
  "21-30",
  "31-50",
  "51+",
] as const;
export type GuessBucket = (typeof GUESS_BUCKETS)[number];

// v2까지 쓰던 세분 버킷(1..6 개별, 21+) → 넓은 구간으로 합치는 매핑.
// 옛 "21+"는 세부를 알 수 없으므로 가장 보수적인 "21-30"에 합산한다.
const LEGACY_BUCKET_MAP: Record<string, GuessBucket> = {
  "1": "1-3",
  "2": "1-3",
  "3": "1-3",
  "4": "4-6",
  "5": "4-6",
  "6": "4-6",
  "21+": "21-30",
};

/** 저장된 분포의 옛 버킷 키를 현재 버킷으로 합산. 이미 새 형식이면 그대로(멱등). */
function migrateDist(dist: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(dist)) {
    const nk = LEGACY_BUCKET_MAP[k] ?? k;
    out[nk] = (out[nk] ?? 0) + v;
  }
  return out;
}

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

  // --- v2: 힌트·파생 지표 (기존 사용자는 업데이트 이후 판부터 누적) ---
  /** 정답 판들의 추측 횟수 총합(평균 계산용) */
  totalGuesses: number;
  /** 최소 추측으로 맞힌 기록(베스트). 없으면 null */
  bestGuesses: number | null;
  /** 사용한 힌트 총합(평균 계산용) */
  totalHints: number;
  /** 힌트 0회로 맞힌 날 수 */
  noHintWins: number;
  /** 현재 무힌트 연속 정답 일수 */
  curNoHintStreak: number;
  /** 역대 최고 무힌트 연속 일수 */
  maxNoHintStreak: number;
  /** 마지막 무힌트 정답 날짜(무힌트 연속 판정용) */
  lastNoHintDate: string | null;
}

function empty(): Stats {
  return {
    version: 3,
    played: 0,
    wins: 0,
    curStreak: 0,
    maxStreak: 0,
    lastWinDate: null,
    dist: {},
    recorded: {},
    totalGuesses: 0,
    bestGuesses: null,
    totalHints: 0,
    noHintWins: 0,
    curNoHintStreak: 0,
    maxNoHintStreak: 0,
    lastNoHintDate: null,
  };
}

export function loadStats(): Stats {
  if (typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const s = { ...empty(), ...(JSON.parse(raw) as Partial<Stats>) };
    s.dist = migrateDist(s.dist);
    s.version = 3;
    return s;
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
  if (n <= 3) return "1-3";
  if (n <= 6) return "4-6";
  if (n <= 10) return "7-10";
  if (n <= 20) return "11-20";
  if (n <= 30) return "21-30";
  if (n <= 50) return "31-50";
  return "51+";
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
 * @param hintCount 사용한 힌트 횟수(정답일 때 힌트 지표에 반영)
 */
export function recordResult(
  date: string,
  solved: boolean,
  guesses: number,
  hintCount = 0,
): Stats {
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

    // 파생 지표
    s.totalGuesses += guesses;
    s.bestGuesses = s.bestGuesses === null ? guesses : Math.min(s.bestGuesses, guesses);
    s.totalHints += hintCount;

    // 무힌트 연속: 힌트를 썼으면 끊김
    if (hintCount === 0) {
      s.noHintWins += 1;
      if (s.lastNoHintDate && isNextDay(s.lastNoHintDate, date)) s.curNoHintStreak += 1;
      else s.curNoHintStreak = 1;
      s.lastNoHintDate = date;
      if (s.curNoHintStreak > s.maxNoHintStreak) s.maxNoHintStreak = s.curNoHintStreak;
    } else {
      s.curNoHintStreak = 0;
    }
  } else {
    s.curStreak = 0; // 포기는 연속 끊김
    s.curNoHintStreak = 0;
  }
  save(s);
  return s;
}

/** 정답률(%) 정수. 플레이 0이면 0. */
export function winRate(s: Stats): number {
  return s.played ? Math.round((s.wins / s.played) * 100) : 0;
}

/** 포기한 날 수. */
export function giveups(s: Stats): number {
  return s.played - s.wins;
}

/** 정답 판 평균 추측 횟수(소수 1자리). 승리 0이면 0. */
export function avgGuesses(s: Stats): number {
  return s.wins ? Math.round((s.totalGuesses / s.wins) * 10) / 10 : 0;
}

/**
 * 표시용 유효 연속. 마지막 정답이 오늘도 어제도 아니면 이미 끊긴 것이므로 0으로 본다.
 * (저장값은 다음 판을 집계할 때 재계산되므로 그대로 두고, 표시 시점에만 보정.)
 * @param today 현재 퍼즐 날짜(YYYY-MM-DD)
 */
export function effectiveStreak(s: Stats, today: string): number {
  return isStreakAlive(s.lastWinDate, today) ? s.curStreak : 0;
}

/** 표시용 유효 무힌트 연속. */
export function effectiveNoHintStreak(s: Stats, today: string): number {
  return isStreakAlive(s.lastNoHintDate, today) ? s.curNoHintStreak : 0;
}

/** 마지막 정답일이 오늘이거나 어제면 연속이 아직 살아있다. */
function isStreakAlive(lastDate: string | null, today: string): boolean {
  return !!lastDate && (lastDate === today || isNextDay(lastDate, today));
}

/** 백업용 JSON 문자열. */
export function exportStats(s: Stats): string {
  return JSON.stringify(s);
}

/**
 * 백업 JSON을 검증 후 저장한다. 성공 시 저장된 Stats, 실패 시 null.
 * 최소한의 형태 검증만 하고 누락 필드는 기본값으로 채운다.
 */
export function importStats(json: string): Stats | null {
  try {
    const parsed = JSON.parse(json) as Partial<Stats>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.played !== "number" ||
      typeof parsed.wins !== "number" ||
      typeof parsed.recorded !== "object"
    ) {
      return null;
    }
    const merged = { ...empty(), ...parsed, version: 3 };
    merged.dist = migrateDist(merged.dist);
    save(merged);
    return merged;
  } catch {
    return null;
  }
}
