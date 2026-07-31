import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodleFeedback, BodleTurn } from "./types.ts";
import {
  buildBodleShareText,
  effectiveBodleStreak,
  emptyBodleStats,
  prevDate,
  recordBodleResult,
  turnEmoji,
} from "./bodle.ts";

function fb(over: Partial<BodleFeedback> = {}): BodleFeedback {
  return {
    types: "miss",
    categories: "miss",
    mechanisms: "miss",
    weight: "unknown",
    weightNear: false,
    weightExact: false,
    year: "unknown",
    yearNear: false,
    yearExact: false,
    ...over,
  };
}

const turn = (over: Partial<BodleFeedback> = {}, correct = false): BodleTurn => ({
  gameId: 1,
  feedback: fb(over),
  correct,
});

test("prevDate: 월 경계를 넘어간다", () => {
  assert.equal(prevDate("2026-08-01"), "2026-07-31");
  assert.equal(prevDate("2026-01-01"), "2025-12-31");
});

test("turnEmoji: 열 순서는 유형·테마·메커니즘·무게·연도", () => {
  const e = turnEmoji(
    fb({ types: "hit", categories: "partial", mechanisms: "miss", weight: "up", year: "down" }),
  );
  assert.equal(e, "🟩🟨⬜⬆️⬇️");
});

test("turnEmoji: 값이 없는 열은 ⬜", () => {
  assert.equal(turnEmoji(fb()), "⬜⬜⬜⬜⬜");
});

test("turnEmoji: hit이어도 완전히 같은 값이 아니면 🟨, 완전히 같으면 🟩", () => {
  const near = turnEmoji(fb({ weight: "hit", weightExact: false, year: "hit", yearExact: false }));
  assert.equal(near, "⬜⬜⬜🟨🟨");
  const exact = turnEmoji(fb({ weight: "hit", weightExact: true, year: "hit", yearExact: true }));
  assert.equal(exact, "⬜⬜⬜🟩🟩");
});

test("공유 텍스트에 게임 이름이 들어가지 않는다", () => {
  const turns = [turn({ types: "hit" }), turn({ types: "hit", year: "hit" }, true)];
  const text = buildBodleShareText(turns, 8, 212, true, 3);
  assert.match(text, /보들 #212/);
  assert.match(text, /2\/8/);
  assert.match(text, /🔥 연속 3일/);
  assert.match(text, /bomantle\.pages\.dev\/bodle/);
  // 이모지 그리드가 추측 수만큼
  assert.equal(text.split("\n").filter((l) => l.startsWith("🟩") || l.startsWith("⬜")).length, 2);
});

test("실패하면 X/8", () => {
  const text = buildBodleShareText([turn()], 8, 5, false);
  assert.match(text, /X\/8/);
  assert.doesNotMatch(text, /연속/);
});

test("연속 기록: 어제 이어서 맞히면 늘어난다", () => {
  let s = emptyBodleStats();
  s = recordBodleResult(s, "2026-08-01", 4, true);
  assert.equal(s.streak, 1);
  s = recordBodleResult(s, "2026-08-02", 3, true);
  assert.equal(s.streak, 2);
  assert.equal(s.bestStreak, 2);
});

test("연속 기록: 하루 건너뛰면 1부터 다시", () => {
  let s = emptyBodleStats();
  s = recordBodleResult(s, "2026-08-01", 4, true);
  s = recordBodleResult(s, "2026-08-03", 4, true); // 8-02 빠짐
  assert.equal(s.streak, 1);
  assert.equal(s.bestStreak, 1);
});

test("연속 기록: 실패하면 0으로 끊긴다", () => {
  let s = emptyBodleStats();
  s = recordBodleResult(s, "2026-08-01", 4, true);
  s = recordBodleResult(s, "2026-08-02", 8, false);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 1);
  assert.equal(s.played, 2);
  assert.equal(s.solved, 1);
});

test("같은 날짜를 두 번 기록해도 통계가 부풀지 않는다", () => {
  let s = emptyBodleStats();
  s = recordBodleResult(s, "2026-08-01", 4, true);
  const again = recordBodleResult(s, "2026-08-01", 4, true);
  assert.equal(again.played, 1);
  assert.equal(again.solved, 1);
  assert.equal(again, s); // 그대로 반환
});

test("분포는 1-based 추측 횟수를 0-based 인덱스로 담는다", () => {
  let s = emptyBodleStats();
  s = recordBodleResult(s, "2026-08-01", 1, true);
  s = recordBodleResult(s, "2026-08-02", 4, true);
  assert.equal(s.dist[0], 1); // 1번 만에
  assert.equal(s.dist[3], 1); // 4번 만에
});

test("표시용 연속 기록: 오래된 기록은 0으로 보정", () => {
  let s = emptyBodleStats();
  s = recordBodleResult(s, "2026-08-01", 4, true);
  assert.equal(effectiveBodleStreak(s, "2026-08-01"), 1); // 오늘
  assert.equal(effectiveBodleStreak(s, "2026-08-02"), 1); // 어제까지는 유효
  assert.equal(effectiveBodleStreak(s, "2026-08-03"), 0); // 끊김
});
