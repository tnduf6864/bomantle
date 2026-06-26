import requests, re
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}
def get(u):
    r=requests.get(u,headers=UA,timeout=20); r.encoding="utf-8"; return r
# pagination probing
print("== pagination probe (unique game ids per variant) ==")
for u in ["https://boardlife.co.kr/rank","https://boardlife.co.kr/rank?page=2","https://boardlife.co.kr/rank/2","https://boardlife.co.kr/rank?pg=2"]:
    r=get(u)
    ids=sorted(set(re.findall(r'/game/(\d+)',r.text)),key=int)
    print(f"{u} -> {len(ids)} ids; first5={ids[:5]}")
# card structure from /rank
r=get("https://boardlife.co.kr/rank")
s=BeautifulSoup(r.text,"lxml")
a=s.select_one('a[href*="/game/"]')
card=a
for _ in range(5):
    if card.parent and card.parent.name!='body': card=card.parent
    else: break
print("\n== sample card classes ==", card.get("class"), card.name)
print("== sample card text ==")
print(re.sub(r'\s{2,}',' ',card.get_text(" ",strip=True))[:400])
