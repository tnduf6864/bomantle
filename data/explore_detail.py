import requests, re, json
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}
r=requests.get("https://boardlife.co.kr/game/8569",headers=UA,timeout=20); r.encoding="utf-8"
html=r.text
s=BeautifulSoup(html,"lxml")
# BGG id
bgg=re.findall(r'boardgamegeek\.com/boardgame/(\d+)',html)
print("BGG ids found:",sorted(set(bgg)))
# find labelled info rows: look for common label words
for label in ["인원","시간","연령","무게","난이도","디자이너","테마","카테고리","메커니즘","장르","출시"]:
    # find element whose text == label, print sibling/next text
    el=s.find(string=re.compile(rf'^\s*{label}'))
    if el:
        parent=el.parent
        sib=parent.find_next_sibling()
        val=sib.get_text(" ",strip=True)[:80] if sib else parent.parent.get_text(" ",strip=True)[:80]
        print(f"[{label}] -> {val!r}")
# dump any element with class containing info/spec/tag/theme/category
print("\n-- candidate class names --")
classes=set()
for el in s.find_all(class_=True):
    for c in el.get("class"):
        if any(k in c for k in ["info","spec","tag","theme","categ","mech","genre","meta","detail"]):
            classes.add(c)
print(sorted(classes)[:40])
open("detail_sample.html","w",encoding="utf-8").write(html)
print("\nsaved detail_sample.html len",len(html))
