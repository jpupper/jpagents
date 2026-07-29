import json, urllib.request

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

# Use the full provider UUID prefix
PROVIDER_UUID = "openai-compatible-chat-77691029-de69-4a01-90fb-58a31231369a"

models_to_test = [
    f"{PROVIDER_UUID}/deepseek-v4-flash",
    f"{PROVIDER_UUID}/deepseek-chat",
    f"{PROVIDER_UUID}/deepseek-reasoner",
    "tllm/deepseek_v4",
    "oc/deepseek-v4-flash-free",
]

for model in models_to_test:
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
        chunks = []
        model_used = "?"
        for line in resp:
            line_str = line.decode().strip()
            if line_str.startswith("data: ") and line_str != "data: [DONE]":
                try:
                    chunk = json.loads(line_str[6:])
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        chunks.append(delta["content"])
                    if chunk.get("model"):
                        model_used = chunk["model"]
                except:
                    pass
        text = "".join(chunks)
        status = "OK" if text else "EMPTY"
        print(f"  {status:5s} {model:55s} -> {model_used:35s} | {text[:80]}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()[:100]
        print(f"  FAIL  {model:55s} | HTTP {e.code}: {body_text}")
    except Exception as e:
        print(f"  FAIL  {model:55s} | {str(e)[:80]}")
