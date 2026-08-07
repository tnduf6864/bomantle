import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Game } from "./types.ts";
import { buildIndex, rankAgainst, toScore, similarity } from "./engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
// 데이터 산출물(data/out)은 gitignore이므로 CI/새 클론에는 없다.
// 동일 내용(빌드가 복사)의 추적되는 워커 번들 games.json으로 폴백.
const dataOut = resolve(here, "../../../data/out/games.json");
const gamesPath = existsSync(dataOut)
  ? dataOut
  : resolve(here, "../../../workers/api/src/games.json");
const games: Game[] = JSON.parse(readFileSync(gamesPath, "utf-8"));
const idx = buildIndex(games);
const byName = (s: string) =>
  games.find((g) => (g.name_ko ?? "").includes(s) || (g.name_en ?? "").toLowerCase().includes(s.toLowerCase()))!;

test("인덱스가 모든 게임을 담는다", () => {
  assert.equal(idx.byId.size, games.length);
});

test("같은 프랜차이즈가 최상위로 (글룸헤이븐 → 사자의 턱)", () => {
  const gloom = byName("글룸헤이븐");
  const ranking = rankAgainst(idx, gloom.id);
  const topName = games.find((g) => g.id === ranking[0].id)!.name_ko;
  assert.match(topName ?? "", /글룸헤이븐|프로스트헤이븐/);
  assert.ok(ranking[0].score > 90, `top score ${ranking[0].score} should be > 90`);
});

test("아줄 → 아줄 시리즈가 상위", () => {
  const azul = games.find((g) => g.name_ko === "아줄")!;
  const ranking = rankAgainst(idx, azul.id);
  const top3 = ranking.slice(0, 3).map((r) => games.find((g) => g.id === r.id)!.name_ko);
  assert.ok(top3.some((n) => (n ?? "").includes("아줄")), `top3=${top3}`);
});

test("결합 엔진: 쌍둥이 게임 고득점 (브라스 버밍엄 vs 랭커셔 ≈ 89)", () => {
  // 테마 0.45 + 진행방식 0.30 + 수치 0.25 결합. 거의 동일 게임이라 매우 높음.
  //
  // ⚠️ 이 값은 **말뭉치 의존적**이다. 태그 가중치가 IDF라 전체 게임 수가 바뀌면
  // 같은 두 게임의 점수도 움직인다. 실제로 수록 범위를 보드라이프 랭킹 목록(5,407개)에서
  // 등록 게임 전체(21,194개)로 넓혔을 때 84.1 → 89로 올랐다(엔진 수식은 그대로).
  // 데이터를 다시 만든 뒤 이 테스트가 깨지면 엔진 버그가 아니라 말뭉치 변화일 수 있으니
  // 먼저 그쪽을 의심할 것.
  const birm = games.find((g) => g.name_ko === "브라스: 버밍엄")!;
  const lanc = games.find((g) => g.name_ko === "브라스: 랭커셔")!;
  const s = toScore(similarity(idx.byId.get(birm.id)!, idx.byId.get(lanc.id)!, idx));
  assert.ok(Math.abs(s - 89) < 0.5, `got ${s}, expected ~89`);
});

test("랭킹은 내림차순 정렬", () => {
  const r = rankAgainst(idx, byName("카탄").id);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
});
