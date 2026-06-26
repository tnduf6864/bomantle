import json,re
d=json.load(open("games_detail.json",encoding="utf-8"))
def has24(g): return any(c["id"]==24 for c in g.get("categories",[]))
c24=[(gid,g) for gid,g in d.items() if has24(g)]
# scenario-kit signals
kit_kw=re.compile(r"머더\s*미스터리|미스터리\s*파티|크라임|crime|murder myster|시나리오|추리\s*키트|방탈출|레전드 오브 더 파이브",re.I)
rows=[]
for gid,g in c24:
    nm=(g.get("name_ko") or "")+" / "+(g.get("name_en") or "")
    kit_name=bool(kit_kw.search(nm))
    rows.append({
      "id":gid,"name":nm[:45],"bgg":g.get("bgg_id"),"weight":g.get("weight"),
      "ncat":len(g.get("categories",[])),"rank":g.get("rank"),"kw":kit_name
    })
# summary
no_bgg=[r for r in rows if not r["bgg"]]
no_w=[r for r in rows if not r["weight"]]
kw_hit=[r for r in rows if r["kw"]]
print(f"cat24 total={len(rows)}  no_bgg={len(no_bgg)}  no_weight={len(no_w)}  name_kw={len(kw_hit)}")
json.dump({"cat24_total":len(rows),
           "no_bgg_sample":[r for r in no_bgg][:40],
           "name_kw_sample":kw_hit[:40]},
          open("murder_candidates.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("written")
