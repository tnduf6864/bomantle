import re,json
from bs4 import BeautifulSoup
html=open("detail_sample.html",encoding="utf-8").read()
s=BeautifulSoup(html,"lxml")
def show(sel):
    els=s.select(sel)
    print(f"\n[{sel}] -> {len(els)} els")
    for e in els[:12]:
        t=e.get_text(" ",strip=True)
        if t: print("   ",repr(t[:80]),"| class=",e.get("class"))
for sel in [".category",".game-info",".game-main-info","[class^=tag-]","a[href*='theme']","a[href*='category']","a[href*='mechanic']"]:
    show(sel)
# 테마/카테고리 label blocks
print("\n=== label blocks ===")
for label in ["테마","카테고리","메커니즘"]:
    el=s.find(string=re.compile(label))
    if el:
        box=el.parent.parent
        print(f"--{label}--", re.sub(r'\s{2,}',' ',box.get_text(" ",strip=True))[:200])
