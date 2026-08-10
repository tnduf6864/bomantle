"""확장(본판 없이는 못 노는 게임)을 골라 expansion_list.json 을 만든다.

**판정 기준은 보드라이프 카테고리 55 = "본판이 필요한 확장"**이다. 상세 페이지의
`/info/category/55` 태그로 붙고 우리는 이미 categories 를 크롤하므로 추가 요청이
필요 없다. 실측 정밀도는 사실상 100% — 평가 수 상위(테라포밍 마스: 서곡, 카탄:
도시와 기사, 윙스팬: 유럽 확장 …) 전부 진짜 확장이고 본판 오탐이 없었다.

주의할 경계 두 가지:

1. 좀비사이드 시즌 2처럼 **단독 플레이 가능한 스탠드얼론 확장은 55가 안 붙는다.**
   기준이 "본판이 *필요한*"이므로 이게 맞다 — 혼자 놀 수 있으면 게임으로 남긴다.
2. 55를 놓친 명백한 확장이 약 81건 있다(해저탐험: 확장 주사위, 메도우: 빅풋 프로모
   등). 이름 정규식 NAME_SIG 로 보강한다. 반대로 본판인데 이름에 '확장'이 들어가는
   경우를 대비해 KEEP 화이트리스트를 둔다.

`rank is None` 은 대체 신호로 쓸 수 없다 — 순위 없는 본판이 430개나 된다.

출력: expansion_list.json  (build_clean.py 가 읽어서 제외)
사용:  python build_expansion.py
"""
import json
import re

SRC = "games_detail_all.json"
OUT = "expansion_list.json"

EXPANSION_CAT = 55

# 55가 놓친 확장을 잡는 보강 규칙. '확장/프로모'가 이름에 박혀 있으면 확장으로 본다.
NAME_SIG = re.compile(r"확장|프로모|expansion|promo", re.I)
# 본판인데 이름에 위 낱말이 들어가는 경우를 위한 보호 목록(현재는 비어 있고, 오탐이
# 발견되면 여기에 추가할 것). 정규식이므로 이름 일부만 적어도 된다.
KEEP = re.compile(r"(?!)", re.I)  # 아무것도 매치하지 않음


def is_expansion(g):
    """(확장인가, 판정 근거) 튜플."""
    name = f"{g.get('name_ko') or ''} {g.get('name_en') or ''}"
    if KEEP.search(name):
        return False, None
    if any(c["id"] == EXPANSION_CAT for c in g.get("categories", [])):
        return True, "cat55"
    if NAME_SIG.search(name):
        return True, "name"
    return False, None


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    rows, by_reason = [], {"cat55": 0, "name": 0}
    for gid, g in d.items():
        exp, why = is_expansion(g)
        if not exp:
            continue
        by_reason[why] += 1
        rows.append({
            "id": gid,
            "name": g.get("name_ko") or g.get("name_en"),
            "reason": why,
            "rank": g.get("rank"),
            "review_count": g.get("review_count"),
        })
    rows.sort(key=lambda r: (r["reason"], -(r["review_count"] or 0)))
    json.dump(
        {"count": len(rows), "by_reason": by_reason, "expansions": rows},
        open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1,
    )
    print(f"확장 {len(rows)}건 (cat55={by_reason['cat55']} name={by_reason['name']}) "
          f"| 남는 게임 {len(d) - len(rows)} -> {OUT}")


if __name__ == "__main__":
    main()
