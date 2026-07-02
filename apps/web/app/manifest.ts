import type { MetadataRoute } from "next";

// output: export 정적 생성 강제 (빌드 시 /manifest.webmanifest 로 산출).
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "보맨틀 — 보드게임 맞추기",
    short_name: "보맨틀",
    description: "매일 하나의 보드게임을 유사도 힌트로 맞히는 게임. 꼬맨틀의 보드게임 버전.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#0f1115",
    lang: "ko",
    orientation: "portrait",
    categories: ["games", "entertainment"],
    icons: [
      // 벡터 한 장으로 모든 크기 커버 (Chrome 설치 기준 충족: sizes "any").
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
