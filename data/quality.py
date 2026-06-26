import json
from collections import Counter
d=json.load(open("games_detail.json",encoding="utf-8"))
n=len(d)
has_bgg=sum(1 for g in d.values() if g.get("bgg_id"))
has_cat=sum(1 for g in d.values() if g.get("categories"))
has_w=sum(1 for g in d.values() if g.get("weight"))
has_pl=sum(1 for g in d.values() if g.get("players_min"))
has_t=sum(1 for g in d.values() if g.get("time_min"))
errs=sum(1 for g in d.values() if g.get("error"))
catcount=Counter(len(g.get("categories",[])) for g in d.values())
# vocabulary
vocab=Counter()
catname={}
for g in d.values():
    for c in g.get("categories",[]):
        vocab[c["id"]]+=1; catname[c["id"]]=c["name"]
out={
 "total":n,"errors":errs,
 "has_bgg":has_bgg,"has_categories":has_cat,"has_weight":has_w,
 "has_players":has_pl,"has_time":has_t,
 "categories_per_game_dist":dict(sorted(catcount.items())),
 "vocab_size":len(vocab),
 "top30_categories":[{"id":i,"name":catname[i],"count":c} for i,c in vocab.most_common(30)],
}
json.dump(out,open("quality.json","w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("written")
