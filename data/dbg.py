import requests, re
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36","Accept-Language":"ko-KR,ko;q=0.9"}
for url in ["https://boardlife.co.kr/rank","https://boardlife.co.kr/rank.php?page=1","https://boardlife.co.kr/rank.php"]:
    r=requests.get(url,headers=UA,timeout=20)
    body=r.text
    ngame=len(re.findall(r'/game/\d+',body))
    # detect if list is in an ajax endpoint
    ajax=re.findall(r'(rank[^"\']*\.php\?[^"\']+)',body)
    print(f"{url} -> {r.status_code}, {len(body)}B, /game/ matches={ngame}")
    print("   ajax-ish:",sorted(set(ajax))[:6])
