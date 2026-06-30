import { ImageResponse } from "next/og";

// output: export 정적 생성 강제.
export const dynamic = "force-static";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS 홈화면 추가용. 애플은 자체적으로 모서리를 둥글게 하므로 배경을 꽉 채움(투명 X).
export default function AppleIcon() {
  const pip = (on: boolean) => (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 22,
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
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            background: "#ffffff",
            borderRadius: 28,
            padding: 22,
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
