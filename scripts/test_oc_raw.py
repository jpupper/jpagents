import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

body = json.dumps({
    "model": "oc/deepseek-v4-flash-free",
    "messages": [{"role": "user", "content": "Say hola in one word and nothing else"}],
    "max_tokens": 20
}).encode()

req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})

try:
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read())
    content = result["choices"][0]["message"]["content"]
    print(f"CONTENT: {content}")
    print(f"MODEL: {result['model']}")
    if 'usage' in result:
        print(f"USAGE: {result['usage']}")
except urllib.error.HTTPError as e:
    body_text = e.read().decode()
    print(f"HTTP {e.code}: {body_text[:500]}")
except Exception as e:
    print(f"ERROR: {e}")
