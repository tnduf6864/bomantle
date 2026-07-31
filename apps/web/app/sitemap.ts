import type { MetadataRoute } from "next";

// 정적 export에 /sitemap.xml 생성. 보맨틀(홈) + 보들 두 게임.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://bomantle.pages.dev",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://bomantle.pages.dev/bodle",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];
}
