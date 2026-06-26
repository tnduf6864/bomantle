import requests,re,json
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR"}
def detail(gid):
    r=requests.get(f"https://boardlife.co.kr/game/{gid}",headers=UA,timeout=20); r.encoding="utf-8"
    s=BeautifulSoup(r.text,"lxml")
    bgg=sorted(set(re.findall(r'boardgamegeek\.com/boardgame/(\d+)',r.text)))
    cats=[{"text":a.get_text(' ',strip=True),"href":a.get("href")} for a in s.select("a[href*='/info/category/']")]
    # 테마 label
    el=s.find(string=re.compile("테마"))
    theme=el.parent.parent.get_text(" ",strip=True)[:120] if el else None
    return {"id":gid,"bgg":bgg,"categories":cats,"theme":theme}
res=[detail(g) for g in [16070,12224,16946,5352]]  # murder-ish & deception
json.dump(res,open("murder_cats.json","w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("done")
