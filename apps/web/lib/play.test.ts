import { test } from "node:test";
import assert from "node:assert/strict";

const {
  puzzleNumberOf,
  parseArchiveDate,
  archiveDates,
  statusOf,
  hintUnlockAt,
  guessesUntilHint,
  shareGrid,
  buildShareText,
  foundTags,
} = await import("./play.ts");

type Row = Parameters<typeof buildShareText>[0]["rows"][number];
const row = (rank: number, win = false, seq = 1): Row =>
  ({ id: seq, score: 50, rank, win, seq, game: {} }) as unknown as Row;

test("puzzleNumberOf: 워커와 같은 규칙 (EPOCH=1)", () => {
  assert.equal(puzzleNumberOf("2026-01-01"), 1);
  assert.equal(puzzleNumberOf("2026-11-11"), 315); // 라이브 /api/today 값
});

test("parseArchiveDate: 오늘 이전·EPOCH 이후만 지난 문제로 인정", () => {
  const today = "2026-11-11";
  assert.equal(parseArchiveDate("2026-08-14", today), "2026-08-14");
  assert.equal(parseArchiveDate(today, today), null); // 오늘은 그냥 오늘 판
  assert.equal(parseArchiveDate("2026-11-12", today), null);
  assert.equal(parseArchiveDate("2025-12-31", today), null);
  assert.equal(parseArchiveDate("2026-02-30", today), null);
  assert.equal(parseArchiveDate("abc", today), null);
  assert.equal(parseArchiveDate(null, today), null);
});

test("archiveDates: 어제부터 퍼즐 1번까지 최신순", () => {
  const list = archiveDates("2026-01-04");
  assert.deepEqual(list, ["2026-01-03", "2026-01-02", "2026-01-01"]);
  assert.deepEqual(archiveDates("2026-01-01"), []);
});

test("statusOf: 저장 진행 → 목록 상태", () => {
  assert.deepEqual(statusOf(null), { status: "new", guesses: 0 });
  assert.deepEqual(statusOf({ rows: [row(5)], won: false }), { status: "playing", guesses: 1 });
  assert.deepEqual(statusOf({ rows: [row(5), row(0, true)], won: true }), { status: "solved", guesses: 2 });
  assert.deepEqual(statusOf({ rows: [row(5)], won: true }), { status: "gaveup", guesses: 1 });
});

test("힌트 해금: 1단계는 바로, 이후 4회마다", () => {
  assert.equal(hintUnlockAt(1), 0);
  assert.equal(hintUnlockAt(2), 4);
  assert.equal(hintUnlockAt(8), 28);
  assert.equal(guessesUntilHint(2, 1), 3);
  assert.equal(guessesUntilHint(2, 9), 0);
});

test("shareGrid: 10칸씩 줄바꿈, 50칸 넘으면 개수로 줄인다", () => {
  assert.equal(shareGrid([row(5), row(40), row(200), row(800), row(5000), row(0, true)]), "🟥🟧🟨🟦⬜🟩");
  const many = Array.from({ length: 23 }, () => row(5000));
  assert.equal(shareGrid(many).split("\n").length, 3);
  const huge = Array.from({ length: 57 }, () => row(5000));
  assert.match(shareGrid(huge), /… \+7$/);
});

test("buildShareText: 정답명이 없고 번호·그리드·링크가 들어간다", () => {
  const rows = [row(120, false, 1), row(0, true, 2)];
  const t = buildShareText({ rows, hintCount: 1, puzzleNumber: 315, streak: 3 });
  assert.match(t, /보맨틀 #315/);
  assert.match(t, /2번 만에/);
  assert.match(t, /🟨🟩/);
  assert.match(t, /연속 3일/);
  assert.match(t, /https:\/\/bomantle\.pages\.dev$/);
});

test("buildShareText: 지난 문제는 표시·딥링크가 붙고 연속 기록은 빠진다", () => {
  const t = buildShareText({
    rows: [row(0, true)],
    hintCount: 0,
    puzzleNumber: 200,
    archiveDate: "2026-07-19",
    streak: 9,
  });
  assert.match(t, /#200 \(지난 문제\)/);
  assert.doesNotMatch(t, /연속/);
  assert.match(t, /\?d=2026-07-19$/);
});

test("buildShareText: 포기는 최고 순위를 보여준다", () => {
  const t = buildShareText({ rows: [row(1500), row(42)], hintCount: 0, puzzleNumber: 1 });
  assert.match(t, /포기 — 최고 42위/);
});

test("foundTags: 추측·힌트로 찾은 정답 태그를 중복 없이 합친다", () => {
  const rows = [
    { match: { cats: [5], mechs: [] }, tagTotal: { cats: 3, mechs: 2 } },
    { match: { cats: [5, 7], mechs: [40] }, tagTotal: { cats: 3, mechs: 2 } },
    {}, // 구버전 저장분
  ];
  const r = foundTags(rows, [{ tags: { cats: [9], mechs: [40] } }, {}]);
  assert.deepEqual(r, { cats: [5, 7, 9], mechs: [40], total: { cats: 3, mechs: 2 } });
});

test("foundTags: 새 형식 응답이 없으면 total은 null", () => {
  assert.equal(foundTags([{}], []).total, null);
});
