"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnswerInfo,
  GameMeta,
  GuessRow,
  HintData,
  PercentileResult,
  RankingItem,
  TodayInfo,
  TodayStats,
} from "../lib/types";
import { loadGameDB, resolve, suggest, categoryNames, type GameDB } from "../lib/games";
import {
  fetchToday,
  fetchGuess,
  fetchGiveup,
  fetchHint,
  fetchRanking,
  fetchResult,
  fetchStats,
  fetchVisit,
} from "../lib/api";
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
// 기기 식별자는 보들과 같은 정의를 쓴다(같은 키 `bomantle:cid`).
import { deviceId } from "../lib/bodle";
import { FEEDBACK_URL } from "../lib/constants";
import { RESET_HOUR, clientPuzzleDate, msUntilNextReset, formatCountdown } from "../lib/reset";
import { AnswerCard } from "../components/AnswerCard";
import { TodayStatsCard } from "../components/TodayStatsCard";

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
// 실제 플레이가 수십 회까지 퍼지므로 경계를 넓게 잡아 별 개수가 고르게 나오도록 함.
function starRating(n: number): string {
  const filled = n <= 4 ? 5 : n <= 9 ? 4 : n <= 16 ? 3 : n <= 30 ? 2 : 1;
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

// 공유 텍스트. 정답 이름은 절대 넣지 않음.
function buildShareText(
  rows: GuessRow[],
  hintCount: number,
  streak = 0,
  pct: PercentileResult | null = null,
): string {
  const solved = rows.some((r) => r.win);
  const n = rows.length;
  const head = `🎲 보맨틀`;
  // 힌트 사용 횟수: 1회당 💀
  const hintLine = hintCount > 0 ? `\n💡 힌트횟수 ${"💀".repeat(hintCount)}` : "";
  // 연속 정답(2일 이상일 때만 자랑)
  const streakLine = solved && streak >= 2 ? `\n🔥 연속 ${streak}일` : "";
  // 백분위(표본이 충분할 때만). 순위·인원은 넣지 않는다 — 공유 시점마다 값이 달라 혼란.
  const pctLine = solved && pct && !pct.pending ? `\n🏆 상위 ${pct.percentile}%` : "";
  if (solved) {
    return `${head}\n🎯 ${n}번 만에 맞혔어요!\n${starRating(n)}${pctLine}${streakLine}${hintLine}\n\nhttps://bomantle.pages.dev`;
  }
  // 포기: 가장 가까이 갔던 순위 (자랑 + 스포일러 없음)
  const ranks = rows.filter((r) => !r.win).map((r) => r.rank);
  const best = ranks.length ? Math.min(...ranks) : 0;
  return `${head}\n🏳️ 포기 — 가장 가까웠던 순위 ${best}위\n${n}번 추측${hintLine}\n\nhttps://bomantle.pages.dev`;
}

// 전체 순위 목록을 한 번에 가져오는 개수(서버 MAX_LIMIT=200 이하).
const RANK_PAGE = 100;

// 백분위 재조회 최소 간격. 표본이 하루 내내 늘어 값이 변하지만, 탭을 자주 왕복해도
// 요청이 몰리지 않게 막는다.
const PCT_REFRESH_MS = 60_000;

/**
 * 오늘 맞힌 사람 중 내 위치. 표본은 **맞힌 사람만**이므로 문구를 반드시 "맞힌 N명 중"으로
 * 쓴다(포기자를 포함한 것처럼 읽히면 수치가 거짓이 된다).
 */
function PercentileCard({ info }: { info: PercentileResult }) {
  if (info.pending) {
    return (
      <div className="pct">
        <div className="pct-pending">
          🏆 아직 집계 중 · 오늘 {info.total}명이 맞혔어요
          <div className="pct-note">몇 명 더 맞히면 상위 %가 표시돼요</div>
        </div>
      </div>
    );
  }

  const maxHint = Math.max(1, ...info.hintDist);
  return (
    <div className="pct">
      <div className="pct-head">
        상위 <b>{info.percentile}%</b>
      </div>
      <div className="pct-bar">
        <span className="pct-fill" style={{ width: `${info.percentile}%` }} />
        <span className="pct-marker" style={{ left: `${info.percentile}%` }} />
      </div>
      <div className="pct-note">
        오늘 맞힌 {info.total.toLocaleString()}명 중 <b>{info.rank.toLocaleString()}위</b> · 힌트{" "}
        {info.hints}개 · {info.guesses}번 추측
      </div>

      <div className="pct-dist">
        <div className="dist-title">힌트 개수별 정답자</div>
        {info.hintDist.map((c, h) => (
          <div className="dist-row" key={h}>
            <span className="dist-lbl">{h}개</span>
            <div className="dist-bar">
              <span
                className={`dist-fill ${h === info.hints ? "hi" : ""}`}
                style={{ width: `${c ? Math.max(12, (c / maxHint) * 100) : 0}%` }}
              >
                {c > 0 && <em>{c}</em>}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 오늘 참여자 중 맞힌 비율(%). 참여 0이면 0. */
function todayWinRate(s: TodayStats): number {
  return s.players ? Math.round((s.solved / s.players) * 100) : 0;
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
  // 정답 공개 시 게임 정보 카드용 (id = 보드라이프 게임 id)
  const [answerInfo, setAnswerInfo] = useState<AnswerInfo | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [shareMsg, setShareMsg] = useState("");
  const [hints, setHints] = useState<HintData[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [visitors, setVisitors] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showStats, setShowStats] = useState(false);
  // 정답 공개 후 전체 순위 목록(누적). 펼쳤을 때만 받아온다.
  const [rankItems, setRankItems] = useState<RankingItem[]>([]);
  const [rankTotal, setRankTotal] = useState(0);
  const [rankOpen, setRankOpen] = useState(false);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState("");
  // 오늘 맞힌 사람 중 내 백분위. 서버 집계가 없으면 계속 null(UI 자체를 감춘다).
  const [pct, setPct] = useState<PercentileResult | null>(null);
  // 오늘 전체 현황(익명 집계). 백분위와 달리 포기자도 볼 수 있다.
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [showBackup, setShowBackup] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 응답 대기 중인 gameId. 같은 게임 연속 제출(race) 중복 추가 방지.
  const inFlightRef = useRef<Set<number>>(new Set());
  // 하루 경계 재조회 진행 중 플래그(중복 fetch 방지).
  const rollingRef = useRef(false);
  // 백분위 재조회 쓰로틀용 마지막 성공 시각(ms) + 진행 중 플래그.
  const pctAtRef = useRef(0);
  const pctBusyRef = useRef(false);
  // 전체 현황 재조회용(같은 쓰로틀 간격).
  const statsAtRef = useRef(0);
  const statsBusyRef = useRef(false);

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
    setRankItems([]);
    setRankTotal(0);
    setRankOpen(false);
    setRankError("");
    setPct(null);
    setTodayStats(null);
    seqRef.current = 0;
    inFlightRef.current.clear();
    pctAtRef.current = 0;
    statsAtRef.current = 0;
    // 로컬 저장 복원 (같은 날짜만)
    try {
      const raw = localStorage.getItem(`bomantle:${info.date}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        rows: GuessRow[];
        won: boolean;
        answer: string | null;
        answerInfo?: Partial<AnswerInfo> | null;
        hints?: HintData[];
        pct?: PercentileResult | null;
      };
      setRows(saved.rows ?? []);
      setWon(saved.won ?? false);
      setAnswer(saved.answer ?? null);
      setHints(saved.hints ?? []);
      // 저장값을 깜빡임 없이 먼저 그리고, 최신값은 아래 재조회 효과가 덮어쓴다.
      setPct(saved.pct ?? null);
      seqRef.current = saved.rows?.length ?? 0;
      // categories 유무로 신버전(게임 정보 포함) 저장인지 판별.
      if (saved.answerInfo?.categories) {
        setAnswerInfo(saved.answerInfo as AnswerInfo);
      } else if (saved.won) {
        // 구버전 저장(박스아트·링크만 또는 정보 없음) → 정답 정보 다시 가져와 복구
        fetchGiveup()
          .then((r) => setAnswerInfo(r.answer))
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
      JSON.stringify({ rows, won, answer, answerInfo, hints, pct }),
    );
  }, [rows, won, answer, answerInfo, hints, pct, today]);

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

  /**
   * 결과 제출(정답·포기 모두) + 정답이면 백분위 조회. 서버가 멱등(같은 cid는 첫 기록 고정)이라
   * 재호출이 안전하고, 표본이 하루 내내 늘기 때문에 탭에 돌아올 때마다 갱신한다.
   * 포기도 보내야 전체 현황의 참여 수·정답률 분모가 생긴다(순위 표본에는 안 들어감).
   * 실패는 조용히 무시 — 게임 진행과 무관한 부가 정보라 에러 UI를 띄우지 않는다.
   */
  const refreshPct = useCallback(async (force = false) => {
    if (!today || !won) return;
    if (pctBusyRef.current) return;
    if (!force && Date.now() - pctAtRef.current < PCT_REFRESH_MS) return;
    const cid = deviceId();
    if (!cid) return;
    const solved = rows.some((r) => r.win);
    pctBusyRef.current = true;
    try {
      const r = await fetchResult(cid, hints.length, rows.length, solved);
      pctAtRef.current = Date.now();
      if (r && solved) setPct(r); // 포기 응답에는 순위가 없다
    } catch {
      // 무시 — 다음 트리거에서 다시 시도한다
    } finally {
      pctBusyRef.current = false;
    }
  }, [today, won, rows, hints.length]);

  /** 통계 모달 열기. 열 때 전체 현황을 함께 받아온다(안 보는 사람에겐 요청이 안 나감). */
  function openStats() {
    setShowStats(true);
    refreshTodayStats();
  }

  /** 오늘 전체 현황. 제출과 별개인 읽기 전용 집계라 완료 전에도 볼 수 있다. */
  const refreshTodayStats = useCallback(async (force = false) => {
    if (statsBusyRef.current) return;
    if (!force && Date.now() - statsAtRef.current < PCT_REFRESH_MS) return;
    statsBusyRef.current = true;
    try {
      const s = await fetchStats();
      statsAtRef.current = Date.now();
      if (s) setTodayStats(s);
    } catch {
      // 무시
    } finally {
      statsBusyRef.current = false;
    }
  }, []);

  // 게임 완료 직후 1회(강제) + 탭 복귀 시 갱신(쓰로틀).
  // 제출이 먼저 끝나야 전체 현황에 내가 포함되므로 순서를 지킨다.
  useEffect(() => {
    if (!won || !today) return;
    refreshPct(true).then(() => refreshTodayStats(true));
  }, [won, today]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refreshPct();
      refreshTodayStats();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshPct, refreshTodayStats]);

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

  // 전체 순위 목록에서 "내가 추측한 게임"을 표시하기 위한 id -> 입력 순서.
  // 추가 요청 없이 이미 갖고 있는 rows만으로 만든다.
  const guessSeq = useMemo(
    () => new Map(rows.map((r) => [r.id, r.seq] as const)),
    [rows],
  );

  // 내 추측 중 가장 가까웠던 순위(정답 자신은 rank 0이라 제외).
  const bestGuessRank = useMemo(() => {
    const ranks = rows.filter((r) => !r.win).map((r) => r.rank);
    return ranks.length ? Math.min(...ranks) : 0;
  }, [rows]);

  // 다음 페이지를 이어붙인다. 중복 append는 offset 일치 검사로 막는다.
  const loadMoreRanking = useCallback(async () => {
    setRankError("");
    setRankLoading(true);
    try {
      const page = await fetchRanking(rankItems.length, RANK_PAGE);
      setRankTotal(page.total);
      setRankItems((prev) => (prev.length === page.offset ? [...prev, ...page.items] : prev));
    } catch {
      setRankError("순위를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setRankLoading(false);
    }
  }, [rankItems.length]);

  // 처음 펼칠 때만 첫 페이지를 받는다(안 보는 사람에겐 요청이 안 나감).
  function toggleRanking() {
    const next = !rankOpen;
    setRankOpen(next);
    if (next && rankItems.length === 0 && !rankLoading) loadMoreRanking();
  }

  // 자동완성: 이미 추측한 게임은 제외 (id 기준 — 동명 다른 게임은 남김).
  // 제외를 suggest에 넘겨야 8개가 전부 기추측일 때 후보가 빈 채로 남지 않는다.
  const suggestions = useMemo(
    () => (db && query ? suggest(db, query, 8, guessedIds) : []),
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
        if (res.answer) setAnswerInfo(res.answer);
      }
    } catch {
      setError("서버 오류예요. 잠시 후 다시 시도해주세요.");
    } finally {
      inFlightRef.current.delete(game.id);
    }
  }

  // 타이핑한 텍스트를 게임으로 해석해 제출. resolve는 정확 일치만 통과시킨다.
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

  // Enter · 추측 버튼 공용. 선택된 후보가 있으면 그 게임을 id로 직접 제출(동명 게임 구분,
  // 초성·오타 입력도 이 경로로 통과), 없으면 텍스트를 정확 일치로 해석한다.
  function submitCurrent() {
    const pick = suggestions[activeIdx];
    if (pick) submitGame(pick);
    else submitText(query);
    setActiveIdx(0);
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
    const text = buildShareText(rows, hints.length, stats?.curStreak ?? 0, pct);
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
      setAnswerInfo(r.answer);
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
      submitCurrent();
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
    <>
    <div className="wrap">
      <header className="top">
        <button
          className="stats-open"
          onClick={openStats}
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
          {pct && rows.some((r) => r.win) && <PercentileCard info={pct} />}
          {/* 포기한 사람에겐 백분위가 없다(표본이 정답자뿐). 대신 전체 현황을 보여준다. */}
          {!rows.some((r) => r.win) && todayStats && todayStats.players > 0 && (
            <div className="pct">
              <div className="pct-pending">
                🌏 오늘 {todayStats.players.toLocaleString()}명 중{" "}
                <b>{todayStats.solved.toLocaleString()}명</b>이 맞혔어요
                <div className="pct-note">
                  정답률 {todayWinRate(todayStats)}%
                  {todayStats.avgGuesses > 0 && ` · 평균 ${todayStats.avgGuesses}번 추측`}
                </div>
              </div>
            </div>
          )}
          {answerInfo && <AnswerCard info={answerInfo} />}

          {answerInfo && db && (
            <div className="rank-section">
              <button className="rank-toggle" onClick={toggleRanking} aria-expanded={rankOpen}>
                {rankOpen ? "▲ 전체 순위 접기" : "🏅 전체 순위 보기"}
              </button>

              {rankOpen && (
                <>
                  <div className="rank-summary">
                    정답과 가까운 순서 · 총 {rankTotal.toLocaleString()}개
                    {rows.length > 0 && (
                      <>
                        {" · "}내 추측 {rows.length}개
                        {bestGuessRank > 0 && ` (최고 ${bestGuessRank}위)`}
                      </>
                    )}
                  </div>

                  {rankItems.length > 0 && (
                    <div className="rank-list">
                      <div className="rank-row answer">
                        <div className="rank-no">👑</div>
                        <div className="rank-name">
                          {answerInfo.name_ko ?? answerInfo.name_en}
                          <span className="rank-badge is-answer">정답</span>
                        </div>
                        <div className="rank-score">100.0</div>
                      </div>
                      {rankItems.map((it, i) => {
                        const g = db.byId.get(it.id);
                        if (!g) return null; // 워커/웹 games.json 불일치 방어
                        const seq = guessSeq.get(it.id);
                        return (
                          <div
                            className={`rank-row ${seq !== undefined ? "mine" : ""}`}
                            key={it.id}
                          >
                            <div className="rank-no">{i + 1}</div>
                            <div className="rank-name">
                              {g.name_ko ?? g.name_en}
                              {seq !== undefined && (
                                <span className="rank-badge">🔍 {seq}번째 추측</span>
                              )}
                            </div>
                            <div className="rank-score">{it.score.toFixed(1)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {rankError && <div className="error">{rankError}</div>}

                  {rankLoading && rankItems.length === 0 ? (
                    <div className="rank-summary">불러오는 중…</div>
                  ) : (
                    rankItems.length < rankTotal && (
                      <button
                        className="rank-more"
                        onClick={loadMoreRanking}
                        disabled={rankLoading}
                      >
                        {rankLoading
                          ? "불러오는 중…"
                          : `더 보기 (${rankItems.length.toLocaleString()} / ${rankTotal.toLocaleString()})`}
                      </button>
                    )
                  )}
                </>
              )}
            </div>
          )}

          <div className="banner-actions">
            <button className="share-btn" onClick={shareResult}>
              📋 결과 공유
            </button>
            <button className="stats-btn" onClick={openStats}>
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
              placeholder={
                loading ? "데이터 불러오는 중…" : "보드게임 이름 · 초성 (예: 카탄, ㅋㅌ)"
              }
              disabled={loading}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onKeyDown}
              autoComplete="off"
            />
            <button disabled={loading || !query} onClick={submitCurrent}>
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

      {/* 자매 게임 유도. 오늘 판을 끝낸 사람이 이어서 할 거리를 준다. */}
      <a className="sister-link" href="/bodle">
        🎲 <b>보들</b> — 다섯 단서로 오늘의 보드게임 맞히기 →
      </a>

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

            {/* 서버 집계가 없으면(로컬·배포 전) 통째로 감춘다 */}
            {todayStats && (
              <TodayStatsCard
                info={todayStats}
                myBucket={won && rows.some((r) => r.win) ? bucketOf(rows.length) : null}
              />
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

    {/* 정적 서버 렌더 콘텐츠 — 클라 렌더 전에도 검색엔진이 읽을 수 있는 실제 텍스트 */}
    <section className="seo-info">
      <h2>보맨틀이란?</h2>
      <p>
        보맨틀은 매일 하나의 보드게임을 맞히는 무료 웹게임입니다. 정답 보드게임을
        추측하면 카테고리·테마·난이도·인원수 등을 기준으로 계산한 유사도 점수를
        알려주고, 그 점수를 힌트 삼아 점점 정답에 가까운 보드게임을 찾아가는 방식입니다.
        영어 단어 맞히기 게임 꼬맨틀(Semantle)의 보드게임 버전이라고 보면 됩니다.
      </p>
      <h3>자주 묻는 질문</h3>
      <dl>
        <dt>새 문제는 언제 나오나요?</dt>
        <dd>매일 한국 시간(KST) 오전 9시에 새로운 보드게임 문제로 초기화됩니다.</dd>
        <dt>점수는 어떻게 계산되나요?</dt>
        <dd>
          보드게임의 카테고리·테마 태그와 난이도·인원·플레이타임 등 수치 정보를
          결합한 유사도 엔진으로 계산합니다. 정답과 비슷한 보드게임일수록 높은
          점수와 순위를 얻습니다.
        </dd>
        <dt>힌트는 어떻게 쓰나요?</dt>
        <dd>
          한 문제당 최대 8단계 힌트(박스아트 제외)를 순서대로 열람할 수 있으며,
          힌트를 많이 볼수록 결과 공유 시 표시됩니다.
        </dd>
        <dt>정답을 찾을 자신이 없으면요?</dt>
        <dd>포기 버튼으로 언제든 정답을 확인하고 다음 날 새 문제로 넘어갈 수 있습니다.</dd>
        <dt>보들은 뭔가요?</dt>
        <dd>
          같은 데이터로 만든 자매 게임입니다. 유사도 점수 대신 유형·테마·진행방식·무게·
          출시연도 다섯 가지 단서로 오늘의 보드게임을 8번 안에 맞히는 워들(Wordle) 방식입니다.
        </dd>
      </dl>
      <p>
        <a href="/bodle">보들 하러 가기 →</a>
      </p>
    </section>
    </>
  );
}
