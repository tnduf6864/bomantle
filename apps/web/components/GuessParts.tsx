import type { SimilarityParts } from "../lib/types";

/**
 * 추측 1건의 축별 유사도(테마·진행방식·수치). 합계 점수만으로는 "왜 가까운지"를 알 수 없어
 * 감으로 찍게 된다 — 어느 축이 맞고 어느 축이 먼지 보여 줘서 다음 추측의 방향을 잡게 한다.
 * 막대 길이는 축마다 0~100 같은 눈금이다(가중치 적용 전).
 */
const AXES: { key: keyof SimilarityParts; label: string; title: string }[] = [
  { key: "theme", label: "테마", title: "테마·카테고리 태그가 얼마나 겹치는지" },
  { key: "mech", label: "진행", title: "진행방식(메커니즘) 태그가 얼마나 겹치는지" },
  { key: "num", label: "수치", title: "난이도·플레이타임·인원이 얼마나 비슷한지" },
];

function tone(v: number): string {
  if (v >= 70) return "hi";
  if (v >= 35) return "mid";
  return "lo";
}

export function GuessParts({ parts }: { parts: SimilarityParts }) {
  return (
    <div className="parts">
      {AXES.map(({ key, label, title }) => {
        const v = parts[key];
        return (
          <div className={`part ${tone(v)}`} key={key} title={`${title}: ${v.toFixed(0)}`}>
            <span className="part-label">{label}</span>
            <span className="part-bar">
              <span style={{ width: `${Math.max(2, v)}%` }} />
            </span>
            <span className="part-num">{v.toFixed(0)}</span>
          </div>
        );
      })}
    </div>
  );
}
