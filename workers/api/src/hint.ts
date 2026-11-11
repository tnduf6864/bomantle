import type { Game, GameIndex } from "@bomantle/core";

/** 워커 games.json(풀 버전)의 게임 — core Game + 힌트용 추가 필드. */
export interface FullGame extends Game {
  types?: string[];
  designers?: string[];
  image?: string | null;
  best_players?: string | null;
  recommended_players?: string | null;
}

/** 태그 id 묶음(테마=categories, 메커니즘=mechanisms). */
export interface TagSet {
  cats: number[];
  mechs: number[];
}

export interface HintData {
  level: number;
  label: string;
  value: string;
  kind: "text" | "image";
  /** 이 힌트로 공개된 정답 태그 — 클라의 "찾은 정답 태그" 목록에 합쳐진다 */
  tags?: TagSet;
}

/**
 * 추측과 정답이 **공유하는 태그**. 클라가 "테마 1/3 · 카드 게임"처럼 찾은 정답 태그를
 * 모아 보여 주는 데 쓴다. 같은 태그를 가진 게임을 맞히면 그 태그가 공개되는 셈이라,
 * 막대(0~100)만으로는 알 수 없던 "무엇이 겹쳤는지"를 알려 준다.
 */
export function sharedTags(guess: Game, answer: Game): TagSet {
  const ac = new Set(answer.categories);
  const am = new Set(answer.mechanisms ?? []);
  return {
    cats: [...new Set(guess.categories)].filter((c) => ac.has(c)),
    mechs: [...new Set(guess.mechanisms ?? [])].filter((m) => am.has(m)),
  };
}

/** 정답의 태그 총개수(테마·메커니즘) — "1/3"의 분모. */
export function tagTotals(answer: Game): { cats: number; mechs: number } {
  return {
    cats: new Set(answer.categories).size,
    mechs: new Set(answer.mechanisms ?? []).size,
  };
}

/**
 * 단계 이름. 클라가 **다음 힌트가 무엇인지** 미리 보여 주는 데 쓴다(`/api/today`로 내려간다).
 * 순서 = 약한 힌트 → 강한 힌트. 개수(8)는 통계의 힌트 분포(0..8)·공유 💀와 묶여 있어 유지한다.
 *
 * 2026-11 개편: 초성(사실상 정답 공개)을 빼고, 정확한 출시연도·디자이너처럼 아는 사람에겐
 * 한 방인 힌트를 뒤로 미뤘다. 대신 정답의 태그를 단계적으로 알려 줘서 추측 막대(테마·메커니즘)를
 * 올릴 방향을 잡게 한다.
 */
export const HINT_LABELS = [
  "인원 · 플레이타임",
  "웨이트",
  "유형 · 출시 연대",
  "테마",
  "메커니즘 · 베스트 인원",
  "인기도",
  "특징 태그",
  "디자이너 · 연도 · 글자 수",
] as const;

/** 난이도를 0.5 폭 밴드로 (예: 3.79 → "3.5 ~ 4.0"). */
function weightBand(w: number): string {
  const lo = Math.floor(w * 2) / 2;
  return `${lo.toFixed(1)} ~ ${(lo + 0.5).toFixed(1)}`;
}

/** 웨이트 밴드 + 체감 표현 (예: 3.79 → "3.5 ~ 4.0 (무거움)"). */
function weightText(w: number): string {
  const feel = w < 2 ? "가벼움" : w < 3 ? "중간" : w < 4 ? "무거움" : "매우 무거움";
  return `${weightBand(w)} (${feel})`;
}

/** "1992" → "1990년대". 미상("0"·없음)이면 빈 문자열. */
function decade(year: string | null): string {
  const y = Number(year);
  return y > 0 ? `${Math.floor(y / 10) * 10}년대` : "";
}

/** 보드라이프 종합 순위 → 대략적인 구간. 정확한 순위는 정답을 특정하므로 감춘다. */
function rankBand(rank: number | null): string {
  if (rank == null) return "";
  for (const top of [50, 100, 300, 500, 1000, 2000, 3000]) {
    if (rank <= top) return `보드라이프 상위 ${top.toLocaleString()}위 안`;
  }
  return "보드라이프 상위 5,500위 안";
}

/** 디자이너 미상 표기("불확실 (uncredited)" 등)는 힌트로서 정보가 없으니 뺀다. */
function knownDesigners(g: FullGame): string[] {
  return (g.designers ?? []).filter((d) => d && !/불확실|uncredited|unknown/i.test(d));
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

/**
 * 4단계 테마 태그: 가장 흔한 카테고리 — 단, 3단계 유형과 **이름이 같은 것은 건너뛴다**
 * ("추상전략" 유형 + "추상전략" 테마가 두 번 나오면 힌트 한 칸이 공짜로 날아간다).
 * 다른 태그가 없으면 그것이라도 쓴다.
 */
function themeTagId(g: FullGame, index: GameIndex, cats: Record<string, string>): number | undefined {
  const type = g.types?.[0];
  const others = g.categories.filter((c) => cats[String(c)] !== type);
  return commonest(others.length ? others : g.categories, index.idf);
}

/**
 * 가장 **드문**(idf 최대) 태그 — 정답을 가장 잘 좁히는 단서. 4·5단계에서 이미 보여준
 * 태그(가장 흔한 것)는 제외하고, 테마·메커니즘을 함께 본다.
 */
function rarestTag(
  g: FullGame,
  index: GameIndex,
  cats: Record<string, string>,
  mechs: Record<string, string>,
): { text: string; tags: TagSet } | null {
  const shown = new Set<string>();
  const cId = themeTagId(g, index, cats);
  const type = g.types?.[0];
  const mId = commonest(g.mechanisms ?? [], index.midf);
  if (cId != null) shown.add(`c${cId}`);
  if (mId != null) shown.add(`m${mId}`);

  let best: { text: string; tags: TagSet } | null = null;
  let bestIdf = -Infinity;
  const consider = (key: string, name: string | undefined, idf: number | undefined, tags: TagSet, kind: string) => {
    if (!name || shown.has(key) || idf == null || idf <= bestIdf) return;
    bestIdf = idf;
    best = { text: `${name} (${kind})`, tags };
  };
  for (const c of g.categories) {
    if (cats[String(c)] === type) continue; // 3단계 유형으로 이미 나온 이름
    consider(`c${c}`, cats[String(c)], index.idf.get(c), { cats: [c], mechs: [] }, "테마");
  }
  for (const m of g.mechanisms ?? []) {
    consider(`m${m}`, mechs[String(m)], index.midf.get(m), { cats: [], mechs: [m] }, "메커니즘");
  }
  return best;
}

function text(level: number, label: string, value: string): HintData {
  return { level, label, value: value || "정보 없음", kind: "text" };
}

/** " · 50-140분" 형태의 플레이타임 조각. 시간 정보가 없으면 빈 문자열. */
function playtimeSuffix(g: FullGame): string {
  if (!g.time_min) return "";
  const range = g.time_max && g.time_max !== g.time_min ? `-${g.time_max}` : "";
  return ` · ${g.time_min}${range}분`;
}

/**
 * 단계별 힌트(8단계, HINT_LABELS 순서). 정답 이름은 8단계의 글자 수 외에는 노출하지 않는다.
 * 초성은 사실상 정답 공개라 뺐고, 박스아트는 정답 공개 시에만 보여준다.
 */
export function buildHint(
  level: number,
  g: FullGame,
  index: GameIndex,
  cats: Record<string, string>,
  mechs: Record<string, string>,
): HintData {
  const label = HINT_LABELS[level - 1] ?? "힌트";
  switch (level) {
    case 1: {
      const players =
        g.players_min === g.players_max
          ? `${g.players_min}명`
          : `${g.players_min}-${g.players_max}명`;
      return text(1, label, `${players}${playtimeSuffix(g)}`);
    }
    case 2:
      return text(2, label, g.weight != null ? weightText(g.weight) : "");
    case 3:
      return text(3, label, [g.types?.[0] ?? "", decade(g.year)].filter(Boolean).join(" · "));
    case 4: {
      const catId = themeTagId(g, index, cats);
      const h = text(4, label, catId != null ? (cats[String(catId)] ?? "") : "");
      return catId != null ? { ...h, tags: { cats: [catId], mechs: [] } } : h;
    }
    case 5: {
      const mId = commonest(g.mechanisms ?? [], index.midf);
      const mech = mId != null ? (mechs[String(mId)] ?? "") : "";
      const best = g.best_players ? `베스트 ${g.best_players}인` : "";
      const h = text(5, label, [mech, best].filter(Boolean).join(" · "));
      return mId != null ? { ...h, tags: { cats: [], mechs: [mId] } } : h;
    }
    case 6: {
      const rate = g.rate != null ? `평점 ${g.rate.toFixed(1)}` : "";
      return text(6, label, [rankBand(g.rank), rate].filter(Boolean).join(" · "));
    }
    case 7: {
      // 태그가 적어 더 보여줄 게 없으면(예: 루미큐브 — 태그 3개) 한 칸을 버리지 않고
      // 추천 인원·연령으로 대신한다.
      const tag = rarestTag(g, index, cats, mechs);
      if (tag) return { ...text(7, label, tag.text), tags: tag.tags };
      const rec = g.recommended_players ? `추천 ${g.recommended_players}인` : "";
      const age = g.age ? `${g.age}세 이상` : "";
      return text(7, "추천 인원 · 연령", [rec, age].filter(Boolean).join(" · "));
    }
    case 8: {
      const year = Number(g.year) > 0 ? `${g.year}년` : "";
      const n = [...(g.name_ko ?? "")].filter((c) => c !== " ").length;
      const parts = [knownDesigners(g).join(", "), year, n ? `${n}글자` : ""];
      return text(8, label, parts.filter(Boolean).join(" · "));
    }
    default:
      return text(level, "힌트", "");
  }
}
