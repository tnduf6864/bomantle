"""games_detail_all.json 의 **커뮤니티 투표 유래 필드만** 다시 받아 덮어쓴다.

배경: 2026-08 보드라이프 개편으로 유형(옛 /info/type/N)과 베스트/추천 인원
(옛 .recommend-player)이 `.gvs-list` 커뮤니티 투표 블록으로 옮겨갔다. 전수 크롤을
돌린 뒤에야 세 필드가 전부 비어 있는 걸 발견했는데(테스트가 잡았다), 원본 HTML을
남기지 않아 재파싱이 안 된다. 그래서 살아있는 id만 다시 훑어 이 세 필드를 채운다.

나머지 필드(테마·진행방식·평점·순위·이미지 등)는 정상이므로 건드리지 않는다.
crawl_all.py와 같은 방식으로 재시작 가능하다 — 이미 채워진 항목은 건너뛴다.

사용: python patch_votes.py [WORKERS]
"""
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from bs4 import BeautifulSoup

from crawl_detail import UA, _vote, parse_detail  # noqa: F401  (_vote 재사용)

SRC = "games_detail_all.json"
DONE = "patched_ids.json"
WORKERS = 6
DELAY = 0.2
SAVE_EVERY = 500

_lock = threading.Lock()


def patch_fields(html):
    """세 필드만 뽑는다. 살아있는 페이지가 아니면 None."""
    if "boardgame-title" not in html:
        return None
    soup = BeautifulSoup(html, "lxml")
    cat = _vote(soup, "category")
    pv = _vote(soup, "player") or ""
    parts = [p.strip() for p in pv.split("/")]
    import re

    nums = [re.sub(r"[^\d\-]", "", p) or None for p in parts]
    return {
        "types": [{"id": 0, "name": cat}] if cat else [],
        "best_players": nums[0] if len(nums) > 0 else None,
        "recommended_players": nums[1] if len(nums) > 1 else None,
    }


def main(workers=WORKERS):
    data = json.load(open(SRC, encoding="utf-8"))
    done = set(json.load(open(DONE, encoding="utf-8"))) if os.path.exists(DONE) else set()
    todo = [g for g in data if g not in done]
    print(f"total={len(data)} done={len(done)} todo={len(todo)} workers={workers}", flush=True)

    local = threading.local()
    state = {"n": 0, "typed": 0, "err": 0}

    def session():
        s = getattr(local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update(UA)
            local.s = s
        return s

    def save():
        json.dump(data, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        json.dump(sorted(done), open(DONE, "w", encoding="utf-8"))

    def work(gid):
        html = None
        for attempt in range(3):
            try:
                r = session().get(f"https://boardlife.co.kr/game/{gid}", timeout=25)
                r.encoding = "utf-8"
                if r.status_code == 200:
                    html = r.text
                    break
            except Exception:
                pass
            time.sleep(1.5 * (attempt + 1))
        time.sleep(DELAY)
        if html is None:
            with _lock:
                state["err"] += 1
            return
        f = patch_fields(html)
        with _lock:
            if f:
                data[gid].update(f)
                done.add(gid)
                if f["types"]:
                    state["typed"] += 1
            state["n"] += 1
            if state["n"] % 100 == 0:
                print(
                    f"{state['n']}/{len(todo)} 유형있음={state['typed']} err={state['err']} (id={gid})",
                    flush=True,
                )
            if state["n"] % SAVE_EVERY == 0:
                save()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, todo))
    save()
    typed = sum(1 for v in data.values() if v.get("types"))
    best = sum(1 for v in data.values() if v.get("best_players"))
    print(f"완료: 유형 있음 {typed}/{len(data)} · 베스트인원 있음 {best} · err={state['err']}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else WORKERS)
