import type { Game, GameIndex, IndexedGame, ScoredGame, GuessResult } from "./types.ts";

/** 결합 가중치: 테마 0.45 + 진행방식 0.30 + 수치 0.25 */
export const THEME_WEIGHT = 0.45;
export const MECH_WEIGHT = 0.3;
export const NUM_WEIGHT = 0.25;

/** IDF 맵 구성: idf[t] = ln((N+1)/(df[t]+1)) + 1 (희귀 태그에 가중). */
function buildIdf(games: Game[], pick: (g: Game) => number[]): Map<number, number> {
  const N = games.length;
  const df = new Map<number, number>();
  for (const g of games) {
    for (const t of new Set(pick(g))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<number, number>();
  for (const [t, c] of df) idf.set(t, Math.log((N + 1) / (c + 1)) + 1);
  return idf;
}

/** id 목록 -> {id: idf} 벡터 + 노름. */
function toVec(
  ids: number[],
  idf: Map<number, number>,
): { vec: Map<number, number>; norm: number } {
  const vec = new Map<number, number>();
  for (const t of new Set(ids)) vec.set(t, idf.get(t) ?? 0);
  let sq = 0;
  for (const v of vec.values()) sq += v * v;
  return { vec, norm: Math.sqrt(sq) };
}

/**
 * 게임 배열로부터 유사도 인덱스를 만든다.
 * 테마(categories)와 진행방식(mechanisms) 각각 IDF 가중 벡터 + 노름을 사전 계산.
 */
export function buildIndex(games: Game[]): GameIndex {
  const idf = buildIdf(games, (g) => g.categories);
  const midf = buildIdf(games, (g) => g.mechanisms ?? []);

  // weight 평균(결측 대체용)
  let wSum = 0;
  let wCount = 0;
  for (const g of games) {
    if (g.weight != null) {
      wSum += g.weight;
      wCount += 1;
    }
  }
  const weightMean = wCount ? wSum / wCount : 2.5;

  const byId = new Map<number, IndexedGame>();
  const order: number[] = [];
  for (const g of games) {
    const t = toVec(g.categories, idf);
    const m = toVec(g.mechanisms ?? [], midf);
    byId.set(g.id, {
      id: g.id,
      vec: t.vec,
      norm: t.norm,
      mvec: m.vec,
      mnorm: m.norm,
      weight: g.weight,
      timeMin: g.time_min,
      playersMin: g.players_min,
      playersMax: g.players_max,
    });
    order.push(g.id);
  }

  return { byId, order, idf, midf, weightMean };
}

/** 두 IDF 가중 벡터의 코사인 유사도 (0~1). 빈 벡터는 0. */
function cosine(
  aVec: Map<number, number>,
  aNorm: number,
  bVec: Map<number, number>,
  bNorm: number,
): number {
  if (aNorm === 0 || bNorm === 0) return 0;
  const [small, large] = aVec.size <= bVec.size ? [aVec, bVec] : [bVec, aVec];
  let dot = 0;
  for (const [t, v] of small) {
    const w = large.get(t);
    if (w !== undefined) dot += v * w;
  }
  return dot / (aNorm * bNorm);
}

/** 테마 태그 코사인 (0~1). */
export function tagCosine(a: IndexedGame, b: IndexedGame): number {
  return cosine(a.vec, a.norm, b.vec, b.norm);
}

/** 진행방식 태그 코사인 (0~1). */
export function mechCosine(a: IndexedGame, b: IndexedGame): number {
  return cosine(a.mvec, a.mnorm, b.mvec, b.mnorm);
}

/** 난이도/시간/인원 기반 수치 유사도 (0~1). 사용 가능한 항목 평균. */
export function numericSim(a: IndexedGame, b: IndexedGame, weightMean: number): number {
  const sims: number[] = [];

  // 난이도(weight): 범위 ~1-5, 차이 2.5에서 0
  const w1 = a.weight ?? weightMean;
  const w2 = b.weight ?? weightMean;
  sims.push(Math.max(0, 1 - Math.abs(w1 - w2) / 2.5));

  // 플레이 시간: 로그 스케일
  if (a.timeMin && b.timeMin) {
    const d = Math.abs(Math.log10(a.timeMin + 1) - Math.log10(b.timeMin + 1));
    sims.push(Math.max(0, 1 - d / 1.0));
  }

  // 인원 범위 겹침(Jaccard)
  if (a.playersMin && a.playersMax && b.playersMin && b.playersMax) {
    const lo = Math.max(a.playersMin, b.playersMin);
    const hi = Math.min(a.playersMax, b.playersMax);
    const inter = Math.max(0, hi - lo + 1);
    const union =
      a.playersMax - a.playersMin + 1 + (b.playersMax - b.playersMin + 1) - inter;
    if (union > 0) sims.push(inter / union);
  }

  return sims.length ? sims.reduce((x, y) => x + y, 0) / sims.length : 0;
}

/** 두 게임의 결합 유사도 (0~1): 테마 + 진행방식 + 수치. */
export function similarity(a: IndexedGame, b: IndexedGame, idx: GameIndex): number {
  return (
    THEME_WEIGHT * tagCosine(a, b) +
    MECH_WEIGHT * mechCosine(a, b) +
    NUM_WEIGHT * numericSim(a, b, idx.weightMean)
  );
}

/** 0~1 유사도를 0~100 표시 점수로. */
export function toScore(sim: number): number {
  return Math.round(sim * 1000) / 10;
}

/**
 * answerId 기준 전체 게임을 유사도 내림차순으로 정렬한 랭킹.
 * 정답 자신은 제외. 하루에 한 번 계산해 캐시하기 위한 용도.
 */
export function rankAgainst(idx: GameIndex, answerId: number): ScoredGame[] {
  const answer = idx.byId.get(answerId);
  if (!answer) throw new Error(`unknown answer id: ${answerId}`);
  const out: ScoredGame[] = [];
  for (const id of idx.order) {
    if (id === answerId) continue;
    const g = idx.byId.get(id)!;
    out.push({ id, score: toScore(similarity(answer, g, idx)) });
  }
  out.sort((x, y) => y.score - x.score || x.id - y.id);
  return out;
}

/**
 * 사전 정렬된 랭킹(rankAgainst 결과)에서 한 추측의 결과를 조회.
 * rank는 1-base. 정답을 맞히면 win=true, rank=0.
 */
export function evaluateGuess(
  ranking: ScoredGame[],
  rankPos: Map<number, number>,
  answerId: number,
  guessId: number,
): GuessResult {
  if (guessId === answerId) {
    return { id: guessId, score: 100, rank: 0, win: true };
  }
  const pos = rankPos.get(guessId);
  if (pos === undefined) {
    return { id: guessId, score: 0, rank: ranking.length + 1, win: false };
  }
  return { id: guessId, score: ranking[pos].score, rank: pos + 1, win: false };
}

/** 랭킹 배열 -> id별 위치(0-base) 맵. evaluateGuess 빠른 조회용. */
export function buildRankPositions(ranking: ScoredGame[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < ranking.length; i++) m.set(ranking[i].id, i);
  return m;
}
