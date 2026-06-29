# 보맨틀 🎲

보드게임을 맞추는 **꼬맨틀(Semantle) 스타일** 웹게임. 매일 정답 보드게임 1개를
유사도 힌트로 맞힙니다. 유사도는 **보드라이프 카테고리/테마 태그(IDF 가중) + 난이도·인원·시간**
으로 계산합니다.

## 구조 (pnpm 모노레포)

```
packages/core   순수 TS 유사도 엔진 (IDF 태그 코사인 + 수치 결합). 웹·워커 공용
workers/api     Cloudflare Worker — /api/guess 등. 정답은 서버에서만 알고 비노출
apps/web        Next.js (정적 export → CF Pages). 꼬맨틀식 UI
data            Python 크롤 파이프라인 (보드라이프 → games.json)
```

데이터 흐름: `data/out/games.json` (5,407개) → 워커 번들 + 웹 public 으로 복사.

## 개발 실행

```bash
pnpm install

# 1) 정답 유사도 API (Cloudflare Worker, 로컬)
pnpm dev:api          # http://127.0.0.1:8787

# 2) 프론트 (다른 터미널)
pnpm dev:web          # http://localhost:3000  (API_BASE 기본값이 :8787)
```

## 테스트 / 타입체크

```bash
pnpm --filter @bomantle/core test        # 유사도 엔진 단위 테스트(Python 검증값 대조)
pnpm -r typecheck
```

## 데이터 재생성 (선택)

```bash
cd data
./.venv/Scripts/python crawl_list.py      # 보드라이프 명단
./.venv/Scripts/python crawl_detail.py    # 상세(BGG id·테마·진행방식·인원/난이도·평가수·이미지)
./.venv/Scripts/python build_clean.py     # 머더 키트 제외 → games_clean.json (+ category/mechanism 이름맵)
./.venv/Scripts/python build_artifacts.py # → out/{games.json(풀), games.web.json(슬림), categories.json, mechanisms.json}
# 산출물 복사:
#   out/games.json      → workers/api/src/games.json   (풀: 엔진+힌트+큐레이션. 진행방식·평가수 포함)
#   out/games.web.json  → apps/web/public/games.json   (슬림: 클라 자동완성·표시용)
#   out/categories.json → workers/api/src/ 및 apps/web/public/
#   out/mechanisms.json → workers/api/src/ (힌트용)
```

## 배포 (Cloudflare)

```bash
# Worker (실서비스: bomantle-api.bomantle.workers.dev)
pnpm --filter @bomantle/api run deploy
#   최초 1회: wrangler kv namespace create ANSWERS → 출력 id를 wrangler.jsonc 에 입력

# Pages (apps/web/out 정적 호스팅, 실서비스: bomantle.pages.dev)
NEXT_PUBLIC_API_BASE=https://bomantle-api.bomantle.workers.dev pnpm --filter @bomantle/web run build
pnpm --filter @bomantle/web exec wrangler pages deploy out --project-name bomantle
#   프로덕션 브랜치 = main → 위 배포가 곧장 apex(bomantle.pages.dev)에 반영됨 (--branch 불필요)
```

### 일일 정답 관리

- 기본: 날짜 시드 결정론으로 정답 풀(평가 50+ · 프랜차이즈 중복 제거, ~551개)에서 자동 선택.
- 수동 지정: KV에 `answer:YYYY-MM-DD = <gameId>` 저장하면 그날 정답을 덮어씀.

## 비고 / TODO

- BGG XML API는 401 게이팅되어 미사용. 유사도 피처는 보드라이프 자체 태그 기반.
- 머더미스터리 **시나리오 키트 93개 제외** (정통 추리게임은 유지).
- 정답 풀 큐레이션은 기본 규칙만 적용 — 추후 정교화 여지.
- 앱 전환 시 `workers/api` 를 그대로 재사용하고 `apps/mobile`(Expo)만 추가.
