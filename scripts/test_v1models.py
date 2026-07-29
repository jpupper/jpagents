import urllib.request, json

# Test /v1/models without API key
try:
    req = urllib.request.Request("http://localhost:20128/v1/models")
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode())
    models = data.get("data", [])
    print(f"Without API key: OK, {len(models)} models")
    for m in models[:5]:
        print(f"  - {m.get('id', '?')}")
except Exception as e:
    print(f"Without API key: FAIL -> {e}")

# Test /v1/models with API key  
try:
    cj = http.cookiejar.MozillaCookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # Login
    data_login = json.dumps({"password": "CHANGEME"}).encode()
    req_login = urllib.request.Request("http://localhost:20128/api/auth/login",
                                        data=data_login,
                                        headers={"Content-Type": "application/json"})
    opener.open(req_login)
    
    # Get key
    req_keys = urllib.request.Request("http://localhost:20128/api/keys?show=true",
                                       headers={"Accept": "application/json"})
    keys_data = json.loads(opener.open(req_keys).read())
    key = keys_data["keys"][0]["key"]
    
    req2 = urllib.request.Request("http://localhost:20128/v1/models",
                                   headers={"Authorization": f"Bearer {key}"})
    resp2 = urllib.request.urlopen(req2, timeout=5)
    data2 = json.loads(resp2.read().decode())
    models2 = data2.get("data", [])
    print(f"\nWith API key: OK, {len(models2)} models")
    for m in models2[:5]:
        print(f"  - {m.get('id', '?')}")
except Exception as e:
    print(f"\nWith API key: FAIL -> {e}")
