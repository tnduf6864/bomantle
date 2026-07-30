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

        {/* 정적 서버 렌더 콘텐츠 — 클라 렌더 전에도 검색엔진이 읽을 수 있는 실제 텍스트 */}
        <section className="seo-info">
          <h2>보맨틀이란?</h2>
          <p>
            보맨틀은 매일 하나의 보드게임을 맞히는 무료 웹게임입니다. 정답 보드게임을
            추측하면 카테고리·테마·난이도·인원수 등을 기준으로 계산한 유사도 점수를
            알려주고, 그 점수를 힌트 삼아 점점 정답에 가까운 보드게임을 찾아가는 방식입니다.
            영어 단어 맞히기 게임 꼬맨틀(Semantle)의 보드게임 버전이라고 보면 됩니다.
          </p>
          <h3>자주 묻는 질문</h3>
          <dl>
            <dt>새 문제는 언제 나오나요?</dt>
            <dd>매일 한국 시간(KST) 오전 9시에 새로운 보드게임 문제로 초기화됩니다.</dd>
            <dt>점수는 어떻게 계산되나요?</dt>
            <dd>
              보드게임의 카테고리·테마 태그와 난이도·인원·플레이타임 등 수치 정보를
              결합한 유사도 엔진으로 계산합니다. 정답과 비슷한 보드게임일수록 높은
              점수와 순위를 얻습니다.
            </dd>
            <dt>힌트는 어떻게 쓰나요?</dt>
            <dd>
              한 문제당 최대 8단계 힌트(박스아트 제외)를 순서대로 열람할 수 있으며,
              힌트를 많이 볼수록 결과 공유 시 표시됩니다.
            </dd>
            <dt>정답을 찾을 자신이 없으면요?</dt>
            <dd>포기 버튼으로 언제든 정답을 확인하고 다음 날 새 문제로 넘어갈 수 있습니다.</dd>
          </dl>
        </section>

        <SwRegister />
      </body>
    </html>
  );
}
