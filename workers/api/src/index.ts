import {
  buildIndex,
  rankAgainst,
  buildRankPositions,
  evaluateGuess,
  type ScoredGame,
} from "@bomantle/core";
import gamesData from "./games.json";
import catData from "./categories.json";
import mechData from "./mechanisms.json";
import {
  kstDate,
  puzzleNumber,
  buildAnswerPool,
  dailyAnswerFromSeed,
} from "./answer.ts";
import { buildHint, type FullGame } from "./hint.ts";

const games = gamesData as unknown as FullGame[];
const categories = catData as Record<string, string>;
const mechanisms = mechData as Record<string, string>;

// 콜드 스타트 1회: 인덱스 + 정답 풀 구성 (isolate 동안 재사용)
const index = buildIndex(games);
const pool = buildAnswerPool(games);

interface Env {
  ANSWERS?: KVNamespace;
}

interface DayState {
  date: string;
  answerId: number;
  ranking: ScoredGame[];
  pos: Map<number, number>;
}

// 비싼 랭킹은 answerId 기준으로만 캐시 (isolate 메모리).
// KV 오버라이드는 cacheTtl로 엣지 캐시 → 무료 플랜 KV 읽기 한도(10만/일) 절약.
// 정답을 바꾸면 최대 KV_CACHE_TTL초 후 반영(즉시 아님).
const rankCache = new Map<number, { ranking: ScoredGame[]; pos: Map<number, number> }>();

// 같은 날짜 키(answer:DATE)를 엣지에 캐시해 KV 읽기 횟수를 대폭 줄임.
const KV_CACHE_TTL = 300;

async function getDayState(env: Env, date: string): Promise<DayState> {
  // KV 오버라이드 우선, 없으면 시드 결정론
  let answerId: number | undefined;
  if (env.ANSWERS) {
    const v = await env.ANSWERS.get(`answer:${date}`, { cacheTtl: KV_CACHE_TTL });
    if (v) answerId = Number(v);
  }
  if (answerId == null || !index.byId.has(answerId)) {
    answerId = dailyAnswerFromSeed(date, pool);
  }

  let rc = rankCache.get(answerId);
  if (!rc) {
    const ranking = rankAgainst(index, answerId);
    rc = { ranking, pos: buildRankPositions(ranking) };
    rankCache.set(answerId, rc);
  }
  return { date, answerId, ranking: rc.ranking, pos: rc.pos };
}

// 허용 origin 화이트리스트. 운영 Pages + 로컬 개발.
const ALLOWED_ORIGINS = new Set([
  "https://bomantle.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders(req) });

    const url = new URL(req.url);
    const date = kstDate();

    // GET /api/today — 오늘 퍼즐 메타 (정답 비노출)
    if (url.pathname === "/api/today" && req.method === "GET") {
      return json(
        {
          date,
          puzzleNumber: puzzleNumber(date),
          totalGames: games.length,
          poolSize: pool.length,
        },
        req,
      );
    }

    // POST /api/guess { gameId } — 점수/순위 (정답 비노출)
    if (url.pathname === "/api/guess" && req.method === "POST") {
      let gameId: number;
      try {
        const body = (await req.json()) as { gameId?: unknown };
        gameId = Number(body.gameId);
      } catch {
        return json({ error: "invalid body" }, req, 400);
      }
      if (!Number.isFinite(gameId) || !index.byId.has(gameId)) {
        return json({ error: "unknown game" }, req, 404);
      }
      const day = await getDayState(env, date);
      const result = evaluateGuess(day.ranking, day.pos, day.answerId, gameId);
      // win일 때만 정답 이름·박스아트 동봉
      if (result.win) {
        const ans = games.find((g) => g.id === day.answerId)!;
        return json(
          { ...result, answer: { id: ans.id, name_ko: ans.name_ko, image: ans.image ?? null } },
          req,
        );
      }
      return json(result, req);
    }

    // POST /api/giveup — 정답 공개
    if (url.pathname === "/api/giveup" && req.method === "POST") {
      const day = await getDayState(env, date);
      const ans = games.find((g) => g.id === day.answerId)!;
      return json(
        {
          answer: {
            id: ans.id,
            name_ko: ans.name_ko,
            name_en: ans.name_en,
            image: ans.image ?? null,
          },
        },
        req,
      );
    }

    // GET /api/hint?level=N — 단계별 힌트 (정답 이름은 비노출)
    if (url.pathname === "/api/hint" && req.method === "GET") {
      const level = Number(url.searchParams.get("level"));
      if (!Number.isInteger(level) || level < 1 || level > 8) {
        return json({ error: "bad level" }, req, 400);
      }
      const day = await getDayState(env, date);
      const ans = games.find((g) => g.id === day.answerId)!;
      return json(buildHint(level, ans, index, categories, mechanisms), req);
    }

    return json({ error: "not found" }, req, 404);
  },
};
