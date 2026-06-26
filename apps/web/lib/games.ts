import type { GameMeta } from "./types";

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export interface GameDB {
  games: GameMeta[];
  byId: Map<number, GameMeta>;
  categories: Record<string, string>;
  /** 정규화 이름 -> game (정확 매칭용) */
  exact: Map<string, GameMeta>;
}

export async function loadGameDB(): Promise<GameDB> {
  const [games, categories] = await Promise.all([
    fetch("/games.json").then((r) => r.json() as Promise<GameMeta[]>),
    fetch("/categories.json").then((r) => r.json() as Promise<Record<string, string>>),
  ]);
  const byId = new Map<number, GameMeta>();
  const exact = new Map<string, GameMeta>();
  for (const g of games) {
    byId.set(g.id, g);
    if (g.name_ko) exact.set(norm(g.name_ko), g);
    if (g.name_en) exact.set(norm(g.name_en), g);
  }
  return { games, byId, categories, exact };
}

/** 입력 문자열을 정확한 게임으로 해석(이름 정규화 일치). */
export function resolve(db: GameDB, query: string): GameMeta | null {
  return db.exact.get(norm(query)) ?? null;
}

/** 자동완성 후보: 접두 일치 우선, 그다음 부분 일치. 랭킹순. */
export function suggest(db: GameDB, query: string, limit = 8): GameMeta[] {
  const q = norm(query);
  if (!q) return [];
  const pre: GameMeta[] = [];
  const sub: GameMeta[] = [];
  for (const g of db.games) {
    const ko = g.name_ko ? norm(g.name_ko) : "";
    const en = g.name_en ? norm(g.name_en) : "";
    if (ko.startsWith(q) || en.startsWith(q)) pre.push(g);
    else if (ko.includes(q) || en.includes(q)) sub.push(g);
    if (pre.length >= limit * 4) break;
  }
  const byRank = (a: GameMeta, b: GameMeta) => (a.rank ?? 1e9) - (b.rank ?? 1e9);
  pre.sort(byRank);
  sub.sort(byRank);
  return [...pre, ...sub].slice(0, limit);
}

export function categoryNames(db: GameDB, g: GameMeta): string[] {
  return g.categories.map((c) => db.categories[String(c)] ?? String(c));
}
