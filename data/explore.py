import requests, re
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}
r=requests.get("https://boardlife.co.kr/rank.php?page=1",headers=UA,timeout=20)
r.encoding="utf-8"
s=BeautifulSoup(r.text,"lxml")
links=s.select('a[href*="/game/"]')
print("page1 game links:",len(links))
# inspect first game link's surrounding card
a=links[0]
card=a
for _ in range(4):
    if card.parent: card=card.parent
print("\n--- sample card text ---")
print(re.sub(r'\s+\n','\n',card.get_text(" ",strip=True))[:600])
print("\n--- first 6 unique game links (id + text) ---")
seen=set()
for a in links:
    m=re.search(r'/game/(\d+)',a.get("href",""))
    if not m: continue
    gid=m.group(1)
    if gid in seen: continue
    seen.add(gid)
    txt=a.get_text(" ",strip=True)[:40]
    if txt:
        print(gid, "|", txt)
    if len(seen)>=8: break
# look for category/theme labels present on listing
print("\n--- pagination hint ---")
print([a.get("href") for a in s.select('a[href*="rank.php?page="]')][:8])
