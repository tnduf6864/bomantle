# 보맨틀 — 남은 작업 (다음 세션용)

> 현재 상태: 모노레포 5개 영역 모두 구현·검증 완료. data(5,407개) / packages/core(테스트 5/5) /
> workers/api(guess 흐름 검증) / apps/web(정적 export 빌드 성공). 로컬 플레이 가능.
> 구조·실행법은 [README.md](./README.md) 참고.

추천 진행 순서: **2(PWA) → 4(공유) → 1(배포)**. 단, 바로 만져보고 싶으면 1(배포) 먼저.

---

## 1. Cloudflare 실제 배포 ⭐필수

사용자 CF 계정 로그인 필요(`wrangler login`).

- [ ] Worker 배포
  - `cd workers/api`
  - `wrangler kv namespace create ANSWERS` → 출력된 id를 `wrangler.jsonc`의 `REPLACE_WITH_KV_ID`에 입력
  - `wrangler deploy` → 워커 도메인 확보 (예: `https://bomantle-api.<account>.workers.dev`)
- [ ] Pages 배포
  - `cd apps/web`
  - `NEXT_PUBLIC_API_BASE=https://<워커도메인> pnpm build`
  - `wrangler pages deploy out` (또는 CF 대시보드에서 out/ 연결)
- [ ] CORS/도메인 확인 — 워커 CORS는 `*`로 열려 있음. 커스텀 도메인 쓰면 좁히기 검토.
- [ ] 배포 후 실제 /api/guess 동작 확인.
- [x] **`ResultBoard` DO 배포 완료(2026-07-30)** — `wrangler.jsonc` migration `v2` 적용됨.
      `GET /api/stats`가 실제 집계를 반환하는 것으로 확인(백분위 카드 정상 동작).

## 2. PWA 실제 구성 ✅ 완료

- [x] `app/manifest.ts` → `/manifest.webmanifest` (name, short_name, icons, theme/bg, standalone)
- [x] 아이콘 — 벡터 `public/icon.svg`(any) + `icon-maskable.svg`(maskable). 래스터라이저 없어 SVG(sizes:"any", Chrome 설치 기준 충족) 채택
- [x] `layout.tsx` metadata에 manifest 연결 + appleWebApp 메타
- [x] 서비스워커 `public/sw.js` — 앱셸+games.json/categories.json 캐시(cache-first, 내비게이션은 network-first). 정답 API는 크로스오리진이라 same-origin 필터로 자동 제외. `sw-register.tsx`로 등록
- [x] iOS 메타 — 기존 `apple-icon.tsx`(180px) + appleWebApp
- [ ] (선택) 실제 기기에서 "홈 화면 추가" 설치·오프라인 동작 최종 확인
- [ ] (참고) 배포로 앱셸/데이터가 바뀌면 `sw.js`의 `CACHE` 버전을 올릴 것 (현재 `bomantle-v3`)

## 3. 정답 풀 큐레이션 정교화

현재 규칙: `workers/api/src/answer.ts` `buildAnswerPool` — rank/weight/players 있고 태그≥2,
프랜차이즈 최상위 1개만, 상위 1200개.

- [ ] 너무 마이너/애매한 정답 추가 필터 검토 (평점 수, 인지도)
- [ ] 확장팩·리메이크가 정답으로 새는 케이스 점검 (baseName 분리 로직 한계)
- [ ] 풀 크기(1200) 적정성 — 너무 작으면 반복, 크면 난해
- [ ] (선택) 정답 풀을 데이터 파이프라인에서 미리 만들어 검수 후 KV/파일로 고정

## 4. 결과 공유 기능 ✅ 구현됨 (page.tsx buildShareText / shareResult)

- [x] 승리·포기 공유 텍스트 생성 (별점·최근접 순위, 정답명 미노출)
- [x] 클립보드 복사 버튼
- [ ] (선택) 추측 점수 막대 이모지 그리드(워들식) 추가 검토

## 5. 자잘한 UX

- [x] 하루 경계(오전 9시) 자동 전환: 탭 열어둔 채 날짜가 넘어가면 서버 재조회로 새 판 자동 리셋
  (`page.tsx` `clientPuzzleDate`=서버 kstDate와 동일 규칙, `applyDay` 공용화, 1초 폴링+30s 백오프)

- [x] 통계: 플레이 일수·정답률·연속 정답(현재/최고)·추측 횟수 분포 (localStorage `bomantle:stats`, `lib/stats.ts`). 헤더 📊 + 완료 배너 버튼으로 모달. 공유에 🔥연속 N일 추가
- [ ] 시간대별/추측횟수별 힌트 (예: 10회마다 카테고리 1개 공개)
- [x] **검색 입력 다듬기** (`lib/games.ts`) — 초성 검색 + 오타 허용 + 정규화 확장.
      단계 순으로 채운다: 정확 → 접두 → 부분 → 초성(접두·부분) → 오타 허용.
      `entries`를 랭킹순으로 미리 정렬해 두어 단계별로 담기만 하면 정렬이 필요 없고,
      앞 단계가 limit을 채우면 뒷단계는 아예 돌지 않는다(실측 0.1~6ms/키스트로크).
  - 정규화: 공백만 버리던 것을 구두점 전체로 확대 — "브라스: 버밍엄"↔"브라스버밍엄",
    "아크 노바"↔"arknova". `resolve`(정확 매칭)도 같이 관대해진다
  - 초성: **자모가 섞인 입력에서만** 동작(`hasChoJamo`). 안 그러면 다 타이핑한 이름이
    같은 초성의 다른 게임들로 퍼진다. "ㅂㄹㅅ"·"브ㄹㅅ" 모두 브라스로 감
  - 오타: OSA(인접 뒤바뀜 포함) 편집거리. 이름 **앞부분**과 비교해 다 안 친 오타도 잡는다
    ("티캣투라이"→티켓 투 라이드, "스플랜더"→스플렌더, "catna"→카탄). 3자↑ 1, 6자↑ 2.
    2자 이하는 후보가 폭발하므로 끈다
  - `resolve`는 여전히 정확 일치만 — 추측 1회를 소모하므로. 오타 입력은 자동완성 후보를
    골라 제출하는 경로로 통과한다(Enter·추측 버튼 모두 `submitCurrent`로 통일)
  - `suggest(db, q, limit, exclude)` — 기추측 제외를 **limit을 세기 전에** 적용.
    전에는 상위 8개가 전부 기추측이면 후보가 빈 채로 남았다
  - 유닛테스트 `lib/games.test.ts` 15건 (`pnpm --filter @bomantle/web test`)
  - ⚠️ 남은 한계: 영문 입력 "catan"은 대표작(카탄의 개척자, en=*The Settlers of Catan*)이
    접두가 아니라 부분 일치라 접두 후보들에 밀린다. 별칭 사전이 필요한 건이라 보류
- [ ] 모바일 입력/자동완성 키보드 동작 다듬기
- [ ] 추측 리스트 가장 가까운 항목 상단 고정 표시 강화
- [ ] 빈 상태/로딩/에러 카피 다듬기

## 6. 전체 익명 집계 통계 ✅ 완료 (2026-07-30)

> ✅ **저장소·수집 경로는 [docs/rank-percentile-plan.md](./docs/rank-percentile-plan.md)(정답 백분위)
> 구현으로 대체됨.** 원래 설계였던 D1은 폐기하고 `ResultBoard` DO(SQLite, 날짜별 인스턴스) +
> `POST /api/result`를 재사용한다. 배경은 그 문서의 "TODO 6번과의 관계" 절 참고.

구성:

- [x] 저장소 — `workers/api/src/results.ts` `ResultBoard`(DO SQLite). D1보다 나음:
      날짜별 인스턴스로 자연 샤딩 + 단일 스레드라 쓰기 경쟁 없음
- [x] 수집 — `POST /api/result { cid, hints, guesses }`. 날짜는 서버 `kstDate()`로 결정.
      어뷰즈 방지는 `INSERT OR IGNORE`(cid당 첫 기록만) — 반복 제출해도 이득 없음
- [x] 분포 집계 — 힌트 개수별 + 추측 버킷별(웹 `lib/stats.ts` 버킷 라벨과 동일)
- [x] 개인정보 원칙 — 정답명·식별 가능 정보 미수집. cid는 클라가 만든 임의 UUID
- [x] 포기도 제출 — 완료 시 `solved` 플래그와 함께 POST. 순위 표본에는 안 들어가고
      참여 수·정답률 분모에만 반영된다
- [x] **추측 0번 포기 허용** — `sanitizeSubmission`이 `solved=false`일 때만 `guesses: 0`을
      받는다. 안 그러면 첫 추측 전에 포기한 사람이 분모에서 통째로 빠져 정답률이 부풀려진다
- [x] 조회 라우트 `GET /api/stats` → `snapshot()`. 쓰기 없음, `Cache-Control: max-age=60`
- [x] `snapshot()`이 `{ players, solved, avgGuesses, hintDist, guessDist }` 반환.
      정답률은 클라에서 `solved / players`로 파생(서버는 원시 카운트만)
- [x] 웹: 통계 모달에 "오늘의 전체 현황" 카드(`.dist-*` 재사용) +
      **포기 배너에 "오늘 N명 중 M명이 맞혔어요"** — 포기자는 백분위를 볼 수 없어 생긴 공백을 메움
- [x] 유닛테스트 — `avgGuessesOf`, 추측 0번 포기/정답 구분 (워커 전체 46건)

> ⚠️ 개발 시 주의: `next dev`는 청크 URL이 고정이라 `sw.js`의 cache-first에 걸려 **코드를
> 고쳐도 브라우저가 옛 번들을 계속 쓴다.** 로컬 테스트가 이상하면 SW 해제 후 새로고침할 것.
> 프로덕션은 `_next` 해시 URL이라 배포하면 자동으로 새로 받는다(내비게이션도 network-first).

## 7. 검색 노출(SEO)

- [x] 메타데이터(title·description·OG·twitter·keywords·canonical) — `layout.tsx`
- [x] `app/robots.ts` → `/robots.txt` (전체 허용 + 사이트맵 위치)
- [x] `app/sitemap.ts` → `/sitemap.xml`
- [x] 구조화 데이터 JSON-LD(WebApplication) — `layout.tsx`
- [x] **Google Search Console 등록** — 소유 확인(HTML 태그, `metadata.verification.google`) +
  사이트맵 제출 완료. 이후 색인 반영은 구글 크롤링 대기(수일~수주).
- [ ] (선택) 커스텀 도메인(예: bomantle.com) 연결 시 브랜딩·신뢰도↑
- [ ] (참고) 신규 사이트는 색인까지 수일~수주. "보맨틀"은 고유어라 색인되면 1위 예상

## 8. 테스트 / CI ✅

- [x] 워커 순수 함수 유닛테스트(43건) — `workers/api/src/hint.test.ts`(초성·난이도밴드·commonest를
  buildHint 블랙박스로), `answer.test.ts`(buildAnswerPool 필터·프랜차이즈 dedup·정렬,
  dailyAnswerFromSeed 결정론, kstDate 9시 경계, puzzleNumber), `reveal.test.ts`(정답 공개 정보),
  `ranklist.test.ts`(페이지네이션 클램프), `rank.test.ts`(제출 검증·백분위 경계·버킷·타이브레이크).
  `pnpm --filter @bomantle/api test`
- [x] DO(`visits.ts`/`results.ts`)는 순수 로직을 분리해 테스트한다 — DO 자체는 `wrangler dev` 수동 검증
- [x] core 테스트 CI-안전화: `data/out`(gitignore) 없으면 추적되는 `workers/api/src/games.json`
  (동일 SHA)로 폴백 — `engine.test.ts`
- [x] GitHub Actions `.github/workflows/ci.yml` — install → core/api typecheck+test → web build
- [x] 워커 tsconfig에서 `*.test.ts` 제외(Node 타입 vs workers-types 분리, 배포 번들 무관)

## 9. (나중) Expo 모바일 앱

- [ ] `apps/mobile` (Expo) 추가, `packages/core` + 같은 Worker API 재사용
- [ ] 화면은 웹 UI 이식

---

## 알아둘 것 (환경/주의)

- **이 윈도우 샌드박스 한정 함정**: pnpm이 스크립트를 cmd로 spawn할 때 `node`를 PATH에서 못 찾아
  `.bin/tsc·next·wrangler` 심과 esbuild/workerd postinstall이 실패함. 우회는 `node node_modules/<pkg>/bin/...`.
  **사용자 실제 터미널에선 `pnpm dev:web` 등 표준 명령 정상.**
- core/worker는 Node 24 네이티브 TS 실행(`.ts` 확장자 import). **web만 Next 번들러용으로 확장자 없는 import.**
- BGG XML API는 401 게이팅 → 미사용. 유사도 피처는 보드라이프 자체 태그 기반.
- 머더미스터리 **시나리오 키트 93개 제외**(정통 추리게임 유지). 제외 목록: `data/exclude_list.json`.
- 데이터 재생성 절차는 README 참고. 중간 산출물(games_detail.json 등)은 .gitignore에 있음.
