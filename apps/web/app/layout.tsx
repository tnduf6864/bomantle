import type { Metadata, Viewport } from "next";
import "./globals.css";
import SwRegister from "./sw-register";

export const metadata: Metadata = {
  metadataBase: new URL("https://bomantle.pages.dev"),
  title: "보맨틀 — 보드게임 맞추기",
  description: "매일 하나의 보드게임을 유사도 힌트로 맞히는 게임. 꼬맨틀의 보드게임 버전.",
  // 브랜드/검색 노출용 키워드
  keywords: ["보맨틀", "보드게임", "꼬맨틀", "보드게임 맞추기", "보드게임 게임", "일일 퍼즐", "semantle"],
  applicationName: "보맨틀",
  alternates: { canonical: "/" },
  // Google Search Console 소유 확인
  verification: { google: "iJxU9PA7a6yGceo_cB_j8aUhkpIKRCMNrE-nWkuqA14" },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "보맨틀",
  },
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
  // 검색엔진이 브랜드/앱 성격을 이해하도록 구조화 데이터(JSON-LD).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "보맨틀",
    alternateName: "보맨틀 — 보드게임 맞추기",
    url: "https://bomantle.pages.dev",
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    inLanguage: "ko",
    description:
      "매일 하나의 보드게임을 유사도 힌트로 맞히는 게임. 꼬맨틀의 보드게임 버전.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
  };
  return (
    <html lang="ko">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
