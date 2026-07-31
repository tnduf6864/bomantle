// 보들(보드게임 Wordle)의 순수 로직. 저장·라우팅 없이 `node --test`로 돌린다.
// answer.ts / hint.ts / rank.ts 와 같은 패턴.
//
// 설계 근거와 측정치는 docs/bodle-plan.md 참고. 요약하면:
//  - 속성 피드백은 정보량이 과잉이라(추측 1회 = 5.17 bit / 전체 9.11 bit) 그대로 두면
//    완벽한 추론자가 평균 2.6회에 끝낸다. 그래서 **일부러 정밀도를 깎았다**.
//  - 깎은 결과가 TUNING. 평균 4.50회 / 6회내 82% (실제 Wordle: 평균 3.9~4.2회, 6회내 95%).
//  - 6회내 성공률이 100%가 아니라 동점 후보가 남기 때문에 시도는 8회를 준다.
//
// ⚠️ TUNING을 만지면 반드시 `node scripts/bodle-sim.mjs`를 돌려 평균과 6회내 성공률을
//    함께 확인할 것. 평균만 보면 "구분 불가능한 동점 후보" 문제를 놓친다.

import type { FullGame } from "./hint.ts";
import { buildAnswerPool, dailyAnswerFromSeed } from "./answer.ts";

/** 난이도 노브. 값 하나만 바꿔도 체감 난이도가 크게 움직인다(위 주석 참고). */
export const TUNING = {
  /** 시도 횟수. */
  maxGuesses: 8,
  /** 유형(types)은 하나만 겹쳐도 🟨 — 원소가 1~2개뿐이라 임계를 올릴 여지가 없다. */
  typesThreshold: 1,
  /** 테마·메커니즘은 2개 이상 겹쳐야 🟨. 1로 낮추면 평균 2.7회, 3으로 올리면 5.3회. */
  tagThreshold: 2,
  /** |Δweight| 이 이하면 🟩. */
  weightBand: 0.75,
  /** 🟩은 아니지만 이 안쪽이면 "근접"(테두리 강조). weightBand보다 커야 의미가 있다. */
  weightNearBand: 1.25,
  /** 같은 N년대면 🟩 (10 = 2010년대끼리). */
  yearGranularity: 10,
  /** 연대가 달라도 이 해 차 이내면 "근접". 2019 vs 2021 같은 경계 케이스를 잡는다. */
  yearNearYears: 3,
  /** 남은 후보 수를 보여주기 시작하는 추측 횟수. */
  remainingFromTurn: 3,
} as const;

/** 집합 열(유형·테마·메커니즘)의 판정. */
export type SetMark = "hit" | "partial" | "miss";
/** 수치 열(무게·연도)의 판정. unknown = 추측한 게임에 그 값이 없음. */
export type NumMark = "hit" | "up" | "down" | "unknown";

export interface BodleFeedback {
  types: SetMark;
  categories: SetMark;
  mechanisms: SetMark;
  weight: NumMark;
  /** 무게가 🟩은 아니지만 가까움. */
  weightNear: boolean;
  /** weight가 "hit"이고 **완전히 같은 값**일 때만 true. 화면 표시용(초록 vs 노랑) — 후보 좁히기(feedbackKey)는 밴드 판정만 쓰고 이 필드는 보지 않는다. */
  weightExact: boolean;
  /**
   * 화살표 표시 전용 방향. **밴드 판정(weight)과 독립적** — hit(밴드 안)이어도 완전히
   * 같은 값이 아니면 방향을 알려준다. 정확히 같으면 null(화살표 없음). feedbackKey는
   * 이 필드를 보지 않으므로 남은 후보 수·난이도에는 영향이 없다(표시 전용).
   */
  weightDir: "up" | "down" | null;
  year: NumMark;
  /** 연대는 다르지만 해 차가 작음. */
  yearNear: boolean;
  /** year가 "hit"이고 **완전히 같은 해**일 때만 true. weightExact와 같은 용도(표시 전용). */
  yearExact: boolean;
  /** weightDir과 같은 용도(표시 전용) — 연도 화살표. */
  yearDir: "up" | "down" | null;
}

/** 한 번의 추측과 그 결과. */
export interface BodleTurn {
  gameId: number;
  feedback: BodleFeedback;
  correct: boolean;
}

// --- 정답 선정 -------------------------------------------------------------

/**
 * 요일별 정답 풀 티어(평가 수 하한). 인덱스는 `Date.getUTCDay()` (0=일).
 * 월·화는 누구나 아는 게임(143개), 수·목은 중간(313개), 금·토·일은 전체(551개).
 * 주 초에 쉬운 판을 놓아 신규 유입이 첫 판에서 이탈하지 않게 하는 게 목적.
 */
export const TIER_BY_WEEKDAY = [50, 200, 200, 100, 100, 50, 50] as const;

/** 해당 퍼즐 날짜에 쓸 평가 수 하한. */
export function tierFor(date: string): number {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return TIER_BY_WEEKDAY[day] ?? 50;
}

/**
 * 보들 전용 시드.
 *
 * ⚠️ 접두사가 **없으면 보맨틀과 같은 날 같은 정답이 나온다.** 그러면 보맨틀의 8단계
 * 힌트(초성·카테고리·박스아트)가 보들의 정답을 그대로 흘린다. 이 게임에서 가장
 * 치명적인 함정이라 함수로 못 박아 두고 테스트로 지킨다.
 */
export function bodleSeed(date: string): string {
  return `bodle:${date}`;
}

/** 날짜별 보들 정답 풀(요일 티어 반영). */
export function bodlePool(games: FullGame[], date: string): number[] {
  return buildAnswerPool(games, 1200, tierFor(date));
}

/** 날짜 시드로 보들 정답 id 선택(KV 오버라이드 없을 때). */
export function bodleAnswerFromSeed(date: string, pool: number[]): number {
  return dailyAnswerFromSeed(bodleSeed(date), pool);
}

// --- 피드백 ---------------------------------------------------------------

function sameSet(a: readonly number[] | readonly string[], b: readonly number[] | readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set<unknown>(b);
  return a.every((x) => bs.has(x));
}

function overlap(a: readonly number[] | readonly string[], b: readonly number[] | readonly string[]): number {
  const bs = new Set<unknown>(b);
  let n = 0;
  for (const x of a) if (bs.has(x)) n += 1;
  return n;
}

function markSet(
  a: readonly number[] | readonly string[] | undefined,
  b: readonly number[] | readonly string[] | undefined,
  threshold: number,
): SetMark {
  const x = a ?? [];
  const y = b ?? [];
  // 양쪽 다 비어 있으면 "같다"고 볼 근거가 없다 — 정보가 없는 것이므로 miss.
  if (x.length === 0 || y.length === 0) return "miss";
  if (sameSet(x, y)) return "hit";
  return overlap(x, y) >= threshold ? "partial" : "miss";
}

/**
 * 출시연도 → 숫자. 없거나 파싱 불가면 NaN.
 * `year`가 `string | null`이라 `Number(null) === 0`(유한!)에 걸리기 쉽다 —
 * 그대로 두면 연도 없는 게임이 "서기 0년"으로 비교돼 항상 ⬆️가 나온다.
 */
function yearOf(g: FullGame): number {
  if (g.year == null || g.year === "") return NaN;
  const n = Number(g.year);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/**
 * 추측 하나에 대한 열별 판정. **정답을 아는 서버에서만 호출할 것** —
 * 클라이언트로 정답 속성을 내려보내면 DevTools로 즉시 털린다.
 */
export function compareBodle(guess: FullGame, answer: FullGame): BodleFeedback {
  const fb: BodleFeedback = {
    types: markSet(guess.types, answer.types, TUNING.typesThreshold),
    categories: markSet(guess.categories, answer.categories, TUNING.tagThreshold),
    mechanisms: markSet(guess.mechanisms, answer.mechanisms, TUNING.tagThreshold),
    weight: "unknown",
    weightNear: false,
    weightExact: false,
    weightDir: null,
    year: "unknown",
    yearNear: false,
    yearExact: false,
    yearDir: null,
  };

  if (guess.weight != null && answer.weight != null) {
    const d = answer.weight - guess.weight;
    fb.weightDir = d > 0 ? "up" : d < 0 ? "down" : null;
    if (Math.abs(d) <= TUNING.weightBand) {
      fb.weight = "hit";
      fb.weightExact = d === 0;
    } else {
      fb.weight = d > 0 ? "up" : "down";
      fb.weightNear = Math.abs(d) <= TUNING.weightNearBand;
    }
  }

  const gy = yearOf(guess);
  const ay = yearOf(answer);
  if (!Number.isNaN(gy) && !Number.isNaN(ay)) {
    fb.yearDir = ay > gy ? "up" : ay < gy ? "down" : null;
    const gd = Math.floor(gy / TUNING.yearGranularity);
    const ad = Math.floor(ay / TUNING.yearGranularity);
    if (gd === ad) {
      fb.year = "hit";
      fb.yearExact = gy === ay;
    } else {
      fb.year = ay > gy ? "up" : "down";
      fb.yearNear = Math.abs(ay - gy) <= TUNING.yearNearYears;
    }
  }

  return fb;
}

/** 피드백 동치 비교용 키. 남은 후보를 셀 때 쓴다. */
export function feedbackKey(fb: BodleFeedback): string {
  return [
    fb.types,
    fb.categories,
    fb.mechanisms,
    fb.weight,
    fb.weightNear ? "n" : "-",
    fb.year,
    fb.yearNear ? "n" : "-",
  ].join("|");
}

// --- 남은 후보 수 ----------------------------------------------------------

/**
 * 지금까지의 단서에 모순되지 않는 정답 후보 수.
 *
 * **개수만 돌려준다. 목록은 절대 노출하지 않는다** — 목록을 주면 눈으로 훑는 노동이
 * 되어 게임이 죽는다. 개수만 주면 551 → 12로 좁혀지는 진행감과 압박이 남는다.
 * (docs/bodle-plan.md 4-1)
 *
 * 이미 추측해 틀린 게임은 후보에서 뺀다. 정답 자신은 항상 후보에 남으므로 결과는 1 이상.
 */
export function remainingCount(
  poolGames: FullGame[],
  guesses: FullGame[],
  answer: FullGame,
): number {
  const guessed = new Set(guesses.map((g) => g.id));
  // 정답 기준 피드백을 미리 계산해 후보마다 재계산하지 않는다.
  const want = guesses.map((g) => [g, feedbackKey(compareBodle(g, answer))] as const);

  let n = 0;
  for (const cand of poolGames) {
    if (guessed.has(cand.id) && cand.id !== answer.id) continue;
    if (want.every(([g, key]) => feedbackKey(compareBodle(g, cand)) === key)) n += 1;
  }
  return n;
}

// --- 요청 검증 -------------------------------------------------------------

/**
 * `{ guesses: number[] }` 본문을 검증한다. 클라는 **추측 id 목록만** 저장하고 매번
 * 전체를 보내며, 피드백은 서버가 매번 재생성한다. 새로고침 복원이 "id 목록 재생"으로
 * 끝나 클라에 피드백 상태를 두지 않아도 된다.
 *
 * 범위를 벗어나면 클램프가 아니라 거부한다(rank.ts sanitizeSubmission과 같은 원칙).
 * @returns 유효하면 id 배열, 아니면 null (호출부에서 400)
 */
export function sanitizeGuesses(body: unknown): number[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>).guesses;
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > TUNING.maxGuesses) return null;

  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
    out.push(v);
  }
  // 같은 게임을 두 번 세면 추측 횟수가 부풀려진다.
  if (new Set(out).size !== out.length) return null;
  return out;
}
