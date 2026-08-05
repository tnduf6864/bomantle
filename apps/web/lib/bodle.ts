// 보들 클라이언트 상태 — 진행 저장/복원, 누적 통계, 공유 텍스트.
//
// 보맨틀의 lib/stats.ts를 재사용하지 않고 따로 둔다: 저장 키가 다르고(섞이면 안 된다),
// 힌트 개념이 없으며, 추측 상한이 8이라 분포 버킷도 다르다.
//
// 진행은 **추측 id 목록만** 저장한다. 피드백은 서버가 매번 다시 만들어 주므로
// (POST /api/bodle/guess에 전체 목록을 보냄) 클라에 판정 결과를 둘 이유가 없다.

import type { BodleFeedback, BodleTurn } from "./types";

const PROGRESS_KEY = "bodle:progress";
const STATS_KEY = "bodle:stats";

export const SITE_URL = "https://bomantle.pages.dev/bodle";

/**
 * 기기 식별자. 같은 기기의 재제출을 서버가 알아보게 하는 용도(집계 기록 고정)로만 쓴다.
 * 임의 UUID이며 개인정보가 아니고, 서버는 이 값으로 아무것도 조회하지 않는다.
 * randomUUID가 없는(비보안 컨텍스트) 브라우저도 있어 폴백을 둔다.
 *
 * **보맨틀과 같은 키(`bomantle:cid`)를 쓴다** — 같은 기기이고, 집계는 DO 인스턴스가
 * 게임별로 분리돼 있어 섞이지 않는다. 굳이 UUID를 두 개 발급할 이유가 없다.
 */
export function deviceId(): string | null {
  try {
    const key = "bomantle:cid";
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    localStorage.setItem(key, id);
    return id;
  } catch {
    return null; // 저장 불가 환경(시크릿 모드 등)은 집계 기능만 비활성
  }
}

// --- 진행 저장 --------------------------------------------------------------

interface Progress {
  date: string;
  guesses: number[];
}

/** 오늘 진행 중인 추측 id 목록. 날짜가 바뀌었으면 빈 배열(새 판). */
export function loadProgress(date: string): number[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as Progress;
    if (p.date !== date || !Array.isArray(p.guesses)) return [];
    return p.guesses.filter((n) => typeof n === "number");
  } catch {
    return [];
  }
}

export function saveProgress(date: string, guesses: number[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ date, guesses } satisfies Progress));
  } catch {
    /* 사파리 프라이빗 모드 등 — 저장 실패해도 게임은 계속된다 */
  }
}

// --- 누적 통계 --------------------------------------------------------------

export interface BodleStats {
  /** 결과를 기록한 마지막 퍼즐 날짜(YYYY-MM-DD) */
  lastDate: string | null;
  played: number;
  solved: number;
  streak: number;
  bestStreak: number;
  /** index 0 = 1번 만에 맞힘 … index 7 = 8번. 실패는 담지 않는다 */
  dist: number[];
}

export function emptyBodleStats(): BodleStats {
  return { lastDate: null, played: 0, solved: 0, streak: 0, bestStreak: 0, dist: [] };
}

export function loadBodleStats(): BodleStats {
  if (typeof localStorage === "undefined") return emptyBodleStats();
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return emptyBodleStats();
    const s = JSON.parse(raw) as Partial<BodleStats>;
    return { ...emptyBodleStats(), ...s, dist: Array.isArray(s.dist) ? s.dist : [] };
  } catch {
    return emptyBodleStats();
  }
}

function saveBodleStats(s: BodleStats): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}

/** 퍼즐 날짜의 하루 전(YYYY-MM-DD). 연속 기록 판정용. */
export function prevDate(date: string): string {
  const t = Date.parse(date + "T00:00:00Z");
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

/**
 * 하루치 결과를 누적에 반영한다. **같은 날짜를 두 번 기록하지 않는다** —
 * 새로고침이나 탭 복귀로 다시 호출돼도 통계가 부풀지 않아야 한다.
 * @returns 갱신된 통계 (변화가 없으면 입력 그대로)
 */
export function recordBodleResult(
  s: BodleStats,
  date: string,
  guesses: number,
  solved: boolean,
): BodleStats {
  if (s.lastDate === date) return s;

  const streak = solved ? (s.lastDate === prevDate(date) ? s.streak : 0) + 1 : 0;
  const dist = [...s.dist];
  if (solved) {
    const i = guesses - 1;
    while (dist.length <= i) dist.push(0);
    dist[i] += 1;
  }

  const next: BodleStats = {
    lastDate: date,
    played: s.played + 1,
    solved: s.solved + (solved ? 1 : 0),
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
    dist,
  };
  saveBodleStats(next);
  return next;
}

/** 정답률(%). 플레이 0이면 0. */
export function bodleWinRate(s: BodleStats): number {
  return s.played ? Math.round((s.solved / s.played) * 100) : 0;
}

/**
 * 맞힌 판의 평균 추측 횟수(소수 1자리). dist에는 맞힌 판만 담기므로 실패는 분모에 없다.
 * 맞힌 적이 없으면 0.
 */
export function bodleAvgGuesses(s: BodleStats): number {
  let total = 0;
  let count = 0;
  s.dist.forEach((c, i) => {
    total += c * (i + 1);
    count += c;
  });
  return count ? Math.round((total / count) * 10) / 10 : 0;
}

/** 가장 적은 추측으로 맞힌 횟수. 맞힌 적이 없으면 null. */
export function bodleBestGuesses(s: BodleStats): number | null {
  const i = s.dist.findIndex((c) => c > 0);
  return i < 0 ? null : i + 1;
}

/**
 * 화면에 보여줄 연속 기록. 마지막 기록이 어제도 오늘도 아니면 이미 끊긴 것이므로 0.
 * (저장값을 건드리지 않고 표시만 보정한다 — 보맨틀 effectiveStreak과 같은 방식)
 */
export function effectiveBodleStreak(s: BodleStats, today: string): number {
  if (!s.lastDate) return 0;
  if (s.lastDate === today || s.lastDate === prevDate(today)) return s.streak;
  return 0;
}

// --- 공유 텍스트 ------------------------------------------------------------

/**
 * 집합 열 판정 → 이모지.
 * "판정 불가"(unknown)도 ⬜로 묶는다 — 공유 그리드는 복기용이 아니라 자랑용이라
 * 상태를 늘리면 남이 읽기만 어려워진다(화면에서는 점선 칸으로 구분해 보여준다).
 */
function setEmoji(m: BodleFeedback["types"]): string {
  return m === "hit" ? "🟩" : m === "partial" ? "🟨" : "⬜";
}

/**
 * 수치 열 판정 → 이모지. 방향 화살표가 곧 힌트라 그대로 노출한다.
 * "hit"이어도 완전히 같은 값이 아니면 🟨(화면의 노랑과 동일 기준) — `exact`로 구분한다.
 */
function numEmoji(m: BodleFeedback["weight"], exact: boolean): string {
  if (m === "hit") return exact ? "🟩" : "🟨";
  return m === "up" ? "⬆️" : m === "down" ? "⬇️" : "⬜";
}

/** 한 추측의 이모지 줄. 열 순서는 화면과 같아야 남이 읽을 수 있다. */
export function turnEmoji(fb: BodleFeedback): string {
  return (
    setEmoji(fb.types) +
    setEmoji(fb.categories) +
    setEmoji(fb.mechanisms) +
    numEmoji(fb.weight, fb.weightExact) +
    numEmoji(fb.year, fb.yearExact)
  );
}

/**
 * 공유 텍스트. **정답 이름도, 추측한 게임 이름도 넣지 않는다** —
 * 추측 이름이 새면 남의 판을 망친다(보맨틀과 같은 원칙).
 */
export function buildBodleShareText(
  turns: BodleTurn[],
  maxGuesses: number,
  puzzleNumber: number,
  solved: boolean,
  streak = 0,
): string {
  const score = solved ? `${turns.length}/${maxGuesses}` : `X/${maxGuesses}`;
  const grid = turns.map((t) => turnEmoji(t.feedback)).join("\n");
  const streakLine = solved && streak >= 2 ? `\n🔥 연속 ${streak}일` : "";
  return `🎲 보들 #${puzzleNumber}  ${score}\n\n${grid}${streakLine}\n\n${SITE_URL}`;
}
