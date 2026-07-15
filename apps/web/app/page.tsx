"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameMeta, GuessRow, HintData, TodayInfo } from "../lib/types";
import { loadGameDB, resolve, suggest, categoryNames, type GameDB } from "../lib/games";
import { fetchToday, fetchGuess, fetchGiveup, fetchHint, fetchVisit } from "../lib/api";
import {
  loadStats,
  recordResult,
  winRate,
  bucketOf,
  giveups,
  avgGuesses,
  effectiveStreak,
  effectiveNoHintStreak,
  exportStats,
  importStats,
  GUESS_BUCKETS,
  type Stats,
} from "../lib/stats";

function barColor(row: GuessRow): string {
  if (row.win) return "var(--cool)";
  if (row.rank <= 10) return "var(--hot)";
  if (row.rank <= 50) return "#ff8a4f";
  if (row.rank <= 300) return "var(--warm)";
  if (row.rank <= 1000) return "var(--accent)";
  return "#3a4150";
}

// 순위 근접도 라벨. 가까울수록 강한 표식 (🔥는 진짜 근접한 것만).
function rankLabel(rank: number): string {
  if (rank <= 10) return `🔥 ${rank}위`;
  if (rank <= 50) return `🟠 ${rank}위`;
  if (rank <= 300) return `🟡 ${rank}위`;
  return `${rank}위`;
}

// 추측 횟수 → 별점 (적게 맞힐수록 ★ 많음).
function starRating(n: number): string {
  const filled = n <= 3 ? 5 : n <= 6 ? 4 : n <= 10 ? 3 : n <= 20 ? 2 : 1;
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

// 공유 텍스트. 정답 이름은 절대 넣지 않음.
function buildShareText(rows: GuessRow[], hintCount: number, streak = 0): string {
  const solved = rows.some((r) => r.win);
  const n = rows.length;
  const head = `🎲 보맨틀`;
  // 힌트 사용 횟수: 1회당 💀
  const hintLine = hintCount > 0 ? `\n💡 힌트횟수 ${"💀".repeat(hintCount)}` : "";
  // 연속 정답(2일 이상일 때만 자랑)
  const streakLine = solved && streak >= 2 ? `\n🔥 연속 ${streak}일` : "";
  if (solved) {
    return `${head}\n🎯 ${n}번 만에 맞혔어요!\n${starRating(n)}${streakLine}${hintLine}\n\nhttps://bomantle.pages.dev`;
  }
  // 포기: 가장 가까이 갔던 순위 (자랑 + 스포일러 없음)
  const ranks = rows.filter((r) => !r.win).map((r) => r.rank);
  const best = ranks.length ? Math.min(...ranks) : 0;
  return `${head}\n🏳️ 포기 — 가장 가까웠던 순위 ${best}위\n${n}번 추측${hintLine}\n\nhttps://bomantle.pages.dev`;
}

// 매일 게임이 초기화되는 시각(Asia/Seoul 기준). 백엔드 RESET_HOUR과 일치시킬 것.
const RESET_HOUR = 9;

// 문의·제보 구글폼. 응답은 연결된 구글 스프레드시트로 자동 수집됨.
// 폼 생성 후 "보내기 → 링크(🔗)"의 단축 URL을 여기에 붙여넣으면 됨.
const FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSedokjNlrAy5I6u73BgqDsAYwyjSSbZ1N2S4ndsdPCXa_pcvw/viewform";

// 현재 "퍼즐 날짜"(YYYY-MM-DD). 서버 data/answer.ts의 kstDate와 동일 규칙:
// KST에서 RESET_HOUR시만큼 당겨 날짜를 계산(오전 9시 경계). 하루 경계 감지에 사용.
function clientPuzzleDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - RESET_HOUR * 3_600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

// 다음 초기화(매일 오전 RESET_HOUR시 KST)까지 남은 ms. 클라이언트 타임존과 무관하게 동작.
function msUntilNextReset(now: Date = new Date()): number {
  // 로컬 타임존에 KST 벽시계 값을 심은 Date — 두 Date의 차(duration)는 타임존 무관.
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const target = new Date(kst);
  target.setHours(RESET_HOUR, 0, 0, 0);
  if (kst.getTime() >= target.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - kst.getTime();
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function metaText(db: GameDB, g: GameMeta): string {
  const parts: string[] = [];
  const cats = categoryNames(db, g).slice(0, 3);
  if (cats.length) parts.push(cats.join("·"));
  if (g.weight) parts.push(`난이도 ${g.weight.toFixed(1)}`);
  return parts.join(" · ");
}

export default function Page() {
  const [db, setDb] = useState<GameDB | null>(null);
  const [today, setToday] = useState<TodayInfo | null>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<GuessRow[]>([]);
  const [error, setError] = useState("");
  const [won, setWon] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  // 정답 공개 시 박스아트·보드라이프 링크용 (id = 보드라이프 게임 id)
  const [answerInfo, setAnswerInfo] = useState<{ id: number; image: string | null } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [shareMsg, setShareMsg] = useState("");
  const [hints, setHints] = useState<HintData[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [visitors, setVisitors] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 응답 대기 중인 gameId. 같은 게임 연속 제출(race) 중복 추가 방지.
  const inFlightRef = useRef<Set<number>>(new Set());
  // 하루 경계 재조회 진행 중 플래그(중복 fetch 방지).
  const rollingRef = useRef(false);

  // 특정 퍼즐 날짜의 판을 화면에 적용: 상태 초기화 후 로컬 저장(같은 날짜) 복원.
  // 최초 로드와 하루 경계(오전 9시) 자동 전환에서 공용.
  const applyDay = useCallback((info: TodayInfo) => {
    setToday(info);
    setVisitors(info.visitors ?? null);
    // 이전 판 상태 초기화
    setRows([]);
    setWon(false);
    setAnswer(null);
    setAnswerInfo(null);
    setHints([]);
    setQuery("");
    setError("");
    setShareMsg("");
    seqRef.current = 0;
    inFlightRef.current.clear();
    // 로컬 저장 복원 (같은 날짜만)
    try {
      const raw = localStorage.getItem(`bomantle:${info.date}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        rows: GuessRow[];
        won: boolean;
        answer: string | null;
        answerInfo?: { id: number; image: string | null } | null;
        hints?: HintData[];
      };
      setRows(saved.rows ?? []);
      setWon(saved.won ?? false);
      setAnswer(saved.answer ?? null);
      setHints(saved.hints ?? []);
      seqRef.current = saved.rows?.length ?? 0;
      if (saved.answerInfo) {
        setAnswerInfo(saved.answerInfo);
      } else if (saved.won) {
        // 구버전 저장(박스아트·링크 정보 없음) → 정답 정보 다시 가져와 복구
        fetchGiveup()
          .then((r) => setAnswerInfo({ id: r.answer.id, image: r.answer.image ?? null }))
          .catch(() => {});
      }
    } catch {}
  }, []);

  // 초기 로드 (DB는 1회만, 오늘 판 적용)
  useEffect(() => {
    (async () => {
      let info: TodayInfo;
      let database: GameDB;
      try {
        [database, info] = await Promise.all([loadGameDB(), fetchToday()]);
      } catch {
        // 로드 실패 시 무한 로딩에 빠지지 않도록 안내
        setError("데이터를 불러오지 못했어요. 잠시 후 새로고침 해주세요.");
        return;
      }
      setDb(database);
      applyDay(info);
    })();
  }, [applyDay]);

  // 저장
  useEffect(() => {
    if (!today) return;
    localStorage.setItem(
      `bomantle:${today.date}`,
      JSON.stringify({ rows, won, answer, answerInfo, hints }),
    );
  }, [rows, won, answer, answerInfo, hints, today]);

  // 오늘 첫 방문이면 접속 집계 핑 1회. localStorage 플래그로 같은 날짜 중복 집계 방지.
  // 플래그를 먼저 심으므로 핑이 실패하면 그날은 집계에서 빠짐(중복 집계보다 낫다).
  useEffect(() => {
    if (!today) return;
    const key = `bomantle:visited:${today.date}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return; // 저장 불가 환경은 dedupe가 안 되므로 집계 생략
    }
    fetchVisit()
      .then((r) => {
        if (r.visitors != null) setVisitors(r.visitors);
      })
      .catch(() => {});
  }, [today]);

  // 통계 최초 로드(헤더 버튼용)
  useEffect(() => {
    setStats(loadStats());
  }, []);

  // 게임 완료(정답/포기) 시 누적 통계 집계. 같은 날짜는 recordResult가 1회만 반영.
  useEffect(() => {
    if (!won || !today) return;
    const solved = rows.some((r) => r.win);
    setStats(recordResult(today.date, solved, rows.length, hints.length));
  }, [won, today]);

  // 다음 초기화까지 1초마다 카운트다운 갱신
  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(msUntilNextReset()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // 하루 경계(오전 9시) 자동 전환: 탭을 열어둔 채 날짜가 넘어가면 서버에서 새 판을
  // 받아 자동 리셋. 클라 시계로 후보를 감지하되, 서버 date가 실제로 바뀐 경우에만 적용.
  useEffect(() => {
    if (!today) return;
    let cooldownUntil = 0;
    const id = setInterval(async () => {
      if (rollingRef.current || Date.now() < cooldownUntil) return;
      if (clientPuzzleDate() === today.date) return; // 아직 같은 날
      rollingRef.current = true;
      try {
        const info = await fetchToday();
        if (info.date !== today.date) {
          applyDay(info); // 실제로 새 날짜일 때만 판 리셋
        } else {
          // 서버가 아직 안 넘어감(클라 시계 앞섬) → 30초 뒤 재확인, 재조회 폭주 방지
          cooldownUntil = Date.now() + 30_000;
        }
      } catch {
        cooldownUntil = Date.now() + 30_000;
      } finally {
        rollingRef.current = false;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [today, applyDay]);

  const guessedIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);

  // 자동완성: 이미 추측한 게임은 제외 (id 기준 — 동명 다른 게임은 남김)
  const suggestions = useMemo(
    () =>
      db && query
        ? suggest(db, query, 8).filter((g) => !guessedIds.has(g.id))
        : [],
    [db, query, guessedIds],
  );

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.score - a.score),
    [rows],
  );

  // 방금(가장 최근) 추측한 행 — 최상단 고정용
  const lastRow = rows.length ? rows[rows.length - 1] : null;

  // 선택된 게임을 id 기준으로 추측. 동명 다른 게임도 각각 구분되어 추가됨.
  async function submitGame(game: GameMeta) {
    setError("");
    // 이미 추측했거나 응답 대기 중이면 중복 추가 방지 (id 기준)
    if (rows.some((r) => r.id === game.id) || inFlightRef.current.has(game.id)) {
      setQuery("");
      setError(`이미 추측한 게임이에요: ${game.name_ko}`);
      return;
    }
    inFlightRef.current.add(game.id);
    try {
      const res = await fetchGuess(game.id);
      const row: GuessRow = { ...res, game, seq: ++seqRef.current };
      // 방어적 dedup: 동시 제출이 끼어들어도 같은 id 중복 추가 안 함
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
      setQuery("");
      if (res.win) {
        setWon(true);
        setAnswer(res.answer?.name_ko ?? game.name_ko);
        setAnswerInfo({ id: res.answer?.id ?? game.id, image: res.answer?.image ?? null });
      }
    } catch {
      setError("서버 오류예요. 잠시 후 다시 시도해주세요.");
    } finally {
      inFlightRef.current.delete(game.id);
    }
  }

  // 입력창/추측 버튼: 타이핑한 텍스트를 게임으로 해석해 제출
  function submitText(name: string) {
    setError("");
    if (!db) return;
    const game = resolve(db, name);
    if (!game) {
      setError("목록에 없는 보드게임이에요. 자동완성에서 골라보세요.");
      return;
    }
    submitGame(game);
  }

  async function getHint() {
    if (hintLoading || hints.length >= 8) return;
    setHintLoading(true);
    try {
      const h = await fetchHint(hints.length + 1);
      setHints((prev) => [...prev, h]);
    } catch {
      setError("힌트를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setHintLoading(false);
    }
  }

  async function shareResult() {
    if (!today) return;
    const text = buildShareText(rows, hints.length, stats?.curStreak ?? 0);
    try {
      await navigator.clipboard.writeText(text);
      setShareMsg("결과를 복사했어요! 붙여넣기로 공유하세요 📋");
    } catch {
      setShareMsg("복사가 안 됐어요. 텍스트를 길게 눌러 복사해주세요.");
    }
    setTimeout(() => setShareMsg(""), 3000);
  }

  async function onGiveup() {
    if (!confirm("정답을 공개할까요? (오늘 게임은 종료됩니다)")) return;
    try {
      const r = await fetchGiveup();
      setAnswer(r.answer.name_ko);
      setAnswerInfo({ id: r.answer.id, image: r.answer.image ?? null });
      setWon(true);
    } catch {
      setError("정답을 불러오지 못했어요.");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
    }
    if (e.key === "Enter") {
      // 한글 IME 조합 중 발생하는 Enter(조합 확정용)는 무시 — 이중 제출 방지
      if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) return;
      e.preventDefault();
      const pick = suggestions[activeIdx];
      // 자동완성 선택 시 그 게임을 id로 직접 제출(동명 게임 구분), 아니면 텍스트 해석
      if (pick) submitGame(pick);
      else submitText(query);
      setActiveIdx(0);
    }
  }

  const loading = !db || !today;

  // 추측 행 1개 렌더 (고정 카드와 목록에서 공용)
  const renderRow = (
    row: GuessRow,
    opts: { cls?: string; badge?: boolean } = {},
  ) => (
    <div key={row.id} className={`row ${opts.cls ?? ""}`}>
      <div className="seq">{row.seq}</div>
      <div className="name">
        {row.game.name_ko}
        {opts.badge && <span className="badge">가장 가까움</span>}
        <span className="meta">{metaText(db!, row.game)}</span>
      </div>
      <div className="score">
        <div className="num">{row.win ? "정답!" : row.score.toFixed(1)}</div>
        {!row.win && <div className="rank">{rankLabel(row.rank)}</div>}
      </div>
      <div className="bar">
        <span style={{ width: `${row.win ? 100 : row.score}%`, background: barColor(row) }} />
      </div>
    </div>
  );

  return (
    <div className="wrap">
      <header className="top">
        <button
          className="stats-open"
          onClick={() => setShowStats(true)}
          aria-label="통계 보기"
          title="통계"
        >
          📊
        </button>
        <h1>보맨틀 🎲</h1>
        <div className="sub">
          {today
            ? `${today.date} · 매일 보드게임 하나를 유사도로 맞혀보세요`
            : "불러오는 중…"}
        </div>
        {visitors != null && visitors > 0 && (
          <div className="visitors">👥 오늘 {visitors.toLocaleString()}명 접속</div>
        )}
        {countdown && (
          <div className="reset-info">
            ⏰ 다음 문제까지 <b>{countdown}</b>
            <span className="reset-note">매일 오전 9시 초기화</span>
          </div>
        )}
      </header>

      {won && (
        <div className="banner">
          {rows.some((r) => r.win) ? (
            <>
              🎉 정답은 <b>{answer}</b>!
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                {rows.length}번 만에 맞혔어요 · 매일 오전 9시 새 문제로 다시 만나요
              </div>
            </>
          ) : (
            <>
              정답은 <b>{answer}</b> 였어요.
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                {rows.length}번 추측 후 포기 · 매일 오전 9시 새 문제로 다시 만나요
              </div>
            </>
          )}
          {answerInfo && (
            <a
              className="answer-link"
              href={`https://boardlife.co.kr/game/${answerInfo.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {answerInfo.image && (
                <img className="answer-img" src={answerInfo.image} alt={`${answer} 박스아트`} />
              )}
              <span className="answer-link-text">보드라이프에서 보기 ↗</span>
            </a>
          )}
          <div className="banner-actions">
            <button className="share-btn" onClick={shareResult}>
              📋 결과 공유
            </button>
            <button className="stats-btn" onClick={() => setShowStats(true)}>
              📊 통계
            </button>
          </div>
          {shareMsg && <div className="share-msg">{shareMsg}</div>}
        </div>
      )}

      {!won && (
        <>
          <div className="input-area">
            <input
              ref={inputRef}
              value={query}
              placeholder={loading ? "데이터 불러오는 중…" : "보드게임 이름 입력 (예: 카탄)"}
              disabled={loading}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onKeyDown}
              autoComplete="off"
            />
            <button disabled={loading || !query} onClick={() => submitText(query)}>
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
                      submitGame(s);
                    }}
                  >
                    <span>{s.name_ko}</span>
                    <span className="en">{s.name_en}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="hint">
            추측한 게임이 정답과 의미적으로 가까울수록 점수가 높아요. {rows.length}번 추측함
          </div>

          {(hints.length > 0 || !loading) && (
            <div className="hints">
              {hints.map((h) => (
                <div className="hint-item" key={h.level}>
                  <span className="hint-label">{h.label}</span>
                  <span className="hint-value">{h.value}</span>
                </div>
              ))}
              {hints.length < 8 && (
                <button className="hint-btn" onClick={getHint} disabled={hintLoading}>
                  💡 힌트 보기 ({hints.length}/8)
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}

      {rows.length === 0 && !loading && !won && (
        <div className="empty">
          🎯 첫 추측을 시작해보세요!
          <span>
            아는 보드게임 이름을 입력하면 정답과의 유사도를 알려드려요. (예: 카탄, 윙스팬)
          </span>
        </div>
      )}

      {/* 방금 추측한 게임을 최상단에 고정 — 순위가 낮아도 바로 보이게 */}
      {!won && lastRow && (
        <div className="pinned">
          <div className="pinned-label">방금 추측</div>
          {renderRow(lastRow, { cls: "latest" })}
        </div>
      )}

      <div className="rows">
        {sortedRows.map((row, idx) =>
          renderRow(row, {
            cls: [
              row.win ? "win" : "",
              idx === 0 && !won && sortedRows.length > 1 ? "top" : "",
              row.id === lastRow?.id && !won ? "latest" : "",
            ]
              .filter(Boolean)
              .join(" "),
            badge: idx === 0 && !won && sortedRows.length > 1,
          }),
        )}
      </div>

      {!won && rows.length > 0 && (
        <div className="footer-actions">
          <button onClick={onGiveup}>포기하고 정답 보기</button>
        </div>
      )}

      <footer className="site-footer">
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          💬 문의·제보
        </a>
        <span className="credit">제작자: 문보미</span>
      </footer>

      {showStats && stats && (
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
                    <div className="stat-num">{winRate(stats)}%</div>
                    <div className="stat-lbl">정답률</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-num">{effectiveStreak(stats, today?.date ?? "")}</div>
                    <div className="stat-lbl">현재 연속</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-num">{stats.maxStreak}</div>
                    <div className="stat-lbl">최고 연속</div>
                  </div>
                </div>

                <div className="stat-grid stat-grid-2">
                  <div className="stat-cell">
                    <div className="stat-num">{avgGuesses(stats) || "–"}</div>
                    <div className="stat-lbl">평균 추측</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-num">{stats.bestGuesses ?? "–"}</div>
                    <div className="stat-lbl">베스트</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-num">{stats.noHintWins}</div>
                    <div className="stat-lbl">무힌트 승</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-num">
                      {effectiveNoHintStreak(stats, today?.date ?? "")}
                    </div>
                    <div className="stat-lbl">무힌트 연속</div>
                  </div>
                </div>

                <div className="dist">
                  <div className="dist-title">
                    추측 횟수 분포
                    {giveups(stats) > 0 && (
                      <span className="dist-note"> · 포기 {giveups(stats)}회</span>
                    )}
                  </div>
                  {(() => {
                    const max = Math.max(1, ...GUESS_BUCKETS.map((b) => stats.dist[b] ?? 0));
                    const hi =
                      won && rows.some((r) => r.win) ? bucketOf(rows.length) : null;
                    return GUESS_BUCKETS.map((b) => {
                      const c = stats.dist[b] ?? 0;
                      return (
                        <div className="dist-row" key={b}>
                          <span className="dist-lbl">{b}</span>
                          <div className="dist-bar">
                            <span
                              className={`dist-fill ${b === hi ? "hi" : ""}`}
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

            <div className="backup">
              <button
                className="backup-toggle"
                onClick={() => {
                  setShowBackup((v) => !v);
                  setBackupMsg("");
                }}
              >
                {showBackup ? "▲ 백업 닫기" : "⤓ 기기 이동·백업"}
              </button>
              {showBackup && (
                <div className="backup-panel">
                  <p className="backup-hint">
                    통계는 이 브라우저에만 저장돼요. 아래 코드를 복사해 두거나, 다른 기기에서
                    붙여넣어 복원하세요.
                  </p>
                  <textarea
                    className="backup-text"
                    value={backupText}
                    onChange={(e) => setBackupText(e.target.value)}
                    placeholder="백업 코드를 붙여넣으세요…"
                    spellCheck={false}
                  />
                  <div className="backup-actions">
                    <button
                      onClick={() => {
                        const json = exportStats(stats);
                        setBackupText(json);
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(json).then(
                            () => setBackupMsg("복사됐어요 ✓"),
                            () => setBackupMsg("아래 코드를 직접 복사하세요"),
                          );
                        } else {
                          setBackupMsg("아래 코드를 직접 복사하세요");
                        }
                      }}
                    >
                      내보내기(복사)
                    </button>
                    <button
                      onClick={() => {
                        const next = importStats(backupText.trim());
                        if (next) {
                          setStats(next);
                          setBackupMsg("복원 완료! ✓");
                        } else {
                          setBackupMsg("잘못된 백업 코드예요");
                        }
                      }}
                    >
                      불러오기
                    </button>
                    {backupMsg && <span className="backup-msg">{backupMsg}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
