import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

body = json.dumps({
    "model": "oc/deepseek-v4-flash-free",
    "messages": [{"role": "user", "content": "Say hola in one word and nothing else"}],
    "max_tokens": 20,
    "stream": True
}).encode()

req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})

try:
    resp = urllib.request.urlopen(req, timeout=60)
    full_text = []
    for line in resp:
        line_str = line.decode().strip()
        if line_str.startswith("data: ") and line_str != "data: [DONE]":
            try:
                chunk = json.loads(line_str[6:])
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                if delta.get("content"):
                    full_text.append(delta["content"])
            except:
                pass
    print(f"CONTENT: {''.join(full_text)}")
except urllib.error.HTTPError as e:
    body_text = e.read().decode()
    print(f"HTTP {e.code}: {body_text[:500]}")
except Exception as e:
    print(f"ERROR: {e}")
