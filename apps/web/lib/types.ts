export interface GameMeta {
  id: number;
  name_ko: string | null;
  name_en: string | null;
  year: string | null;
  rank: number | null;
  rate: number | null;
  bgg_id: number | null;
  categories: number[];
  weight: number | null;
  players_min: number | null;
  players_max: number | null;
  time_min: number | null;
  age: number | null;
}

/** 정답 공개(맞힘·포기) 시 서버가 내려주는 정답 게임 정보. 워커 reveal.ts와 동일 형태. */
export interface AnswerInfo {
  id: number;
  name_ko: string | null;
  name_en: string | null;
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
  age: number | null;
  types: string[];
  /** 테마 태그 이름 */
  categories: string[];
  /** 진행방식 태그 이름 */
  mechanisms: string[];
  designers: string[];
}

export interface GuessResult {
  id: number;
  score: number;
  rank: number;
  win: boolean;
  answer?: AnswerInfo;
}

export interface TodayInfo {
  date: string;
  puzzleNumber: number;
  totalGames: number;
  poolSize: number;
  /** 오늘 접속자 수. 집계 불가(구버전 서버·DO 오류)면 null/없음 */
  visitors?: number | null;
}

/** 전체 순위 목록의 한 항목. 이름은 없다 — games.json에서 id로 찾아 쓴다. */
export interface RankingItem {
  id: number;
  score: number;
}

/** GET /api/ranking 한 페이지. total은 정답을 제외한 전체 게임 수. */
export interface RankingPage {
  total: number;
  offset: number;
  items: RankingItem[];
}

/**
 * POST /api/result 응답 — 오늘 **맞힌 사람** 중 내 순위·백분위.
 * 워커 `results.ts`의 RankResult와 같은 형태(이름은 유사도 순위 목록과 겹치지 않게 구분).
 */
export interface PercentileResult {
  rank: number;
  /** 표본 = 오늘 맞힌 사람 수. 포기자는 포함되지 않는다 */
  total: number;
  /** 상위 N% (1~100, 올림) */
  percentile: number;
  /** 서버에 기록된 내 값. 첫 제출이 고정되므로 클라 값과 다를 수 있다 */
  hints: number;
  guesses: number;
  /** index = 힌트 개수 0..8 */
  hintDist: number[];
  /** 버킷 라벨 -> 인원. 라벨은 lib/stats.ts의 GUESS_BUCKETS와 같다 */
  guessDist: Record<string, number>;
  /** 표본 부족 — 순위를 감추고 참여 인원만 보여준다 */
  pending?: boolean;
}

export interface HintData {
  level: number;
  label: string;
  value: string;
  kind: "text" | "image";
}

/** 추측 1건의 화면 표시용 레코드 */
export interface GuessRow extends GuessResult {
  game: GameMeta;
  /** 입력 순서(중복 강조용) */
  seq: number;
}
