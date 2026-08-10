"""games_detail_all.json 의 **플레이타임 필드만** 다시 받아 덮어쓴다.

배경 — 옛 파싱은 두 가지가 겹쳐 틀렸다:

1. 정규식 `(\\d+)\\s*분` 이 "50-140분" 같은 범위에서 앞쪽 50을 건너뛰고 **뒤쪽 140에
   매칭**했다. 그 최댓값이 `time_min` 이라는 이름으로 저장돼 힌트가 할러타우를
   "1-4명 · 140분"으로 잘못 보여줬다(정답은 50-140분). 실측 약 40%가 범위 표기다.
2. 값을 **meta description에서** 읽었다. description은 게임 이름이 맨 앞에 오는
   템플릿이라 이름에 숫자+분이 있으면 거기에 먼저 걸린다 — '가이스트블리츠 12시
   5분전'은 15분인데 5분, '9분의 1'은 시간 정보가 없는데 9분이 됐다.

이제 사양 블록(dl.game-info-item, <dt>시간</dt>)에서 읽는다(crawl_detail.parse_time).

정규식은 고쳤지만(crawl_detail.py) 원본 HTML을 남기지 않아 재파싱이 안 된다.
그래서 patch_votes.py 와 같은 방식으로 살아있는 id를 다시 훑어 time_min/time_max 를
채운다. 나머지 필드는 정상이므로 건드리지 않는다.

**확장은 건너뛴다** — expansion_list.json 에 오른 게임은 build_clean.py 에서
어차피 빠지므로 받을 이유가 없다(5,981건, 요청의 28%).

재시작 가능: 이미 채운 id는 patched_time_ids.json 으로 건너뛴다.

사용: python patch_time.py [WORKERS]
"""
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from bs4 import BeautifulSoup

from crawl_detail import UA, parse_time

SRC = "games_detail_all.json"
DONE = "patched_time_ids.json"
EXPANSIONS = "expansion_list.json"
WORKERS = 6
DELAY = 0.2
SAVE_EVERY = 500

_lock = threading.Lock()


def parse_fields(html):
    """{time_min, time_max}. 살아있는 페이지가 아니면 None.

    파싱 규칙은 crawl_detail.parse_time 하나만 쓴다 — 여기에 규칙을 복사해 두면
    전수 크롤과 이 패치가 서로 다른 값을 넣게 된다.
    """
    if "boardgame-title" not in html:
        return None
    soup = BeautifulSoup(html, "lxml")
    meta = soup.find("meta", attrs={"name": "description"})
    lo, hi = parse_time(soup, meta.get("content", "") if meta else "")
    return {"time_min": lo, "time_max": hi}


def main(workers=WORKERS):
    data = json.load(open(SRC, encoding="utf-8"))
    exp = {r["id"] for r in json.load(open(EXPANSIONS, encoding="utf-8"))["expansions"]}
    done = set(json.load(open(DONE, encoding="utf-8"))) if os.path.exists(DONE) else set()
    todo = [g for g in data if g not in done and g not in exp]
    print(f"total={len(data)} 확장제외={len(exp)} done={len(done)} todo={len(todo)} "
          f"workers={workers}", flush=True)

    local = threading.local()
    state = {"n": 0, "ranged": 0, "changed": 0, "err": 0}

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
        f = parse_fields(html)
        with _lock:
            if f:
                old = data[gid].get("time_min")
                if old != f["time_min"]:
                    state["changed"] += 1
                if f["time_min"] != f["time_max"]:
                    state["ranged"] += 1
                data[gid].update(f)
                done.add(gid)
            state["n"] += 1
            if state["n"] % 200 == 0:
                print(f"{state['n']}/{len(todo)} 범위표기={state['ranged']} "
                      f"값바뀜={state['changed']} err={state['err']} (id={gid})", flush=True)
            if state["n"] % SAVE_EVERY == 0:
                save()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, todo))
    save()
    print(f"완료: {state['n']}건 처리 · 범위표기 {state['ranged']} · "
          f"값바뀜 {state['changed']} · err={state['err']}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else WORKERS)
