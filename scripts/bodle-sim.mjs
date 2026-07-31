#!/usr/bin/env node
// 보들 난이도 시뮬레이터 — docs/bodle-plan.md 2장의 표를 재생성한다.
//
//   node scripts/bodle-sim.mjs
//
// 열 구성이나 피드백 정밀도를 바꿀 때마다 반드시 돌려서 "완벽한 추론자 평균 4회"
// 부근을 유지할 것. 정밀도가 조금만 올라가도 2~3회로 떨어져 게임이 시시해진다.
// (실제 Wordle: 평균 약 3.9~4.2회, 6회내 성공률 약 95%)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const games = require(join(root, "workers/api/src/games.json"));

// --- 정답 풀: workers/api/src/answer.ts buildAnswerPool 과 같은 규칙 ---
const baseName = (g) => (g.name_ko ?? g.name_en ?? String(g.id)).split(/[:\-(]/)[0].trim();

function buildPool(minReviews) {
  const eligible = games.filter(
    (g) =>
      g.rank != null &&
      g.weight != null &&
      g.categories.length >= 2 &&
      g.players_min != null &&
      (g.review_count ?? 0) >= minReviews,
  );
  // 프랜차이즈별 최상위 1개만
  const best = new Map();
  for (const g of eligible) {
    const k = baseName(g);
    const cur = best.get(k);
    if (!cur || (g.rank ?? 1e9) < (cur.rank ?? 1e9)) best.set(k, g);
  }
  return [...best.values()].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const inter = (a, b) => a.filter((x) => b.includes(x)).length;

// opts.counted: 교집합 개수를 노출할지 (노출하면 정보량이 크게 뛴다)
// opts.band:    무게를 🟩으로 볼 오차 폭
// opts.yearGran: 연도 입도 (1=정확, 10=10년대)
function makeFeedback(cols, opts) {
  return (guess, ans) => {
    const out = [];
    for (const c of cols) {
      if (c === "types") {
        const g = guess.types ?? [], a = ans.types ?? [];
        out.push(setEq(g, a) ? "G" : inter(g, a) ? "Y" : "X");
      } else if (c === "cat" || c === "mech") {
        const key = c === "cat" ? "categories" : "mechanisms";
        const g = guess[key] ?? [], a = ans[key] ?? [];
        const n = inter(g, a);
        out.push(setEq(g, a) ? "G" : n ? (opts.counted ? "Y" + Math.min(n, 3) : "Y") : "X");
      } else if (c === "players") {
        const [g1, g2] = [guess.players_min, guess.players_max ?? guess.players_min];
        const [a1, a2] = [ans.players_min, ans.players_max ?? ans.players_min];
        out.push(g1 === a1 && g2 === a2 ? "G" : Math.max(g1, a1) <= Math.min(g2, a2) ? "Y" : "X");
      } else if (c === "weight") {
        const d = (ans.weight ?? 0) - (guess.weight ?? 0);
        out.push(Math.abs(d) <= opts.band ? "G" : d > 0 ? "U" : "D");
      } else if (c === "year") {
        const gy = Math.floor(Number(guess.year) / opts.yearGran);
        const ay = Math.floor(Number(ans.year) / opts.yearGran);
        out.push(ay === gy ? "G" : ay > gy ? "U" : "D");
      } else if (c === "time") {
        const d = (ans.time_min ?? 0) - (guess.time_min ?? 0);
        out.push(Math.abs(d) <= 15 ? "G" : d > 0 ? "U" : "D");
      }
    }
    return out.join("|");
  };
}

const entropy = (counts) => {
  const n = counts.reduce((a, b) => a + b, 0);
  return -counts.reduce((s, c) => s + (c ? (c / n) * Math.log2(c / n) : 0), 0);
};

// 하드모드 그리디: 남은 후보 중 기대 잔여 후보수를 최소화하는 추측을 고른다.
function evaluate(pool, fb, trials = 50, maxTurns = 9) {
  const results = [];
  for (let t = 0; t < trials; t++) {
    const answer = pool[(Math.random() * pool.length) | 0];
    let cands = pool.slice();
    let done = 0;
    for (let turn = 1; turn <= maxTurns; turn++) {
      const probe = cands.slice(0, 100); // 탐색 비용 상한
      let best = probe[0], bestScore = Infinity;
      for (const g of probe) {
        const m = new Map();
        for (const a of cands) {
          const k = fb(g, a);
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        let exp = 0;
        for (const c of m.values()) exp += (c / cands.length) * c;
        if (exp < bestScore) { bestScore = exp; best = g; }
      }
      if (best.id === answer.id) { done = turn; break; }
      const key = fb(best, answer);
      cands = cands.filter((a) => a.id !== best.id && fb(best, a) === key);
      if (cands.length === 1) { done = turn + 1; break; }
      if (cands.length === 0) { done = maxTurns + 1; break; }
    }
    results.push(done || maxTurns + 1);
  }
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  return { avg, worst: Math.max(...results), in6: results.filter((r) => r <= 6).length / results.length };
}

const CONFIGS = [
  ["A. 6열 정밀(개수노출)", ["types", "cat", "mech", "players", "weight", "year"], { counted: 1, band: 0.25, yearGran: 1 }],
  ["B. 6열 개수숨김", ["types", "cat", "mech", "players", "weight", "year"], { counted: 0, band: 0.5, yearGran: 5 }],
  ["C. 5열(인원제거)", ["types", "cat", "mech", "weight", "year"], { counted: 0, band: 0.5, yearGran: 5 }],
  ["D. 4열 ★채택안", ["types", "mech", "weight", "year"], { counted: 0, band: 0.75, yearGran: 10 }],
  ["E. 3열", ["types", "cat", "year"], { counted: 0, band: 1, yearGran: 10 }],
  ["F. 2열", ["types", "year"], { counted: 0, band: 1, yearGran: 10 }],
];

console.log("정답 풀 크기 (프랜차이즈 dedup 후):");
for (const rc of [0, 50, 100, 200, 500]) {
  console.log(`  review_count>=${String(rc).padStart(3)} → ${buildPool(rc).length}개`);
}

// 열별 정보량 — 채택안 후보인 A안 기준
{
  const pool = buildPool(50);
  const cols = ["유형", "테마", "메커니즘", "인원", "무게", "연도"];
  const fb = makeFeedback(["types", "cat", "mech", "players", "weight", "year"], { counted: 1, band: 0.25, yearGran: 1 });
  console.log(`\n열별 평균 정보량 (풀 ${pool.length}개, 전체 불확실도 ${Math.log2(pool.length).toFixed(2)} bit):`);
  cols.forEach((name, i) => {
    let tot = 0;
    for (let t = 0; t < 200; t++) {
      const g = pool[(Math.random() * pool.length) | 0];
      const m = new Map();
      for (const a of pool) {
        const k = fb(g, a).split("|")[i];
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      tot += entropy([...m.values()]);
    }
    console.log(`  ${name.padEnd(5)} ${(tot / 200).toFixed(2)} bit`);
  });
}

for (const rc of [50, 200]) {
  const pool = buildPool(rc);
  console.log(`\n=== 정답 풀 review_count>=${rc} (${pool.length}개, ${Math.log2(pool.length).toFixed(1)} bit) ===`);
  for (const [name, cols, opts] of CONFIGS) {
    const r = evaluate(pool, makeFeedback(cols, opts));
    console.log(
      `  ${name.padEnd(20)} 평균 ${r.avg.toFixed(2)}회  최악 ${String(r.worst).padStart(2)}회  6회내 ${(r.in6 * 100).toFixed(0)}%`,
    );
  }
}
