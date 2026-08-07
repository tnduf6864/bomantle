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
import boxartIds from "./boxart.json";
import {
  kstDate,
  puzzleNumber,
  buildAnswerPool,
  dailyAnswerFromSeed,
} from "./answer.ts";
import { buildHint, type FullGame } from "./hint.ts";
import { buildAnswerInfo } from "./reveal.ts";
import { parsePage, sliceRanking } from "./ranklist.ts";
import { sanitizeSubmission } from "./rank.ts";
import { ResultBoard } from "./results.ts";
import { VisitCounter } from "./visits.ts";

// DO 클래스는 엔트리에서 export 되어야 wrangler가 바인딩할 수 있다.
export { VisitCounter, ResultBoard };

const games = gamesData as unknown as FullGame[];
const categories = catData as Record<string, string>;
const mechanisms = mechData as Record<string, string>;

// 콜드 스타트 1회: 인덱스 + 정답 풀 구성 (isolate 동안 재사용)
const index = buildIndex(games);
const pool = buildAnswerPool(games);
// 재호스팅된 박스아트가 있는 게임 id (빌드 시 data 스크립트가 생성).
const boxartSet = new Set<number>(boxartIds as number[]);

interface Env {
  ANSWERS?: KVNamespace;
  VISITS?: DurableObjectNamespace<VisitCounter>;
  RESULTS?: DurableObjectNamespace<ResultBoard>;
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

// 오늘 전체 현황(/api/stats) 캐시. 값이 하루 내내 늘어나므로 짧게 잡는다.
const STATS_CACHE_TTL = 60;

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

// 오늘 접속자 수. 바인딩 없음(로컬 등)·DO 오류 시 null — 게임 진행에는 영향 없음.
async function visitorCount(env: Env, date: string): Promise<number | null> {
  if (!env.VISITS) return null;
  try {
    return await env.VISITS.get(env.VISITS.idFromName(date)).current();
  } catch {
    return null;
  }
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

function json(
  body: unknown,
  req: Request,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req), ...extra },
  });
}

/**
 * 정답 박스아트 URL(사이트 오리진 기준 상대 경로).
 * 보드라이프(Cloudflare 뒤)는 브라우저 크로스오리진(503)·서버/Worker(403) 이미지
 * 요청을 모두 막는다. 그래서 정답 풀 이미지는 빌드 시 미리 받아 Pages에 재호스팅하고
 * (/boxart/<id>.jpg) same-origin으로 서빙한다. 재호스팅된 이미지가 없으면 null.
 */
function imageUrl(game: { id: number }): string | null {
  return boxartSet.has(game.id) ? `/boxart/${game.id}.jpg` : null;
}

/** 정답 공개용 게임 정보(맞힘·포기 공용). 정답 확정 후에만 호출할 것. */
function revealAnswer(answerId: number) {
  const ans = games.find((g) => g.id === answerId)!;
  return buildAnswerInfo(ans, categories, mechanisms, imageUrl(ans));
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
          visitors: await visitorCount(env, date),
        },
        req,
      );
    }

    // POST /api/visit — 오늘 접속자 +1 (클라이언트가 하루 1회만 호출)
    if (url.pathname === "/api/visit" && req.method === "POST") {
      if (!env.VISITS) return json({ visitors: null }, req);
      try {
        const n = await env.VISITS.get(env.VISITS.idFromName(date)).increment();
        return json({ visitors: n }, req);
      } catch {
        return json({ visitors: null }, req);
      }
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
      // win일 때만 정답 정보(이름·박스아트·사양) 동봉
      if (result.win) {
        return json({ ...result, answer: revealAnswer(day.answerId) }, req);
      }
      return json(result, req);
    }

    // POST /api/giveup — 정답 공개
    if (url.pathname === "/api/giveup" && req.method === "POST") {
      const day = await getDayState(env, date);
      return json({ answer: revealAnswer(day.answerId) }, req);
    }

    // GET /api/ranking?offset=&limit= — 오늘 정답 기준 전체 유사도 순위 목록.
    // 정답 공개(맞힘·포기) 후 화면용. 랭킹은 이미 캐시돼 있어 자르기만 하면 된다.
    // 1위 = 정답과 가장 가까운 게임이라 스포일러성이 있지만, /api/giveup이 이미
    // 정답 자체를 누구에게나 내주므로 새로 생기는 노출은 아니다.
    if (url.pathname === "/api/ranking" && req.method === "GET") {
      const day = await getDayState(env, date);
      const total = day.ranking.length; // 정답 자신은 제외된 수
      const page = parsePage(url.searchParams, total);
      return json(
        { total, offset: page.offset, items: sliceRanking(day.ranking, page) },
        req,
        200,
        // 같은 날짜·같은 정답이면 항상 같은 응답. 정답 KV 오버라이드 반영 주기와 맞춘다.
        { "Cache-Control": `public, max-age=${KV_CACHE_TTL}` },
      );
    }

    // POST /api/result { cid, hints, guesses } — 오늘 맞힌 사람 중 내 순위·백분위.
    // 같은 cid로 다시 호출해도 기록은 첫 제출로 고정되고 순위만 재계산된다(멱등).
    // 날짜는 서버 kstDate()로 결정 — 클라가 보낸 날짜는 신뢰하지 않는다.
    if (url.pathname === "/api/result" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid body" }, req, 400);
      }
      const sub = sanitizeSubmission(body);
      if (!sub) return json({ error: "invalid body" }, req, 400);

      // 바인딩 없음(로컬 등)·DO 오류는 게임 진행에 영향 없이 조용히 비활성 처리.
      if (!env.RESULTS) return json({ available: false }, req);
      try {
        const board = env.RESULTS.get(env.RESULTS.idFromName(date));
        return json(await board.submit(sub), req);
      } catch {
        return json({ available: false }, req);
      }
    }

    // GET /api/stats — 오늘 전체 현황(익명 집계). 쓰기 없음.
    // 정답명·개인 식별 정보는 담지 않는다 — 순수 카운트만.
    if (url.pathname === "/api/stats" && req.method === "GET") {
      if (!env.RESULTS) return json({ available: false }, req);
      try {
        const board = env.RESULTS.get(env.RESULTS.idFromName(date));
        return json(await board.snapshot(), req, 200, {
          // 하루 내내 값이 늘어나므로 짧게만 캐시한다. 브라우저 재조회(모달 재오픈)에서
          // DO 호출을 아끼는 게 주 목적.
          "Cache-Control": `public, max-age=${STATS_CACHE_TTL}`,
        });
      } catch {
        return json({ available: false }, req);
      }
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
