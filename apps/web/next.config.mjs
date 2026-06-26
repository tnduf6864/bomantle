/** @type {import('next').NextConfig} */
const nextConfig = {
  // CF Pages 정적 호스팅용 정적 export
  output: "export",
  images: { unoptimized: true },
  // 정답 유사도 API(워커) 기본 주소. 배포 시 환경변수로 덮어씀.
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8787",
  },
};

export default nextConfig;
