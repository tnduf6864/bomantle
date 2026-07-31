import type { AnswerInfo } from "../lib/types";

/** 정답 카드 사양 목록. 값이 없는 항목은 통째로 뺀다(빈 줄 방지). */
export function answerSpecs(a: AnswerInfo): { label: string; value: string; wide?: boolean }[] {
  const out: { label: string; value: string; wide?: boolean }[] = [];
  const push = (label: string, value: string | null, wide = false) => {
    if (value) out.push({ label, value, wide });
  };
  const players =
    a.players_min == null
      ? null
      : a.players_min === a.players_max
        ? `${a.players_min}명`
        : `${a.players_min}-${a.players_max}명`;
  push("출시", a.year);
  push("인원", players && a.best_players ? `${players} (베스트 ${a.best_players}인)` : players);
  push("플레이타임", a.time_min ? `${a.time_min}분` : null);
  push("난이도", a.weight != null ? `${a.weight.toFixed(2)} / 5` : null);
  push("연령", a.age != null ? `${a.age}세 이상` : null);
  push("평점", a.rate != null ? a.rate.toFixed(1) : null);
  push("랭킹", a.rank != null ? `보드라이프 ${a.rank}위` : null);
  push("디자이너", a.designers.join(", ") || null, true);
  return out;
}

/** 정답 공개 시 보여주는 게임 정보 카드(박스아트 + 사양 + 태그 + 원문 링크). */
export function AnswerCard({ info }: { info: AnswerInfo }) {
  const specs = answerSpecs(info);
  const url = `https://boardlife.co.kr/game/${info.id}`;
  const caption = info.name_en ?? info.name_ko ?? "";
  return (
    <div className="answer-card">
      <div className="answer-head">
        {info.image && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              className="answer-img"
              src={info.image}
              alt={`${info.name_ko ?? ""} 박스아트`}
            />
          </a>
        )}
        <div className="answer-title">
          {caption && <div className="answer-en">{caption}</div>}
          {info.types.length > 0 && (
            <div className="answer-type">{info.types.join(" · ")}</div>
          )}
          <a className="answer-link-text" href={url} target="_blank" rel="noopener noreferrer">
            보드라이프에서 보기 ↗
          </a>
        </div>
      </div>

      {specs.length > 0 && (
        <dl className="answer-specs">
          {specs.map((s) => (
            <div className={`answer-spec ${s.wide ? "wide" : ""}`} key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(info.categories.length > 0 || info.mechanisms.length > 0) && (
        <div className="answer-tags">
          {info.categories.length > 0 && (
            <div className="answer-tag-row">
              <span className="answer-tag-label">테마</span>
              {info.categories.map((c) => (
                <span className="tag" key={c}>
                  {c}
                </span>
              ))}
            </div>
          )}
          {info.mechanisms.length > 0 && (
            <div className="answer-tag-row">
              <span className="answer-tag-label">진행방식</span>
              {info.mechanisms.map((m) => (
                <span className="tag" key={m}>
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
