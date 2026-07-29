import json, urllib.request, sys
from urllib.error import HTTPError

KEY = "sk-57b...9377"
BASE = "http://localhost:20128"

def api(path):
    req = urllib.request.Request(f"{BASE}{path}")
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        body = e.read().decode()[:1000]
        return {"error": f"HTTP {e.code}", "body": body}
    except Exception as e:
        return {"error": str(e)}

# Get all models
models = api("/v1/models")
data = models.get("data", models) if isinstance(models, dict) else models

# Group by provider prefix
from collections import defaultdict
by_prefix = defaultdict(list)
for m in data:
    mid = m.get("id","")
    prefix = mid.split("/")[0] if "/" in mid else "other"
    by_prefix[prefix].append(mid)

print("=== Modelos por proveedor ===")
for prefix, mids in sorted(by_prefix.items()):
    print(f"\n{prefix}/ ({len(mids)} modelos):")
    for mid in mids[:5]:
        print(f"  {mid}")
    if len(mids) > 5:
        print(f"  ... y {len(mids)-5} mas")

# Check health / status endpoint
status = api("/health")
print(f"\n=== Health ===")
print(json.dumps(status, indent=2)[:1000])
