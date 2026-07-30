# 정답 백분위(상위 N%) 기능 — 구현 계획

> 작성: 2026-07-29 세션. **2026-07-30 구현 완료** (배포만 남음 — 5번 체크리스트 참고).
> 계획과 다르게 간 부분은 아래 "실제 구현과의 차이"에 정리했다.
> 관련: [TODO.md](../TODO.md) 6번(전체 익명 집계 통계) — 아래 "TODO 6번과의 관계" 참고.

## 실제 구현과의 차이

| 계획 | 실제 | 이유 |
|---|---|---|
| DO 파일명 `src/results.ts` + 순수로직 `src/rank.ts` | 그대로 | — |
| 순위·분포를 SQL `COUNT`/`GROUP BY`로 계산 | **행을 읽어 `rank.ts`에서 JS로 계산** | 타이브레이크 규칙이 SQL·JS 두 곳에 생기면 어긋난다. 인덱스 범위 스캔도 결국 같은 행을 읽어 이득이 작고, 표본은 하루·정답자로 한정돼 작다. 표본이 수만이 되면 DO 내부 스냅샷 캐시가 다음 단계 |
| 범위 밖 입력은 클램프 | **거부(400)** | 조용히 보정하면 조작된 값이 순위에 섞인다 |
| `results` 테이블에 `solved` 없음 | **`solved` 컬럼 포함**(순위는 `solved=1`만) | TODO 6번 통합 시 마이그레이션이 필요 없게 미리 넣었다. 현재 클라는 맞혔을 때만 제출 |
| 클라 타입명 `RankResult` | **`PercentileResult`** | 웹에는 이미 유사도 순위 목록용 `Ranking*` 타입이 있어 혼동 방지 |
| 바인딩 없을 때 "null 계열 응답" | `{ available: false }` → `fetchResult`가 `null` 반환 → **UI 자체를 감춤** | "0명 참여"처럼 거짓으로 읽히는 표시를 피한다 |

오늘의 문제를 맞힌 사용자에게 **"오늘 맞힌 사람 중 상위 N%"** 를 보여준다.
개인 통계(`lib/stats.ts`, localStorage)와 달리 **서버에 익명 집계를 남겨야** 성립하는 기능.

---

## 1. 확정된 설계 결정

세션에서 사용자가 선택한 사항. 재논의 없이 이대로 간다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 3순위 타이브레이크 | **정답 도달 시각**(서버 수신 `ts`) | 서버가 직접 찍으므로 클라 조작 불가. 소요시간(첫 추측→정답)은 클라가 재는 값이라 신뢰 못함 |
| 치팅 방지 수준 | **경량 검증** | 서버 세션 토큰 방식은 guess/hint API 전면 수정이 필요해 과함. 캐주얼 게임엔 클램프 + 1일 1회 제출로 충분 |
| 새로고침 시 백분위 | **매번 재조회** | 표본이 하루 내내 늘어 아침에 맞힌 값이 저녁엔 크게 달라짐. 재방문 동기도 생김 |

### 순위 규칙

정렬 키 `(hints ASC, guesses ASC, ts ASC)`

1. 힌트를 **적게** 쓴 사람이 위
2. 힌트가 같으면 추측 횟수가 **적은** 사람이 위
3. 둘 다 같으면 **먼저 정답에 도달한**(서버 수신이 이른) 사람이 위

- 상위 % = `ceil((나보다 좋은 기록 수 + 1) / 전체 * 100)`
- **포기한 사람은 표본에서 제외.** UI 문구를 반드시 "오늘 **맞힌** N명 중"으로 쓸 것 (안 그러면 수치가 거짓말이 됨)

---

## 2. 서버 — `workers/api`

### 2-1. 새 DO: `src/results.ts` — `ResultBoard`

날짜당 인스턴스 하나(`idFromName(date)`). `VisitCounter`와 같은 패턴이되 **SQLite 스토리지**(`ctx.storage.sql`)를 쓴다. 카운터 하나가 아니라 정렬·순위 질의가 필요하기 때문.

```sql
CREATE TABLE IF NOT EXISTS results (
  cid     TEXT PRIMARY KEY,  -- 클라 localStorage 랜덤 UUID (기기 식별)
  hints   INTEGER NOT NULL,
  guesses INTEGER NOT NULL,
  ts      INTEGER NOT NULL   -- 서버 수신 시각(ms). 클라 입력 아님
);
CREATE INDEX IF NOT EXISTS idx_rank ON results (hints, guesses, ts);
```

**`submit({ cid, hints, guesses })`**

1. 클램프/검증 — `hints` 0~8 정수, `guesses` 1~500 정수. 벗어나면 400 (`rank.ts`의 순수 함수로)
2. `INSERT OR IGNORE ... VALUES (?, ?, ?, ?)` with `ts = Date.now()`
   → **첫 제출만 채택.** 같은 `cid`가 다시 와도 기록은 안 바뀜
3. 내 행을 다시 `SELECT` (2에서 무시됐으면 기존 값이 나옴 → 멱등)
4. 순위 산출
   ```sql
   SELECT COUNT(*) FROM results
   WHERE hints < ?1
      OR (hints = ?1 AND guesses < ?2)
      OR (hints = ?1 AND guesses = ?2 AND ts < ?3);
   ```
   (SQLite row-value `(hints,guesses,ts) < (?,?,?)` 도 되지만 명시적 OR가 읽기 쉬움)
5. `total = COUNT(*)`, `rank = better + 1`, `percentile = ceil(rank / total * 100)`
6. 분포 — `SELECT hints, COUNT(*) GROUP BY hints` (0~8) + 추측 버킷별 카운트
7. **최초 쓰기 때만** `ctx.storage.setAlarm(Date.now() + 14일)`
   → `alarm()` 에서 `ctx.storage.deleteAll()`. 날짜별 DO가 영구 누적되는 걸 막는다

**`snapshot()`** — 쓰기 없이 `total` + 분포만. (포기자에게 오늘 현황만 보여주거나, 나중에 TODO 6번에 재사용)

> 멱등성이 핵심이다. "새로고침 시 재조회" 요구사항은 **같은 POST를 다시 쳐도 기록은 고정, 순위만 현재 표본 기준으로 재계산**되는 구조로 자연히 충족된다. 읽기 전용 엔드포인트를 따로 만들지 않는다(클라 분기 하나로 유지).

### 2-2. 순수 로직 분리: `src/rank.ts` + `src/rank.test.ts`

DO 런타임 없이 `node --test`로 돌리기 위해 계산은 전부 여기로 뺀다 (`hint.ts` / `answer.ts` / `reveal.ts` 와 같은 패턴).

- `sanitizeSubmission(body): { cid, hints, guesses } | null` — 타입·범위 검증
- `percentileOf(rank, total): number`
- `guessBucket(n): string` — **웹 `lib/stats.ts`의 `GUESS_BUCKETS`와 라벨을 반드시 일치**시킬 것 (`1-3` / `4-6` / `7-10` / `11-20` / `21-30` / `31-50` / `51+`)
- `buildDistribution(rows): { hintDist, guessDist }`

테스트 케이스: 동점 타이브레이크 순서, 1명뿐일 때, 범위 밖 입력 거부, 백분위 경계(1등=상위 1%, 꼴찌=100%), 버킷 경계값.

`package.json` test 스크립트에 `src/rank.test.ts` 추가.

### 2-3. 라우트 — `src/index.ts`

```
POST /api/result  { cid, hints, guesses }
  → { rank, total, percentile, hintDist, guessDist }
  → 표본 부족(total < 5)이면 { pending: true, total } — "아직 집계 중 · N명 참여" 표시
  → RESULTS 바인딩 없으면(로컬 등) null 계열 응답. visitorCount()처럼 게임 진행엔 무영향
```

- 날짜는 서버 `kstDate()`로 결정 (클라가 보낸 날짜 신뢰 안 함)
- `ResultBoard` 를 `index.ts`에서 re-export (wrangler 바인딩 요건, `VisitCounter`와 동일)

### 2-4. `wrangler.jsonc`

```jsonc
"durable_objects": { "bindings": [
  { "name": "VISITS",  "class_name": "VisitCounter" },
  { "name": "RESULTS", "class_name": "ResultBoard" }   // 추가
]},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["VisitCounter"] },
  { "tag": "v2", "new_sqlite_classes": ["ResultBoard"] }  // 추가. 기존 v1은 손대지 말 것
]
```

---

## 3. 클라 — `apps/web`

### `lib/types.ts`

```ts
export interface RankResult {
  rank: number;
  total: number;
  percentile: number;
  hintDist: number[];              // index = 힌트 개수 0..8
  guessDist: Record<string, number>;
  pending?: boolean;               // 표본 부족
}
```

### `lib/api.ts`

`fetchResult(cid, hints, guesses): Promise<RankResult>` — 기존 `fetchVisit` 스타일.

### `app/page.tsx`

- `bomantle:cid` — `crypto.randomUUID()` 1회 발급 후 localStorage 보관 (기기 식별자, 개인정보 아님)
- `const [rank, setRank] = useState<RankResult | null>(null)`
- **제출/갱신 흐름**
  - 정답 확정(`won && rows.some(r => r.win)`) 시 POST
  - 응답은 일자 저장(`bomantle:DATE` JSON)에 `rank` 필드로 함께 저장 → 새로고침 시 **즉시 렌더**(깜빡임 방지)
  - 그 후 백그라운드 재조회로 최신값 갱신. 트리거 = 마운트 1회 + `visibilitychange`(탭 복귀), **60초 쓰로틀**
  - `bomantle:ranked:DATE` 플래그의 의미는 "재제출 차단"이 아니라 **"이미 집계된 판"** 표시
  - 실패 시 조용히 무시. 저장값 유지, 에러 UI 없음
- `applyDay()` 에서 `saved.rank` 복원 + 날짜 전환 시 `setRank(null)` 초기화 (다른 상태들과 동일하게)

### UI — 정답 배너 안, `AnswerCard` **위**

```
        상위 4%
  ▓▓▓▓▓░░░░░░░░░░░░░░░  ← 백분위 게이지(0~100%, 내 위치 마커)
  오늘 맞힌 512명 중 21위 · 힌트 0개 · 15번 추측

  힌트 0개  ▓▓▓▓▓▓▓▓ 88      ← 힌트 개수별 참여자 가로 막대(0~8)
  힌트 1개  ▓▓▓▓▓▓▓▓▓▓▓ 121     내 칸 하이라이트
  ...
```

- 기존 `.dist-*` 클래스를 재사용해 통계 모달과 톤을 맞춘다 (`globals.css`에 `.pct`, `.pct-bar` 정도만 신규)
- 같은 힌트 구간 안의 추측 버킷 분포는 접었다 펴기(선택)
- 표본 수를 항상 같이 노출해 값이 왜 움직이는지 자연스럽게 읽히게 한다
- `buildShareText()` 에 `🏆 상위 4%` 한 줄 추가

---

## 4. 알아둘 한계 (구현 시 문구로 방어할 것)

- **경량 검증의 한계** — 시크릿 모드/여러 기기 제출은 못 막는다. 다만 `INSERT OR IGNORE`라 같은 기기에서 반복 시도해도 첫 기록만 남아 이득이 없다
- **힌트·추측 수는 클라 보고값** — 범위 클램프만 한다. 완전 검증은 서버 세션 방식뿐이고, 그건 이번 범위가 아니다
- **시각 타이브레이크** — 힌트·추측이 완전히 같을 때만 작동하므로 "일찍 접속한 사람 유리" 효과는 미미하다
- **표본 = 맞힌 사람만.** 포기자는 분모에 없다. 문구를 정확히 쓸 것
- **DO 14일 정리** — alarm으로 지운다. 과거 날짜 통계를 남기고 싶어지면 이 부분을 먼저 바꿔야 함

---

## 5. 검증 · 배포 체크리스트

- [x] `pnpm --filter @bomantle/api test` (rank.test.ts 16건 포함, 전체 43건 통과) / `typecheck`
- [x] `wrangler dev` 로 `/api/result` 확인 — 6개 cid로 순위·타이브레이크·백분위(1/5→20%,
      5/5→100%) 확인. 같은 cid로 조작된 값 재제출 시 첫 기록 유지(멱등) 확인. 검증 실패 400 확인
- [x] 웹: 정답 배너에 카드 표시 → 새로고침 시 저장값 즉시 표시 후 서버값으로 갱신됨 확인.
      표본 부족(pending) 화면도 확인
- [ ] 하루 경계(오전 9시) 넘길 때 `pct` 초기화 — `applyDay`에 `setPct(null)` 넣었으나 실제 경계는 미확인
- [ ] `wrangler deploy` (migration v2 자동 적용) ⭐남은 작업
- [x] CI(`.github/workflows/ci.yml`)는 test 스크립트만 갱신 → 그대로 통과 예상

---

## 6. TODO 6번(전체 익명 집계 통계)과의 관계

TODO.md 6번이 이미 `POST /api/result` 라는 **같은 이름**의 엔드포인트를 제안하고 있다. 목적이 겹치므로 **하나로 통합**한다.

- 6번이 원하던 "오늘의 전체 현황"(플레이 수·정답률·평균 추측·분포)은 이 `ResultBoard`에서 대부분 파생된다
- 다만 6번은 **포기까지 포함**한 집계를 원한다 → `results` 테이블에 `solved INTEGER` 컬럼을 두고 포기도 기록하되, **순위 계산에서는 `solved = 1`만 필터**하는 방식으로 확장하면 둘 다 만족한다
- 6번은 저장소로 D1을 권했으나, **DO SQLite가 더 낫다**: 날짜별 인스턴스라 자연 샤딩되고 단일 스레드라 경쟁이 없으며, 이미 `VisitCounter`로 검증된 경로다
- 구현 시 TODO.md 6번 항목에 "이 문서로 대체" 표시를 남길 것
