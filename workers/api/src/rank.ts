// 정답 백분위(상위 N%) 계산의 순수 로직. DO 런타임 없이 `node --test`로 돌리기 위해
// 저장(results.ts)과 분리한다. hint.ts / answer.ts / reveal.ts 와 같은 패턴.
//
// 순위·분포는 SQL이 아니라 여기서 JS로 계산한다. COUNT 질의로 나눠 넣으면 타이브레이크
// 규칙이 SQL과 JS 두 곳에 생겨 어긋날 수 있고, 인덱스 범위 스캔도 결국 같은 행들을
// 읽으므로 이득이 크지 않다. 표본은 하루·정답자로 한정돼 작다(수백~수천 행).

/** 힌트 최대 단계. index.ts의 /api/hint 상한과 일치시킬 것. */
export const MAX_HINTS = 8;

/** 추측 횟수 상한(검증용). 이보다 많으면 사실상 전수 탐색이라 순위 의미가 없다. */
export const MAX_GUESSES = 500;

/** 순위를 공개하기 시작하는 최소 표본. 그 전에는 pending으로 내려 표본 수만 보여준다. */
export const MIN_SAMPLE = 5;

/**
 * 추측 횟수 분포 버킷. **웹 `lib/stats.ts`의 GUESS_BUCKETS와 라벨이 반드시 같아야 한다**
 * (개인 통계 모달과 같은 UI를 재사용하기 때문).
 */
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

/** 검증을 통과한 제출 내용. ts(정답 도달 시각)는 서버가 찍으므로 여기 없다. */
export interface Submission {
  cid: string;
  hints: number;
  guesses: number;
  solved: boolean;
}

/** 순위 계산에 쓰는 한 사람의 기록. cid는 순위와 무관하므로 담지 않는다. */
export interface ResultRow {
  hints: number;
  guesses: number;
  /** 서버가 정답 제출을 받은 시각(ms). 클라 입력이 아니다. */
  ts: number;
}

/** 힌트 개수별 카운트(0..MAX_HINTS) + 추측 버킷별 카운트. 빈 칸도 0으로 채워진다. */
export interface Distribution {
  hintDist: number[];
  guessDist: Record<string, number>;
}

// 기기 식별자(클라 localStorage의 crypto.randomUUID). UUID 형태만 받아
// 쓰레기 값이 테이블에 쌓이는 걸 막는다. 개인정보가 아니고 서버는 발급하지 않는다.
const CID_RE = /^[0-9a-fA-F-]{8,64}$/;

/**
 * 요청 본문을 검증한다. 범위를 벗어나면 클램프가 아니라 **거부**한다 —
 * 조용히 보정하면 조작된 값이 순위에 그대로 섞이기 때문.
 * @returns 유효하면 Submission, 아니면 null (호출부에서 400)
 */
export function sanitizeSubmission(body: unknown): Submission | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (typeof b.cid !== "string" || !CID_RE.test(b.cid)) return null;
  if (!isIntInRange(b.hints, 0, MAX_HINTS)) return null;
  if (!isIntInRange(b.guesses, 1, MAX_GUESSES)) return null;
  // solved 생략은 정답(true)으로 본다 — 현재 클라는 맞혔을 때만 제출한다.
  if (b.solved !== undefined && typeof b.solved !== "boolean") return null;

  return {
    cid: b.cid,
    hints: b.hints,
    guesses: b.guesses,
    solved: b.solved ?? true,
  };
}

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * 내 순위(1부터). 정렬 키는 `(hints ASC, guesses ASC, ts ASC)`:
 * 힌트를 적게 쓴 사람이 위 → 같으면 추측이 적은 사람 → 둘 다 같으면 먼저 도달한 사람.
 *
 * `rows`에는 내 기록도 포함돼 있어야 한다(나보다 나은 기록만 세므로 결과는 같다).
 * 완전 동점(시각까지 같음)이면 같은 순위를 받는다.
 */
export function rankAmong(rows: ResultRow[], mine: ResultRow): number {
  let better = 0;
  for (const r of rows) if (isBetter(r, mine)) better += 1;
  return better + 1;
}

/** a가 b보다 좋은 기록인가. 순위 규칙의 단일 정의. */
function isBetter(a: ResultRow, b: ResultRow): boolean {
  if (a.hints !== b.hints) return a.hints < b.hints;
  if (a.guesses !== b.guesses) return a.guesses < b.guesses;
  return a.ts < b.ts;
}

/**
 * 상위 몇 %인가. 1등은 1%, 꼴찌는 100%. 표본이 없으면 100.
 * (0%가 나오지 않도록 최소 1로 올린다 — "상위 0%"는 읽는 사람에게 무의미하다.)
 */
export function percentileOf(rank: number, total: number): number {
  if (total <= 0) return 100;
  const pct = Math.ceil((rank / total) * 100);
  return Math.min(100, Math.max(1, pct));
}

/** 추측 횟수 -> 분포 버킷 라벨. 웹 `lib/stats.ts`의 bucketOf와 경계가 같다. */
export function guessBucket(n: number): GuessBucket {
  if (n <= 3) return "1-3";
  if (n <= 6) return "4-6";
  if (n <= 10) return "7-10";
  if (n <= 20) return "11-20";
  if (n <= 30) return "21-30";
  if (n <= 50) return "31-50";
  return "51+";
}

/**
 * 힌트·추측 분포. 범위를 벗어난 hints는 버린다(이상값 방어).
 * 모든 칸을 0으로라도 채워 클라가 순서를 고정해 렌더할 수 있게 한다.
 */
export function buildDistribution(rows: ResultRow[]): Distribution {
  const hintDist = new Array<number>(MAX_HINTS + 1).fill(0);
  const guessDist: Record<string, number> = {};
  for (const b of GUESS_BUCKETS) guessDist[b] = 0;

  for (const r of rows) {
    if (Number.isInteger(r.hints) && r.hints >= 0 && r.hints <= MAX_HINTS) {
      hintDist[r.hints] += 1;
    }
    if (r.guesses >= 1) guessDist[guessBucket(r.guesses)] += 1;
  }

  return { hintDist, guessDist };
}
