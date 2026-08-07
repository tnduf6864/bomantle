"""보드라이프에 **등록된 모든 게임**을 상세 페이지에서 직접 크롤링한다.

기존 `crawl_list.py`(=/rank/N)는 랭킹 목록에 오른 5,500개만 준다. 하지만
등록된 게임은 그보다 훨씬 많고(2026-08 기준 id 최대 ~22,400), 목록에 없는
게임도 상세 페이지는 정상이다. 그래서 여기서는 id를 1..MAX 로 전수 조회한다.

상세 페이지만으로 필요한 필드가 전부 나온다:
  - 이름/영문/연도  : section.game-title-block
  - 종합 순위       : meta description "종합 N위"  (랭킹 목록에 없는 게임도 있음)
  - 평점/평가 수    : JSON-LD Product.aggregateRating
  - 나머지          : crawl_detail.parse_detail 재사용

살아있는 페이지 판정은 `id='boardgame-title'` 존재 여부. 없는 id는 200을 주되
커뮤니티 홈 같은 껍데기를 돌려주므로 이걸로 걸러 `dead_ids.json`에 적어두고
재시작 시 다시 받지 않는다.

출력: games_detail_all.json  (str(id) -> 상세 dict), dead_ids.json
사용:  python crawl_all.py [MAX_ID] [WORKERS]
"""
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from bs4 import BeautifulSoup

from crawl_detail import UA, parse_detail

OUT = "games_detail_all.json"
DEAD = "dead_ids.json"
MAX_ID = 22600          # 실측 최대 id ~22,400. 여유분 포함(살아있는 id가 끝에 걸리면 경고)
WORKERS = 6             # 동시 요청 수. 상대 서버 배려로 낮게 유지(실측 ~6 req/s)
DELAY = 0.2             # 워커당 요청 간 간격(초)
SAVE_EVERY = 500

_lock = threading.Lock()


def parse_title_block(html, soup):
    """이름/영문명/연도. 목록 크롤에서 받아오던 필드를 상세 페이지에서 직접 뽑는다."""
    ko = soup.select_one("#boardgame-title")
    en = soup.select_one(".game-title-en")
    yr = soup.select_one(".game-title-year")
    year = re.sub(r"\D", "", yr.get_text(strip=True)) if yr else ""
    return {
        "name_ko": ko.get_text(" ", strip=True) if ko else None,
        "name_en": en.get_text(" ", strip=True) if en else None,
        "year": year or None,
    }


def parse_game(html):
    """살아있는 게임이면 상세 dict, 아니면 None."""
    if "boardgame-title" not in html:
        return None
    soup = BeautifulSoup(html, "lxml")
    d = parse_detail(html)
    d.update(parse_title_block(html, soup))
    # 랭킹: 목록(/rank)에 없는 게임도 meta description에 "종합 N위"가 있다.
    # 목록 rank와 수백 단위로 어긋나므로(집계 시점 차이) 전수 크롤에서는
    # 이쪽으로 통일한다 — 한 번의 크롤 안에서 서로 일관된 유일한 값.
    d["rank"] = d.get("overall_rank")
    # 평점: JSON-LD ratingValue(소수 1자리). 목록 rate(소수 3자리)는 build 단계에서 우선 사용.
    m = re.search(r'"ratingValue":\s*([\d.]+)', html)
    d["rate"] = float(m.group(1)) if m else None
    # 껍데기 페이지(id 1='카테고리', 5='디자이너' 등 내부용 더미)는 제목만 있고
    # 순위·인원·태그가 전부 비어 있다. 실제 게임으로 취급하지 않는다.
    if not d["name_ko"] or (
        d["rank"] is None and d["players_min"] is None and not d["categories"]
    ):
        return None
    return d


def fetch(session, gid):
    for attempt in range(3):
        try:
            r = session.get(f"https://boardlife.co.kr/game/{gid}", timeout=25)
            r.encoding = "utf-8"
            if r.status_code == 200:
                return r.text
            if r.status_code == 404:
                return ""
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def main(max_id=MAX_ID, workers=WORKERS):
    result = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    dead = set(json.load(open(DEAD, encoding="utf-8"))) if os.path.exists(DEAD) else set()
    todo = [i for i in range(1, max_id + 1) if str(i) not in result and i not in dead]
    print(f"max_id={max_id} workers={workers} | done={len(result)} dead={len(dead)} todo={len(todo)}")

    local = threading.local()
    state = {"n": 0, "alive": 0, "err": 0}

    def session():
        s = getattr(local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update(UA)
            local.s = s
        return s

    def save():
        json.dump(result, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        json.dump(sorted(dead), open(DEAD, "w", encoding="utf-8"))

    def work(gid):
        html = fetch(session(), gid)
        time.sleep(DELAY)
        if html is None:
            with _lock:
                state["err"] += 1
            return
        d = parse_game(html) if html else None
        with _lock:
            if d is None:
                dead.add(gid)
            else:
                result[str(gid)] = d
                state["alive"] += 1
            state["n"] += 1
            if state["n"] % 100 == 0:
                print(
                    f"{state['n']}/{len(todo)} alive={state['alive']} "
                    f"dead={len(dead)} err={state['err']} (last id={gid})",
                    flush=True,
                )
            if state["n"] % SAVE_EVERY == 0:
                save()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, todo))
    save()

    tail = [i for i in range(max_id - 50, max_id + 1) if str(i) in result]
    if tail:
        print(f"⚠️ 상한 근처에 살아있는 id가 있음: {tail} → MAX_ID를 올려서 다시 실행할 것")
    print(f"saved alive={len(result)} dead={len(dead)} err={state['err']} -> {OUT}")


if __name__ == "__main__":
    mx = int(sys.argv[1]) if len(sys.argv) > 1 else MAX_ID
    wk = int(sys.argv[2]) if len(sys.argv) > 2 else WORKERS
    main(mx, wk)
