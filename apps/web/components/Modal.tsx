"use client";

import { useEffect, type ReactNode } from "react";

/**
 * 공용 모달(통계·게임 방법·지난 문제). ESC로 닫기 + 열려 있는 동안 뒤 페이지 스크롤 잠금.
 * 모바일에서 배경이 같이 스크롤되면 모달이 화면 밖으로 밀려 닫기가 어려워진다.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
