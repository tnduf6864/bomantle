import {
  buildIndex,
  rankAgainst,
  buildRankPositions,
  evaluateGuess,
  similarityParts,
  type ScoredGame,
} from "@bomantle/core";
import gamesData from "./games.json";
import catData from "./categories.json";
import mechData from "./mechanisms.json";
import boxartIds from "./boxart.json";
import poolV1 from "./pool_v1.json";
import {
  kstDate,
  puzzleNumber,
  baseName,
  buildAnswerPool,
  answerForDate,
  resolvePuzzleDate,
  type AnswerSchedule,
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

/**
 * 새 정답 풀(bgg_id 묶음)이 적용되는 첫 날짜. 그 전 날짜는 얼려 둔 pool_v1.json으로
 * 예전과 똑같이 계산된다(answer.ts AnswerSchedule).
 *
 * ⚠️ **배포일 이후 날짜로 둘 것.** 이미 지나간 날짜로 두면 그 사이 실제로 출제된
 * 정답(구 풀)과 이 워커가 계산하는 정답(새 풀)이 갈라져, 진행 중인 판과 지난 문제가 깨진다.
 */
const POOL_V2_FROM = "2026-11-12";
const schedule: AnswerSchedule = {
  legacyPool: poolV1 as number[],
  pool,
  from: POOL_V2_FROM,
};
// id -> 게임. games.find()를 요청마다 돌리면 15,000개를 훑는다(정답 공개·힌트·추측 판정
// 모두 이 조회가 필요하다). 콜드 스타트에 한 번만 만든다.
const gameById = new Map(games.map((g) => [g.id, g]));
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
    answerId = answerForDate(date, schedule);
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
  const ans = gameById.get(answerId)!;
  return buildAnswerInfo(ans, categories, mechanisms, imageUrl(ans));
}

/**
 * 추측이 정답과 **같은 시리즈**인가(같은 게임은 제외 — 그건 win이다).
 *
 * 한 프랜차이즈에 단독 플레이 가능한 형제가 여럿인 경우가 많다(브라스: 버밍엄/랭커셔,
 * 도미니언/장막뒤의 사람들 …). 이때 시리즈를 정확히 떠올린 사람이 형제를 찍으면
 * 점수·순위는 최상위인데 정답은 아니어서, 사실상 맞혔는데 왜 아닌지 모른 채 끝난다.
 * 이 신호로 "이 시리즈는 맞다, 편만 다르다"를 알려 준다.
 *
 * 노출 위험은 낮다 — 같은 시리즈를 이미 찍었다는 건 유사도 점수로도 드러나 있고,
 * 시리즈를 특정하려면 추측을 그만큼 써야 한다.
 */
function isSameSeries(guessId: number, answerId: number): boolean {
  if (guessId === answerId) return false;
  const a = gameById.get(guessId);
  const b = gameById.get(answerId);
  return !!a && !!b && baseName(a) === baseName(b);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders(req) });

    const url = new URL(req.url);
    const date = kstDate();
    // 지난 문제 다시 풀기: 추측·힌트·포기·순위는 ?date=로 과거 날짜를 받는다(오늘 이하만).
    // 결과 제출·통계·접속 집계는 오늘 전용이라 이 값을 쓰지 않는다.
    const puzzleDate = resolvePuzzleDate(url.searchParams.get("date"), date);
    if (puzzleDate == null) return json({ error: "bad date" }, req, 400);

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
      const day = await getDayState(env, puzzleDate);
      const result = evaluateGuess(day.ranking, day.pos, day.answerId, gameId);
      // date: 채점 기준 날짜. 클라가 보던 판과 다르면(9시 경계를 넘김) 판을 새로 받는다.
      // win일 때만 정답 정보(이름·박스아트·사양) 동봉
      if (result.win) {
        return json({ ...result, date: puzzleDate, answer: revealAnswer(day.answerId) }, req);
      }
      return json(
        {
          ...result,
          date: puzzleDate,
          // 테마·진행방식·수치 각 축의 유사도 — 어느 방향으로 좁힐지 추리하는 단서.
          parts: similarityParts(index, day.answerId, gameId),
          ...(isSameSeries(gameId, day.answerId) ? { sameSeries: true } : {}),
        },
        req,
      );
    }

    // POST /api/giveup — 정답 공개
    if (url.pathname === "/api/giveup" && req.method === "POST") {
      const day = await getDayState(env, puzzleDate);
      return json({ answer: revealAnswer(day.answerId) }, req);
    }

    // GET /api/ranking?offset=&limit= — 오늘 정답 기준 전체 유사도 순위 목록.
    // 정답 공개(맞힘·포기) 후 화면용. 랭킹은 이미 캐시돼 있어 자르기만 하면 된다.
    // 1위 = 정답과 가장 가까운 게임이라 스포일러성이 있지만, /api/giveup이 이미
    // 정답 자체를 누구에게나 내주므로 새로 생기는 노출은 아니다.
    if (url.pathname === "/api/ranking" && req.method === "GET") {
      const day = await getDayState(env, puzzleDate);
      const total = day.ranking.length; // 정답 자신은 제외된 수
      const page = parsePage(url.searchParams, total);
      return json(
        { total, offset: page.offset, items: sliceRanking(day.ranking, page) },
        req,
        200,
        // 같은 날짜·같은 정답이면 항상 같은 응답. 정답 KV 오버라이드 반영 주기와 맞춘다.
        // 오늘 판은 ?date= 없이 요청되므로 URL이 9시 경계를 넘어 같다 — 리셋 직후 어제 순위가
        // 캐시에서 나오지 않게 짧게, 날짜가 박힌 지난 문제는 길게 잡는다.
        { "Cache-Control": `public, max-age=${url.searchParams.has("date") ? 86_400 : 60}` },
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
      const day = await getDayState(env, puzzleDate);
      const ans = gameById.get(day.answerId)!;
      return json(buildHint(level, ans, index, categories, mechanisms), req);
    }

    return json({ error: "not found" }, req, 404);
  },
};
