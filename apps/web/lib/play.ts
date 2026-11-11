// 게임 진행 규칙 중 화면과 무관한 순수 로직 — 지난 문제 날짜, 힌트 해금, 공유 텍스트.
// page.tsx에서 분리해 `node --test`로 검증한다.

import type { GuessRow, HintData, PercentileResult } from "./types";

/** 퍼즐 1번 날짜. 워커 answer.ts EPOCH와 같아야 한다. */
export const EPOCH = "2026-01-01";

export const SITE_URL = "https://bomantle.pages.dev";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 퍼즐 번호 = EPOCH 이후 경과 일수 + 1 (워커 puzzleNumber와 같은 규칙). */
export function puzzleNumberOf(date: string): number {
  return Math.floor((Date.parse(date + "T00:00:00Z") - Date.parse(EPOCH + "T00:00:00Z")) / 86_400_000) + 1;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * URL의 `?d=`를 지난 문제 날짜로 해석. 오늘보다 **이전**이고 퍼즐 1번 이후일 때만 인정한다
 * (오늘 날짜면 그냥 오늘 판, 미래는 서버도 거부한다). 아니면 null = 오늘 판.
 */
export function parseArchiveDate(param: string | null, today: string): string | null {
  if (!param || !DATE_RE.test(param)) return null;
  const t = Date.parse(param + "T00:00:00Z");
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== param) return null;
  if (param >= today || puzzleNumberOf(param) < 1) return null;
  return param;
}

/** 지난 문제 목록 — 어제부터 퍼즐 1번까지 최신순. */
export function archiveDates(today: string): string[] {
  const n = puzzleNumberOf(today) - 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(today, -(i + 1)));
}

/** 날짜별 저장 진행(localStorage `bomantle:DATE`)에서 목록 표시용 상태만 뽑는다. */
export type PlayStatus = "solved" | "gaveup" | "playing" | "new";

export function statusOf(saved: { rows?: GuessRow[]; won?: boolean } | null): {
  status: PlayStatus;
  guesses: number;
} {
  const rows = saved?.rows ?? [];
  if (saved?.won) return { status: rows.some((r) => r.win) ? "solved" : "gaveup", guesses: rows.length };
  return { status: rows.length ? "playing" : "new", guesses: rows.length };
}

// ── 힌트 해금 ─────────────────────────────────────────────────────────

export const MAX_HINT_LEVEL = 8;

/**
 * 힌트 단계 이름 기본값. 원본은 워커 `hint.ts` HINT_LABELS이고 `/api/today`로 내려온다 —
 * 이건 응답에 없을 때(구버전 서버) 쓰는 폴백이라 같게 유지할 것.
 */
export const DEFAULT_HINT_LABELS = [
  "인원 · 플레이타임",
  "웨이트",
  "유형 · 출시 연대",
  "테마",
  "메커니즘 · 베스트 인원",
  "인기도",
  "특징 태그",
  "디자이너 · 연도 · 글자 수",
];

/**
 * 힌트 k단계는 추측을 (k-1)×HINT_EVERY번 한 뒤에 열린다(1단계는 처음부터).
 *
 * 예전엔 8단계를 바로 다 열 수 있어서 초성(8단계)까지 직행하면 추리할 게 남지 않았다.
 * 실측 정답자 평균이 40회 남짓이라 4회 간격이면 8단계(28회)가 그보다 일찍 열린다 —
 * 막혀서 그만두게 하려는 게 아니라 순서대로 좁혀 가게 하려는 것.
 */
export const HINT_EVERY = 4;

export function hintUnlockAt(level: number): number {
  return (level - 1) * HINT_EVERY;
}

/** 다음 힌트(level)를 열려면 추측이 몇 번 더 필요한가. 0이면 지금 열 수 있다. */
export function guessesUntilHint(level: number, guesses: number): number {
  return Math.max(0, hintUnlockAt(level) - guesses);
}

// ── 찾은 정답 태그 ─────────────────────────────────────────────────────

export interface FoundTags {
  /** 찾은 태그 id — 처음 찾은 순서 */
  cats: number[];
  mechs: number[];
  /** 정답 태그 총개수. 아직 새 형식 응답을 받은 적이 없으면 null(목록을 감춘다) */
  total: { cats: number; mechs: number } | null;
}

/**
 * 추측들과 힌트로 알아낸 정답 태그를 합친다. 같은 태그를 가진 게임을 추측하면 그 태그가,
 * 4·5·7단계 힌트를 열면 그 힌트의 태그가 공개된다.
 */
export function foundTags(
  rows: Pick<GuessRow, "match" | "tagTotal">[],
  hints: Pick<HintData, "tags">[],
): FoundTags {
  const cats: number[] = [];
  const mechs: number[] = [];
  let total: FoundTags["total"] = null;
  const add = (t?: { cats: number[]; mechs: number[] }) => {
    for (const c of t?.cats ?? []) if (!cats.includes(c)) cats.push(c);
    for (const m of t?.mechs ?? []) if (!mechs.includes(m)) mechs.push(m);
  };
  for (const r of rows) {
    add(r.match);
    if (r.tagTotal) total = r.tagTotal;
  }
  for (const h of hints) add(h.tags);
  return { cats, mechs, total };
}

// ── 공유 ─────────────────────────────────────────────────────────────

/** 추측 1건 → 근접도 색 칸. 화면의 막대 색(barColor) 구간과 같다. */
export function rankEmoji(row: Pick<GuessRow, "win" | "rank">): string {
  if (row.win) return "🟩";
  if (row.rank <= 10) return "🟥";
  if (row.rank <= 50) return "🟧";
  if (row.rank <= 300) return "🟨";
  if (row.rank <= 1000) return "🟦";
  return "⬜";
}

const GRID_COLS = 10;
const GRID_MAX = 50;

/**
 * 추측 순서대로의 근접도 그리드(워들식). 정답명은 물론 게임명도 드러나지 않는다.
 * 길면 앞쪽만 보이고 나머지는 개수로 줄인다 — 메신저에서 한 화면을 넘기지 않게.
 */
export function shareGrid(rows: Pick<GuessRow, "win" | "rank">[]): string {
  const cells = rows.slice(0, GRID_MAX).map(rankEmoji);
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += GRID_COLS) lines.push(cells.slice(i, i + GRID_COLS).join(""));
  if (rows.length > GRID_MAX) lines.push(`… +${rows.length - GRID_MAX}`);
  return lines.join("\n");
}

/** 추측 횟수 → 별점 (적게 맞힐수록 ★ 많음). */
export function starRating(n: number): string {
  const filled = n <= 4 ? 5 : n <= 9 ? 4 : n <= 16 ? 3 : n <= 30 ? 2 : 1;
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** 공유 텍스트. 정답 이름은 절대 넣지 않는다. */
export function buildShareText(opts: {
  rows: GuessRow[];
  hintCount: number;
  puzzleNumber: number;
  /** 지난 문제면 그 날짜 — 링크가 그 문제로 바로 연다 */
  archiveDate?: string | null;
  streak?: number;
  pct?: PercentileResult | null;
}): string {
  const { rows, hintCount, puzzleNumber, archiveDate, streak = 0, pct = null } = opts;
  const solved = rows.some((r) => r.win);
  const n = rows.length;
  const head = `🎲 보맨틀 #${puzzleNumber}${archiveDate ? " (지난 문제)" : ""}`;
  const url = archiveDate ? `${SITE_URL}/?d=${archiveDate}` : SITE_URL;
  const hintLine = hintCount > 0 ? `\n💡 힌트 ${"💀".repeat(hintCount)}` : "";
  const grid = n ? `\n\n${shareGrid(rows)}` : "";
  if (solved) {
    // 연속·백분위는 오늘 판에만 의미가 있다(지난 문제는 집계에 안 들어간다).
    const streakLine = !archiveDate && streak >= 2 ? `\n🔥 연속 ${streak}일` : "";
    const pctLine = !archiveDate && pct && !pct.pending ? `\n🏆 상위 ${pct.percentile}%` : "";
    return `${head}\n🎯 ${n}번 만에 맞혔어요! ${starRating(n)}${pctLine}${streakLine}${hintLine}${grid}\n\n${url}`;
  }
  const ranks = rows.filter((r) => !r.win).map((r) => r.rank);
  const best = ranks.length ? Math.min(...ranks) : 0;
  const bestText = best ? ` — 최고 ${best.toLocaleString()}위` : "";
  return `${head}\n🏳️ ${n}번 추측 후 포기${bestText}${hintLine}${grid}\n\n${url}`;
}

/**
 * 모바일이면 OS 공유 시트(카톡 등으로 바로), 아니면 클립보드.
 * 데스크톱 Chrome에도 navigator.share가 있지만 거기선 복사가 더 기대되는 동작이라
 * 터치 기기에서만 공유 시트를 쓴다.
 */
export async function shareOrCopy(text: string): Promise<"shared" | "copied" | "cancelled"> {
  const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  if (touch && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (e) {
      // 사용자가 시트를 닫은 것 — 복사로 넘어가지 않는다.
      if ((e as Error)?.name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
