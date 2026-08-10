import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnswerInfo } from "./reveal.ts";
import type { FullGame } from "./hint.ts";

const game: FullGame = {
  id: 7, name_ko: "카탄", name_en: "Catan", year: "1995", rank: 12, rate: 8.13,
  bgg_id: 13, categories: [10, 20, 999], mechanisms: [100, 200], weight: 2.31,
  players_min: 3, players_max: 4, time_min: 50, time_max: 75, age: 10, review_count: 1000,
  types: ["전략게임"], designers: ["클라우스 토이버"], best_players: "4",
  recommended_players: "3-4", image: null,
};
const cats: Record<string, string> = { "10": "전략", "20": "경제" };
const mechs: Record<string, string> = { "100": "주사위", "200": "교역" };

test("정답 정보에 이름·사양·태그가 모두 담긴다", () => {
  const a = buildAnswerInfo(game, cats, mechs, "/boxart/7.jpg");
  assert.equal(a.name_ko, "카탄");
  assert.equal(a.name_en, "Catan");
  assert.equal(a.image, "/boxart/7.jpg");
  assert.equal(a.year, "1995");
  assert.equal(a.rank, 12);
  assert.equal(a.rate, 8.13);
  assert.equal(a.weight, 2.31);
  assert.equal(a.time_min, 50);
  assert.equal(a.time_max, 75);
  assert.equal(a.best_players, "4");
  assert.deepEqual(a.types, ["전략게임"]);
  assert.deepEqual(a.designers, ["클라우스 토이버"]);
});

test("태그 id는 이름으로 변환하고, 사전에 없는 id는 버린다", () => {
  const a = buildAnswerInfo(game, cats, mechs, null);
  assert.deepEqual(a.categories, ["전략", "경제"]); // 999는 제외
  assert.deepEqual(a.mechanisms, ["주사위", "교역"]);
});

test("선택 필드가 없어도 빈 배열/null로 안전하게 채운다", () => {
  const bare: FullGame = {
    id: 1, name_ko: null, name_en: null, year: null, rank: null, rate: null,
    bgg_id: null, categories: [], weight: null, players_min: null,
    players_max: null, time_min: null, time_max: null, age: null,
  };
  const a = buildAnswerInfo(bare, cats, mechs, null);
  assert.deepEqual(a.categories, []);
  assert.deepEqual(a.mechanisms, []);
  assert.deepEqual(a.types, []);
  assert.deepEqual(a.designers, []);
  assert.equal(a.best_players, null);
});
