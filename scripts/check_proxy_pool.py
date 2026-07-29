import urllib.request, json, http.cookiejar

cj = http.cookiejar.MozillaCookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# Login
data = json.dumps({"password": "CHANGEME"}).encode()
req = urllib.request.Request("http://localhost:20128/api/auth/login", data=data,
                              headers={"Content-Type": "application/json"})
resp = opener.open(req)
print("Login OK")

# Check free proxy pool status
req2 = urllib.request.Request("http://localhost:20128/api/free-proxies",
                              headers={"Accept": "application/json"})
try:
    proxies = json.loads(opener.open(req2).read())
    print("Free proxies:", json.dumps(proxies, indent=2)[:2000])
except urllib.error.HTTPError as e:
    print(f"Free proxies endpoint: HTTP {e.code}: {e.read().decode()[:500]}")

# Check proxy pool config
req3 = urllib.request.Request("http://localhost:20128/api/v1/proxy/pool/status",
                              headers={"Accept": "application/json"})
try:
    pool = json.loads(opener.open(req3).read())
    print("\nProxy pool status:", json.dumps(pool, indent=2)[:2000])
except urllib.error.HTTPError as e:
    print(f"\nProxy pool endpoint: HTTP {e.code}: {e.read().decode()[:500]}")

# Check if we can get proxy config
req4 = urllib.request.Request("http://localhost:20128/api/settings/proxy",
                              headers={"Accept": "application/json"})
try:
    settings = json.loads(opener.open(req4).read())
    print("\nProxy settings:", json.dumps(settings, indent=2)[:2000])
except urllib.error.HTTPError as e:
    print(f"\nProxy settings: HTTP {e.code}: {e.read().decode()[:500]}")
