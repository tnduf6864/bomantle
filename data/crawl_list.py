"""보드라이프 전체 순위 페이지(/rank/N)를 크롤링해 게임 명단을 수집한다.

각 페이지는 div.rank-row 단위. 페이지당 100개. rank-row가 0개인 페이지를
만나면 종료한다. 결과는 games_list.json 으로 저장.
"""
import json
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
}
BASE = "https://boardlife.co.kr/rank/{}"


def text(node):
    return node.get_text(" ", strip=True) if node else ""


def parse_page(html):
    soup = BeautifulSoup(html, "lxml")
    rows = []
    for row in soup.select("div.rank-row"):
        a = row.select_one("a.title")
        if not a:
            continue
        m = re.search(r"/game/(\d+)", a.get("href", ""))
        if not m:
            continue
        gid = int(m.group(1))
        rank_el = row.select_one(".rank")
        rate_el = row.select_one(".game-rate")
        rows.append(
            {
                "boardlife_id": gid,
                "rank": int(re.sub(r"\D", "", text(rank_el)) or 0) or None,
                "name_ko": text(a),
                "name_en": text(row.select_one(".subTitle .eng")),
                "year": re.sub(r"\D", "", text(row.select_one(".subTitle .year"))) or None,
                "tagline": text(row.select_one(".short-title")),
                "rate": text(rate_el) if rate_el and text(rate_el) != "-" else None,
            }
        )
    return rows


def crawl(max_pages=1000, delay=0.4):
    session = requests.Session()
    session.headers.update(UA)
    seen = set()
    games = []
    for page in range(1, max_pages + 1):
        r = session.get(BASE.format(page), timeout=20)
        r.encoding = "utf-8"
        rows = parse_page(r.text)
        if not rows:
            print(f"page {page}: 0 rows -> stop")
            break
        new = 0
        for g in rows:
            if g["boardlife_id"] in seen:
                continue
            seen.add(g["boardlife_id"])
            games.append(g)
            new += 1
        print(f"page {page}: {len(rows)} rows ({new} new), total={len(games)}")
        if new == 0:
            print("no new ids -> stop")
            break
        time.sleep(delay)
    return games


if __name__ == "__main__":
    max_pages = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    games = crawl(max_pages=max_pages)
    with open("games_list.json", "w", encoding="utf-8") as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
    print(f"\nsaved {len(games)} games -> games_list.json")
