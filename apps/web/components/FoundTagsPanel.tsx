import type { GameDB } from "../lib/games";
import type { FoundTags } from "../lib/play";

/**
 * 찾은 정답 태그 — "테마 1/3 · 카드 게임 · ? · ?".
 *
 * 같은 태그를 가진 게임을 추측하거나 태그 힌트(4·5·7단계)를 열면 그 태그가 여기에 쌓인다.
 * 막대(0~100)는 "얼마나" 겹쳤는지만 말해 주는데, 이 목록은 "무엇이" 겹쳤는지를 모아 둬서
 * 남은 ?를 채울 게임을 찾아가게 한다.
 */
export function FoundTagsPanel({ db, found }: { db: GameDB; found: FoundTags }) {
  if (!found.total) return null; // 새 형식 응답을 받기 전(첫 추측 전·구버전 저장분)
  const lines = [
    { key: "cats", label: "테마", ids: found.cats, total: found.total.cats, names: db.categories },
    { key: "mechs", label: "메커니즘", ids: found.mechs, total: found.total.mechs, names: db.mechanisms },
  ] as const;

  return (
    <div className="found-tags" aria-label="찾은 정답 태그">
      <div className="found-title">🎯 찾은 정답 태그</div>
      {lines.map(({ key, label, ids, total, names }) => {
        if (total === 0) return null; // 그 종류의 태그가 아예 없는 게임
        const shown = Math.min(ids.length, total);
        return (
          <div className="found-line" key={key}>
            <span className="found-label">
              {label} <b>{shown}</b>/{total}
            </span>
            <span className="found-chips">
              {ids.slice(0, total).map((id) => (
                <span className="found-chip" key={id}>
                  {names[String(id)] ?? `#${id}`}
                </span>
              ))}
              {Array.from({ length: total - shown }, (_, i) => (
                <span className="found-chip unknown" key={`u${i}`}>
                  ?
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
