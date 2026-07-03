import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "@bomantle/core";
import { buildHint, type FullGame } from "./hint.ts";

// 합성 게임 2개. cat20/mech200을 두 게임이 공유 → df가 커져 idf 최소(=가장 흔함).
// buildHint의 commonest가 "가장 흔한 태그"를 고르는지 검증하기 위한 구성.
const games: FullGame[] = [
  {
    id: 1, name_ko: "카탄", name_en: "Catan", year: "1995", rank: 1, rate: null,
    bgg_id: null, categories: [10, 20], mechanisms: [100, 200], weight: 2.31,
    players_min: 3, players_max: 4, time_min: 75, age: 10, review_count: 1000,
    types: ["전략게임"], designers: ["클라우스 토이버"], best_players: "4",
    recommended_players: "3-4", image: null,
  },
  {
    id: 2, name_ko: "윙스팬", name_en: "Wingspan", year: "2019", rank: 2, rate: null,
    bgg_id: null, categories: [20, 30], mechanisms: [200, 300], weight: 2.44,
    players_min: 1, players_max: 5, time_min: 70, age: 10, review_count: 900,
    types: ["전략게임"], designers: ["엘리자베스 하그레이브"], best_players: "2",
    recommended_players: "2-3", image: null,
  },
];
const idx = buildIndex(games);
const cats: Record<string, string> = { "10": "전략", "20": "경제", "30": "카드" };
const mechs: Record<string, string> = { "100": "주사위", "200": "교역", "300": "드래프팅" };
const g = games[0];
const v = (lvl: number) => buildHint(lvl, g, idx, cats, mechs).value;

test("레벨1 인원·시간", () => {
  assert.equal(v(1), "3-4명 · 75분");
});
test("레벨2 타입·테마 — 가장 흔한 카테고리(경제) 노출", () => {
  assert.equal(v(2), "전략게임 · 경제");
});
test("레벨3 난이도 밴드 (2.31 → 2.0 ~ 2.5)", () => {
  assert.equal(v(3), "2.0 ~ 2.5");
});
test("레벨4 진행방식·베스트 — 가장 흔한 진행방식(교역) + 베스트", () => {
  assert.equal(v(4), "교역 · 베스트 4인");
});
test("레벨5 출시연도", () => {
  assert.equal(v(5), "1995");
});
test("레벨6 디자이너", () => {
  assert.equal(v(6), "클라우스 토이버");
});
test("레벨7 글자수 (공백 제외)", () => {
  assert.equal(v(7), "2글자");
});
test("레벨8 초성", () => {
  assert.equal(v(8), "ㅋㅌ");
});
test("1~6단계는 정답 이름을 노출하지 않는다", () => {
  for (let lvl = 1; lvl <= 6; lvl++) {
    assert.ok(!v(lvl).includes("카탄"), `레벨 ${lvl}에서 이름 노출: ${v(lvl)}`);
  }
});
test("범위 밖 레벨은 빈 힌트", () => {
  assert.equal(v(9), "정보 없음");
});
