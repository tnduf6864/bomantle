import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// stats.ts는 localStorage에 저장한다. Node 테스트 환경에는 없으므로 인메모리 폴리필.
// (stats.ts는 모듈 로드 시점이 아니라 호출 시점에만 localStorage를 읽으므로 import 후 주입 OK)
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const {
  loadStats,
  recordResult,
  winRate,
  giveups,
  avgGuesses,
  bucketOf,
  effectiveStreak,
  effectiveNoHintStreak,
  exportStats,
  importStats,
} = await import("./stats.ts");

beforeEach(() => store.clear());

test("bucketOf: 넓은 구간 버킷", () => {
  assert.equal(bucketOf(1), "1-3");
  assert.equal(bucketOf(3), "1-3");
  assert.equal(bucketOf(4), "4-6");
  assert.equal(bucketOf(6), "4-6");
  assert.equal(bucketOf(7), "7-10");
  assert.equal(bucketOf(10), "7-10");
  assert.equal(bucketOf(11), "11-20");
  assert.equal(bucketOf(20), "11-20");
  assert.equal(bucketOf(21), "21-30");
  assert.equal(bucketOf(30), "21-30");
  assert.equal(bucketOf(31), "31-50");
  assert.equal(bucketOf(50), "31-50");
  assert.equal(bucketOf(51), "51+");
  assert.equal(bucketOf(999), "51+");
});

test("v2 저장 데이터의 옛 버킷은 로드 시 새 구간으로 합산", () => {
  // 옛 형식: 1..6 개별 키, "21+" 존재
  store.set(
    "bomantle:stats",
    JSON.stringify({
      version: 2,
      played: 6,
      wins: 6,
      dist: { "1": 1, "3": 2, "5": 1, "7-10": 1, "21+": 1 },
      recorded: {},
    }),
  );
  const s = loadStats();
  assert.equal(s.version, 3);
  assert.deepEqual(s.dist, { "1-3": 3, "4-6": 1, "7-10": 1, "21-30": 1 });
});

test("recordResult: 같은 날짜는 1회만 반영(멱등)", () => {
  recordResult("2026-07-10", true, 5, 0);
  const s = recordResult("2026-07-10", true, 5, 0);
  assert.equal(s.played, 1);
  assert.equal(s.wins, 1);
});

test("승/포기 집계와 정답률", () => {
  recordResult("2026-07-10", true, 4, 0);
  recordResult("2026-07-11", false, 20, 0);
  const s = recordResult("2026-07-12", true, 8, 0);
  assert.equal(s.played, 3);
  assert.equal(s.wins, 2);
  assert.equal(giveups(s), 1);
  assert.equal(winRate(s), 67); // 2/3
});

test("연속 정답: 연속일 증가, 하루 건너뛰면 리셋", () => {
  recordResult("2026-07-10", true, 3, 0);
  let s = recordResult("2026-07-11", true, 3, 0);
  assert.equal(s.curStreak, 2);
  // 12일 건너뛰고 13일
  s = recordResult("2026-07-13", true, 3, 0);
  assert.equal(s.curStreak, 1);
  assert.equal(s.maxStreak, 2);
});

test("포기는 연속을 끊는다", () => {
  recordResult("2026-07-10", true, 3, 0);
  recordResult("2026-07-11", true, 3, 0);
  const s = recordResult("2026-07-12", false, 5, 0);
  assert.equal(s.curStreak, 0);
  assert.equal(s.maxStreak, 2);
});

test("effectiveStreak: 마지막 승리가 오래되면 0으로 표시(저장값은 유지)", () => {
  const s = recordResult("2026-07-10", true, 3, 0);
  assert.equal(s.curStreak, 1);
  // 마지막 승리일 == 오늘/어제면 살아있음
  assert.equal(effectiveStreak(s, "2026-07-10"), 1);
  assert.equal(effectiveStreak(s, "2026-07-11"), 1);
  // 이틀 이상 지났으면 끊긴 것으로 표시
  assert.equal(effectiveStreak(s, "2026-07-12"), 0);
  // 저장값 자체는 보존
  assert.equal(s.curStreak, 1);
});

test("무힌트 연속: 힌트를 쓴 승리는 무힌트 연속을 끊는다", () => {
  recordResult("2026-07-10", true, 3, 0); // 무힌트
  let s = recordResult("2026-07-11", true, 3, 0); // 무힌트
  assert.equal(s.curNoHintStreak, 2);
  assert.equal(s.noHintWins, 2);
  // 힌트 쓴 승리 → 무힌트 연속 끊김, 일반 연속은 유지
  s = recordResult("2026-07-12", true, 4, 2);
  assert.equal(s.curNoHintStreak, 0);
  assert.equal(s.curStreak, 3);
  assert.equal(s.maxNoHintStreak, 2);
  assert.equal(s.totalHints, 2);
});

test("effectiveNoHintStreak도 오래되면 0", () => {
  const s = recordResult("2026-07-10", true, 3, 0);
  assert.equal(effectiveNoHintStreak(s, "2026-07-11"), 1);
  assert.equal(effectiveNoHintStreak(s, "2026-07-15"), 0);
});

test("파생 지표: 평균 추측 / 베스트", () => {
  recordResult("2026-07-10", true, 10, 0);
  recordResult("2026-07-11", true, 4, 0);
  const s = recordResult("2026-07-12", false, 30, 0); // 포기는 평균/베스트에 미반영
  assert.equal(s.bestGuesses, 4);
  assert.equal(avgGuesses(s), 7); // (10+4)/2
});

test("빈 통계 파생 지표는 0/–", () => {
  const s = loadStats();
  assert.equal(avgGuesses(s), 0);
  assert.equal(s.bestGuesses, null);
  assert.equal(winRate(s), 0);
});

test("export/import 왕복", () => {
  recordResult("2026-07-10", true, 5, 1);
  const dump = exportStats(loadStats());
  store.clear();
  assert.equal(loadStats().played, 0);
  const restored = importStats(dump);
  assert.ok(restored);
  assert.equal(restored!.played, 1);
  assert.equal(restored!.wins, 1);
  assert.equal(loadStats().played, 1); // 저장까지 됨
});

test("import: 잘못된 데이터는 null 반환하고 저장 안 함", () => {
  recordResult("2026-07-10", true, 5, 0);
  assert.equal(importStats("не json"), null);
  assert.equal(importStats(JSON.stringify({ foo: 1 })), null);
  assert.equal(loadStats().played, 1); // 기존 데이터 보존
});
