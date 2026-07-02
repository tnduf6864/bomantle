"use client";

import { useEffect } from "react";

// 서비스워커 등록(오프라인/앱셸 캐시). 렌더 UI 없음.
export default function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    // 초기 로드 경쟁을 피해 load 이후 등록.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
