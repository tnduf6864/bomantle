import { ImageResponse } from "next/og";

// output: export 에선 정적 생성 강제 필요.
export const dynamic = "force-static";

export const alt = "보맨틀 — 매일 보드게임 맞히기";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 빌드 시 한글 웹폰트(Jua) 로드 — Satori 기본 폰트는 한글 미지원이라 필수.
async function loadFont(): Promise<ArrayBuffer> {
  const url =
    "https://cdn.jsdelivr.net/npm/@fontsource/jua/files/jua-korean-400-normal.woff";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

// div로 그린 주사위 5눈 (이모지 폰트 의존 제거).
function Die() {
  const pip = (on: boolean) => (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 34,
        background: on ? "#0f1115" : "transparent",
        display: "flex",
      }}
    />
  );
  const row = (a: boolean, b: boolean, c: boolean) => (
    <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
      {pip(a)}
      {pip(b)}
      {pip(c)}
    </div>
  );
  return (
    <div
      style={{
        width: 180,
        height: 180,
        background: "#ffffff",
        borderRadius: 32,
        padding: 28,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "0 12px 40px rgba(91,140,255,0.35)",
      }}
    >
      {row(true, false, true)}
      {row(false, true, false)}
      {row(true, false, true)}
    </div>
  );
}

export default async function OpengraphImage() {
  const font = await loadFont();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1115",
          fontFamily: "Jua",
        }}
      >
        <Die />
        <div
          style={{
            fontSize: 130,
            color: "#e7eaf0",
            marginTop: 36,
            letterSpacing: -2,
          }}
        >
          보맨틀
        </div>
        <div style={{ fontSize: 46, color: "#9aa3b2", marginTop: 8 }}>
          매일 보드게임 하나를 유사도로 맞혀보세요
        </div>
        <div style={{ fontSize: 34, color: "#5b8cff", marginTop: 40 }}>
          bomantle.pages.dev
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Jua", data: font, style: "normal", weight: 400 }],
    },
  );
}
