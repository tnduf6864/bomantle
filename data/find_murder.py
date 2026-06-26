import requests,re,json
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR"}
# 1) search boardlife for 머더미스터리
out={}
# scan our list for names containing murder-ish keywords
lst=json.load(open("games_list.json",encoding="utf-8"))
kw=re.compile(r"머더|미스터리|크라임|추리|범죄|살인|murder|mystery|crime",re.I)
hits=[g for g in lst if kw.search((g["name_ko"] or "")+" "+(g["name_en"] or "")+" "+(g["tagline"] or ""))]
out["list_keyword_hits_count"]=len(hits)
out["list_keyword_hits_sample"]=[{"id":g["boardlife_id"],"ko":g["name_ko"],"en":g["name_en"]} for g in hits[:15]]
json.dump(out,open("murder_scan.json","w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("hits:",len(hits))
