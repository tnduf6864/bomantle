"use client";

import { useCallback, useEffect, type RefObject } from "react";

/**
 * 모바일 가상 키보드에 입력창이 가리는 문제 해결.
 *
 * 증상: 폰에서 입력창을 탭하면 키보드가 올라오는데, 입력창이 그 뒤로 숨어 타이핑한
 * 글자가 안 보인다. 추측을 하기 **전**에 특히 심하다.
 *
 * 원인은 두 가지가 겹친다:
 *  1. 키보드가 뜨면 보이는 영역(visualViewport)만 줄어들 뿐 레이아웃 뷰포트는 그대로다.
 *     브라우저가 포커스된 요소를 알아서 끌어올려 주긴 하지만, 그러려면 **스크롤할 여유**가
 *     있어야 한다. 추측 전 페이지는 짧아서(헤더+배너+입력창+힌트 정도) 스크롤 여유가
 *     없고, 그래서 브라우저가 끌어올리지 못한 채 입력창이 키보드 밑에 남는다.
 *  2. 끌어올려지더라도 기준이 레이아웃 뷰포트라 키보드 높이를 고려하지 않는다.
 *
 * 그래서 (1) 키보드 높이만큼 페이지 아래 여백을 만들어 스크롤 여유를 확보하고,
 * (2) 보이는 영역 기준으로 직접 스크롤한다.
 *
 * `--kb`(키보드가 덮은 높이)와 `--vvh`(실제 보이는 높이)를 CSS 변수로 내보내
 * 여백과 자동완성 목록 높이가 이를 따라가게 한다.
 */
export function useKeyboardInsets() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    const sync = () => {
      // 키보드가 덮은 높이 = 레이아웃 높이 - 보이는 높이 - 위로 밀린 양.
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", `${Math.round(covered)}px`);
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--kb");
      root.style.removeProperty("--vvh");
    };
  }, []);
}

/**
 * 가려진 입력창을 보이는 영역 맨 위로 끌어올린다.
 *
 * **가려졌을 때만** 움직인다. 포커스마다 무조건 스크롤하면 키보드가 없는 데스크톱에서
 * 입력창을 클릭할 때마다 화면이 위로 튄다.
 *
 * 위쪽에 붙이는 이유: 자동완성 목록이 입력창 **아래로** 펼쳐지므로, 가운데에 두면
 * 후보 절반이 키보드 뒤로 넘어간다. 맨 위에 붙여야 목록이 최대로 보인다.
 */
function scrollIfCovered(el: HTMLInputElement | null) {
  if (!el || document.activeElement !== el) return;
  const vv = window.visualViewport;
  const r = el.getBoundingClientRect();
  // 보이는 영역(키보드 위) 경계. visualViewport가 없으면 창 전체로 본다.
  const visibleTop = vv ? vv.offsetTop : 0;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  if (r.bottom <= visibleBottom - 8) return; // 안 가려짐 — 그대로 둔다
  window.scrollBy({ top: r.top - (visibleTop + 8), behavior: "smooth" });
}

/**
 * 입력창 `onFocus`에 물릴 콜백. 키보드가 올라오는 애니메이션(약 250~300ms)이 끝나야
 * visualViewport 값이 확정되므로 조금 늦춰 확인한다.
 *
 * 포커스 시점에 키보드가 아직 안 뜬 기기도 있어서, 포커스가 살아 있는 동안의
 * visualViewport 변화(키보드 등장·회전)에도 다시 맞춘다.
 */
export function useScrollInputIntoView(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => scrollIfCovered(ref.current);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [ref]);

  return useCallback(() => {
    setTimeout(() => scrollIfCovered(ref.current), 350);
  }, [ref]);
}
