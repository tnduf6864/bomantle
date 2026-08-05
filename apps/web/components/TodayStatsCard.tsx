import { GUESS_BUCKETS, type GuessBucket } from "../lib/stats";
import type { TodayStats } from "../lib/types";
import { DistBars } from "./DistBars";

/** 오늘 참여자 중 맞힌 비율(%). 참여 0이면 0. */
function todayWinRate(s: TodayStats): number {
  return s.players ? Math.round((s.solved / s.players) * 100) : 0;
}

/**
 * 오늘의 전체 현황(익명 집계). 개인 통계(localStorage)와 달리 서버 집계이고,
 * **분모에 포기까지 포함**한다 — 분포 막대는 정답자 기준이므로 라벨로 구분해 둔다.
 * @param buckets 표시할 버킷만 골라서 넘긴다(보들은 최대 8회라 앞쪽 버킷만 의미 있음).
 */
export function TodayStatsCard({
  info,
  myBucket,
  buckets = GUESS_BUCKETS,
}: {
  info: TodayStats;
  myBucket: GuessBucket | null;
  buckets?: readonly GuessBucket[];
}) {
  return (
    <div className="today-stats">
      <div className="dist-title">
        🌏 오늘의 전체 현황
        <span className="dist-note"> · 익명 집계</span>
      </div>

      {info.players === 0 ? (
        <div className="today-empty">아직 오늘 결과를 낸 사람이 없어요. 첫 번째가 되어보세요!</div>
      ) : (
        <>
          <div className="stat-grid stat-grid-3">
            <div className="stat-cell">
              <div className="stat-num">{info.players.toLocaleString()}</div>
              <div className="stat-lbl">참여</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{todayWinRate(info)}%</div>
              <div className="stat-lbl">정답률</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{info.avgGuesses || "–"}</div>
              <div className="stat-lbl">평균 추측</div>
            </div>
          </div>

          {info.solved > 0 && (
            <DistBars
              title="추측 횟수 분포"
              note={`맞힌 ${info.solved.toLocaleString()}명 기준`}
              rows={buckets.map((b) => ({
                label: b,
                count: info.guessDist[b] ?? 0,
                mine: b === myBucket,
              }))}
            />
          )}
        </>
      )}
    </div>
  );
}
