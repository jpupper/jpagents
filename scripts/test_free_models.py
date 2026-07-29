import json, urllib.request, sys

KEY = "sk-57b...9377"
BASE = "http://localhost:20128/v1"

models_to_test = [
    ("oc/deepseek-v4-flash-free", "opencode"),
    ("tllm/deepseek_v4", "theoldllm"),
    ("tllm/gemini_2_0_flash", "theoldllm"),
    ("tllm/gpt-4o-mini", "theoldllm"),
    ("tllm/claude_haiku_3_5", "theoldllm"),
    ("oc/qwen3.6-plus-free", "opencode"),
    ("oc/minimax-m3-free", "opencode"),
    ("oc/ling-2.6-1t-free", "opencode"),
    ("oc/nemotron-3-super-free", "opencode"),
    ("auto/best-free", "combo"),
    ("auto/coding:free", "combo"),
    ("auto/cheap", "combo"),
]

def test_model(model, provider):
    data = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Responde solo con: FUNCIONA"}],
        "max_tokens": 20
    }).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        result = json.loads(resp.read())
        content = result["choices"][0]["message"]["content"]
        print(f"  OK  {model:40s} | {content}")
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body)["error"]["message"][:80]
        except:
            err = body[:80]
        print(f"  FAIL {model:40s} | {err}")
        return False
    except Exception as e:
        print(f"  FAIL {model:40s} | {str(e)[:80]}")
        return False

print(f"=== Test de modelos GRATIS en OnmiRoute ===")
print(f"Endpoint: {BASE}/chat/completions\n")

working = []
for model, provider in models_to_test:
    if test_model(model, provider):
        working.append(model)

print(f"\n=== Modelos que funcionan ({len(working)}/{len(models_to_test)}) ===")
for m in working:
    print(f"  - {m}")
