import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "보맨틀 — 보드게임 맞추기",
  description: "매일 하나의 보드게임을 유사도 힌트로 맞히는 게임. 꼬맨틀의 보드게임 버전.",
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
