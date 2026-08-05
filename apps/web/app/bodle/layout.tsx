import type { Metadata } from "next";

// page.tsx가 "use client"라 메타데이터는 레이아웃에서 내보낸다.
export const metadata: Metadata = {
  title: "보들 — 하루 한 판 보드게임 맞히기",
  description:
    "오늘의 보드게임을 6번 안에 맞혀보세요. 유형·테마·진행방식·무게·출시연도 다섯 가지 단서로 좁혀나가는 보드게임 워들(Wordle). 매일 오전 9시 새 문제.",
  keywords: ["보들", "보드게임 워들", "보드게임 퀴즈", "보드게임 게임", "워들", "보맨틀"],
  alternates: { canonical: "https://bomantle.pages.dev/bodle" },
  openGraph: {
    title: "보들 — 하루 한 판 보드게임 맞히기",
    description: "다섯 가지 단서로 오늘의 보드게임을 6번 안에 맞혀보세요.",
    url: "https://bomantle.pages.dev/bodle",
    type: "website",
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "보들 — 하루 한 판 보드게임 맞히기",
    description: "다섯 가지 단서로 오늘의 보드게임을 6번 안에 맞혀보세요.",
  },
};

export default function BodleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
