import type { Game, GameIndex } from "@bomantle/core";

/** 워커 games.json(풀 버전)의 게임 — core Game + 힌트용 추가 필드. */
export interface FullGame extends Game {
  types?: string[];
  designers?: string[];
  image?: string | null;
  best_players?: string | null;
  recommended_players?: string | null;
}

export interface HintData {
  level: number;
  label: string;
  value: string;
  kind: "text" | "image";
}

const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** 한글 문자열 → 초성. 비한글(숫자/영문/기호)은 그대로, 공백 유지. */
function chosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHO[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 난이도를 0.5 폭 밴드로 (예: 3.79 → "3.5 ~ 4.0"). */
function weightBand(w: number): string {
  const lo = Math.floor(w * 2) / 2;
  return `${lo.toFixed(1)} ~ ${(lo + 0.5).toFixed(1)}`;
}

/** 태그 중 가장 흔한(idf 최소) 1개 id — 정답이 콕 집히지 않도록. */
function commonest(ids: number[], idf: Map<number, number>): number | undefined {
  let best: number | undefined;
  let bestIdf = Infinity;
  for (const id of ids) {
    const v = idf.get(id) ?? Infinity;
    if (v < bestIdf) {
      bestIdf = v;
      best = id;
    }
  }
  return best;
}

function text(level: number, label: string, value: string): HintData {
  return { level, label, value: value || "정보 없음", kind: "text" };
}

/**
 * 단계별 힌트(8단계). 정답 이름은 7·8단계의 글자수·초성 외에는 노출하지 않음.
 * 박스아트는 정답 공개 시에만 보여주므로 힌트에서 제외.
 * 1 인원·시간 / 2 타입+테마 / 3 난이도밴드 / 4 진행방식+베스트인원 /
 * 5 출시연도 / 6 디자이너 / 7 글자수 / 8 초성
 */
export function buildHint(
  level: number,
  g: FullGame,
  index: GameIndex,
  cats: Record<string, string>,
  mechs: Record<string, string>,
): HintData {
  switch (level) {
    case 1: {
      const players =
        g.players_min === g.players_max
          ? `${g.players_min}명`
          : `${g.players_min}-${g.players_max}명`;
      const time = g.time_min ? ` · ${g.time_min}분` : "";
      return text(1, "인원 · 플레이타임", `${players}${time}`);
    }
    case 2: {
      const type = g.types?.[0] ?? "";
      const catId = commonest(g.categories, index.idf);
      const theme = catId != null ? (cats[String(catId)] ?? "") : "";
      return text(2, "타입 · 테마", [type, theme].filter(Boolean).join(" · "));
    }
    case 3:
      return text(3, "난이도", g.weight != null ? weightBand(g.weight) : "");
    case 4: {
      const mId = commonest(g.mechanisms ?? [], index.midf);
      const mech = mId != null ? (mechs[String(mId)] ?? "") : "";
      const best = g.best_players ? `베스트 ${g.best_players}인` : "";
      return text(4, "진행방식 · 베스트 인원", [mech, best].filter(Boolean).join(" · "));
    }
    case 5:
      return text(5, "출시연도", g.year ?? "");
    case 6:
      return text(6, "디자이너", (g.designers ?? []).join(", "));
    case 7: {
      const n = [...(g.name_ko ?? "")].filter((c) => c !== " ").length;
      return text(7, "글자 수", `${n}글자`);
    }
    case 8:
      return text(8, "초성", chosung(g.name_ko ?? ""));
    default:
      return text(level, "힌트", "");
  }
}
