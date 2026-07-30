import { DurableObject } from "cloudflare:workers";
import {
  MIN_SAMPLE,
  avgGuessesOf,
  buildDistribution,
  percentileOf,
  rankAmong,
  type Distribution,
  type ResultRow,
  type Submission,
} from "./rank.ts";

// 날짜별 결과 보드. 퍼즐 날짜(YYYY-MM-DD)당 인스턴스 하나(idFromName(date)).
// VisitCounter와 같은 패턴이되 KV API가 아니라 SQLite 스토리지를 쓴다 —
// 카운터 하나가 아니라 행별 기록·정렬·순위가 필요하기 때문.
// 날짜별 인스턴스라 자연히 샤딩되고, DO는 단일 스레드라 쓰기 경쟁도 없다.

/** 기록 보존 기간. 지나면 alarm이 인스턴스 데이터를 비운다(무한 누적 방지). */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * 오늘 전체 현황(익명 집계). `RankResult`와 달리 **포기까지 포함**한 참여 수를 담는다.
 * 정답률은 `solved / players`로 클라에서 파생한다(서버는 원시 카운트만 내려준다).
 */
export interface BoardSnapshot {
  /** 결과를 제출한 사람 수(정답 + 포기) */
  players: number;
  /** 그중 맞힌 사람 수 */
  solved: number;
  /** 정답자 평균 추측 횟수(소수 1자리) */
  avgGuesses: number;
  /** 아래 분포는 모두 **정답자 기준** */
  hintDist: number[];
  guessDist: Record<string, number>;
}

/** 백분위 응답. total은 **맞힌 사람 수**(포기자는 분모에 없다). */
export interface RankResult {
  rank: number;
  total: number;
  percentile: number;
  /** 서버에 기록된 내 값(첫 제출이 고정되므로 클라 값과 다를 수 있다) */
  hints: number;
  guesses: number;
  hintDist: number[];
  guessDist: Record<string, number>;
  /** 표본이 MIN_SAMPLE 미만이면 순위를 감추고 이 플래그로 내려준다 */
  pending?: boolean;
}

// env 바인딩은 쓰지 않으므로 unknown으로 둔다(생성자에서 테이블만 준비한다).
export class ResultBoard extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // 인스턴스 첫 사용 시 1회. 이후 호출은 IF NOT EXISTS로 무해하다.
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS results (
        cid     TEXT PRIMARY KEY,
        hints   INTEGER NOT NULL,
        guesses INTEGER NOT NULL,
        solved  INTEGER NOT NULL DEFAULT 1,
        ts      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rank ON results (solved, hints, guesses, ts);
    `);
  }

  /**
   * 기록을 남기고(첫 제출만) 현재 표본 기준 순위를 계산한다.
   *
   * 멱등: 같은 cid가 다시 와도 `INSERT OR IGNORE`로 기록은 바뀌지 않는다.
   * 그래서 "새로고침 시 재조회"는 별도 읽기 엔드포인트 없이 같은 POST로 처리되고,
   * 기록은 고정된 채 순위만 늘어난 표본 기준으로 재계산된다.
   */
  async submit(s: Submission): Promise<RankResult> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();

    sql.exec(
      `INSERT OR IGNORE INTO results (cid, hints, guesses, solved, ts) VALUES (?, ?, ?, ?, ?)`,
      s.cid,
      s.hints,
      s.guesses,
      s.solved ? 1 : 0,
      now,
    );

    // 최초 쓰기 때만 정리 알람을 건다(이미 걸려 있으면 그대로 둔다).
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + RETENTION_MS);
    }

    // 내 기록을 다시 읽는다 — 위에서 무시됐으면 기존(첫) 값이 나온다.
    const mine = sql
      .exec<{ hints: number; guesses: number; ts: number }>(
        `SELECT hints, guesses, ts FROM results WHERE cid = ?`,
        s.cid,
      )
      .toArray()[0];

    const rows = this.#solvedRows();
    const total = rows.length;

    // 포기 제출(solved = 0)은 표본에 없으므로 순위를 낼 수 없다. 표본 수만 돌려준다.
    if (!mine || !s.solved) {
      return {
        rank: 0,
        total,
        percentile: 100,
        hints: s.hints,
        guesses: s.guesses,
        ...this.#dist(rows),
        pending: true,
      };
    }

    const rank = rankAmong(rows, mine);
    return {
      rank,
      total,
      percentile: percentileOf(rank, total),
      hints: mine.hints,
      guesses: mine.guesses,
      ...this.#dist(rows),
      // 표본이 너무 적으면 순위가 요동치고 사실상 개인 식별에 가까워진다.
      ...(total < MIN_SAMPLE ? { pending: true } : {}),
    };
  }

  /** 쓰기 없이 오늘 전체 현황만. 포기자 화면·통계 모달용. */
  async snapshot(): Promise<BoardSnapshot> {
    const rows = this.#solvedRows();
    return {
      players: this.#playerCount(),
      solved: rows.length,
      avgGuesses: avgGuessesOf(rows),
      ...this.#dist(rows),
    };
  }

  /** 제출자 총원(정답 + 포기). 행 전체를 읽지 않도록 COUNT로만 센다. */
  #playerCount(): number {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM results`)
        .toArray()[0]?.n ?? 0
    );
  }

  /**
   * 순위 표본 = **맞힌 사람만**. 포기 기록(solved = 0)도 테이블엔 남지만 제외한다.
   * 표본이 커지면(수만 행) 스냅샷 캐시를 두는 게 다음 단계다.
   */
  #solvedRows(): ResultRow[] {
    return this.ctx.storage.sql
      .exec<{ hints: number; guesses: number; ts: number }>(
        `SELECT hints, guesses, ts FROM results WHERE solved = 1`,
      )
      .toArray();
  }

  #dist(rows: ResultRow[]): Distribution {
    return buildDistribution(rows);
  }

  /** 보존 기간 경과 — 이 날짜 기록을 비운다. 과거 통계를 남기려면 여기를 먼저 바꿀 것. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
