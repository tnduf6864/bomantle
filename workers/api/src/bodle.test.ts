import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildAnswerPool, dailyAnswerFromSeed } from "./answer.ts";
import type { FullGame } from "./hint.ts";
import {
  TUNING,
  TIER_BY_WEEKDAY,
  tierFor,
  bodleSeed,
  bodlePool,
  bodleAnswerFromSeed,
  compareBodle,
  feedbackKey,
  remainingCount,
  sanitizeGuesses,
} from "./bodle.ts";

const here = dirname(fileURLToPath(import.meta.url));
const games: FullGame[] = JSON.parse(
  readFileSync(resolve(here, "games.json"), "utf-8"),
);

function mk(over: Partial<FullGame>): FullGame {
  return {
    id: 0, name_ko: null, name_en: null, year: null, rank: null, rate: null,
    bgg_id: null, categories: [], mechanisms: [], weight: null,
    players_min: null, players_max: null, time_min: null, age: null,
    review_count: null, types: [],
    ...over,
  };
}

// --- 정답 시드 분리 (가장 중요) --------------------------------------------

test("보들 시드는 보맨틀과 접두사로 분리된다", () => {
  assert.equal(bodleSeed("2026-08-01"), "bodle:2026-08-01");
  assert.notEqual(bodleSeed("2026-08-01"), "2026-08-01");
});

test("같은 날 보맨틀과 보들의 정답이 (거의 항상) 다르다", () => {
  // 접두사를 빼먹으면 보맨틀 8단계 힌트가 보들 정답을 그대로 흘린다.
  // 우연한 충돌은 1/풀크기 확률로 가능하므로 "1년 중 대부분"으로 검증한다.
  const pool = buildAnswerPool(games);
  let same = 0;
  for (let i = 0; i < 365; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    if (dailyAnswerFromSeed(date, pool) === bodleAnswerFromSeed(date, pool)) same += 1;
  }
  assert.ok(same <= 3, `보맨틀과 정답이 겹친 날이 ${same}일 — 시드 분리를 확인할 것`);
});

test("정답 선정은 결정론적이다", () => {
  const pool = buildAnswerPool(games);
  assert.equal(
    bodleAnswerFromSeed("2026-08-01", pool),
    bodleAnswerFromSeed("2026-08-01", pool),
  );
});

// --- 요일 티어 -------------------------------------------------------------

test("요일 티어: 월화=200, 수목=100, 금토일=50", () => {
  assert.deepEqual([...TIER_BY_WEEKDAY], [50, 200, 200, 100, 100, 50, 50]);
  // 2026-08-03 = 월요일
  assert.equal(tierFor("2026-08-03"), 200); // 월
  assert.equal(tierFor("2026-08-04"), 200); // 화
  assert.equal(tierFor("2026-08-05"), 100); // 수
  assert.equal(tierFor("2026-08-06"), 100); // 목
  assert.equal(tierFor("2026-08-07"), 50);  // 금
  assert.equal(tierFor("2026-08-08"), 50);  // 토
  assert.equal(tierFor("2026-08-09"), 50);  // 일
});

test("티어가 높을수록 정답 풀이 좁아진다", () => {
  const mon = bodlePool(games, "2026-08-03"); // 200
  const wed = bodlePool(games, "2026-08-05"); // 100
  const fri = bodlePool(games, "2026-08-07"); // 50
  assert.ok(mon.length < wed.length, `${mon.length} < ${wed.length}`);
  assert.ok(wed.length < fri.length, `${wed.length} < ${fri.length}`);

  // 부분집합은 아니다: 프랜차이즈 대표를 "필터 통과분 중 최상위"로 뽑으므로,
  // 티어가 높아지면 대표가 다른 형제로 바뀔 수 있다(아그리콜라 → 아그리콜라: 가족용).
  // 실제로 보장해야 하는 건 "월요일엔 인지도 높은 게임만 나온다"는 것.
  const byId = new Map(games.map((g) => [g.id, g]));
  assert.ok(mon.every((id) => (byId.get(id)!.review_count ?? 0) >= 200));
  assert.ok(fri.every((id) => (byId.get(id)!.review_count ?? 0) >= 50));
});

test("월요일 풀도 한 달 이상 돌 만큼은 된다", () => {
  assert.ok(bodlePool(games, "2026-08-03").length >= 100);
});

// --- 피드백 ---------------------------------------------------------------

test("집합 열: 내 태그가 전부 있으면 hit, 일부면 partial, 없으면 miss", () => {
  const base = { weight: 3, year: "2018" };
  const g = (categories: number[]) => mk({ ...base, categories });

  assert.equal(compareBodle(g([1, 2, 3]), g([1, 2, 3])).categories, "hit");
  // 내 태그가 전부 정답에도 있으면 정답이 더 갖고 있어도 hit
  assert.equal(compareBodle(g([1, 2]), g([1, 2, 3])).categories, "hit");
  assert.equal(compareBodle(g([1, 2, 9]), g([1, 2, 3])).categories, "partial");
  // 1개만 겹쳐도 partial — 예전 임계 2에서는 miss로 뭉개졌다
  assert.equal(compareBodle(g([1, 8, 9]), g([1, 2, 3])).categories, "partial");
  assert.equal(compareBodle(g([7, 8, 9]), g([1, 2, 3])).categories, "miss");
});

test("집합 열: 겹친 태그를 그대로 돌려준다 (추측한 순서 유지)", () => {
  const g = (categories: number[]) => mk({ categories });
  const fb = compareBodle(g([9, 3, 7, 1]), g([1, 2, 3]));
  assert.deepEqual(fb.categoriesHit, [3, 1]); // 내가 낸 순서대로
  assert.equal(fb.categories, "partial");

  // 하나도 안 겹치면 빈 배열
  assert.deepEqual(compareBodle(g([7, 8]), g([1, 2])).categoriesHit, []);
  // 비교 불가(unknown)도 빈 배열
  assert.deepEqual(compareBodle(mk({}), g([1, 2])).categoriesHit, []);
});

test("겹친 태그 목록에는 내가 내지 않은 정답 태그가 절대 들어가지 않는다", () => {
  const fb = compareBodle(
    mk({ types: ["전략게임"], categories: [1], mechanisms: [5] }),
    mk({ types: ["전략게임", "가족게임"], categories: [1, 2, 3], mechanisms: [5, 6] }),
  );
  assert.deepEqual(fb.typesHit, ["전략게임"]);
  assert.deepEqual(fb.categoriesHit, [1]);
  assert.deepEqual(fb.mechanismsHit, [5]);
});

test("유형: 원소가 1~2개뿐이라 하나만 겹쳐도 partial", () => {
  const a = mk({ types: ["전략게임", "가족게임"] });
  const b = mk({ types: ["전략게임"] });
  assert.equal(compareBodle(a, b).types, "partial"); // 가족게임은 정답에 없음
  assert.equal(compareBodle(b, a).types, "hit"); // 내 태그(전략게임)는 전부 있음
  assert.equal(compareBodle(b, b).types, "hit");
  assert.equal(compareBodle(mk({ types: ["파티게임"] }), b).types, "miss");
});

test("빈 집합은 hit도 miss도 아닌 unknown (비교 불가)", () => {
  assert.equal(compareBodle(mk({}), mk({})).categories, "unknown");
  assert.equal(compareBodle(mk({}), mk({})).mechanisms, "unknown");
});

test("한쪽만 태그가 없어도 unknown — 정답에 없으면 어떤 추측도 판정될 수 없다", () => {
  const tagged = mk({ categories: [1, 2, 3], mechanisms: [4, 5] });
  const bare = mk({});
  // 정답에 태그가 없는 경우
  assert.equal(compareBodle(tagged, bare).categories, "unknown");
  // 추측한 게임에 태그가 없는 경우
  assert.equal(compareBodle(bare, tagged).categories, "unknown");
  assert.equal(compareBodle(bare, tagged).mechanisms, "unknown");
});

test("무게: 밴드 안이면 hit, 밖이면 up/down + 근접 표시", () => {
  const w = (weight: number) => mk({ weight });
  // |Δ| <= 0.75 → hit
  assert.equal(compareBodle(w(3.0), w(3.7)).weight, "hit");
  // 정답이 더 무거우면 up
  const up = compareBodle(w(2.0), w(3.0));
  assert.equal(up.weight, "up");
  assert.equal(up.weightNear, true); // |Δ|=1.0 <= 1.25
  // 정답이 더 가벼우면 down, 멀면 근접 아님
  const down = compareBodle(w(4.5), w(2.0));
  assert.equal(down.weight, "down");
  assert.equal(down.weightNear, false);
});

test("무게: hit이어도 완전히 같은 값이 아니면 weightExact는 false (화면 초록/노랑 구분용)", () => {
  const w = (weight: number) => mk({ weight });
  // 밴드 안(hit)이지만 값이 다름 → 화면에선 노랑
  const near = compareBodle(w(3.0), w(3.7));
  assert.equal(near.weight, "hit");
  assert.equal(near.weightExact, false);
  // 완전히 같은 값 → 화면에선 초록
  const exact = compareBodle(w(3.7), w(3.7));
  assert.equal(exact.weight, "hit");
  assert.equal(exact.weightExact, true);
  // hit이 아니면 weightExact는 항상 false
  assert.equal(compareBodle(w(2.0), w(3.0)).weightExact, false);
});

test("연도: 해 차 밴드 안이면 hit, 밖이면 up/down + 근접 표시", () => {
  const y = (year: string) => mk({ year });
  assert.equal(compareBodle(y("2014"), y("2018")).year, "hit"); // 4년 차 <= 5
  // 밴드 밖, 정답이 더 최근 → up
  const near = compareBodle(y("2012"), y("2019"));
  assert.equal(near.year, "up");
  assert.equal(near.yearNear, true); // 7년 차 <= 8
  // 멀면 근접 아님
  const far = compareBodle(y("2005"), y("2021"));
  assert.equal(far.year, "up");
  assert.equal(far.yearNear, false);
  assert.equal(compareBodle(y("2021"), y("2005")).year, "down");
});

test("연도: 연대 경계에서 근접도가 뒤집히지 않는다", () => {
  const y = (year: string) => mk({ year });
  // 정답 2019 기준 — 2년 차가 9년 차보다 반드시 가깝게 판정돼야 한다.
  const close = compareBodle(y("2021"), y("2019")); // 2년 차, 연대는 다름
  const farInSameDecade = compareBodle(y("2010"), y("2019")); // 9년 차, 예전 규칙이면 hit
  assert.equal(close.year, "hit");
  assert.equal(farInSameDecade.year, "up");
  assert.equal(farInSameDecade.yearNear, false); // 9년 차는 근접(<=8)에도 못 든다
});

test("연도: hit이어도 완전히 같은 해가 아니면 yearExact는 false", () => {
  const y = (year: string) => mk({ year });
  const near = compareBodle(y("2014"), y("2018")); // 밴드 안, 다른 해
  assert.equal(near.year, "hit");
  assert.equal(near.yearExact, false);
  const exact = compareBodle(y("2018"), y("2018"));
  assert.equal(exact.year, "hit");
  assert.equal(exact.yearExact, true);
});

test("weightDir/yearDir: 밴드(hit) 안이어도 완전히 같지 않으면 방향을 알려준다", () => {
  const w = (weight: number) => mk({ weight });
  // 밴드 안(hit)인데 정답이 더 무거움 → up
  const up = compareBodle(w(3.0), w(3.5));
  assert.equal(up.weight, "hit");
  assert.equal(up.weightDir, "up");
  // 밴드 안인데 정답이 더 가벼움 → down
  const down = compareBodle(w(3.5), w(3.0));
  assert.equal(down.weight, "hit");
  assert.equal(down.weightDir, "down");
  // 완전히 같으면 방향 없음
  assert.equal(compareBodle(w(3.5), w(3.5)).weightDir, null);
  // 밴드 밖(miss)이어도 mark와 같은 방향을 준다
  assert.equal(compareBodle(w(2.0), w(3.0)).weightDir, "up");
  assert.equal(compareBodle(w(4.5), w(2.0)).weightDir, "down");
});

test("yearDir: 밴드(hit) 안이어도 완전히 같지 않으면 방향을 알려준다", () => {
  const y = (year: string) => mk({ year });
  const up = compareBodle(y("2014"), y("2018")); // 밴드 안, 정답이 더 최근
  assert.equal(up.year, "hit");
  assert.equal(up.yearDir, "up");
  const down = compareBodle(y("2018"), y("2014"));
  assert.equal(down.year, "hit");
  assert.equal(down.yearDir, "down");
  assert.equal(compareBodle(y("2018"), y("2018")).yearDir, null);
});

test("weightDir/yearDir: 값이 없으면(unknown) 방향도 없다", () => {
  const fb = compareBodle(mk({}), mk({ weight: 3, year: "2018" }));
  assert.equal(fb.weightDir, null);
  assert.equal(fb.yearDir, null);
});

test("값이 없으면 unknown (추측한 게임에 무게·연도가 없는 경우)", () => {
  const fb = compareBodle(mk({}), mk({ weight: 3, year: "2018" }));
  assert.equal(fb.weight, "unknown");
  assert.equal(fb.year, "unknown");
});

test("정답을 그대로 추측하면 모든 열이 hit", () => {
  const ans = games.find((g) => g.name_ko === "브라스: 버밍엄")!;
  const fb = compareBodle(ans, ans);
  assert.equal(fb.types, "hit");
  assert.equal(fb.categories, "hit");
  assert.equal(fb.mechanisms, "hit");
  assert.equal(fb.weight, "hit");
  assert.equal(fb.year, "hit");
  assert.equal(fb.weightExact, true);
  assert.equal(fb.yearExact, true);
});

test("feedbackKey는 서로 다른 판정을 구분한다", () => {
  const a = compareBodle(mk({ weight: 2, year: "2010" }), mk({ weight: 4, year: "2020" }));
  const b = compareBodle(mk({ weight: 4, year: "2020" }), mk({ weight: 2, year: "2010" }));
  assert.notEqual(feedbackKey(a), feedbackKey(b)); // up vs down
});

// --- 남은 후보 수 ----------------------------------------------------------

test("남은 후보는 추측할수록 줄고, 정답은 끝까지 남는다", () => {
  const date = "2026-08-07"; // 금 = 가장 넓은 풀
  const pool = bodlePool(games, date);
  const byId = new Map(games.map((g) => [g.id, g]));
  const poolGames = pool.map((id) => byId.get(id)!);
  const answer = byId.get(bodleAnswerFromSeed(date, pool))!;

  const guesses: FullGame[] = [];
  let prev = remainingCount(poolGames, guesses, answer);
  assert.equal(prev, poolGames.length); // 추측 전에는 풀 전체

  for (const g of poolGames.slice(0, 6)) {
    if (g.id === answer.id) continue;
    guesses.push(g);
    const now = remainingCount(poolGames, guesses, answer);
    assert.ok(now <= prev, `후보가 늘었다: ${prev} → ${now}`);
    assert.ok(now >= 1, "정답이 후보에서 사라졌다");
    prev = now;
  }
  // 6번쯤 찍으면 눈에 띄게 좁혀져 있어야 한다.
  assert.ok(prev < poolGames.length / 2, `충분히 좁혀지지 않음: ${prev}`);
});

test("이미 추측한 오답은 후보에서 빠진다", () => {
  const answer = mk({ id: 1, weight: 3, year: "2018", categories: [1, 2], types: ["전략게임"] });
  const twin = mk({ id: 2, weight: 3, year: "2018", categories: [1, 2], types: ["전략게임"] });
  const poolGames = [answer, twin];
  // 쌍둥이는 정답과 피드백이 구분되지 않지만, 추측해 버리면 후보에서 빠진다.
  assert.equal(remainingCount(poolGames, [], answer), 2);
  assert.equal(remainingCount(poolGames, [twin], answer), 1);
});

// --- 요청 검증 -------------------------------------------------------------

test("sanitizeGuesses: 정상 입력", () => {
  assert.deepEqual(sanitizeGuesses({ guesses: [1, 2, 3] }), [1, 2, 3]);
});

test("sanitizeGuesses: 잘못된 입력은 거부한다", () => {
  assert.equal(sanitizeGuesses(null), null);
  assert.equal(sanitizeGuesses({}), null);
  assert.equal(sanitizeGuesses({ guesses: [] }), null);
  assert.equal(sanitizeGuesses({ guesses: "1,2" }), null);
  assert.equal(sanitizeGuesses({ guesses: [1.5] }), null);
  assert.equal(sanitizeGuesses({ guesses: [-1] }), null);
  // 같은 게임 중복 — 추측 횟수가 부풀려진다
  assert.equal(sanitizeGuesses({ guesses: [1, 1] }), null);
  // 시도 횟수 초과
  const tooMany = Array.from({ length: TUNING.maxGuesses + 1 }, (_, i) => i);
  assert.equal(sanitizeGuesses({ guesses: tooMany }), null);
});

test("sanitizeGuesses: 최대 시도까지는 받는다", () => {
  const max = Array.from({ length: TUNING.maxGuesses }, (_, i) => i);
  assert.deepEqual(sanitizeGuesses({ guesses: max }), max);
});
