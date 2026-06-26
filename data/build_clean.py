import json
d = json.load(open("games_detail.json", encoding="utf-8"))
ex = json.load(open("exclude_list.json", encoding="utf-8"))
exclude_ids = {r["id"] for r in ex["exclude"]}
clean = []
for gid, g in d.items():
    if gid in exclude_ids:
        continue
    cats = g.get("categories", [])
    mechs = g.get("mechanisms", [])
    clean.append({
        "id": int(gid),
        "name_ko": g.get("name_ko"),
        "name_en": g.get("name_en"),
        "year": g.get("year"),
        "rank": g.get("rank"),
        "rate": float(g["rate"]) if g.get("rate") else None,
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
print("clean games:", len(clean), "| categories:", len(catnames), "| mechanisms:", len(mechnames))
