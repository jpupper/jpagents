import json, urllib.request

# Read the deepseek key
with open(r'C:\Users\JPupper\.hermes\.env', 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith('DEEPSEEK_API_KEY='):
            key = line.split('=', 1)[1].strip()
            if key:
                deepseek_key = key
                break

print("Key found:", deepseek_key[:8] + "..." + deepseek_key[-4:])

# Login
login_data = json.dumps({"password": "CHANGEME"}).encode()
req = urllib.request.Request("http://localhost:20128/api/auth/login", data=login_data, method="POST")
req.add_header("Content-Type", "application/json")

import http.cookiejar
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
resp = opener.open(req)
print("Login:", resp.status)

# Get providers list
req2 = urllib.request.Request("http://localhost:20128/api/providers")
resp2 = opener.open(req2)
providers = json.loads(resp2.read())

# Find DeepSeek provider
pid = None
for conn in providers.get("connections", []):
    print("Found provider:", conn.get("name"), conn.get("id"))
    if "deepseek" in conn.get("name", "").lower():
        pid = conn["id"]
        break

if pid:
    print("Updating provider:", pid)
    update_data = json.dumps({"apiKey": deepseek_key}).encode()
    req3 = urllib.request.Request(
        "http://localhost:20128/api/providers/" + pid,
        data=update_data,
        method="PUT"
    )
    req3.add_header("Content-Type", "application/json")
    resp3 = opener.open(req3)
    print("Update:", resp3.status)
    
    # Test
    req4 = urllib.request.Request(
        "http://localhost:20128/api/providers/" + pid + "/test",
        method="POST"
    )
    req4.add_header("Content-Type", "application/json")
    resp4 = opener.open(req4)
    test_result = json.loads(resp4.read())
    print("Test result:", json.dumps(test_result, indent=2)[:500])
else:
    print("Creating new provider...")
    create_data = json.dumps({
        "name": "DeepSeek API",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": deepseek_key,
        "prefix": "deepseek",
        "apiType": "chat",
        "authType": "apikey"
    }).encode()
    req3 = urllib.request.Request(
        "http://localhost:20128/api/providers/client",
        data=create_data,
        method="POST"
    )
    req3.add_header("Content-Type", "application/json")
    resp3 = opener.open(req3)
    print("Create:", resp3.status)
    print(json.dumps(json.loads(resp3.read()), indent=2)[:500])
