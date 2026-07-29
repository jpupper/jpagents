import urllib.request, json, http.cookiejar, time

cj = http.cookiejar.MozillaCookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# Login
data = json.dumps({"password": "CHANGEME"}).encode()
req = urllib.request.Request("http://localhost:20128/api/auth/login", data=data,
                              headers={"Content-Type": "application/json"})
opener.open(req)

# Get API key
req2 = urllib.request.Request("http://localhost:20128/api/keys?show=true",
                              headers={"Accept": "application/json"})
keys_data = json.loads(opener.open(req2).read())
key = keys_data["keys"][0]["key"]

print(f"Testing free providers with key: {key[:15]}...")
print("Waiting 30 seconds for rate limits to reset...")
time.sleep(30)

# Test one model per provider
models = [
    ("tllm/deepseek_v4", "TheOldLLM"),
    ("oc/deepseek-v4-flash-free", "OpenCode Free"),
    ("ddgw/gpt-4o-mini", "DuckDuckGo"),
]

for model, label in models:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Say hello in one word"}],
        "max_tokens": 5,
    }).encode()
    
    req = urllib.request.Request("http://localhost:20128/v1/chat/completions",
                                  data=body,
                                  headers={
                                      "Content-Type": "application/json",
                                      "Authorization": f"Bearer {key}"
                                  })
    try:
        resp = opener.open(req, timeout=20)
        resp_body = json.loads(resp.read().decode())
        content = resp_body.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"[OK] {label}: '{content}'")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:100]
        print(f"[--] {label}: HTTP {e.code} - {body[:60]}")
