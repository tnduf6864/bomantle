"use client";

import { useMemo } from "react";
import { Modal } from "./Modal";
import { archiveDates, puzzleNumberOf, statusOf, type PlayStatus } from "../lib/play";

const BADGE: Record<PlayStatus, string> = {
  solved: "✅",
  gaveup: "🏳️",
  playing: "▶️",
  new: "",
};

/** localStorage의 날짜별 진행에서 목록 상태를 읽는다. 저장 불가·손상은 "안 함"으로. */
function readStatus(date: string) {
  try {
    const raw = localStorage.getItem(`bomantle:${date}`);
    return statusOf(raw ? JSON.parse(raw) : null);
  } catch {
    return statusOf(null);
  }
}

/**
 * 지난 문제 목록. 고르면 `?d=날짜`로 이동한다 — 새로 불러오는 편이 상태 초기화가 확실하고,
 * 그 링크를 그대로 공유할 수도 있다. 그날 실제로 플레이했다면 그때 기록이 그대로 열린다
 * (진행 저장 키가 날짜 기준이라).
 */
export function ArchiveModal({
  today,
  current,
  onClose,
}: {
  today: string;
  /** 지금 보고 있는 지난 문제 날짜(오늘 판이면 null) */
  current: string | null;
  onClose: () => void;
}) {
  const items = useMemo(
    () => archiveDates(today).map((date) => ({ date, n: puzzleNumberOf(date), ...readStatus(date) })),
    [today],
  );
  const done = items.filter((it) => it.status === "solved").length;

  return (
    <Modal title="📅 지난 문제" onClose={onClose}>
      <p className="archive-note">
        {items.length}문제 중 {done}개 맞힘 · 지난 문제는 개인 통계·연속 기록에 들어가지 않아요.
      </p>
      {current && (
        <a className="archive-today" href="/">
          ← 오늘 문제로 돌아가기
        </a>
      )}
      <ul className="archive-list">
        {items.map((it) => (
          <li key={it.date}>
            <a
              href={`/?d=${it.date}`}
              className={`archive-item ${it.status} ${it.date === current ? "current" : ""}`}
            >
              <span className="archive-no">#{it.n}</span>
              <span className="archive-date">{it.date}</span>
              <span className="archive-status">
                {BADGE[it.status]}
                {it.guesses > 0 && <span className="archive-guesses">{it.guesses}회</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
