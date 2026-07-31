import { test } from "node:test";
import assert from "node:assert/strict";

const { buildGameDB, resolve, suggest } = await import("./games.ts");

interface Row {
  id: number;
  ko: string | null;
  en?: string | null;
  rank?: number | null;
}

// GameMeta의 검색 무관 필드는 기본값으로 채운다 — 검색은 이름·랭킹만 본다.
function db(rows: Row[]) {
  return buildGameDB(
    rows.map((r) => ({
      id: r.id,
      name_ko: r.ko,
      name_en: r.en ?? null,
      year: null,
      // rank를 명시하지 않으면 id를 쓴다. 명시한 null은 "랭킹 없음"으로 그대로 둔다.
      rank: r.rank === undefined ? r.id : r.rank,
      rate: null,
      bgg_id: null,
      categories: [],
      mechanisms: [],
      types: [],
      weight: null,
      players_min: null,
      players_max: null,
      time_min: null,
      age: null,
    })),
    {},
  );
}

const names = (rows: { name_ko: string | null }[]) => rows.map((g) => g.name_ko);

const SAMPLE = db([
  { id: 1, ko: "카탄", en: "Catan", rank: 1 },
  { id: 2, ko: "브라스: 버밍엄", en: "Brass: Birmingham", rank: 2 },
  { id: 3, ko: "브라스: 랭커셔", en: "Brass: Lancashire", rank: 3 },
  { id: 4, ko: "티켓 투 라이드", en: "Ticket to Ride", rank: 4 },
  { id: 5, ko: "윙스팬", en: "Wingspan", rank: 5 },
  { id: 6, ko: "글룸헤이븐", en: "Gloomhaven", rank: 6 },
]);

test("정규화: 공백·구두점 차이를 무시한다", () => {
  assert.equal(resolve(SAMPLE, "브라스: 버밍엄")?.id, 2);
  assert.equal(resolve(SAMPLE, "브라스 버밍엄")?.id, 2);
  assert.equal(resolve(SAMPLE, "브라스버밍엄")?.id, 2);
  assert.equal(resolve(SAMPLE, " BRASS:  birmingham ")?.id, 2);
  assert.equal(resolve(SAMPLE, "티켓투라이드")?.id, 4);
});

test("resolve는 초성·오타를 통과시키지 않는다 (추측 1회를 소모하므로)", () => {
  assert.equal(resolve(SAMPLE, "ㅋㅌ"), null);
  assert.equal(resolve(SAMPLE, "카딴"), null);
  assert.equal(resolve(SAMPLE, "없는게임"), null);
});

test("접두 일치가 부분 일치보다 앞선다", () => {
  const got = names(SAMPLE.games.length ? suggest(SAMPLE, "라이드", 5) : []);
  assert.deepEqual(got, ["티켓 투 라이드"]); // 부분 일치만 존재
  // "브라스"는 두 게임의 접두 → 랭킹순
  assert.deepEqual(names(suggest(SAMPLE, "브라스", 5)), [
    "브라스: 버밍엄",
    "브라스: 랭커셔",
  ]);
});

test("초성 검색: 자모만 입력해도 찾는다", () => {
  assert.deepEqual(names(suggest(SAMPLE, "ㅇㅅㅍ", 5)), ["윙스팬"]);
  assert.deepEqual(names(suggest(SAMPLE, "ㅌㅋㅌㄹㅇㄷ", 5)), ["티켓 투 라이드"]);
  // 초성 접두 — 두 게임이 같은 초성이면 랭킹순
  assert.deepEqual(names(suggest(SAMPLE, "ㅂㄹㅅ", 5)), [
    "브라스: 버밍엄",
    "브라스: 랭커셔",
  ]);
});

test("초성 검색: 접두가 중간 일치보다 앞선다", () => {
  // "ㅋㅌ"는 카탄의 초성 접두이자 티켓 투 라이드(ㅌ|ㅋㅌ|ㄹㅇㄷ)의 중간 일치.
  // 접두 단계가 먼저 돌므로 카탄이 항상 위에 온다.
  const got = names(suggest(SAMPLE, "ㅋㅌ", 5));
  assert.equal(got[0], "카탄");
  assert.ok(got.includes("티켓 투 라이드"));
});

test("초성 검색: 음절과 자모가 섞인 입력도 찾는다", () => {
  assert.deepEqual(names(suggest(SAMPLE, "브ㄹㅅ", 5)), [
    "브라스: 버밍엄",
    "브라스: 랭커셔",
  ]);
  assert.equal(names(suggest(SAMPLE, "카ㅌ", 5))[0], "카탄");
});

test("자모가 없는 입력은 초성 단계를 타지 않는다", () => {
  // "가탄"은 카탄과 초성이 다르므로(ㄱ vs ㅋ) 초성으로 새지 않고, 오타 허용으로만 걸린다.
  // 반대로 다 타이핑한 "윙스팬"이 같은 초성의 다른 게임까지 끌고 오지 않아야 한다.
  const only = db([
    { id: 1, ko: "윙스팬", rank: 1 },
    { id: 2, ko: "와사비", rank: 2 },
  ]);
  assert.deepEqual(names(suggest(only, "윙스팬", 5)), ["윙스팬"]);
  assert.deepEqual(names(suggest(only, "ㅇㅅㅍ", 5)), ["윙스팬"]);
});

test("오타 허용: 3자 이상부터 한 글자 오타를 잡는다", () => {
  assert.deepEqual(names(suggest(SAMPLE, "윙스펜", 5)), ["윙스팬"]); // 치환
  assert.deepEqual(names(suggest(SAMPLE, "글룸헤이본", 5)), ["글룸헤이븐"]);
  assert.deepEqual(names(suggest(SAMPLE, "catna", 5)), ["카탄"]); // 인접 뒤바뀜
  assert.deepEqual(names(suggest(SAMPLE, "wingspam", 5)), ["윙스팬"]);
});

test("오타 허용: 다 치지 않은 상태의 오타도 잡는다", () => {
  assert.deepEqual(names(suggest(SAMPLE, "티캣투라이", 5)), ["티켓 투 라이드"]);
  assert.deepEqual(names(suggest(SAMPLE, "글룸헤", 5)), ["글룸헤이븐"]);
});

test("2자 이하 입력엔 오타 허용을 적용하지 않는다 (후보 폭발 방지)", () => {
  // "카딴"은 2자가 아니라 3자? → 한글 2자 오타는 걸리지 않아야 한다.
  assert.deepEqual(names(suggest(SAMPLE, "가탄", 5)), []);
  assert.deepEqual(names(suggest(SAMPLE, "카탄", 5)), ["카탄"]);
});

test("결과는 항상 랭킹순, limit을 넘지 않는다", () => {
  const many = db([
    { id: 1, ko: "테스트 게임 A", rank: 50 },
    { id: 2, ko: "테스트 게임 B", rank: 10 },
    { id: 3, ko: "테스트 게임 C", rank: 30 },
    { id: 4, ko: "테스트 게임 D", rank: null },
  ]);
  assert.deepEqual(names(suggest(many, "테스트", 3)), [
    "테스트 게임 B",
    "테스트 게임 C",
    "테스트 게임 A",
  ]);
  // 랭킹 없는 게임(null)은 맨 뒤
  assert.equal(names(suggest(many, "테스트", 10))[3], "테스트 게임 D");
});

test("exclude는 limit을 세기 전에 걸러진다", () => {
  const many = db([
    { id: 1, ko: "테스트 A", rank: 1 },
    { id: 2, ko: "테스트 B", rank: 2 },
    { id: 3, ko: "테스트 C", rank: 3 },
  ]);
  // 상위 2개를 이미 추측했어도 limit 2를 남은 후보로 채운다
  assert.deepEqual(names(suggest(many, "테스트", 2, new Set([1, 2]))), ["테스트 C"]);
  assert.deepEqual(names(suggest(many, "테스트", 2)), ["테스트 A", "테스트 B"]);
});

test("같은 게임이 여러 단계에 걸려도 한 번만 나온다", () => {
  const got = suggest(SAMPLE, "카탄", 5);
  assert.equal(got.length, new Set(got.map((g) => g.id)).size);
});

test("빈 입력·이름 없는 게임을 안전하게 처리한다", () => {
  assert.deepEqual(suggest(SAMPLE, ""), []);
  assert.deepEqual(suggest(SAMPLE, "   "), []);
  const holes = db([
    { id: 1, ko: null, en: null, rank: 1 },
    { id: 2, ko: null, en: "Nameless", rank: 2 },
  ]);
  assert.deepEqual(names(suggest(holes, "nameless", 5)), [null]);
  assert.deepEqual(names(suggest(holes, "ㄱ", 5)), []);
});

test("정규화 후 이름이 겹치면 랭킹 높은 쪽을 남긴다", () => {
  const dup = db([
    { id: 1, ko: "티켓 투 라이드", rank: 40 },
    { id: 2, ko: "티켓투라이드", rank: 4 },
  ]);
  assert.equal(resolve(dup, "티켓 투 라이드")?.id, 2);
});
