import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

models = [
    "aug/claude-sonnet-4.6",
    "aug/claude-haiku-4.5",
    "aug/gemini-3.0-flash",
    "aug/gpt-5.5-medium",
    "aug/gemini-3.1-pro",
]

for model in models:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Reply just: OK"}],
        "max_tokens": 5
    }).encode()
    
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        result = json.loads(resp.read())
        content = result["choices"][0]["message"]["content"]
        model_used = result.get("model", "?")
        print(f"  OK   {model:35s} -> {model_used:30s} | {content[:60]}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"  FAIL {model:35s} | HTTP {e.code}: {body_text[:80]}")
    except Exception as e:
        print(f"  FAIL {model:35s} | {str(e)[:80]}")
