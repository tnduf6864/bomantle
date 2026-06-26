import requests, re, json
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}
r=requests.get("https://boardlife.co.kr/rank/1",headers=UA,timeout=20); r.encoding="utf-8"
s=BeautifulSoup(r.text,"lxml")
a=s.select_one('a[href*="/game/"]')
# climb to the smallest ancestor that contains rank number + name
item=a
for _ in range(6):
    p=item.parent
    if p is None: break
    item=p
    cls=" ".join(item.get("class") or [])
    if any(k in cls for k in ["item","rank","row","card","list","game"]):
        break
out={"item_tag":item.name,"item_class":item.get("class"),
     "inner_html_snippet":item.decode()[:1500]}
open("item_sample.html","w",encoding="utf-8").write(item.decode())
print(json.dumps({k:out[k] for k in["item_tag","item_class"]},ensure_ascii=False))
# find total pages: look for last /rank/<n> link
pages=sorted(set(int(m) for m in re.findall(r'/rank/(\d+)',r.text)))
print("page links found:",pages[-10:] if pages else None)
