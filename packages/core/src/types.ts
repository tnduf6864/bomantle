/** 정제 데이터셋(games.json)의 한 게임. 보드라이프 + 카테고리 기반. */
export interface Game {
  id: number;
  name_ko: string | null;
  name_en: string | null;
  year: string | null;
  rank: number | null;
  rate: number | null;
  bgg_id: number | null;
  /** 보드라이프 카테고리/테마 태그 id 목록 */
  categories: number[];
  /** 보드라이프 진행방식(메커니즘) 태그 id 목록 */
  mechanisms?: number[];
  /** 난이도(weight) 1~5, 없을 수 있음 */
  weight: number | null;
  players_min: number | null;
  players_max: number | null;
  time_min: number | null;
  age: number | null;
  /** 평가 수(인지도 신호). 정답 풀 큐레이션용 */
  review_count?: number | null;
}

/** 인덱싱된 게임: 테마·진행방식 벡터(IDF 가중) + 노름 + 수치 피처. */
export interface IndexedGame {
  id: number;
  /** 테마 tagId -> idf 가중치 */
  vec: Map<number, number>;
  /** |vec| (테마 코사인 분모용 사전 계산) */
  norm: number;
  /** 진행방식 tagId -> idf 가중치 */
  mvec: Map<number, number>;
  /** |mvec| (진행방식 코사인 분모용 사전 계산) */
  mnorm: number;
  weight: number | null;
  timeMin: number | null;
  playersMin: number | null;
  playersMax: number | null;
}

export interface GameIndex {
  byId: Map<number, IndexedGame>;
  /** 등장 순서(보통 랭킹순) id 배열 */
  order: number[];
  /** 테마 tagId -> idf */
  idf: Map<number, number>;
  /** 진행방식 tagId -> idf */
  midf: Map<number, number>;
  /** 결측 weight 대체용 평균 */
  weightMean: number;
}

export interface ScoredGame {
  id: number;
  /** 0~100 표시 점수 */
  score: number;
}

export interface GuessResult {
  id: number;
  score: number;
  /** 정답과의 유사도 순위(1 = 가장 가까움). 정답 자신은 제외한 1-base */
  rank: number;
  win: boolean;
}
