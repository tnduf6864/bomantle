/**
 * 기기 식별자. 같은 기기의 재제출을 서버가 알아보게 하는 용도(집계 기록 고정)로만 쓴다.
 * 임의 UUID이며 개인정보가 아니고, 서버는 이 값으로 아무것도 조회하지 않는다.
 * randomUUID가 없는(비보안 컨텍스트) 브라우저도 있어 폴백을 둔다.
 */
export function deviceId(): string | null {
  try {
    const key = "bomantle:cid";
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    localStorage.setItem(key, id);
    return id;
  } catch {
    return null; // 저장 불가 환경(시크릿 모드 등)은 집계 기능만 비활성
  }
}
