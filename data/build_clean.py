"""games_detail_all.json(전수 크롤) → games_clean.json + 태그 이름 마스터.

크롤 범위가 랭킹 목록 5,500개에서 **보드라이프 등록 전체**로 넓어졌다.
정답 풀은 넓어지면 안 되므로 워커 `answer.ts`가 순위·평가 수로 자른다.
여기서는 순위로 자르지 않는다 — 유사도 순위·자동완성은 전 게임을 대상으로 한다.

다만 **확장은 여기서 완전히 뺀다**(expansion_list.json). 본판 없이는 못 노는
게임이라 추측·자동완성 대상으로도 의미가 없기 때문이다. 정답 풀에는 원래도
확장이 없었다 — answer.ts 의 `rank <= 5500` + 프랜차이즈 중복제거가 이미 걸렀다.
"""
import json
import os

SRC = "games_detail_all.json"

if not os.path.exists(SRC):
    raise SystemExit(f"{SRC} 없음 — 먼저 `python crawl_all.py` 를 돌릴 것")

d = json.load(open(SRC, encoding="utf-8"))
ex = json.load(open("exclude_list.json", encoding="utf-8"))
exclude_ids = {r["id"] for r in ex["exclude"]}
xp = json.load(open("expansion_list.json", encoding="utf-8"))
expansion_ids = {r["id"] for r in xp["expansions"]}

clean, skipped = [], {"excluded": 0, "expansion": 0, "noname": 0}
for gid, g in d.items():
    if gid in exclude_ids:
        skipped["excluded"] += 1
        continue
    if gid in expansion_ids:
        skipped["expansion"] += 1
        continue
    if not g.get("name_ko"):
        skipped["noname"] += 1
        continue
    cats = g.get("categories", [])
    mechs = g.get("mechanisms", [])
    rank = g.get("rank")
    clean.append({
        "id": int(gid),
        "name_ko": g.get("name_ko"),
        "name_en": g.get("name_en"),
        "year": g.get("year"),
        "rank": rank,
        "rate": g.get("rate"),
        "bgg_id": g.get("bgg_id"),
        # 엔진용 태그 (id) + 이름 마스터
        "categories": [c["id"] for c in cats],
        "category_names": {c["id"]: c["name"] for c in cats},
        "mechanisms": [m["id"] for m in mechs],
        "mechanism_names": {m["id"]: m["name"] for m in mechs},
        # 수치 피처
        "weight": g.get("weight"),
        "players_min": g.get("players_min"),
        "players_max": g.get("players_max"),
        "time_min": g.get("time_min"),
        "time_max": g.get("time_max"),
        "age": g.get("age"),
        # 힌트/큐레이션용
        "review_count": g.get("review_count"),
        "best_players": g.get("best_players"),
        "recommended_players": g.get("recommended_players"),
        "types": [t["name"] for t in g.get("types", [])],
        "designers": [x["name"] for x in g.get("designers", [])],
        "image": g.get("image"),
    })
clean.sort(key=lambda g: (g["rank"] or 999999))

# 태그 id->name 마스터 (테마/진행방식)
catnames, mechnames = {}, {}
for g in clean:
    catnames.update({str(k): v for k, v in g["category_names"].items()})
    mechnames.update({str(k): v for k, v in g["mechanism_names"].items()})

json.dump(clean, open("games_clean.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(catnames, open("category_names.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(mechnames, open("mechanism_names.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

norank = sum(1 for g in clean if g["rank"] is None)
print(f"clean games: {len(clean)} (순위 없음 {norank}) | skipped {skipped}")
print(f"categories: {len(catnames)} | mechanisms: {len(mechnames)}")
