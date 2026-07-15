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

export interface GuessResult {
  id: number;
  score: number;
  rank: number;
  win: boolean;
  answer?: { id: number; name_ko: string | null; image?: string | null };
}

export interface TodayInfo {
  date: string;
  puzzleNumber: number;
  totalGames: number;
  poolSize: number;
  /** 오늘 접속자 수. 집계 불가(구버전 서버·DO 오류)면 null/없음 */
  visitors?: number | null;
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
