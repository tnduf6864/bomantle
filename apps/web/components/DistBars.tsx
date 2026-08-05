/** 분포 막대 한 줄. */
export interface DistRow {
  label: string;
  count: number;
  /** 내 기록이 속한 줄 — 강조색 */
  mine?: boolean;
}

/**
 * 가로 막대 분포. 개인 통계·전체 현황·백분위 카드가 모두 같은 모양을 쓰므로
 * 여기 한 곳에서만 그린다(막대 길이 규칙이 화면마다 달라지면 비교가 어긋난다).
 * 0인 줄도 라벨은 남긴다 — 줄이 사라지면 분포의 모양을 못 읽는다.
 */
export function DistBars({
  title,
  note,
  rows,
}: {
  title: string;
  note?: string;
  rows: DistRow[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="dist">
      <div className="dist-title">
        {title}
        {note && <span className="dist-note"> · {note}</span>}
      </div>
      {rows.map((r) => (
        <div className="dist-row" key={r.label}>
          <span className="dist-lbl">{r.label}</span>
          <div className="dist-bar">
            <span
              className={`dist-fill ${r.mine ? "hi" : ""}`}
              // 1명짜리 막대도 숫자가 들어갈 만큼은 보이게 최소 폭을 준다
              style={{ width: `${r.count ? Math.max(12, (r.count / max) * 100) : 0}%` }}
            >
              {r.count > 0 && <em>{r.count}</em>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
