import json, urllib.request, sys
from urllib.error import HTTPError

KEY = "sk-57b626f5532722be-9377"
BASE = "http://localhost:20128"

def api(path):
    req = urllib.request.Request(f"{BASE}{path}")
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body = e.read().decode()[:500]
        return {"error": f"HTTP {e.code}", "body": body}
    except Exception as e:
        return {"error": str(e)}

# 1. Get /v1/models
models = api("/v1/models")
print("=== /v1/models (catalog) ===")
if isinstance(models, list):
    free = [m for m in models if m.get("id","").startswith(("tllm/","oc/","ddgw/","aug/","auto/"))]
    print(f"Total models: {len(models)}, Free: {len(free)}")
    for m in free[:20]:
        print(f"  {m.get('id','?')} -> provider: {m.get('provider','?')}")
elif isinstance(models, dict):
    data = models.get("data", models)
    if isinstance(data, list):
        free = [m for m in data if m.get("id","").startswith(("tllm/","oc/","ddgw/","aug/","auto/"))]
        print(f"Total models: {len(data)}, Free: {len(free)}")
        for m in free[:20]:
            print(f"  {m.get('id','?')}")
    else:
        print(json.dumps(models, indent=2)[:2000])

# 2. Get providers via API
providers = api("/api/admin/providers")
print("\n=== /api/admin/providers ===")
if "error" in str(providers).lower():
    print(f"Error: {json.dumps(providers, indent=2)[:2000]}")

# 3. Try /api/providers
providers2 = api("/api/providers")
print("\n=== /api/providers ===")
if isinstance(providers2, list):
    for p in providers2[:10]:
        print(f"  {p.get('id','?')} - {p.get('name','?')} - connected: {p.get('connected','?')}")
elif isinstance(providers2, dict):
    print(json.dumps(providers2, indent=2)[:2000])
