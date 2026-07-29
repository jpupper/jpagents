import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

def test_stream(model):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Reply just: OK"}],
        "max_tokens": 10,
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
        return True, "".join(full_text)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        return False, f"HTTP {e.code}: {body_text[:100]}"
    except Exception as e:
        return False, str(e)

models = [
    "aug/claude-sonnet-4.6",
    "aug/claude-haiku-4.5",
    "aug/gemini-3.0-flash",
    "aug/gpt-5.5-medium",
]

for model in models:
    ok, result = test_stream(model)
    if ok:
        print(f"  OK   {model:35s} | {result[:80]}")
    else:
        print(f"  FAIL {model:35s} | {result[:80]}")
