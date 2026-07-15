import { DurableObject } from "cloudflare:workers";

// 날짜별 접속자 카운터. 퍼즐 날짜(YYYY-MM-DD)당 인스턴스 하나(idFromName(date)).
// KV는 원자 증가가 없고 무료 플랜 쓰기 한도(1,000/일)가 좁아서 DO를 사용한다.
// 무료 플랜은 SQLite 클래스만 허용 → wrangler.jsonc의 new_sqlite_classes 참고.
export class VisitCounter extends DurableObject {
  async increment(): Promise<number> {
    const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + 1;
    await this.ctx.storage.put("n", n);
    return n;
  }

  async current(): Promise<number> {
    return (await this.ctx.storage.get<number>("n")) ?? 0;
  }
}
