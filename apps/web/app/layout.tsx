import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bomantle.pages.dev"),
  title: "보맨틀 — 보드게임 맞추기",
  description: "매일 하나의 보드게임을 유사도 힌트로 맞히는 게임. 꼬맨틀의 보드게임 버전.",
  openGraph: {
    title: "보맨틀 🎲 — 매일 보드게임 맞히기",
    description: "매일 하나의 보드게임을 유사도로 맞혀보세요. 꼬맨틀의 보드게임 버전!",
    url: "https://bomantle.pages.dev",
    siteName: "보맨틀",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "보맨틀 🎲 — 매일 보드게임 맞히기",
    description: "매일 하나의 보드게임을 유사도로 맞혀보세요. 꼬맨틀의 보드게임 버전!",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
