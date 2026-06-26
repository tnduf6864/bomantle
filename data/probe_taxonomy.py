import requests,re,json,time
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR"}
# 1) boardlife category taxonomy: fetch /info/category/N for N=1..70
tax={}
sess=requests.Session(); sess.headers.update(UA)
for n in range(1,71):
    try:
        r=sess.get(f"https://boardlife.co.kr/info/category/{n}",timeout=15); r.encoding="utf-8"
        # page title usually "<카테고리명> | ..." or h1
        s=BeautifulSoup(r.text,"lxml")
        t=s.find("title")
        name=t.get_text(strip=True).split("|")[0].strip() if t else ""
        # filter generic
        if name and name not in ("보드라이프","보드게임"):
            tax[n]=name
    except Exception as e:
        tax[n]=f"ERR {e}"
    time.sleep(0.1)
json.dump(tax,open("category_taxonomy.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("taxonomy entries:",len(tax))
# 2) BGG with browser UA via xmlapi1
import xml.etree.ElementTree as ET
r=sess.get("https://boardgamegeek.com/xmlapi/boardgame/224517",timeout=30)
print("BGG xmlapi1 status",r.status_code,"head",repr(r.text[:50]))
