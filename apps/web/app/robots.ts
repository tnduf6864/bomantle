import type { MetadataRoute } from "next";

// 정적 export에 /robots.txt 생성. 전체 크롤 허용 + 사이트맵 위치 안내.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://bomantle.pages.dev/sitemap.xml",
    host: "https://bomantle.pages.dev",
  };
}
