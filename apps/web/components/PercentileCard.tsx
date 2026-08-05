import type { PercentileResult } from "../lib/types";
import { DistBars, type DistRow } from "./DistBars";

/**
 * 오늘 맞힌 사람 중 내 위치. 표본은 **맞힌 사람만**이므로 문구를 반드시 "맞힌 N명 중"으로
 * 쓴다(포기자를 포함한 것처럼 읽히면 수치가 거짓이 된다).
 *
 * 보맨틀·보들이 같은 카드를 쓰되 아래 분포만 다르다(보맨틀=힌트 개수별, 보들=추측 횟수별).
 * @param heading 상단 문구. 게임마다 표본 설명이 달라 밖에서 넘긴다.
 * @param detail  순위 줄 끝에 덧붙일 내 기록(예: "힌트 2개").
 * @param dist    카드 하단 분포. 없으면 그리지 않는다.
 */
export function PercentileCard({
  info,
  heading = "상위",
  detail,
  dist,
}: {
  info: PercentileResult;
  heading?: string;
  detail?: string;
  dist?: { title: string; rows: DistRow[] };
}) {
  if (info.pending) {
    return (
      <div className="pct">
        <div className="pct-pending">
          🏆 아직 집계 중 · 오늘 {info.total}명이 맞혔어요
          <div className="pct-note">몇 명 더 맞히면 상위 %가 표시돼요</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pct">
      <div className="pct-head">
        {heading} <b>{info.percentile}%</b>
      </div>
      <div className="pct-bar">
        <span className="pct-fill" style={{ width: `${info.percentile}%` }} />
        <span className="pct-marker" style={{ left: `${info.percentile}%` }} />
      </div>
      <div className="pct-note">
        오늘 맞힌 {info.total.toLocaleString()}명 중 <b>{info.rank.toLocaleString()}위</b>
        {detail && ` · ${detail}`}
      </div>

      {dist && (
        <div className="pct-dist">
          <DistBars title={dist.title} rows={dist.rows} />
        </div>
      )}
    </div>
  );
}

/** 포기한 사람용 — 백분위 표본(정답자)에 못 들어가므로 전체 현황을 대신 보여준다. */
export function TodaySummaryCard({
  players,
  solved,
  avgGuesses,
}: {
  players: number;
  solved: number;
  avgGuesses: number;
}) {
  return (
    <div className="pct">
      <div className="pct-pending">
        🌏 오늘 {players.toLocaleString()}명 중 <b>{solved.toLocaleString()}명</b>이 맞혔어요
        <div className="pct-note">
          정답률 {players ? Math.round((solved / players) * 100) : 0}%
          {avgGuesses > 0 && ` · 평균 ${avgGuesses}번 추측`}
        </div>
      </div>
    </div>
  );
}
