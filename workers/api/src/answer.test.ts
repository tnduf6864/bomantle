import { test } from "node:test";
import assert from "node:assert/strict";
import type { Game } from "@bomantle/core";
import {
  buildAnswerPool,
  dailyAnswerFromSeed,
  kstDate,
  puzzleNumber,
  RESET_HOUR,
} from "./answer.ts";

function mk(over: Partial<Game>): Game {
  return {
    id: 0, name_ko: null, name_en: null, year: null, rank: null, rate: null,
    bgg_id: null, categories: [], mechanisms: [], weight: null,
    players_min: null, players_max: null, time_min: null, age: null, review_count: null,
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

test("buildAnswerPool: 자격 미달(평가<50·태그<2·weight 없음) 제외", () => {
  const games: Game[] = [
    mk({ id: 1, name_ko: "적격", rank: 10, weight: 2.5, categories: [1, 2], players_min: 2, review_count: 100 }),
    mk({ id: 2, name_ko: "평가부족", rank: 11, weight: 2.5, categories: [1, 2], players_min: 2, review_count: 10 }),
    mk({ id: 3, name_ko: "태그부족", rank: 12, weight: 2.5, categories: [1], players_min: 2, review_count: 100 }),
    mk({ id: 4, name_ko: "무게없음", rank: 13, weight: null, categories: [1, 2], players_min: 2, review_count: 100 }),
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
