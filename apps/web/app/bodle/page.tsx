"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type {
  AnswerInfo,
  BodleFeedback,
  BodleToday,
  BodleTurn,
  GameMeta,
  PercentileResult,
  TodayStats,
} from "../../lib/types";
import {
  loadGameDB,
  resolve,
  suggest,
  categoryNames,
  mechanismNames,
  type GameDB,
} from "../../lib/games";
import {
  fetchBodleGuess,
  fetchBodleResult,
  fetchBodleStats,
  fetchBodleToday,
} from "../../lib/api";
import {
  buildBodleShareText,
  deviceId,
  effectiveBodleStreak,
  emptyBodleStats,
  loadBodleStats,
  loadProgress,
  recordBodleResult,
  saveProgress,
  type BodleStats,
} from "../../lib/bodle";
import { FEEDBACK_URL } from "../../lib/constants";
import { msUntilNextReset, formatCountdown } from "../../lib/reset";
import { AnswerCard } from "../../components/AnswerCard";
import { TodayStatsCard } from "../../components/TodayStatsCard";
import type { GuessBucket } from "../../lib/stats";

/** 그리드 열. **순서는 공유 이모지(lib/bodle.ts turnEmoji)와 반드시 같아야 한다.** */
const COLS = [
  { key: "types", label: "유형" },
  { key: "categories", label: "테마" },
  { key: "mechanisms", label: "진행방식" },
  { key: "weight", label: "Weight" },
  { key: "year", label: "연도" },
] as const;

type TagKey = "types" | "categories" | "mechanisms";

const ARROW: Record<"up" | "down", string> = { up: "▲", down: "▼" };

// 보들 개인 통계용 버킷(최대 8회라 앞쪽 3개만 의미 있음) — 서버 집계도 같은 라벨을 쓴다.
const BODLE_BUCKETS: readonly GuessBucket[] = ["1-3", "4-6", "7-10"];

function bodleBucket(n: number): GuessBucket {
  if (n <= 3) return "1-3";
  if (n <= 6) return "4-6";
  return "7-10";
}

/** 정답률(%). 플레이 0이면 0. */
function bodleWinRate(s: BodleStats): number {
  return s.played ? Math.round((s.solved / s.played) * 100) : 0;
}

/** 데이터가 없을 때 공통으로 쓰는 표시 문구. "?"는 표시가 아니라 오류처럼 보여서 바꿨다. */
const NO_DATA = "정보 없음";

/** 수치 열에 곁들일 추측한 게임의 실제 값. 모르면 NO_DATA(그 게임에 실제로 데이터가 없는 것 — 크롤 누락, 버그 아님). */
function numText(key: "weight" | "year", g: GameMeta | undefined): string {
  if (!g) return NO_DATA;
  if (key === "weight") return g.weight == null ? NO_DATA : g.weight.toFixed(1);
  return g.year ?? NO_DATA;
}

/** 집합 열(유형·테마·진행방식)에 곁들일 추측한 게임의 실제 태그 이름. */
function tagNames(db: GameDB | null, g: GameMeta | undefined, key: TagKey): string[] {
  if (!db || !g) return [];
  if (key === "types") return g.types;
  if (key === "categories") return categoryNames(db, g);
  return mechanismNames(db, g);
}

/** 셀 안에 넣을 짧은 표시 문자열. 태그가 많으면 앞 2개 + "+N"만 보여준다(칸이 좁다). */
function tagText(names: string[]): string {
  if (names.length === 0) return NO_DATA;
  const shown = names.slice(0, 2);
  const rest = names.length - shown.length;
  return shown.join(" · ") + (rest > 0 ? ` +${rest}` : "");
}

/**
 * 무게·연도는 "hit"(밴드 안)이어도 완전히 같은 값일 때만 초록으로 보여준다.
 * **후보 좁히기(remainingCount)는 이 구분을 안 쓴다** — 화면 색상 표시만 바꾼 것이다.
 * (밴드 판정 자체를 바꾸면 난이도가 변해 재시뮬레이션이 필요해진다 — docs/bodle-plan.md)
 *
 * `dir`은 색상(mark)과 별개로 항상 채워진다 — 밴드 안(hit)이어도 완전히 같은 값이
 * 아니면 위/아래 화살표를 보여줘서 다음 추측 방향을 잡게 해준다.
 */
function cellState(fb: BodleFeedback, key: (typeof COLS)[number]["key"]): {
  mark: string;
  near: boolean;
  dir: "up" | "down" | null;
} {
  if (key === "weight") {
    const mark = fb.weight === "hit" && !fb.weightExact ? "partial" : fb.weight;
    return { mark, near: fb.weightNear, dir: fb.weightDir };
  }
  if (key === "year") {
    const mark = fb.year === "hit" && !fb.yearExact ? "partial" : fb.year;
    return { mark, near: fb.yearNear, dir: fb.yearDir };
  }
  return { mark: fb[key], near: false, dir: null };
}

export default function BodlePage() {
  const [db, setDb] = useState<GameDB | null>(null);
  const [today, setToday] = useState<BodleToday | null>(null);
  const [turns, setTurns] = useState<BodleTurn[]>([]);
  const [solved, setSolved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [answer, setAnswer] = useState<AnswerInfo | null>(null);
  const [stats, setStats] = useState<BodleStats>(emptyBodleStats());
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  // 오늘 맞힌 사람 중 내 백분위. 서버 집계가 없으면 계속 null(UI 자체를 감춘다).
  const [pct, setPct] = useState<PercentileResult | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [countdown, setCountdown] = useState("");

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // 결과 제출은 하루 한 번이면 충분하다(서버도 멱등). 재렌더로 중복 호출되지 않게 막는다.
  const submittedRef = useRef<string | null>(null);

  const guessedIds = useMemo(() => new Set(turns.map((t) => t.gameId)), [turns]);
  const suggestions = useMemo(
    () => (db && query ? suggest(db, query, 8, guessedIds) : []),
    [db, query, guessedIds],
  );

  const applyResult = useCallback(
    (
      nextTurns: BodleTurn[],
      nextSolved: boolean,
      nextFinished: boolean,
      nextRemaining: number | null,
      nextAnswer: AnswerInfo | null,
      meta: BodleToday,
    ) => {
      setTurns(nextTurns);
      setSolved(nextSolved);
      setFinished(nextFinished);
      setRemaining(nextRemaining);
      setAnswer(nextAnswer);

      if (!nextFinished || submittedRef.current === meta.date) return;
      submittedRef.current = meta.date;

      // 로컬 누적(같은 날짜 재기록은 recordBodleResult가 막는다)
      setStats((s) => recordBodleResult(s, meta.date, nextTurns.length, nextSolved));

      // 익명 집계 제출 + 백분위 + 오늘 전체 현황. 실패해도 게임 진행에는 영향 없다.
      const cid = deviceId();
      (async () => {
        try {
          if (cid) {
            const r = await fetchBodleResult(cid, nextTurns.length, nextSolved);
            if (r && nextSolved) setPct(r); // 포기 응답에는 순위가 없다
          }
          setTodayStats(await fetchBodleStats());
        } catch {
          /* 집계는 부가 기능 — 조용히 무시 */
        }
      })();
    },
    [],
  );

  // --- 초기 로드 ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [gdb, meta] = await Promise.all([loadGameDB(), fetchBodleToday()]);
        if (!alive) return;
        setDb(gdb);
        setToday(meta);
        setStats(loadBodleStats());

        // 진행 복원: 저장해 둔 추측 id 목록을 그대로 다시 보내면 서버가 판정을 재생성한다.
        // 클라에 판정 결과를 저장하지 않으므로 규칙이 바뀌어도 복원이 어긋나지 않는다.
        const saved = loadProgress(meta.date);
        if (saved.length) {
          const res = await fetchBodleGuess(saved);
          if (!alive) return;
          applyResult(res.turns, res.solved, res.finished, res.remaining, res.answer ?? null, meta);
        }
      } catch {
        if (alive) setError("불러오지 못했어요. 잠시 후 새로고침 해주세요.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyResult]);

  // 다음 초기화까지 1초마다 카운트다운 갱신
  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(msUntilNextReset()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const submitGame = useCallback(
    async (g: GameMeta) => {
      if (!today || finished || busy || guessedIds.has(g.id)) return;
      setBusy(true);
      setError("");
      const ids = [...turns.map((t) => t.gameId), g.id];
      try {
        const res = await fetchBodleGuess(ids);
        saveProgress(today.date, ids);
        applyResult(res.turns, res.solved, res.finished, res.remaining, res.answer ?? null, today);
        setQuery("");
        setActiveIdx(0);
      } catch {
        setError("제출에 실패했어요. 다시 시도해 주세요.");
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [today, finished, busy, guessedIds, turns, applyResult],
  );

  /** Enter·추측 버튼 공통 경로 — 자동완성 후보가 있으면 그것을, 없으면 정확 일치를 제출. */
  const submitCurrent = useCallback(() => {
    if (!db || !query) return;
    const picked = suggestions[activeIdx] ?? resolve(db, query);
    if (!picked) {
      setError("그런 이름의 보드게임을 찾지 못했어요.");
      return;
    }
    void submitGame(picked);
  }, [db, query, suggestions, activeIdx, submitGame]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submitCurrent();
    }
  };

  const share = async () => {
    if (!today) return;
    const text = buildBodleShareText(
      turns,
      today.maxGuesses,
      today.puzzleNumber,
      solved,
      effectiveBodleStreak(stats, today.date),
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("클립보드 복사에 실패했어요.");
    }
  };

  /** 통계 모달 열기. 아직 오늘 전체 현황을 안 받아왔으면 함께 받아온다. */
  function openStats() {
    setShowStats(true);
    if (!todayStats) {
      fetchBodleStats()
        .then((s) => {
          if (s) setTodayStats(s);
        })
        .catch(() => {});
    }
  }

  const left = today ? today.maxGuesses - turns.length : 0;
  const streak = today ? effectiveBodleStreak(stats, today.date) : 0;
  const myBucket = finished && solved ? bodleBucket(turns.length) : null;

  return (
    <>
    <div className="wrap">
      <header className="top">
        <button className="stats-open" onClick={openStats} aria-label="통계 보기" title="통계">
          📊
        </button>
        <h1>🎲 보들</h1>
        <div className="sub">
          {today ? `#${today.puzzleNumber} · 오늘의 보드게임을 ${today.maxGuesses}번 안에` : "불러오는 중…"}
        </div>
        {countdown && (
          <div className="reset-info">
            ⏰ 다음 문제까지 <b>{countdown}</b>
            <span className="reset-note">매일 오전 9시 초기화</span>
          </div>
        )}
        {today && (
          <div className="bodle-progress">
            후보 <b>{today.poolSize}</b>개 · 남은 시도 <b>{Math.max(0, left)}</b>번
            {streak >= 2 && <> · 🔥 연속 <b>{streak}</b>일</>}
          </div>
        )}
      </header>

      {!finished && (
        <div className="input-area">
          <input
            ref={inputRef}
            value={query}
            placeholder={db ? "보드게임 이름 · 초성 (예: 카탄, ㅋㅌ)" : "데이터 불러오는 중…"}
            disabled={!db || busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />
          <button disabled={!db || busy || !query} onClick={submitCurrent}>
            추측
          </button>
          {suggestions.length > 0 && (
            <div className="suggest">
              {suggestions.map((s, i) => (
                <div
                  key={s.id}
                  className={`item ${i === activeIdx ? "active" : ""}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void submitGame(s);
                  }}
                >
                  <span>{s.name_ko}</span>
                  <span className="en">{s.name_en}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {/* 남은 후보는 개수만. 목록을 주면 눈으로 훑는 노동이 되어 게임이 죽는다. */}
      {remaining != null && !finished && (
        <div className="bodle-remaining">
          단서에 맞는 게임 <b>{remaining}</b>개 남음
        </div>
      )}

      {turns.length > 0 && (
        <div className="bodle-grid">
          <div className="bodle-head">
            {COLS.map((c) => (
              <span key={c.key}>{c.label}</span>
            ))}
          </div>
          {turns.map((t, i) => {
            const g = db?.byId.get(t.gameId);
            const latest = i === turns.length - 1;
            return (
              <div
                key={`${t.gameId}-${i}`}
                className={`bodle-row ${t.correct ? "correct" : ""} ${latest ? "latest" : ""}`}
              >
                <div className="bodle-name">
                  <span className="seq">{i + 1}</span>
                  {g?.name_ko ?? `#${t.gameId}`}
                </div>
                <div className="bodle-cells">
                  {COLS.map((c) => {
                    const { mark, near, dir } = cellState(t.feedback, c.key);
                    const isNum = c.key === "weight" || c.key === "year";
                    const names = isNum ? [] : tagNames(db, g, c.key as TagKey);
                    const numVal = isNum ? numText(c.key as "weight" | "year", g) : "";
                    return (
                      <div
                        key={c.key}
                        className={`cell ${mark} ${near ? "near" : ""}`}
                        title={isNum ? undefined : names.join(", ")}
                      >
                        {isNum ? (
                          <>
                            <span className={`v ${numVal === NO_DATA ? "long" : ""}`}>{numVal}</span>
                            {dir && <span className="a">{ARROW[dir]}</span>}
                          </>
                        ) : (
                          <span className="v long">{tagText(names)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {turns.length === 0 && db && (
        <div className="empty">
          아무 보드게임이나 추측해 보세요. 유형·테마·진행방식·무게·연도가
          정답과 얼마나 맞는지 알려드려요.
        </div>
      )}

      {finished && (
        <div className="banner">
          <div className="banner-title">
            {solved ? `🎉 ${turns.length}번 만에 맞혔어요!` : "🏳️ 아쉬워요, 다음 판에!"}
          </div>

          {solved && pct && !pct.pending && (
            <div className="pct">
              <div className="pct-head">
                오늘 맞힌 사람 중 상위 <b>{pct.percentile}%</b>
              </div>
              <div className="pct-bar">
                <span className="pct-fill" style={{ width: `${pct.percentile}%` }} />
                <span className="pct-marker" style={{ left: `${pct.percentile}%` }} />
              </div>
              <div className="pct-note">
                오늘 맞힌 {pct.total.toLocaleString()}명 중 <b>{pct.rank.toLocaleString()}위</b> ·{" "}
                {pct.guesses}번 추측
              </div>
            </div>
          )}
          {solved && pct?.pending && (
            <div className="pct">
              <div className="pct-pending">
                🏆 아직 집계 중 · 오늘 {pct.total}명이 맞혔어요
                <div className="pct-note">몇 명 더 맞히면 상위 %가 표시돼요</div>
              </div>
            </div>
          )}
          {/* 포기한 사람에겐 백분위가 없다(표본이 정답자뿐). 대신 전체 현황을 보여준다. */}
          {!solved && todayStats && todayStats.players > 0 && (
            <div className="pct">
              <div className="pct-pending">
                🌏 오늘 {todayStats.players.toLocaleString()}명 중{" "}
                <b>{todayStats.solved.toLocaleString()}명</b>이 맞혔어요
                <div className="pct-note">
                  정답률{" "}
                  {todayStats.players
                    ? Math.round((todayStats.solved / todayStats.players) * 100)
                    : 0}
                  %
                  {todayStats.avgGuesses > 0 && ` · 평균 ${todayStats.avgGuesses}번 추측`}
                </div>
              </div>
            </div>
          )}

          {answer && <AnswerCard info={answer} />}

          <div className="banner-actions">
            <button className="share-btn" onClick={share}>
              {copied ? "복사됨!" : "📋 결과 공유"}
            </button>
            <button className="stats-btn" onClick={openStats}>
              📊 통계
            </button>
          </div>
          <Link href="/" className="bodle-cross">
            이 게임으로 보맨틀 하러 가기 →
          </Link>
        </div>
      )}

      <footer className="site-footer">
        <Link href="/">🎲 보맨틀로 돌아가기</Link>
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          💬 문의·제보
        </a>
        <span className="credit">제작자: 문보미</span>
      </footer>
    </div>

    {showStats && (
      <div className="modal-backdrop" onClick={() => setShowStats(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>📊 통계</h2>
            <button
              className="modal-close"
              onClick={() => setShowStats(false)}
              aria-label="닫기"
            >
              ✕
            </button>
          </div>

          {stats.played === 0 ? (
            <div className="stats-empty">
              아직 완료한 게임이 없어요.
              <span>오늘의 문제를 맞히면 여기에 기록돼요!</span>
            </div>
          ) : (
            <>
              <div className="stat-grid">
                <div className="stat-cell">
                  <div className="stat-num">{stats.played}</div>
                  <div className="stat-lbl">플레이</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-num">{bodleWinRate(stats)}%</div>
                  <div className="stat-lbl">정답률</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-num">
                    {today ? effectiveBodleStreak(stats, today.date) : stats.streak}
                  </div>
                  <div className="stat-lbl">현재 연속</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-num">{stats.bestStreak}</div>
                  <div className="stat-lbl">최고 연속</div>
                </div>
              </div>

              <div className="dist">
                <div className="dist-title">
                  추측 횟수 분포
                  {stats.played - stats.solved > 0 && (
                    <span className="dist-note"> · 실패 {stats.played - stats.solved}회</span>
                  )}
                </div>
                {(() => {
                  const max = Math.max(1, ...stats.dist);
                  return Array.from({ length: 8 }, (_, i) => {
                    const c = stats.dist[i] ?? 0;
                    const hi = finished && solved && turns.length - 1 === i;
                    return (
                      <div className="dist-row" key={i}>
                        <span className="dist-lbl">{i + 1}</span>
                        <div className="dist-bar">
                          <span
                            className={`dist-fill ${hi ? "hi" : ""}`}
                            style={{ width: `${c ? Math.max(12, (c / max) * 100) : 0}%` }}
                          >
                            {c > 0 && <em>{c}</em>}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          )}

          {todayStats && (
            <TodayStatsCard info={todayStats} myBucket={myBucket} buckets={BODLE_BUCKETS} />
          )}
        </div>
      </div>
    )}

    {/* 정적 서버 렌더 콘텐츠 — 클라 렌더 전에도 검색엔진이 읽을 수 있는 실제 텍스트 */}
    <section className="seo-info">
      <h2>보들이란?</h2>
      <p>
        보들은 매일 하나의 보드게임을 맞히는 무료 웹게임입니다. 아무 보드게임이나
        추측하면 그 게임이 정답과 유형·테마·진행방식·무게(난이도)·출시연도에서
        얼마나 겹치는지 알려주고, 그 단서로 후보를 좁혀 8번 안에 정답을 찾는 방식입니다.
        영어 단어 맞히기 게임 워들(Wordle)·꼬들의 보드게임 버전이라고 보면 됩니다.
      </p>
      <h3>자주 묻는 질문</h3>
      <dl>
        <dt>새 문제는 언제 나오나요?</dt>
        <dd>매일 한국 시간(KST) 오전 9시에 새로운 보드게임 문제로 초기화됩니다.</dd>
        <dt>색깔은 무슨 뜻인가요?</dt>
        <dd>
          유형·테마·진행방식은 초록이 정답과 완전히 같음, 노랑이 일부만 겹침입니다.
          무게와 연도는 초록이 정답과 <b>완전히 같은 값</b>일 때만이고, 근접한 범위 안이면
          노랑입니다. 완전히 같은 값이 아니면 색과 별개로 ▲(정답이 더 높음)·▼(더 낮음)
          화살표가 항상 붙어 다음 추측 방향을 알려줍니다. 아깝게 빗나갔을 때는 칸에
          주황 테두리가 생깁니다.
        </dd>
        <dt>&ldquo;단서에 맞는 게임 N개 남음&rdquo;은 뭔가요?</dt>
        <dd>
          지금까지 나온 단서에 모순되지 않는 정답 후보의 개수입니다. 3번째 추측부터
          보이며, 어떤 게임인지 목록은 알려주지 않습니다.
        </dd>
        <dt>난이도가 매일 같나요?</dt>
        <dd>
          요일마다 다릅니다. 월·화요일은 널리 알려진 게임에서만 정답이 나오고,
          주말로 갈수록 후보가 넓어집니다.
        </dd>
        <dt>보맨틀과 정답이 같나요?</dt>
        <dd>아니요. 두 게임의 정답은 매일 서로 다르게 정해집니다.</dd>
      </dl>
      <p>
        <Link href="/">보맨틀 하러 가기 →</Link>
      </p>
    </section>
    </>
  );
}
