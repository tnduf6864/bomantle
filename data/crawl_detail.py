"""games_list.json 의 각 게임 상세 페이지(/game/{id})를 크롤링해
BGG id, 보드라이프 분류(테마/진행방식/타입/디자이너/그룹), 인원/난이도/시간/연령,
베스트·추천 인원, 평가 수, 박스아트 이미지 등을 수집한다.

- 중간 저장(매 SAVE_EVERY건) + 재시작 가능(이미 받은 id는 건너뜀)
- 결과: games_detail.json  (boardlife_id -> 상세 dict)
- 분류는 보드라이프 /info/<type>/<id> 네임스페이스가 종류별로 분리돼 있으므로
  (예: category 18=산업제조, mechanism 18=셋컬렉션) 필드를 따로 저장한다.
"""
import json
import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup


def _links(soup, kind):
    """/info/<kind>/<id> 앵커들을 [{id,name}] 로 (등장순·중복제거)."""
    out, seen = [], set()
    for a in soup.select(f"a[href*='/info/{kind}/']"):
        m = re.search(rf"/info/{kind}/(\d+)", a.get("href", ""))
        name = a.get_text(" ", strip=True)
        if m and name and m.group(1) not in seen:
            seen.add(m.group(1))
            out.append({"id": int(m.group(1)), "name": name})
    return out


def _ld_product(soup):
    """JSON-LD Product 블록(평점/평가수/이미지)."""
    for s in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            obj = json.loads(s.string or s.get_text() or "")
        except Exception:
            continue
        if isinstance(obj, dict) and obj.get("@type") == "Product":
            return obj
    return None

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
}
OUT = "games_detail.json"
SAVE_EVERY = 100


def parse_detail(html):
    soup = BeautifulSoup(html, "lxml")
    d = {}
    # BGG id (첫 매치)
    m = re.search(r"boardgamegeek\.com/boardgame/(\d+)", html)
    d["bgg_id"] = int(m.group(1)) if m else None

    # 보드라이프 분류 (/info/<kind>/N). 종류별 네임스페이스 분리 저장.
    d["categories"] = _links(soup, "category")    # 테마
    d["mechanisms"] = _links(soup, "mechanisms")  # 진행방식
    d["types"] = _links(soup, "type")             # 전략/가족/파티/추상 등
    d["designers"] = _links(soup, "designer")     # 디자이너
    d["groups"] = _links(soup, "groups")          # 패밀리(테마/디지털구현/솔로규칙 혼재)

    # 베스트·추천 인원 (.recommend-player 내부: "베스트:2인, 추천:3인").
    # 범위형("2-3")도 있을 수 있어 문자열로 보존. 데이터 없으면 None.
    rp = soup.select_one(".recommend-player")
    rp_txt = rp.get_text(" ", strip=True) if rp else ""
    bm = re.search(r"베스트\s*[:：]?\s*([\d\-]+)", rp_txt)
    rm = re.search(r"추천\s*[:：]?\s*([\d\-]+)", rp_txt)
    d["best_players"] = bm.group(1) if bm else None
    d["recommended_players"] = rm.group(1) if rm else None

    # JSON-LD: 평가 수(인지도 신호) + 박스아트 이미지.
    ld = _ld_product(soup)
    img = (ld or {}).get("image")
    if not img:
        og = soup.find("meta", attrs={"property": "og:image"})
        img = og.get("content") if og else None
    d["image"] = img
    ar = (ld or {}).get("aggregateRating") or {}
    rc = ar.get("reviewCount")
    d["review_count"] = int(rc) if rc not in (None, "") else None

    # 메타 description: "N세 이상 X-Y명이 Z분 동안 ..." (구조화된 백업 소스)
    meta = soup.find("meta", attrs={"name": "description"})
    desc = meta.get("content", "") if meta else ""
    age = re.search(r"(\d+)\s*세\s*이상", desc)
    players = re.search(r"(\d+)\s*-\s*(\d+)\s*명", desc) or re.search(r"(\d+)\s*명", desc)
    ptime = re.search(r"(\d+)\s*분", desc)
    weight = re.search(r"난이도\s*([\d.]+)", desc)
    rank = re.search(r"종합\s*([\d,]+)\s*위", desc)
    d["age"] = int(age.group(1)) if age else None
    if players:
        g = players.groups()
        d["players_min"] = int(g[0])
        d["players_max"] = int(g[1]) if len(g) > 1 and g[1] else int(g[0])
    else:
        d["players_min"] = d["players_max"] = None
    d["time_min"] = int(ptime.group(1)) if ptime else None
    d["weight"] = float(weight.group(1)) if weight else None
    d["overall_rank"] = int(rank.group(1).replace(",", "")) if rank else None
    return d


def main(limit=None, delay=0.35):
    games = json.load(open("games_list.json", encoding="utf-8"))
    if limit:
        games = games[:limit]
    result = {}
    if os.path.exists(OUT):
        result = json.load(open(OUT, encoding="utf-8"))
    session = requests.Session()
    session.headers.update(UA)
    # 새 필드(mechanisms 등) 없는 기존 항목도 재크롤 대상. 재시작 시 이미 보강된 건 건너뜀.
    todo = [
        g
        for g in games
        if "mechanisms" not in result.get(str(g["boardlife_id"]), {})
    ]
    print(f"total={len(games)}, already={len(result)}, todo={len(todo)}")
    for i, g in enumerate(todo, 1):
        gid = g["boardlife_id"]
        try:
            r = session.get(f"https://boardlife.co.kr/game/{gid}", timeout=20)
            r.encoding = "utf-8"
            d = parse_detail(r.text)
        except Exception as e:
            d = {"error": str(e)}
        d.update({k: g[k] for k in ("name_ko", "name_en", "year", "rank", "rate")})
        result[str(gid)] = d
        if i % 25 == 0:
            print(
                f"{i}/{len(todo)} (id={gid}) bgg={d.get('bgg_id')} "
                f"cats={len(d.get('categories',[]))} mech={len(d.get('mechanisms',[]))} "
                f"best={d.get('best_players')} rc={d.get('review_count')}"
            )
        if i % SAVE_EVERY == 0:
            json.dump(result, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        time.sleep(delay)
    json.dump(result, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"saved {len(result)} -> {OUT}")


if __name__ == "__main__":
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    main(limit=limit)
