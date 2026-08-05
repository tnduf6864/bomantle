// 보들(보드게임 Wordle)의 순수 로직. 저장·라우팅 없이 `node --test`로 돌린다.
// answer.ts / hint.ts / rank.ts 와 같은 패턴.
//
// 설계 근거는 docs/bodle-plan.md 참고.
//
// 태그 열(유형·테마·진행방식)은 **겹친 태그를 그대로 공개**한다. 예전에는 "몇 개
// 겹쳤나"만 집계해 hit/partial/miss로 뭉갰는데, 임계 2 때문에 정답 풀 313개의 모든 쌍
// 중 테마가 🟨 이상인 경우가 3.8%뿐이라 **화면 5칸 중 2칸이 사실상 항상 회색**이었다.
// (게다가 회색의 26%는 실제로 1개가 겹친 경우라 "안 겹침"이 거짓말이었다.)
// 워들이 글자 단위로 알려주듯 태그 단위로 알려주는 게 이 게임의 원래 모양이다.
//
// 실측(정답 풀 313개 / 최적 플레이 300판):
//   예전 집계 방식  평균 3.20회 · 4회내 94%
//   태그 공개 방식  평균 2.59회 · 4회내 100%  ← 그래서 시도를 8 → 6으로 줄였다
//
// ⚠️ TUNING을 만지면 난이도를 반드시 다시 잴 것. `scripts/bodle-sim.mjs`는 설계 탐색용
//    근사치(4열·near 없음)라 실측과 다르다 — 아래 compareBodle/feedbackKey를 그대로
//    쓰는 시뮬레이터로 재야 한다. 평균만 보면 "구분 불가능한 동점 후보" 문제를 놓친다.

import type { FullGame } from "./hint.ts";
import { buildAnswerPool, dailyAnswerFromSeed } from "./answer.ts";

/** 난이도 노브. 값 하나만 바꿔도 체감 난이도가 크게 움직인다(위 주석 참고). */
export const TUNING = {
  /**
   * 시도 횟수.
   *
   * 태그 열이 "겹친 태그를 그대로 공개"하는 구조로 바뀌면서 8 → 6으로 줄였다.
   * 8을 유지하면 최적 플레이 기준 **4회 안에 100%** 끝나서 긴장이 남지 않는다.
   */
  maxGuesses: 6,
  /** |Δweight| 이 이하면 🟩. */
  weightBand: 0.75,
  /** 🟩은 아니지만 이 안쪽이면 "근접"(테두리 강조). weightBand보다 커야 의미가 있다. */
  weightNearBand: 1.25,
  /**
   * |Δ연도| 이 이하면 🟩.
   *
   * ⚠️ 예전에는 "같은 연대(10년 단위)"였는데, 그러면 근접도가 **뒤집힌다**:
   * 정답 2019에 대해 2010(9년 차)은 같은 201x라 🟩인데 2021(2년 차)은 202x라 ⬜였다.
   * 플레이어는 2021을 보고 "멀어졌다"고 읽고 반대 방향으로 좁힌다. 무게와 같은
   * "차이 기준" 밴드로 바꿔서 화면의 가까움과 실제 가까움을 일치시킨다.
   */
  yearBand: 5,
  /** 🟩은 아니지만 이 해 차 이내면 "근접"(테두리 강조). yearBand보다 커야 의미가 있다. */
  yearNearYears: 8,
  /** 남은 후보 수를 보여주기 시작하는 추측 횟수. */
  remainingFromTurn: 3,
} as const;

/**
 * 집합 열(유형·테마·메커니즘)의 요약 판정. 화면의 "n/m" 색과 공유 이모지에 쓴다.
 * 실제 단서는 아래 `*Hit`(겹친 태그 목록)이고, 이건 그걸 한 글자로 줄인 것이다.
 *
 * - hit     = 내가 낸 태그가 **전부** 정답에도 있음 (정답이 더 갖고 있을 수는 있다)
 * - partial = 일부만 있음
 * - miss    = 하나도 없음
 * - unknown = 양쪽 중 한쪽에 태그가 아예 없어 **비교 자체가 불가능**(miss와 구분해야 한다)
 */
export type SetMark = "hit" | "partial" | "miss" | "unknown";
/** 수치 열(무게·연도)의 판정. unknown = 추측한 게임에 그 값이 없음. */
export type NumMark = "hit" | "up" | "down" | "unknown";

export interface BodleFeedback {
  types: SetMark;
  categories: SetMark;
  mechanisms: SetMark;
  /**
   * **내 추측의 태그 중 정답에도 있는 것**(교집합만). 정답의 전체 태그가 아니다 —
   * 내가 내지 않은 태그는 절대 새지 않는다. 워들이 내가 친 글자에 대해서만
   * 초록·노랑을 알려주는 것과 같다.
   */
  typesHit: string[];
  categoriesHit: number[];
  mechanismsHit: number[];
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

/**
 * 집합 열 판정. **내가 낸 태그 중 정답에도 있는 것들**과 그 요약을 함께 돌려준다.
 *
 * 순서는 추측한 게임의 태그 순서를 그대로 따른다 — 화면에서 칩을 원래 순서로
 * 늘어놓고 맞은 것만 표시하기 때문에, 여기서 정렬해 버리면 순서가 어긋난다.
 */
function markSet<T extends number | string>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
): { mark: SetMark; hit: T[] } {
  const x = a ?? [];
  const y = b ?? [];
  /*
   * 한쪽이라도 비어 있으면 비교할 근거가 없다 → unknown.
   * miss로 뭉개면 플레이어가 "내 추측이 빗나갔다"로 읽는데, 정답에 그 태그가 아예
   * 없는 판에서는 **무슨 게임을 넣어도 끝까지 ⬜**라 헛다리만 짚게 된다.
   */
  if (x.length === 0 || y.length === 0) return { mark: "unknown", hit: [] };

  const ys = new Set<unknown>(y);
  const hit = x.filter((v) => ys.has(v));
  // hit = "내가 낸 태그가 전부 정답에도 있음". 정답이 더 갖고 있어도 초록이다 —
  // 집합이 완전히 같을 때만 초록으로 두면 태그 3~5개짜리끼리는 사실상 도달 불가였다.
  const mark: SetMark = hit.length === x.length ? "hit" : hit.length > 0 ? "partial" : "miss";
  return { mark, hit };
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
  const t = markSet(guess.types, answer.types);
  const c = markSet(guess.categories, answer.categories);
  const m = markSet(guess.mechanisms, answer.mechanisms);

  const fb: BodleFeedback = {
    types: t.mark,
    categories: c.mark,
    mechanisms: m.mark,
    typesHit: t.hit,
    categoriesHit: c.hit,
    mechanismsHit: m.hit,
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
    const d = ay - gy;
    fb.yearDir = d > 0 ? "up" : d < 0 ? "down" : null;
    if (Math.abs(d) <= TUNING.yearBand) {
      fb.year = "hit";
      fb.yearExact = d === 0;
    } else {
      fb.year = d > 0 ? "up" : "down";
      fb.yearNear = Math.abs(d) <= TUNING.yearNearYears;
    }
  }

  return fb;
}

/**
 * 피드백 동치 비교용 키. 남은 후보를 셀 때 쓴다.
 *
 * **겹친 태그 목록까지 포함해야 한다** — 화면이 "어느 태그가 맞았는지"를 보여주므로,
 * 목록이 다르면 플레이어에게 서로 다른 판으로 보인다. 요약(mark)만 비교하면 실제보다
 * 후보를 많이 세게 되고, 반대로 목록만 비교하면 unknown과 miss를 구분하지 못한다.
 */
export function feedbackKey(fb: BodleFeedback): string {
  return [
    fb.types,
    fb.typesHit.join(","),
    fb.categories,
    fb.categoriesHit.join(","),
    fb.mechanisms,
    fb.mechanismsHit.join(","),
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
