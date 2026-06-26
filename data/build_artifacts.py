import json
import os

clean = json.load(open("games_clean.json", encoding="utf-8"))
catnames = json.load(open("category_names.json", encoding="utf-8"))
mechnames = json.load(open("mechanism_names.json", encoding="utf-8"))

# 풀 버전: 워커(엔진+힌트+큐레이션) + 엔진 테스트용. 진행방식·평가수·힌트 필드 포함.
FULL = (
    "id", "name_ko", "name_en", "year", "rank", "rate", "bgg_id",
    "categories", "mechanisms",
    "weight", "players_min", "players_max", "time_min", "age",
    "review_count", "best_players", "recommended_players",
    "types", "designers", "image",
)
# 슬림 버전: 클라이언트(자동완성 + 추측 행 메타 표시)용. 정답 전용 힌트 필드 제외.
SLIM = (
    "id", "name_ko", "name_en", "year", "rank", "rate", "bgg_id",
    "categories", "weight", "players_min", "players_max", "time_min", "age",
)

full = [{k: g[k] for k in FULL} for g in clean]
slim = [{k: g[k] for k in SLIM} for g in clean]

os.makedirs("out", exist_ok=True)
json.dump(full, open("out/games.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(slim, open("out/games.web.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(catnames, open("out/categories.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
json.dump(mechnames, open("out/mechanisms.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)

print("games.json (full):", len(full), "games,", os.path.getsize("out/games.json") // 1024, "KB")
print("games.web.json (slim):", len(slim), "games,", os.path.getsize("out/games.web.json") // 1024, "KB")
print("categories:", len(catnames), "| mechanisms:", len(mechnames))
