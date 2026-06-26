import requests,json,time
import xml.etree.ElementTree as ET
UA={"User-Agent":"Mozilla/5.0"}
url="https://boardgamegeek.com/xmlapi2/thing?id=224517&stats=1"
for attempt in range(5):
    r=requests.get(url,headers=UA,timeout=30)
    print("attempt",attempt,"status",r.status_code,"len",len(r.text),"head",repr(r.text[:60]))
    if r.status_code==200 and r.text.strip().startswith("<?xml"):
        break
    time.sleep(2)
root=ET.fromstring(r.text)
item=root.find("item")
def links(t): return [l.get("value") for l in item.findall(f"link[@type='{t}']")]
aw=item.find(".//averageweight")
out={"name":item.find("name").get("value"),
 "mechanics":links("boardgamemechanic"),
 "categories":links("boardgamecategory"),
 "families":links("boardgamefamily")[:10],
 "weight":aw.get("value") if aw is not None else None}
json.dump(out,open("bgg_brass.json","w",encoding="utf-8"),ensure_ascii=False,indent=2)
print("written")
