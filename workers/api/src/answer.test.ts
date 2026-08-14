import { test } from "node:test";
import assert from "node:assert/strict";
import type { Game } from "@bomantle/core";
import {
  baseName,
  buildAnswerPool,
  dailyAnswerFromSeed,
  kstDate,
  POOL_MAX_RANK,
  puzzleNumber,
  RESET_HOUR,
} from "./answer.ts";

function mk(over: Partial<Game>): Game {
  return {
    id: 0, name_ko: null, name_en: null, year: null, rank: null, rate: null,
    bgg_id: null, categories: [], mechanisms: [], weight: null,
    players_min: null, players_max: null, time_min: null, time_max: null, age: null,
    review_count: null,
    ...over,
  };
}

test("puzzleNumber: EPOCH(2026-01-01)=1, 다음날=2", () => {
  assert.equal(puzzleNumber("2026-01-01"), 1);
  assert.equal(puzzleNumber("2026-01-02"), 2);
});

test("kstDate: 오전 9시(RESET_HOUR) 경계로 날짜가 넘어감", () => {
  assert.equal(RESET_HOUR, 9);
  // 08:59 KST → 아직 전날 퍼즐
  assert.equal(kstDate(new Date("2026-07-03T08:59:00+09:00")), "2026-07-02");
  // 09:00 KST → 당일 퍼즐
  assert.equal(kstDate(new Date("2026-07-03T09:00:00+09:00")), "2026-07-03");
});

test("dailyAnswerFromSeed: 같은 날짜는 결정론적, 항상 풀 안에서 선택", () => {
  const pool = [11, 22, 33, 44, 55];
  const a = dailyAnswerFromSeed("2026-07-03", pool);
  assert.equal(a, dailyAnswerFromSeed("2026-07-03", pool)); // 재현성
  assert.ok(pool.includes(a));
  assert.ok(pool.includes(dailyAnswerFromSeed("2026-07-04", pool)));
});

/** EPOCH(퍼즐 1번)부터 n일치 정답을 순서대로. */
function run(pool: number[], days: number, from = "2026-01-01"): number[] {
  const start = Date.parse(from + "T00:00:00Z");
  return Array.from({ length: days }, (_, i) =>
    dailyAnswerFromSeed(new Date(start + i * 86_400_000).toISOString().slice(0, 10), pool),
  );
}

test("dailyAnswerFromSeed: 한 사이클(풀 크기) 안에서는 정답이 절대 겹치지 않는다", () => {
  // 예전 날짜-해시 방식이 5일 만에 같은 답을 내던 자리 — 순열 소진으로 구조적 차단.
  const pool = Array.from({ length: 60 }, (_, i) => i + 1);
  const cycle = run(pool, pool.length);
  assert.equal(new Set(cycle).size, pool.length);
  assert.deepEqual([...cycle].sort((a, b) => a - b), pool); // 풀 전체를 정확히 한 번씩
});

test("dailyAnswerFromSeed: 다음 사이클은 순서가 다시 섞인다", () => {
  const pool = Array.from({ length: 60 }, (_, i) => i + 1);
  const all = run(pool, pool.length * 2);
  const first = all.slice(0, pool.length);
  const second = all.slice(pool.length);
  assert.equal(new Set(second).size, pool.length); // 둘째 사이클도 무중복
  assert.notDeepEqual(first, second); // 같은 순서 반복이 아니다
});

test("dailyAnswerFromSeed: EPOCH 이전 날짜(퍼즐 번호 음수)도 풀 안에서 선택", () => {
  const pool = [11, 22, 33, 44, 55];
  for (const d of ["2025-12-31", "2025-06-01", "2024-01-01"]) {
    assert.ok(pool.includes(dailyAnswerFromSeed(d, pool)), d);
  }
});

test("dailyAnswerFromSeed: 빈 풀은 조용한 undefined 대신 에러", () => {
  assert.throws(() => dailyAnswerFromSeed("2026-07-03", []));
});

test("baseName: 부제·판 표기를 떼어 시리즈 키를 만든다", () => {
  const of = (name_ko: string) => baseName(mk({ name_ko }));
  assert.equal(of("브라스: 버밍엄"), "브라스");
  assert.equal(of("브라스: 랭커셔"), "브라스");
  assert.equal(of("도미니언 (2판)"), "도미니언");
  assert.equal(of("엑시트: 더 게임 - 파라오의 무덤"), "엑시트");
  assert.equal(of("카탄"), "카탄"); // 부제 없는 이름은 그대로
});

test("baseName: 시리즈가 다르면 키도 다르다 (같은 시리즈 오탐 방지)", () => {
  const of = (name_ko: string) => baseName(mk({ name_ko }));
  assert.notEqual(of("브라스: 버밍엄"), of("아그리콜라"));
  // 앞부분이 겹쳐도 단어가 다르면 갈린다
  assert.notEqual(of("아컴 호러"), of("아컴 호러의 밤")); // 부제 구분자가 없으면 별개
});

test("baseName: 이름이 없으면 id로 떨어져 서로 묶이지 않는다", () => {
  assert.equal(baseName(mk({ id: 7, name_ko: null, name_en: null })), "7");
  assert.notEqual(
    baseName(mk({ id: 7, name_ko: null, name_en: null })),
    baseName(mk({ id: 8, name_ko: null, name_en: null })),
  );
});

test("buildAnswerPool: 자격 미달(평가<50·태그<2·weight 없음) 제외", () => {
  const games: Game[] = [
    mk({ id: 1, name_ko: "적격", rank: 10, weight: 2.5, categories: [1, 2], players_min: 2, review_count: 100 }),
    mk({ id: 2, name_ko: "평가부족", rank: 11, weight: 2.5, categories: [1, 2], players_min: 2, review_count: 10 }),
    mk({ id: 3, name_ko: "태그부족", rank: 12, weight: 2.5, categories: [1], players_min: 2, review_count: 100 }),
    mk({ id: 4, name_ko: "무게없음", rank: 13, weight: null, categories: [1, 2], players_min: 2, review_count: 100 }),
  ];
  assert.deepEqual(buildAnswerPool(games), [1]);
});

test("buildAnswerPool: 순위가 POOL_MAX_RANK 밖이면 제외 (전수 크롤 유입분 차단)", () => {
  const base = { weight: 2.5, categories: [1, 2], players_min: 2, review_count: 100 };
  const games: Game[] = [
    mk({ id: 1, name_ko: "목록권", rank: POOL_MAX_RANK, ...base }),
    mk({ id: 2, name_ko: "목록밖", rank: POOL_MAX_RANK + 1, ...base }),
    mk({ id: 3, name_ko: "순위없음", rank: null, ...base }),
  ];
  assert.deepEqual(buildAnswerPool(games), [1]);
});

test("buildAnswerPool: 같은 프랜차이즈는 최상위 1개만 (아줄 > 아줄:신트라)", () => {
  const games: Game[] = [
    mk({ id: 1, name_ko: "아줄: 신트라의 스테인드글라스", rank: 50, weight: 2, categories: [1, 2], players_min: 2, review_count: 100 }),
    mk({ id: 2, name_ko: "아줄", rank: 20, weight: 2, categories: [1, 2], players_min: 2, review_count: 100 }),
  ];
  assert.deepEqual(buildAnswerPool(games), [2]);
});

test("buildAnswerPool: 랭킹 오름차순 정렬 + limit 적용", () => {
  const games: Game[] = [3, 1, 2].map((r) =>
    mk({ id: r, name_ko: `게임${r}`, rank: r, weight: 2, categories: [1, 2], players_min: 2, review_count: 100 }),
  );
  assert.deepEqual(buildAnswerPool(games), [1, 2, 3]);
  assert.deepEqual(buildAnswerPool(games, 2), [1, 2]);
});
