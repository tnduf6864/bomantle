import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUESS_BUCKETS,
  MAX_GUESSES,
  MAX_HINTS,
  avgGuessesOf,
  buildDistribution,
  guessBucket,
  percentileOf,
  rankAmong,
  sanitizeSubmission,
  type ResultRow,
} from "./rank.ts";

const CID = "3f0b9c2a-1111-4222-8333-444455556666";

// --- sanitizeSubmission ---------------------------------------------------

test("정상 제출은 그대로 통과하고 solved 기본값은 true", () => {
  const s = sanitizeSubmission({ cid: CID, hints: 0, guesses: 15 });
  assert.deepEqual(s, { cid: CID, hints: 0, guesses: 15, solved: true });
});

test("경계값(힌트 0·8, 추측 1·500)은 허용", () => {
  assert.ok(sanitizeSubmission({ cid: CID, hints: 0, guesses: 1 }));
  assert.ok(sanitizeSubmission({ cid: CID, hints: MAX_HINTS, guesses: MAX_GUESSES }));
});

test("범위 밖 입력은 보정하지 않고 거부한다", () => {
  assert.equal(sanitizeSubmission({ cid: CID, hints: -1, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: CID, hints: MAX_HINTS + 1, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: MAX_GUESSES + 1 }), null);
  assert.equal(sanitizeSubmission({ cid: CID, hints: 1.5, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: Number.NaN }), null);
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: -1, solved: false }), null);
});

// 첫 추측 전에 포기하는 사람이 참여 집계(분모)에서 빠지면 정답률이 부풀려진다.
test("추측 0번은 포기만 허용하고 정답은 거부한다", () => {
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: 0, solved: false })?.guesses, 0);
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: 0 }), null); // solved 기본 true
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: 0, solved: true }), null);
});

test("문자열 숫자·누락 필드·잘못된 cid는 거부한다", () => {
  assert.equal(sanitizeSubmission({ cid: CID, hints: "0", guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: CID, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ hints: 0, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: "짧음", hints: 0, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: "x".repeat(65), hints: 0, guesses: 5 }), null);
  assert.equal(sanitizeSubmission({ cid: "drop table; --", hints: 0, guesses: 5 }), null);
  assert.equal(sanitizeSubmission(null), null);
  assert.equal(sanitizeSubmission("nope"), null);
});

test("solved는 boolean만 받는다", () => {
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: 5, solved: false })?.solved, false);
  assert.equal(sanitizeSubmission({ cid: CID, hints: 0, guesses: 5, solved: 1 }), null);
});

// --- percentileOf --------------------------------------------------------

test("1등은 상위 1%, 꼴찌는 100%", () => {
  assert.equal(percentileOf(1, 512), 1);
  assert.equal(percentileOf(512, 512), 100);
});

test("혼자면 100% (상위 1%가 아니다)", () => {
  assert.equal(percentileOf(1, 1), 100);
});

test("백분위는 올림 — 21/512위는 상위 5%", () => {
  assert.equal(percentileOf(21, 512), 5); // 4.10 -> 5
  assert.equal(percentileOf(2, 100), 2);
  assert.equal(percentileOf(3, 1000), 1); // 0.3 -> 올림 1, 0% 방지
});

test("표본 0이면 100%", () => {
  assert.equal(percentileOf(1, 0), 100);
});

// --- guessBucket ---------------------------------------------------------

test("버킷 경계값", () => {
  assert.equal(guessBucket(1), "1-3");
  assert.equal(guessBucket(3), "1-3");
  assert.equal(guessBucket(4), "4-6");
  assert.equal(guessBucket(6), "4-6");
  assert.equal(guessBucket(7), "7-10");
  assert.equal(guessBucket(10), "7-10");
  assert.equal(guessBucket(11), "11-20");
  assert.equal(guessBucket(20), "11-20");
  assert.equal(guessBucket(21), "21-30");
  assert.equal(guessBucket(30), "21-30");
  assert.equal(guessBucket(31), "31-50");
  assert.equal(guessBucket(50), "31-50");
  assert.equal(guessBucket(51), "51+");
  assert.equal(guessBucket(9999), "51+");
});

// --- buildDistribution ---------------------------------------------------

test("힌트 분포는 0..8 전 칸이 채워지고 빈 칸은 0", () => {
  const { hintDist } = buildDistribution([
    { hints: 0, guesses: 5, ts: 1 },
    { hints: 0, guesses: 7, ts: 2 },
    { hints: 3, guesses: 9, ts: 3 },
  ]);
  assert.equal(hintDist.length, MAX_HINTS + 1);
  assert.deepEqual(hintDist, [2, 0, 0, 1, 0, 0, 0, 0, 0]);
});

test("범위 밖 힌트 값은 버린다", () => {
  const { hintDist } = buildDistribution([
    { hints: -1, guesses: 5, ts: 1 },
    { hints: 99, guesses: 5, ts: 2 },
    { hints: 2, guesses: 5, ts: 3 },
  ]);
  assert.equal(
    hintDist.reduce((a, b) => a + b, 0),
    1,
  );
});

test("추측 분포는 버킷으로 접히고 모든 버킷 키가 존재한다", () => {
  const { guessDist } = buildDistribution([
    { hints: 0, guesses: 2, ts: 1 },
    { hints: 0, guesses: 3, ts: 2 },
    { hints: 1, guesses: 55, ts: 3 },
  ]);
  assert.deepEqual(Object.keys(guessDist), [...GUESS_BUCKETS]);
  assert.equal(guessDist["1-3"], 2); // 2와 3이 같은 버킷
  assert.equal(guessDist["51+"], 1);
  assert.equal(guessDist["4-6"], 0);
});

// --- avgGuessesOf --------------------------------------------------------

test("평균 추측은 소수 1자리로 반올림", () => {
  const rows: ResultRow[] = [
    { hints: 0, guesses: 10, ts: 1 },
    { hints: 0, guesses: 11, ts: 2 },
    { hints: 0, guesses: 15, ts: 3 },
  ];
  assert.equal(avgGuessesOf(rows), 12); // 36/3
  assert.equal(avgGuessesOf([...rows, { hints: 0, guesses: 12, ts: 4 }]), 12); // 48/4
  assert.equal(avgGuessesOf([{ hints: 0, guesses: 1, ts: 1 }, { hints: 0, guesses: 2, ts: 2 }]), 1.5);
});

test("표본 0이면 평균 0", () => {
  assert.equal(avgGuessesOf([]), 0);
});

// --- rankAmong (타이브레이크 규칙) ---------------------------------------

// 정렬 키 (hints ASC, guesses ASC, ts ASC) — 힌트 적은 사람, 그다음 추측 적은 사람,
// 그다음 먼저 도달한 사람이 위.
const rows: ResultRow[] = [
  { hints: 0, guesses: 10, ts: 300 }, // 1위
  { hints: 0, guesses: 12, ts: 100 }, // 2위 (추측이 더 많아 시각 우위가 무의미)
  { hints: 0, guesses: 12, ts: 200 }, // 3위 (동점 → 늦게 도달)
  { hints: 1, guesses: 1, ts: 50 }, // 4위 (힌트를 써서 아래)
];

test("힌트 적은 쪽이 위, 같으면 추측 적은 쪽, 그다음 먼저 도달한 쪽", () => {
  assert.equal(rankAmong(rows, { hints: 0, guesses: 10, ts: 300 }), 1);
  assert.equal(rankAmong(rows, { hints: 0, guesses: 12, ts: 100 }), 2);
  assert.equal(rankAmong(rows, { hints: 0, guesses: 12, ts: 200 }), 3);
  assert.equal(rankAmong(rows, { hints: 1, guesses: 1, ts: 50 }), 4);
});

test("혼자면 1위", () => {
  assert.equal(rankAmong([{ hints: 3, guesses: 40, ts: 1 }], { hints: 3, guesses: 40, ts: 1 }), 1);
});

test("완전 동점(시각까지 같음)은 같은 순위를 받는다", () => {
  const tied: ResultRow[] = [
    { hints: 0, guesses: 5, ts: 10 },
    { hints: 0, guesses: 5, ts: 10 },
  ];
  assert.equal(rankAmong(tied, { hints: 0, guesses: 5, ts: 10 }), 1);
});
