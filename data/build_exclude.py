import json,re
d=json.load(open("games_detail.json",encoding="utf-8"))
def has24(g): return any(c["id"]==24 for c in g.get("categories",[]))
# 시나리오 키트 시리즈명 (전역 적용)
KIT=re.compile(r"미스터리\s*파티|머더\s*미스터리\s*미니|머더미스터리|머더\s*미스테리|탁상탐정단|인사이드\s*팩트",re.I)
# 명백히 유지할 정통 게임(보호 화이트리스트: 시리즈 오탐 방지)
KEEP=re.compile(r"디텍티브|미크로\s*마크로|micromacro|사건의 재구성|chronicles of crime|디셉션|deception|블랙\s*스토리|미니\s*크라임|mini crime|크립티드|cryptid|크라임 시티",re.I)
excl=[]; keep24=[]
for gid,g in d.items():
    nm=(g.get("name_ko") or "")+" / "+(g.get("name_en") or "")
    is_keep=bool(KEEP.search(nm))
    is_kit = bool(KIT.search(nm)) or (has24(g) and not g.get("bgg_id") and not g.get("weight"))
    if is_kit and not is_keep:
        excl.append({"id":gid,"name":(g.get("name_ko") or g.get("name_en")),"bgg":g.get("bgg_id"),"w":g.get("weight"),"rank":g.get("rank")})
    elif has24(g):
        keep24.append({"id":gid,"name":(g.get("name_ko") or g.get("name_en")),"bgg":g.get("bgg_id"),"w":g.get("weight")})
excl.sort(key=lambda r:(r["rank"] or 99999))
keep24.sort(key=lambda r:r["name"])
json.dump({"exclude_count":len(excl),"keep24_count":len(keep24),
           "exclude":excl,"kept_murder_games":keep24},
          open("exclude_list.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print(f"exclude={len(excl)}  kept(cat24 but legit)={len(keep24)}  remaining={len(d)-len(excl)}")
