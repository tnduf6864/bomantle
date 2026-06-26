import requests, re
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}
def ids(n):
    r=requests.get(f"https://boardlife.co.kr/rank/{n}",headers=UA,timeout=20); r.encoding="utf-8"
    return sorted(set(re.findall(r'class="title[^"]*" href="/game/(\d+)"',r.text)),key=int)
for n in [1,2,10,30,50,80,100,150]:
    v=ids(n)
    print(f"page {n:>4}: rows={len(v)}, first={v[0] if v else None}, last={v[-1] if v else None}")
