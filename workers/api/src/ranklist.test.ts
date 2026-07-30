import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage, sliceRanking, DEFAULT_LIMIT, MAX_LIMIT } from "./ranklist.ts";
import type { ScoredGame } from "@bomantle/core";

const ranking: ScoredGame[] = Array.from({ length: 250 }, (_, i) => ({
  id: 1000 + i,
  score: 100 - i * 0.1,
}));

const q = (s: string) => new URLSearchParams(s);

test("쿼리가 없으면 첫 페이지 기본값", () => {
  assert.deepEqual(parsePage(q(""), ranking.length), { offset: 0, limit: DEFAULT_LIMIT });
});

test("offset·limit을 정수로 읽는다", () => {
  assert.deepEqual(parsePage(q("offset=100&limit=50"), ranking.length), {
    offset: 100,
    limit: 50,
  });
});

test("limit은 1~MAX_LIMIT으로 잘린다", () => {
  assert.equal(parsePage(q("limit=9999"), ranking.length).limit, MAX_LIMIT);
  assert.equal(parsePage(q("limit=0"), ranking.length).limit, 1);
  assert.equal(parsePage(q("limit=-5"), ranking.length).limit, 1);
});

test("offset은 0~total로 잘린다", () => {
  assert.equal(parsePage(q("offset=-10"), ranking.length).offset, 0);
  assert.equal(parsePage(q("offset=99999"), ranking.length).offset, ranking.length);
});

test("숫자가 아니거나 빈 값이면 기본값으로 떨어진다", () => {
  assert.deepEqual(parsePage(q("offset=abc&limit=xyz"), ranking.length), {
    offset: 0,
    limit: DEFAULT_LIMIT,
  });
  assert.deepEqual(parsePage(q("offset=&limit="), ranking.length), {
    offset: 0,
    limit: DEFAULT_LIMIT,
  });
});

test("소수는 내림 처리", () => {
  assert.deepEqual(parsePage(q("offset=10.9&limit=20.7"), ranking.length), {
    offset: 10,
    limit: 20,
  });
});

test("페이지를 순서대로 이어붙이면 원본 랭킹과 같다", () => {
  const first = sliceRanking(ranking, { offset: 0, limit: 100 });
  const second = sliceRanking(ranking, { offset: 100, limit: 100 });
  const third = sliceRanking(ranking, { offset: 200, limit: 100 });
  assert.equal(first.length, 100);
  assert.equal(third.length, 50); // 마지막 페이지는 남은 만큼만
  assert.deepEqual([...first, ...second, ...third], ranking);
});

test("범위를 넘은 offset은 빈 배열", () => {
  assert.deepEqual(sliceRanking(ranking, { offset: 250, limit: 100 }), []);
});
