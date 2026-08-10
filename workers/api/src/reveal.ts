import type { FullGame } from "./hint.ts";

/**
 * 정답 공개(맞힘·포기) 시 내려주는 게임 정보.
 * 힌트와 달리 감출 게 없으므로 이름·사양·태그를 그대로 노출한다.
 */
export interface AnswerInfo {
  id: number;
  name_ko: string | null;
  name_en: string | null;
  /** 재호스팅된 박스아트 경로(없으면 null) */
  image: string | null;
  year: string | null;
  /** 보드라이프 랭킹 */
  rank: number | null;
  rate: number | null;
  weight: number | null;
  players_min: number | null;
  players_max: number | null;
  best_players: string | null;
  time_min: number | null;
  time_max: number | null;
  age: number | null;
  types: string[];
  /** 테마 태그 이름 */
  categories: string[];
  /** 진행방식 태그 이름 */
  mechanisms: string[];
  designers: string[];
}

// 태그가 너무 길어지지 않도록 상한 (카드 레이아웃 유지용).
const MAX_TAGS = 8;

/** 태그 id 목록 → 이름 목록. 사전에 없는 id는 버림. */
function tagNames(ids: number[] | undefined, dict: Record<string, string>): string[] {
  return (ids ?? [])
    .map((id) => dict[String(id)])
    .filter((n): n is string => !!n)
    .slice(0, MAX_TAGS);
}

/** 정답 게임 → 공개용 정보. image는 호출부(재호스팅 여부 판단)가 넘긴다. */
export function buildAnswerInfo(
  g: FullGame,
  cats: Record<string, string>,
  mechs: Record<string, string>,
  image: string | null,
): AnswerInfo {
  return {
    id: g.id,
    name_ko: g.name_ko,
    name_en: g.name_en,
    image,
    year: g.year,
    rank: g.rank,
    rate: g.rate,
    weight: g.weight,
    players_min: g.players_min,
    players_max: g.players_max,
    best_players: g.best_players ?? null,
    time_min: g.time_min,
    time_max: g.time_max,
    age: g.age,
    types: g.types ?? [],
    categories: tagNames(g.categories, cats),
    mechanisms: tagNames(g.mechanisms, mechs),
    designers: g.designers ?? [],
  };
}
