// 보맨틀 서비스워커 — 앱셸 + 정적 데이터 오프라인 캐시.
// 정답 API는 크로스오리진(워커 도메인)이라 same-origin 필터에서 자동 제외됨 → 캐시 안 됨.
// 배포로 앱셸/데이터가 바뀌면 CACHE 버전을 올려 이전 캐시를 폐기한다.
const CACHE = "bomantle-v1";

// 안정 URL만 사전 캐시. _next 해시 자산은 첫 요청 시 런타임 캐시(cache-first)로 담긴다.
const SHELL = [
  "/",
  "/games.json",
  "/categories.json",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // addAll은 하나라도 실패하면 전체 실패 → 개별 실패는 무시하고 진행
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 정답 유사도 API 등 크로스오리진 요청은 절대 가로채지 않는다.
  if (url.origin !== self.location.origin) return;

  // 문서(내비게이션): 네트워크 우선 → 실패 시 캐시된 앱셸('/')로 폴백.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/", { ignoreSearch: true })),
    );
    return;
  }

  // 정적 자산(_next 청크·데이터·아이콘): 캐시 우선, 미스 시 네트워크 후 캐시에 저장.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
