import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "@bomantle/core";
import { buildHint, HINT_LABELS, sharedTags, tagTotals, type FullGame } from "./hint.ts";

// 합성 게임 2개. cat20/mech200을 두 게임이 공유 → df가 커져 idf 최소(=가장 흔함).
// cat10/mech100은 카탄에만 있어 idf 최대(=가장 드묾).
const games: FullGame[] = [
  {
    id: 1, name_ko: "카탄", name_en: "Catan", year: "1995", rank: 1, rate: 7.31,
    bgg_id: null, categories: [10, 20], mechanisms: [100, 200], weight: 2.31,
    players_min: 3, players_max: 4, time_min: 60, time_max: 90, age: 10, review_count: 1000,
    types: ["전략게임"], designers: ["클라우스 토이버"], best_players: "4",
    recommended_players: "3-4", image: null,
  },
  {
    id: 2, name_ko: "윙스팬", name_en: "Wingspan", year: "2019", rank: 2, rate: null,
    bgg_id: null, categories: [20, 30], mechanisms: [200, 300], weight: 2.44,
    players_min: 1, players_max: 5, time_min: 70, time_max: 70, age: 10, review_count: 900,
    types: ["전략게임"], designers: ["엘리자베스 하그레이브"], best_players: "2",
    recommended_players: "2-3", image: null,
  },
];
const idx = buildIndex(games);
const cats: Record<string, string> = { "10": "전략", "20": "경제", "30": "카드" };
const mechs: Record<string, string> = { "100": "주사위", "200": "교역", "300": "드래프팅" };
const g = games[0];
const v = (lvl: number, game: FullGame = g) => buildHint(lvl, game, idx, cats, mechs).value;

test("레벨1 인원·시간 — 범위 표기", () => {
  assert.equal(v(1), "3-4명 · 60-90분");
});
test("레벨1 시간 — 상·하한이 같으면 단일값", () => {
  assert.equal(v(1, games[1]), "1-5명 · 70분");
});
test("레벨1 시간 — time_max가 없으면 하한만", () => {
  assert.equal(v(1, { ...g, time_max: null }), "3-4명 · 60분");
});
test("레벨1 시간 — 시간 정보가 없으면 인원만", () => {
  assert.equal(v(1, { ...g, time_min: null, time_max: null }), "3-4명");
});
test("레벨2 웨이트 — 밴드 + 체감 (2.31 → 2.0 ~ 2.5 중간)", () => {
  assert.equal(v(2), "2.0 ~ 2.5 (중간)");
  assert.equal(v(2, { ...g, weight: 1 }), "1.0 ~ 1.5 (가벼움)");
  assert.equal(v(2, { ...g, weight: 4.2 }), "4.0 ~ 4.5 (매우 무거움)");
});
test("레벨3 유형 · 출시 연대 — 정확한 연도는 숨긴다", () => {
  assert.equal(v(3), "전략게임 · 1990년대");
  assert.equal(v(3, { ...g, year: "0" }), "전략게임");
});
test("레벨4 테마 — 가장 흔한 카테고리(경제)", () => {
  assert.equal(v(4), "경제");
});
test("레벨4 테마 — 유형과 이름이 같은 태그는 건너뛴다", () => {
  const abstract = { ...g, types: ["경제"] }; // 유형 "경제" = 가장 흔한 테마 이름
  assert.equal(v(4, abstract), "전략");
  assert.equal(v(4, { ...abstract, categories: [20] }), "경제"); // 다른 태그가 없으면 그대로
});
test("레벨5 메커니즘·베스트 — 가장 흔한 메커니즘(교역) + 베스트", () => {
  assert.equal(v(5), "교역 · 베스트 4인");
});
test("레벨6 인기도 — 순위는 구간으로만", () => {
  assert.equal(v(6), "보드라이프 상위 50위 안 · 평점 7.3");
  assert.equal(v(6, { ...g, rank: 474, rate: null }), "보드라이프 상위 500위 안");
});
test("레벨7 특징 태그 — 4·5단계에 안 나온 가장 드문 태그", () => {
  assert.ok(["전략 (테마)", "주사위 (메커니즘)"].includes(v(7)), v(7));
});
test("레벨7 — 보여줄 태그가 더 없으면 추천 인원·연령으로 대신한다", () => {
  assert.equal(v(7, { ...g, categories: [20], mechanisms: [200] }), "추천 3-4인 · 10세 이상");
});
test("레벨8 디자이너 · 연도 · 글자 수 — 초성은 없다", () => {
  assert.equal(v(8), "클라우스 토이버 · 1995년 · 2글자");
  assert.doesNotMatch(v(8), /[ㄱ-ㅎ]/);
});
test("레벨8 — 디자이너 미상 표기는 뺀다", () => {
  assert.equal(v(8, { ...g, designers: ["불확실 (uncredited)"] }), "1995년 · 2글자");
});
test("어느 단계도 정답 이름·초성을 노출하지 않는다", () => {
  for (let lvl = 1; lvl <= 8; lvl++) {
    assert.ok(!v(lvl).includes("카탄"), `레벨 ${lvl}에서 이름 노출: ${v(lvl)}`);
    assert.ok(!v(lvl).includes("ㅋㅌ"), `레벨 ${lvl}에서 초성 노출: ${v(lvl)}`);
  }
});
test("라벨은 8단계이고 buildHint 라벨과 일치", () => {
  assert.equal(HINT_LABELS.length, 8);
  for (let lvl = 1; lvl <= 8; lvl++) {
    assert.equal(buildHint(lvl, g, idx, cats, mechs).label, HINT_LABELS[lvl - 1]);
  }
});
test("범위 밖 레벨은 빈 힌트", () => {
  assert.equal(v(9), "정보 없음");
});

test("sharedTags: 추측과 정답이 공유하는 테마·메커니즘만", () => {
  // 카탄(10,20 / 100,200) vs 윙스팬(20,30 / 200,300) → 경제(20)·교역(200)
  assert.deepEqual(sharedTags(games[1], g), { cats: [20], mechs: [200] });
  assert.deepEqual(sharedTags({ ...games[1], categories: [30], mechanisms: [] }, g), { cats: [], mechs: [] });
});
test("tagTotals: 정답 태그 총개수(중복 제거)", () => {
  assert.deepEqual(tagTotals(g), { cats: 2, mechs: 2 });
  assert.deepEqual(tagTotals({ ...g, mechanisms: undefined }), { cats: 2, mechs: 0 });
});
test("힌트 4·5·7단계는 공개한 태그 id를 함께 준다", () => {
  assert.deepEqual(buildHint(4, g, idx, cats, mechs).tags, { cats: [20], mechs: [] });
  assert.deepEqual(buildHint(5, g, idx, cats, mechs).tags, { cats: [], mechs: [200] });
  const t7 = buildHint(7, g, idx, cats, mechs).tags!;
  assert.equal(t7.cats.length + t7.mechs.length, 1);
  assert.equal(buildHint(1, g, idx, cats, mechs).tags, undefined);
});
