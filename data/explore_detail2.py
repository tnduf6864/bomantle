import re,json
from bs4 import BeautifulSoup
html=open("detail_sample.html",encoding="utf-8").read()
s=BeautifulSoup(html,"lxml")
out={}
out["bgg_ids"]=sorted(set(re.findall(r'boardgamegeek\.com/boardgame/(\d+)',html)))
# .category tag elements (boardlife's own tags)
cats=[]
for e in s.select(".category"):
    t=e.get_text(" ",strip=True)
    if t: cats.append({"text":t,"class":e.get("class")})
out["category_tags"]=cats
# category nav links with href
catlinks=[]
for a in s.select("a[href*='category']"):
    catlinks.append({"text":a.get_text(' ',strip=True)[:40],"href":a.get("href")})
out["category_links"]=catlinks
# labelled info: 인원/난이도/시간/연령/테마
def label_val(label):
    el=s.find(string=re.compile(rf'^\s*{label}\s*$'))
    if not el: 
        el=s.find(string=re.compile(label))
    if not el: return None
    p=el.parent
    sib=p.find_next_sibling()
    return (sib.get_text(' ',strip=True) if sib else p.parent.get_text(' ',strip=True))[:120]
out["labels"]={lab:label_val(lab) for lab in ["인원","난이도","시간","연령","테마","디자이너","출시"]}
json.dump(out,open("detail_parsed.json","w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("written")
