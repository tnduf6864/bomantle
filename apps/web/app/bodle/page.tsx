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
  bodleAvgGuesses,
  bodleBestGuesses,
  bodleWinRate,
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
import { PercentileCard, TodaySummaryCard } from "../../components/PercentileCard";
import { DistBars } from "../../components/DistBars";
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

/** 태그 열만. 단서판은 이 세 열만 다룬다(무게·연도는 값이라 칩이 될 수 없다). */
const TAG_COLS = COLS.filter((c) => c.key !== "weight" && c.key !== "year") as readonly {
  key: TagKey;
  label: string;
}[];

const ARROW: Record<"up" | "down", string> = { up: "▲", down: "▼" };

// 보들 개인 통계용 버킷(최대 6회라 앞쪽 2개면 충분) — 서버 집계도 같은 라벨을 쓴다.
const BODLE_BUCKETS: readonly GuessBucket[] = ["1-3", "4-6"];

function bodleBucket(n: number): GuessBucket {
  return n <= 3 ? "1-3" : "4-6";
}

/** 데이터가 없을 때 공통으로 쓰는 표시 문구. "?"는 표시가 아니라 오류처럼 보여서 바꿨다. */
const NO_DATA = "정보 없음";

/** 수치 열에 곁들일 추측한 게임의 실제 값. 모르면 NO_DATA(그 게임에 실제로 데이터가 없는 것 — 크롤 누락, 버그 아님). */
function numText(key: "weight" | "year", g: GameMeta | undefined): string {
  if (!g) return NO_DATA;
  if (key === "weight") return g.weight == null ? NO_DATA : g.weight.toFixed(1);
  return g.year ?? NO_DATA;
}

/** 추측한 게임의 태그 하나. `hit`이면 정답에도 있는 것으로 확인된 태그. */
interface TagChip {
  name: string;
  hit: boolean;
}

/**
 * 추측한 게임의 태그를 **원래 순서 그대로** 이름 + 판정 쌍으로 만든다.
 * 서버가 내려주는 `*Hit`은 교집합(내가 낸 것 중 정답에도 있는 것)이라, 여기서
 * 원본 태그와 대조해 칩 단위 판정을 만든다.
 */
function tagChips(
  db: GameDB | null,
  g: GameMeta | undefined,
  key: TagKey,
  fb: BodleFeedback,
): TagChip[] {
  if (!db || !g) return [];
  const raw: (number | string)[] =
    key === "types" ? g.types : key === "categories" ? g.categories : g.mechanisms;
  const names =
    key === "types" ? g.types : key === "categories" ? categoryNames(db, g) : mechanismNames(db, g);
  const hitSet = new Set<number | string>(
    key === "types" ? fb.typesHit : key === "categories" ? fb.categoriesHit : fb.mechanismsHit,
  );
  return raw.map((v, i) => ({ name: names[i] ?? String(v), hit: hitSet.has(v) }));
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
  const [shareMsg, setShareMsg] = useState("");
  // 단서판의 "없음" 목록은 금방 수십 개가 되므로 기본은 접어 둔다.
  const [showNoClues, setShowNoClues] = useState(false);

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
      if (!today || finished || busy) return;
      // 이미 쓴 게임은 조용히 무시하면 "추측 버튼이 먹통"으로 읽힌다. 자동완성에서는
      // 빠지지만 이름을 끝까지 타이핑하면 여기로 들어온다.
      if (guessedIds.has(g.id)) {
        setError(`이미 추측한 게임이에요: ${g.name_ko ?? g.name_en}`);
        return;
      }
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
      /*
       * 한글 IME 조합 중 발생하는 Enter(마지막 글자 확정용)는 무시한다.
       * 이걸 빼면 "카탄"을 치고 Enter를 누르는 순간 조합 확정 Enter가 그대로 제출로
       * 넘어가 **의도하지 않은 자동완성 1번 후보**가 나간다. 시도가 6번뿐이라
       * 되돌릴 수 없는 손실이다(보맨틀 page.tsx의 같은 가드).
       */
      if (e.nativeEvent.isComposing || (e.nativeEvent as unknown as KeyboardEvent).keyCode === 229) {
        return;
      }
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
      setShareMsg("결과를 복사했어요! 붙여넣기로 공유하세요 📋");
    } catch {
      setShareMsg("복사가 안 됐어요. 텍스트를 길게 눌러 복사해주세요.");
    }
    setTimeout(() => setShareMsg(""), 3000);
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

  /**
   * 지금까지 한 번도 판정되지 않은 열. 정답에 그 값이 없으면 무슨 게임을 넣어도 영원히
   * 판정 불가라, 알려주지 않으면 "내가 계속 빗나간다"고 오해하며 시도를 낭비한다.
   */
  const deadCols = useMemo(
    () =>
      turns.length === 0
        ? []
        : COLS.filter((c) => turns.every((t) => t.feedback[c.key] === "unknown")),
    [turns],
  );

  /**
   * 누적 단서판 — 워들의 키보드에 해당한다. 격자는 "무엇을 냈는지"의 기록이고,
   * 지금까지 **알아낸 것**은 여기 모인다. 태그를 여러 번 냈어도 한 번만 나온다.
   */
  const clues = useMemo(() => {
    const yes = new Map<string, { col: string; name: string }>();
    const no = new Map<string, { col: string; name: string }>();
    for (const t of turns) {
      const g = db?.byId.get(t.gameId);
      for (const c of TAG_COLS) {
        for (const chip of tagChips(db, g, c.key, t.feedback)) {
          const k = `${c.key}:${chip.name}`;
          (chip.hit ? yes : no).set(k, { col: c.label, name: chip.name });
        }
      }
    }
    // 같은 태그가 양쪽에 들어갈 일은 없지만, 들어간다면 "있음"이 진실이다.
    for (const k of yes.keys()) no.delete(k);
    const group = (m: Map<string, { col: string; name: string }>) =>
      TAG_COLS.map((c) => ({
        label: c.label,
        names: [...m.values()].filter((v) => v.col === c.label).map((v) => v.name),
      })).filter((row) => row.names.length > 0);
    return { yes: group(yes), no: group(no), noCount: no.size };
  }, [turns, db]);

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
        <h1>보들 🎲</h1>
        <div className="sub">
          {today
            ? `#${today.puzzleNumber} · 다섯 단서로 오늘의 보드게임을 ${today.maxGuesses}번 안에`
            : "불러오는 중…"}
        </div>
        {countdown && (
          <div className="reset-info">
            ⏰ 다음 문제까지 <b>{countdown}</b>
            <span className="reset-note">매일 오전 9시 초기화</span>
          </div>
        )}
        {today && (
          <>
            {/* 남은 시도를 한눈에 — 숫자보다 칸이 줄어드는 게 압박감이 산다(워들식). */}
            <div
              className="bodle-tries"
              role="img"
              aria-label={`${today.maxGuesses}번 중 ${turns.length}번 사용`}
            >
              {Array.from({ length: today.maxGuesses }, (_, i) => (
                <span
                  key={i}
                  className={`pip ${
                    i < turns.length ? (turns[i]?.correct ? "hit" : "used") : ""
                  }`}
                />
              ))}
            </div>
            <div className="bodle-progress">
              후보 <b>{today.poolSize}</b>개
              {/* 끝난 판에서 "남은 시도"는 의미가 없다 — 칸(pip)만 결과로 남긴다. */}
              {!finished && <> · 남은 시도 <b>{Math.max(0, left)}</b>번</>}
              {streak >= 2 && <> · 🔥 연속 <b>{streak}</b>일</>}
            </div>
          </>
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

      {/*
        누적 단서판 — 이 게임의 "키보드". 격자는 기록이고, 다음 추측을 고를 때 실제로
        보는 건 여기다. 좁은 칸에 다 못 넣던 태그를 전부 보여주므로 모바일에서도 읽힌다.
      */}
      {turns.length > 0 && (clues.yes.length > 0 || clues.noCount > 0) && (
        <div className="clues">
          <div className="clues-title">지금까지 알아낸 것</div>

          {clues.yes.length > 0 ? (
            clues.yes.map((row) => (
              <div className="clue-row" key={`y-${row.label}`}>
                <span className="clue-lbl">✓ {row.label}</span>
                <span className="clue-chips">
                  {row.names.map((n) => (
                    <span className="chip yes" key={n}>
                      {n}
                    </span>
                  ))}
                </span>
              </div>
            ))
          ) : (
            <div className="clue-empty">아직 정답에 있는 걸로 확인된 태그가 없어요.</div>
          )}

          {clues.noCount > 0 && (
            <div className="clue-no">
              <button
                className="clue-toggle"
                onClick={() => setShowNoClues((v) => !v)}
                aria-expanded={showNoClues}
              >
                {showNoClues ? "▲" : "▼"} 정답에 없는 걸로 확인된 태그 {clues.noCount}개
              </button>
              {showNoClues &&
                clues.no.map((row) => (
                  <div className="clue-row" key={`n-${row.label}`}>
                    <span className="clue-lbl">✗ {row.label}</span>
                    <span className="clue-chips">
                      {row.names.map((n) => (
                        <span className="chip no" key={n}>
                          {n}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {turns.length > 0 && (
        <div className="bodle-grid">
          {/* 색 범례 — 칸 색이 무슨 뜻인지 페이지 안에서 바로 읽히게. FAQ까지 내려가지 않아도 된다. */}
          <div className="bodle-legend">
            <span>
              <i className="hit" />내 태그 전부 있음
            </span>
            <span>
              <i className="partial" />
              일부 있음
            </span>
            <span>
              <i className="miss" />
              없음
            </span>
            <span>
              <i className="near" />
              아깝게
            </span>
            <span>
              <i className="unknown" />
              판정 불가
            </span>
            <span>▲ 정답이 더 큼 · ▼ 더 작음</span>
          </div>
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
                    // 판정 불가 칸은 "없음"과 반드시 구분해서 알려준다(점선 + 안내 문구).
                    const dead = mark === "unknown";
                    const chips = isNum ? [] : tagChips(db, g, c.key as TagKey, t.feedback);
                    const nHit = chips.filter((x) => x.hit).length;
                    /*
                     * 좁은 칸에 태그 이름을 우겨넣는 대신 "맞은 수/낸 수"만 남긴다.
                     * 어느 태그가 맞았는지는 위 단서판이 책임진다 — 10px로 잘린 이름은
                     * 어차피 못 읽었고, 모바일에서는 title 툴팁도 뜨지 않았다.
                     */
                    const detail = dead
                      ? `${c.label}: 판정 불가 — 정답 또는 이 게임에 정보가 없어요`
                      : isNum
                        ? undefined
                        : `${c.label}: ${chips.map((x) => `${x.name} ${x.hit ? "✓" : "✗"}`).join(", ")}`;
                    return (
                      <div
                        key={c.key}
                        className={`cell ${mark} ${near ? "near" : ""}`}
                        title={detail}
                        aria-label={detail}
                      >
                        {isNum ? (
                          (() => {
                            const numVal = numText(c.key as "weight" | "year", g);
                            return (
                              <>
                                <span className={`v ${numVal === NO_DATA ? "long" : ""}`}>
                                  {numVal}
                                </span>
                                {dir && <span className="a">{ARROW[dir]}</span>}
                              </>
                            );
                          })()
                        ) : dead ? (
                          <span className="v long">판정 불가</span>
                        ) : (
                          <span className="v count">
                            {nHit}
                            <em>/{chips.length}</em>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {deadCols.length > 0 && (
            <div className="bodle-dead">
              ⓘ <b>{deadCols.map((c) => c.label).join(" · ")}</b> 열은 지금까지 한 번도 판정되지
              않았어요 — 정보가 없어 비교할 수 없는 칸이니 단서로 쓰지 마세요.
            </div>
          )}
        </div>
      )}

      {turns.length === 0 &&
        (db ? (
          <div className="empty">
            🎯 첫 추측을 시작해보세요!
            <span>
              아무 보드게임이나 넣으면 유형·테마·진행방식·무게·연도가 정답과 얼마나 맞는지
              알려드려요. (예: 카탄, 윙스팬)
            </span>
          </div>
        ) : (
          !error && (
            <div className="empty">
              불러오는 중…
              <span>오늘의 문제를 준비하고 있어요</span>
            </div>
          )
        ))}

      {finished && (
        <div className="banner">
          <div className="banner-title">
            {solved ? `🎉 ${turns.length}번 만에 맞혔어요!` : "🏳️ 아쉬워요, 다음 판에!"}
          </div>
          {answer && (
            <div className="banner-answer">
              정답은 <b>{answer.name_ko ?? answer.name_en}</b>
              {solved ? "!" : " 였어요."}
            </div>
          )}
          <div className="banner-sub">매일 오전 9시 새 문제로 다시 만나요</div>

          {solved && pct && (
            <PercentileCard
              info={pct}
              heading="오늘 맞힌 사람 중 상위"
              detail={`${pct.guesses}번 추측`}
              dist={{
                title: "추측 횟수별 정답자",
                rows: BODLE_BUCKETS.map((b) => ({
                  label: b,
                  count: pct.guessDist?.[b] ?? 0,
                  mine: b === bodleBucket(pct.guesses),
                })),
              }}
            />
          )}
          {/* 포기한 사람에겐 백분위가 없다(표본이 정답자뿐). 대신 전체 현황을 보여준다. */}
          {!solved && todayStats && todayStats.players > 0 && (
            <TodaySummaryCard
              players={todayStats.players}
              solved={todayStats.solved}
              avgGuesses={todayStats.avgGuesses}
            />
          )}

          {answer && <AnswerCard info={answer} />}

          <div className="banner-actions">
            <button className="share-btn" onClick={share}>
              📋 결과 공유
            </button>
            <button className="stats-btn" onClick={openStats}>
              📊 통계
            </button>
          </div>
          {shareMsg && <div className="share-msg">{shareMsg}</div>}
        </div>
      )}

      {/* 자매 게임 유도. 보맨틀 쪽과 같은 카드 모양을 쓴다. */}
      <Link className="sister-link" href="/">
        🎯 <b>보맨틀</b> — 유사도 점수로 오늘의 보드게임 맞히기 →
      </Link>

      <footer className="site-footer">
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

              <div className="stat-grid stat-grid-2 stat-grid-3">
                <div className="stat-cell">
                  <div className="stat-num">{bodleAvgGuesses(stats) || "–"}</div>
                  <div className="stat-lbl">평균 추측</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-num">{bodleBestGuesses(stats) ?? "–"}</div>
                  <div className="stat-lbl">베스트</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-num">{stats.played - stats.solved}</div>
                  <div className="stat-lbl">실패</div>
                </div>
              </div>

              <DistBars
                title="추측 횟수 분포"
                note={
                  stats.played - stats.solved > 0
                    ? `실패 ${stats.played - stats.solved}회`
                    : undefined
                }
                // 시도 횟수를 8 → 6으로 줄였어도 옛 기록(7·8번 만에 맞힘)은 계속 보여준다.
                rows={Array.from(
                  { length: Math.max(today?.maxGuesses ?? 6, stats.dist.length) },
                  (_, i) => ({
                    label: String(i + 1),
                    count: stats.dist[i] ?? 0,
                    mine: finished && solved && turns.length - 1 === i,
                  }),
                )}
              />
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
        추측하면 그 게임의 유형·테마·진행방식 태그 중 <b>어느 것이 정답에도 있는지</b>를
        하나씩 알려주고, 무게(난이도)·출시연도는 정답이 더 높은지 낮은지 알려줍니다.
        그 단서로 후보를 좁혀 6번 안에 정답을 찾는 방식입니다. 영어 단어 맞히기 게임
        워들(Wordle)·꼬들의 보드게임 버전이라고 보면 됩니다.
      </p>
      <h3>자주 묻는 질문</h3>
      <dl>
        <dt>새 문제는 언제 나오나요?</dt>
        <dd>매일 한국 시간(KST) 오전 9시에 새로운 보드게임 문제로 초기화됩니다.</dd>
        <dt>격자의 숫자와 색깔은 무슨 뜻인가요?</dt>
        <dd>
          유형·테마·진행방식 칸의 <b>1/3</b>은 &ldquo;내가 낸 태그 3개 중 1개가 정답에도
          있다&rdquo;는 뜻입니다. 낸 태그가 전부 있으면 초록, 일부만 있으면 노랑, 하나도
          없으면 회색입니다. 무게와 연도는 정답과 완전히 같은 값일 때만 초록이고,
          근접한 범위(무게 0.75 이내, 연도 5년 이내)면 노랑, 더 벌어졌지만 아깝게
          빗나갔으면(무게 1.25 이내, 연도 8년 이내) 주황 테두리가 생깁니다. 완전히 같은
          값이 아니면 색과 별개로 ▲(정답이 더 높음)·▼(더 낮음) 화살표가 항상 붙어 다음
          추측 방향을 알려줍니다.
        </dd>
        <dt>&ldquo;지금까지 알아낸 것&rdquo;은 뭔가요?</dt>
        <dd>
          지금까지 추측한 게임들의 태그 중 <b>정답에 있는 것으로 확인된 태그</b>와 없는
          것으로 확인된 태그를 모아 보여줍니다. 워들의 키보드 색과 같은 역할이며, 다음에
          어떤 게임을 넣을지 고를 때 여기를 보면 됩니다. 내가 추측한 게임의 태그만 나오고,
          <b>내지 않은 정답의 태그는 나오지 않습니다.</b>
        </dd>
        <dt>점선으로 비어 있는 칸은 뭔가요?</dt>
        <dd>
          &ldquo;판정 불가&rdquo; 칸입니다. 정답 또는 추측한 게임에 그 항목 정보가 아예 없어
          비교할 수 없다는 뜻이며, <b>&ldquo;안 겹친다&rdquo;는 뜻이 아닙니다.</b> 어떤 열이
          계속 판정 불가로 나오면 그 열은 오늘 단서가 될 수 없으니 무시하세요.
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
