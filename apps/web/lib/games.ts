import type { GameMeta } from "./types";

/**
 * 검색용 이름 정규화. 공백과 구두점을 모두 버려 표기 차이를 흡수한다
 * ("브라스: 버밍엄" ↔ "브라스 버밍엄", "d&d" ↔ "dd"). 문자·숫자는 스크립트에
 * 상관없이 남기므로 한글/영문/일본어 이름이 모두 검색 대상으로 남는다.
 */
const PUNCT = /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~·․–—―‘’“”…]/g;

const norm = (s: string) => s.toLowerCase().replace(PUNCT, "");

// 초성 19자. 워커 hint.ts와 같은 규칙(같은 순서)이라 8단계 힌트의 초성과 맞물린다.
const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const CHO_SET = new Set(CHO);

/** 한글 음절 → 초성. 그 외 문자(자모·영문·숫자)는 그대로 둔다. */
function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out +=
      code >= 0xac00 && code <= 0xd7a3
        ? CHO[Math.floor((code - 0xac00) / 588)]
        : ch;
  }
  return out;
}

/** 초성 자모(ㄱ~ㅎ)를 하나라도 포함하는가. 모음(ㅏ 등)·겹자모(ㄳ 등)는 해당 없음. */
function hasChoJamo(s: string): boolean {
  for (const ch of s) if (CHO_SET.has(ch)) return true;
  return false;
}

/**
 * q가 name의 **어떤 앞부분과도** 편집거리 tol 이내인가. 이름 전체가 아니라 앞부분과
 * 비교하므로 다 치지 않은 상태의 오타("티캣투라이" → "티켓 투 라이드")도 걸린다.
 * 인접 문자가 뒤바뀐 오타는 1로 센다(OSA) — 실제로 가장 흔한 유형("catna" → "catan").
 */
function nearPrefix(q: string, name: string, tol: number): boolean {
  const n = q.length;
  if (!name || n === 0) return false;
  // q보다 tol 이상 더 긴 앞부분은 볼 필요가 없다 — 삭제 비용만으로 tol을 넘는다.
  const b = name.slice(0, n + tol);
  const m = b.length;
  if (n - m > tol) return false;

  // 뒤바뀜 판정에 i-2 행이 필요해 세 줄을 돌려 쓴다.
  let r0 = new Array<number>(m + 1);
  let r1 = new Array<number>(m + 1);
  let r2 = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) r1[j] = j;

  for (let i = 1; i <= n; i++) {
    r2[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = q[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(r1[j] + 1, r2[j - 1] + 1, r1[j - 1] + cost);
      if (i > 1 && j > 1 && q[i - 1] === b[j - 2] && q[i - 2] === b[j - 1]) {
        v = Math.min(v, r0[j - 2] + 1);
      }
      r2[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // 행 최솟값은 줄어들지 않으므로, 여기서 초과면 남은 행도 가망이 없다.
    if (rowMin > tol) return false;
    const t = r0;
    r0 = r1;
    r1 = r2;
    r2 = t;
  }

  // 마지막 행의 최솟값 = 가장 잘 맞는 앞부분까지의 거리.
  for (let j = 0; j <= m; j++) if (r1[j] <= tol) return true;
  return false;
}

/** 오타 허용 폭. 짧은 입력에 거리를 주면 후보가 폭발하므로 3자부터 연다. */
function typoTolerance(q: string): number {
  return q.length >= 6 ? 2 : q.length >= 3 ? 1 : 0;
}

/** 자동완성용 사전 정규화 항목. 키스트로크마다 norm을 다시 돌리지 않기 위한 캐시. */
interface SearchEntry {
  game: GameMeta;
  /** 정규화 한글명 (없으면 "") */
  ko: string;
  /** 정규화 영문명 (없으면 "") */
  en: string;
  /** 한글명의 초성 */
  cho: string;
}

export interface GameDB {
  games: GameMeta[];
  byId: Map<number, GameMeta>;
  categories: Record<string, string>;
  mechanisms: Record<string, string>;
  /** 정규화 이름 -> game (정확 매칭용) */
  exact: Map<string, GameMeta>;
  /** 랭킹 오름차순. 단계별로 순서대로 담기면 결과가 그대로 랭킹순이 된다 */
  entries: SearchEntry[];
}

const rankOf = (g: GameMeta) => g.rank ?? Number.MAX_SAFE_INTEGER;

/** 받아온 데이터로 검색 인덱스를 구성한다(순수 함수 — 테스트에서 직접 호출). */
export function buildGameDB(
  games: GameMeta[],
  categories: Record<string, string>,
  mechanisms: Record<string, string> = {},
): GameDB {
  const byId = new Map<number, GameMeta>();
  const exact = new Map<string, GameMeta>();
  const entries: SearchEntry[] = [];

  for (const g of games) {
    byId.set(g.id, g);
    const ko = g.name_ko ? norm(g.name_ko) : "";
    const en = g.name_en ? norm(g.name_en) : "";
    for (const key of [ko, en]) {
      if (!key) continue;
      // 정규화 후 이름이 겹치면 랭킹이 높은(숫자가 작은) 쪽을 남긴다.
      const prev = exact.get(key);
      if (!prev || rankOf(g) < rankOf(prev)) exact.set(key, g);
    }
    if (ko || en) entries.push({ game: g, ko, en, cho: chosung(ko) });
  }

  entries.sort((a, b) => rankOf(a.game) - rankOf(b.game));
  return { games, byId, categories, mechanisms, exact, entries };
}

export async function loadGameDB(): Promise<GameDB> {
  const [games, categories, mechanisms] = await Promise.all([
    fetch("/games.json").then((r) => r.json() as Promise<GameMeta[]>),
    fetch("/categories.json").then((r) => r.json() as Promise<Record<string, string>>),
    fetch("/mechanisms.json").then((r) => r.json() as Promise<Record<string, string>>),
  ]);
  return buildGameDB(games, categories, mechanisms);
}

/**
 * 입력 문자열을 정확한 게임으로 해석(이름 정규화 일치).
 * 초성·오타 보정은 적용하지 않는다 — 추측 1회를 소모하므로 확실할 때만 통과시킨다.
 * (오타 입력은 자동완성 후보를 골라 제출하는 경로로 처리된다.)
 */
export function resolve(db: GameDB, query: string): GameMeta | null {
  return db.exact.get(norm(query)) ?? null;
}

/**
 * 자동완성에 띄우는 후보 수.
 *
 * 8개였을 때는 "브라스"·"카탄"처럼 시리즈가 긴 검색어에서 정작 찾던 편이 잘려 나갔다.
 * 수록 범위가 보드라이프 등록 게임 전체로 넓어지면서 더 심해질 자리라 늘렸다.
 * 목록은 자체 스크롤(.suggest max-height)이라 길어져도 화면을 밀지 않는다.
 */
export const SUGGEST_LIMIT = 30;

/**
 * 자동완성 후보. 단계 순으로 채운다: 정확 → 접두 → 부분 → 초성 → 오타 허용.
 * 앞 단계가 limit을 채우면 뒤 단계는 아예 돌지 않아 흔한 입력에서는 비용이 거의 없다.
 * `exclude`(이미 추측한 id)는 limit을 세기 **전에** 걸러야 후보가 빈 채로 남지 않는다.
 */
export function suggest(
  db: GameDB,
  query: string,
  limit = 8,
  exclude?: Set<number>,
): GameMeta[] {
  const q = norm(query);
  if (!q) return [];

  const out: GameMeta[] = [];
  const seen = new Set<number>();

  const stage = (match: (e: SearchEntry) => boolean) => {
    if (out.length >= limit) return;
    for (const e of db.entries) {
      const id = e.game.id;
      if (seen.has(id) || exclude?.has(id)) continue;
      if (!match(e)) continue;
      seen.add(id);
      out.push(e.game);
      if (out.length >= limit) return;
    }
  };

  stage((e) => e.ko === q || e.en === q);
  stage((e) => e.ko.startsWith(q) || e.en.startsWith(q));
  stage((e) => e.ko.includes(q) || e.en.includes(q));

  // 초성은 자모가 섞인 입력에서만 — 안 그러면 다 타이핑한 이름까지 같은 초성 게임들로 퍼진다.
  if (hasChoJamo(q)) {
    const cp = chosung(q);
    stage((e) => e.cho.startsWith(cp));
    stage((e) => e.cho.includes(cp));
  }

  const tol = typoTolerance(q);
  if (tol > 0) stage((e) => nearPrefix(q, e.ko, tol) || nearPrefix(q, e.en, tol));

  return out;
}

export function categoryNames(db: GameDB, g: GameMeta): string[] {
  return g.categories.map((c) => db.categories[String(c)] ?? String(c));
}

export function mechanismNames(db: GameDB, g: GameMeta): string[] {
  return g.mechanisms.map((m) => db.mechanisms[String(m)] ?? String(m));
}
