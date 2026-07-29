import urllib.request, json, http.cookiejar

# Login to OnmiRoute
cj = http.cookiejar.MozillaCookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

data = json.dumps({"password": "CHANGEME"}).encode()
req = urllib.request.Request("http://localhost:20128/api/auth/login", data=data,
                              headers={"Content-Type": "application/json"})
resp = opener.open(req)
print("Login:", resp.status, resp.read().decode()[:100])

# Create an API key if needed
req2 = urllib.request.Request("http://localhost:20128/api/keys?show=true",
                              headers={"Accept": "application/json"})
keys = json.loads(opener.open(req2).read())
print("\nExisting keys:", json.dumps(keys, indent=2)[:500])

# Get the first API key
key = None
if isinstance(keys, list) and len(keys) > 0:
    key = keys[0].get("key") or keys[0].get("apiKey") or keys[0].get("id")
    print(f"Using key: {key[:20]}...")
else:
    # Create one
    data3 = json.dumps({"name": "jp-agents-key", "limit": 0}).encode()
    req3 = urllib.request.Request("http://localhost:20128/api/keys",
                                   data=data3,
                                   headers={"Content-Type": "application/json"})
    key_resp = json.loads(opener.open(req3).read())
    key = key_resp.get("key") or key_resp.get("apiKey")
    print(f"Created key: {key[:20] if key else 'none'}...")

# Now test the opencode free models directly
# The provider registry shows the prefix is 'oc/'
test_models = [
    "oc/deepseek-v4-flash-free",
    "oc/qwen3-235b-a22b",
    "oc/gpt-4o-mini",
    "oc/claude-sonnet-4-6",
    "oc/gemini-3-flash",
]

print(f"\n=== Testing OpenCode Free models ===")
for model in test_models:
    data4 = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Say hello in one word"}],
        "max_tokens": 10,
        "stream": False,
    }).encode()
    
    req4 = urllib.request.Request("http://localhost:20128/v1/chat/completions",
                                   data=data4,
                                   headers={
                                       "Content-Type": "application/json",
                                       "Authorization": f"Bearer {key}" if key else ""
                                   })
    try:
        resp4 = opener.open(req4, timeout=15)
        body = resp4.read().decode()
        data4 = json.loads(body)
        content = data4.get("choices", [{}])[0].get("message", {}).get("content", "NO CONTENT")
        print(f"  {model}: OK -> '{content[:80]}'")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        print(f"  {model}: FAIL HTTP {e.code} -> {body}")
    except Exception as e:
        print(f"  {model}: ERROR -> {e}")
