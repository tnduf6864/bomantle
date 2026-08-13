"use client";

import { useEffect, useState } from "react";
import { msUntilNextReset, formatCountdown } from "../lib/reset";

/**
 * 다음 초기화까지 남은 시간.
 *
 * **별도 컴포넌트로 떼어낸 이유**: 1초마다 갱신되는 상태라 페이지 안에 두면 타이핑하는
 * 내내 초당 한 번 전체가 리렌더된다. 그때 React가 controlled input의 value를 다시
 * 써넣으면 한글 IME 조합이 끊겨 글자가 씹히거나 직전 값이 되살아난다.
 * 여기서만 리렌더되게 가둬 두면 입력창은 건드리지 않는다.
 */
export function ResetCountdown() {
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(msUntilNextReset()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!countdown) return null;
  return (
    <div className="reset-info">
      ⏰ 다음 문제까지 <b>{countdown}</b>
      <span className="reset-note">매일 오전 9시 초기화</span>
    </div>
  );
}
