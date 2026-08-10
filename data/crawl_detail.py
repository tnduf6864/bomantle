"""[부분 폐기] games_list.json 의 각 게임 상세 페이지(/game/{id})를 크롤링해

⚠️ 이제 진입점은 `crawl_all.py`다(등록 게임 전수 스윕). 다만 아래 `parse_detail`은
그대로 재사용하므로 이 파일을 지우면 안 된다. `main()`만 games_list.json에 묶여 있다.

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


def _vote(soup, vtype):
    """커뮤니티 투표 요약(.gvs-list)의 한 항목 값. 투표가 없으면 '-'라 None으로 본다.

    2026-08 개편으로 유형(옛 /info/type/N)·베스트/추천 인원이 전부 이 블록으로 옮겨졌다.
    옛 셀렉터(a[href*='/info/type/'], .recommend-player)는 페이지에서 사라졌다.
    """
    el = soup.select_one(f".gvs-item[data-vtype='{vtype}'] .gvs-value")
    v = el.get_text(" ", strip=True) if el else None
    return None if v in (None, "", "-") else v


# 플레이타임 표기: "50-140분"(범위) 또는 "45분"(단일). 데이터가 없으면 "-".
TIME_RANGE = re.compile(r"(\d+)\s*-\s*(\d+)\s*분")
TIME_ONE = re.compile(r"(\d+)\s*분")


def _info_row(soup, label):
    """상세 페이지 사양 블록(dl.game-info-item)에서 label('인원'/'시간'/'연령') 값.

    **행이 없는 것과 값이 비어 있는 것을 구분해서 돌려준다** — 행이 없으면 None(파서를
    못 믿는 상황이라 폴백이 필요), 값이 "-"면 ""(사이트가 "데이터 없음"이라고 명시한
    것이므로 폴백하면 안 된다). 둘을 뭉뚱그리면 '9분의 1'처럼 시간 정보가 없는 게임이
    description의 이름 부분("9분")으로 폴백해 버린다.
    """
    for dl in soup.select("dl.game-info-item"):
        dt, dd = dl.select_one("dt"), dl.select_one("dd")
        if dt and dd and dt.get_text(strip=True) == label:
            v = dd.get_text(strip=True)
            return "" if v == "-" else v
    return None


def parse_time(soup, desc=""):
    """(time_min, time_max) — 둘 다 분.

    **meta description이 아니라 사양 블록에서 읽는다.** description은
    "{이름}(영문)은 ... A세 이상 B-C명이 D-E분 동안 ..." 템플릿이라 **게임 이름이 맨 앞에**
    오는데, 이름에 숫자+분이 들어가면(8분 제국, 5분 던전, 가이스트블리츠 12시 5분전 …)
    정규식이 이름 쪽에 먼저 걸린다. 실제로 '가이스트블리츠 12시 5분전'은 15분짜리인데
    5분으로, '9분의 1'은 시간 정보가 없는데 9분으로 들어갔다.
    사양 블록은 <dt>시간</dt> 라벨로 구분되므로 이 혼동이 원천적으로 없다.

    desc는 **사양 블록 자체가 없는** 페이지를 위한 폴백이다(실측 150건 중 0건이지만
    마크업이 또 바뀔 때를 대비). 블록이 있는데 값이 "-"면 폴백하지 않고 없는 값으로 둔다.
    """
    raw = _info_row(soup, "시간")
    if raw is None:
        raw = desc  # 행 자체가 없음 → 이름 오염을 감수하고라도 값이 없는 것보단 낫다
    m = TIME_RANGE.search(raw) or TIME_ONE.search(raw)
    if not m:
        return None, None
    t = m.groups()
    lo = int(t[0])
    hi = int(t[1]) if len(t) > 1 and t[1] else lo
    # 보드라이프에 뒤집힌 범위가 실제로 올라와 있다("40-30분", "240-0분" 등 50건).
    # 상한이 하한보다 작으면 그 범위는 못 믿으므로 **앞 숫자만** 단일값으로 쓴다.
    # 뒤집어서 살리지 않는 이유: "90-12분"이 12~90분인지 90분 오타인지 알 수 없다.
    if hi < lo:
        hi = lo
    return lo, hi


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
    d["designers"] = _links(soup, "designer")     # 디자이너
    d["groups"] = _links(soup, "groups")          # 패밀리(테마/디지털구현/솔로규칙 혼재)

    # 유형(전략/가족/파티/추상 등). 예전에는 /info/type/N 링크였지만 2026-08 개편으로
    # 커뮤니티 투표 항목이 됐다. 값도 "전략게임"에서 "전략"으로 짧아졌다.
    # 리스트로 유지하는 이유: 소비처(보들 그리드·정답 카드)가 이미 배열을 기대한다.
    cat = _vote(soup, "category")
    d["types"] = [cat] if cat else []

    # 베스트·추천 인원. 같은 투표 블록의 "4인 / 2인" 형태. 범위형("2-3인")도 있을 수
    # 있어 숫자 부분만 문자열로 보존한다. 투표가 없으면 None.
    pv = _vote(soup, "player") or ""
    parts = [p.strip() for p in pv.split("/")]
    nums = [re.sub(r"[^\d\-]", "", p) or None for p in parts]
    d["best_players"] = nums[0] if len(nums) > 0 else None
    d["recommended_players"] = nums[1] if len(nums) > 1 else None

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
    weight = re.search(r"난이도\s*([\d.]+)", desc)
    rank = re.search(r"종합\s*([\d,]+)\s*위", desc)
    d["age"] = int(age.group(1)) if age else None
    if players:
        g = players.groups()
        d["players_min"] = int(g[0])
        d["players_max"] = int(g[1]) if len(g) > 1 and g[1] else int(g[0])
    else:
        d["players_min"] = d["players_max"] = None
    # 시간만 사양 블록에서 읽는다 — 이유는 parse_time 주석 참고.
    # (인원·연령은 사양 블록이 "2-0명"/"0명" 같은 미설정 값을 그대로 노출해서
    #  오히려 description 쪽이 깨끗하다. 연령은 "세 이상" 앵커가 이름 오염을 막는다.)
    d["time_min"], d["time_max"] = parse_time(soup, desc)
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
