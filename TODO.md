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

## 2. PWA 실제 구성 ⭐ (지금 themeColor만 있고 manifest·아이콘·SW 없음)

- [ ] `apps/web/public/manifest.webmanifest` 작성 (name, short_name, icons, theme/bg color, display:standalone)
- [ ] 아이콘 생성 (192/512 png, maskable 포함) → `public/`
- [ ] `app/layout.tsx` metadata에 manifest 연결 (`manifest: "/manifest.webmanifest"`)
- [ ] 오프라인/캐시 서비스워커 — 정적 export라 `next-pwa` 대신 간단한 SW 직접 등록 권장
      (games.json·앱셸 캐시). 정답 API는 캐시 제외.
- [ ] iOS 대응 메타(apple-touch-icon 등).

## 3. 정답 풀 큐레이션 정교화

현재 규칙: `workers/api/src/answer.ts` `buildAnswerPool` — rank/weight/players 있고 태그≥2,
프랜차이즈 최상위 1개만, 상위 1200개.

- [ ] 너무 마이너/애매한 정답 추가 필터 검토 (평점 수, 인지도)
- [ ] 확장팩·리메이크가 정답으로 새는 케이스 점검 (baseName 분리 로직 한계)
- [ ] 풀 크기(1200) 적정성 — 너무 작으면 반복, 크면 난해
- [ ] (선택) 정답 풀을 데이터 파이프라인에서 미리 만들어 검수 후 KV/파일로 고정

## 4. 결과 공유 기능

- [ ] 승리 시 "🎲 보맨틀 #176 · N번 만에!" + 추측 점수 막대 이모지 공유 텍스트 생성
- [ ] 클립보드 복사 버튼 (꼬맨틀/워들 스타일)
- [ ] 정답은 텍스트에 노출하지 않기.

## 5. 자잘한 UX

- [ ] 통계: 플레이 일수·연속 정답·추측 횟수 분포 (localStorage)
- [ ] 시간대별/추측횟수별 힌트 (예: 10회마다 카테고리 1개 공개)
- [ ] 모바일 입력/자동완성 키보드 동작 다듬기
- [ ] 추측 리스트 가장 가까운 항목 상단 고정 표시 강화
- [ ] 빈 상태/로딩/에러 카피 다듬기

## 6. (나중) Expo 모바일 앱

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
