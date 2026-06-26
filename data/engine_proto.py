"""유사도 엔진 프로토타입.

피처:
  - 태그(카테고리/테마) : IDF 가중 이진 벡터의 코사인 유사도 (주 신호)
  - 수치(난이도/시간/인원): 정규화 거리 -> 유사도 (보조 신호)
결합: final = TAG_W * tag_cos + NUM_W * num_sim
"""
import json
import math
from collections import Counter

TAG_W = 0.72
NUM_W = 0.28

games = json.load(open("games_clean.json", encoding="utf-8"))
catnames = json.load(open("category_names.json", encoding="utf-8"))
N = len(games)

# --- IDF ---
df = Counter()
for g in games:
    for t in set(g["categories"]):
        df[t] += 1
idf = {t: math.log((N + 1) / (c + 1)) + 1 for t, c in df.items()}

# --- 수치 피처 정규화 준비 ---
weights = [g["weight"] for g in games if g["weight"]]
W_MEAN = sum(weights) / len(weights)


def tag_vec(g):
    return {t: idf[t] for t in set(g["categories"])}


def cos(a, b):
    if not a or not b:
        return 0.0
    dot = sum(a[t] * b[t] for t in a if t in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def num_sim(g1, g2):
    sims = []
    # 난이도(weight): 범위 ~1-5
    w1 = g1["weight"] or W_MEAN
    w2 = g2["weight"] or W_MEAN
    sims.append(max(0.0, 1 - abs(w1 - w2) / 2.5))
    # 플레이 시간: 로그 스케일
    t1, t2 = g1["time_min"], g2["time_min"]
    if t1 and t2:
        sims.append(max(0.0, 1 - abs(math.log10(t1 + 1) - math.log10(t2 + 1)) / 1.0))
    # 인원 범위 겹침 (Jaccard)
    a = set(range(g1["players_min"] or 0, (g1["players_max"] or 0) + 1))
    b = set(range(g2["players_min"] or 0, (g2["players_max"] or 0) + 1))
    if a and b:
        sims.append(len(a & b) / len(a | b))
    return sum(sims) / len(sims) if sims else 0.0


# 미리 태그 벡터 캐시
for g in games:
    g["_vec"] = tag_vec(g)


def similarity(g1, g2):
    return TAG_W * cos(g1["_vec"], g2["_vec"]) + NUM_W * num_sim(g1, g2)


def find(name):
    for g in games:
        if name in (g["name_ko"] or "") or name.lower() in (g["name_en"] or "").lower():
            return g
    return None


def topn(name, n=10):
    src = find(name)
    if not src:
        return {"query": name, "error": "not found"}
    scored = [(similarity(src, g), g) for g in games if g["id"] != src["id"]]
    scored.sort(key=lambda x: -x[0])
    cats = [catnames.get(str(c), str(c)) for c in src["categories"]]
    return {
        "query": f"{src['name_ko']} ({src['name_en']})",
        "tags": cats,
        "weight": src["weight"],
        "top": [
            {
                "name": g["name_ko"],
                "score": round(s * 100, 1),
                "tags": [catnames.get(str(c), str(c)) for c in g["categories"]],
                "w": g["weight"],
            }
            for s, g in scored[:n]
        ],
    }


if __name__ == "__main__":
    samples = ["브라스: 버밍엄", "카탄", "글룸헤이븐", "윙스팬", "아줄", "코드네임", "팬데믹", "스플렌더"]
    out = [topn(s) for s in samples]
    json.dump(out, open("validation.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("written validation.json")
