import { ImageResponse } from "next/og";

// output: export 정적 생성 강제.
export const dynamic = "force-static";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// 액센트 배경 위 흰 주사위(5눈) — OG 이미지와 동일 브랜딩.
export default function Icon() {
  const pip = (on: boolean) => (
    <div
      style={{
        width: 7,
        height: 7,
        borderRadius: 7,
        background: on ? "#5b8cff" : "transparent",
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
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#5b8cff",
          borderRadius: 14,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            background: "#ffffff",
            borderRadius: 10,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {row(true, false, true)}
          {row(false, true, false)}
          {row(true, false, true)}
        </div>
      </div>
    ),
    { ...size },
  );
}
