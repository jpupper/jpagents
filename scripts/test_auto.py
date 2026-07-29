import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

models = [
    "auto/cheap",
    "auto/fast",
    "auto/chat",
    "auto/coding",
    "auto/smart",
]

for model in models:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Respond just: OK"}],
        "max_tokens": 5,
        "stream": True
    }).encode()
    
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        full_text = []
        model_used = "?"
        for line in resp:
            line_str = line.decode().strip()
            if line_str.startswith("data: ") and line_str != "data: [DONE]":
                try:
                    chunk = json.loads(line_str[6:])
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        full_text.append(delta["content"])
                    if not model_used or model_used == "?":
                        model_used = chunk.get("model", "?")
                except:
                    pass
        text = "".join(full_text)
        if text:
            print(f"  OK   {model:20s} -> {model_used:35s} | {text[:50]}")
        else:
            print(f"  EMPTY {model:20s} -> {model_used:35s}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()[:100]
        print(f"  FAIL {model:20s} | HTTP {e.code}: {body_text}")
    except Exception as e:
        print(f"  FAIL {model:20s} | {str(e)[:80]}")
