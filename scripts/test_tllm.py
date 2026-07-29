import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

# Use streaming to check
data = json.dumps({
    "model": "tllm/deepseek_v4",
    "messages": [{"role": "user", "content": "Say hola in one word"}],
    "max_tokens": 10,
    "stream": True
}).encode()

req = urllib.request.Request(f"{BASE}/chat/completions", data=data,
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})

try:
    resp = urllib.request.urlopen(req, timeout=60)
    chunks = []
    for line in resp:
        line = line.decode().strip()
        if line.startswith("data: ") and line != "data: [DONE]":
            try:
                chunk = json.loads(line[6:])
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                if delta.get("content"):
                    chunks.append(delta["content"])
            except:
                pass
    print(f"SUCCESS - content: {''.join(chunks)}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"HTTP {e.code}: {body[:200]}")
except Exception as e:
    print(f"ERROR: {e}")
