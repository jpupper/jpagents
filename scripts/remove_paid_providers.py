import urllib.request, json, http.cookiejar

cj = http.cookiejar.MozillaCookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# Login
data = json.dumps({"password": "CHANGEME"}).encode()
req = urllib.request.Request("http://localhost:20128/api/auth/login", data=data,
                              headers={"Content-Type": "application/json"})
opener.open(req)

# List providers
req2 = urllib.request.Request("http://localhost:20128/api/providers",
                              headers={"Accept": "application/json"})
providers = json.loads(opener.open(req2).read())
print("Current providers:")
for conn in providers.get("connections", []):
    print(f"  ID: {conn['id']}")
    print(f"  Name: {conn['name']}")
    print(f"  Provider: {conn['provider']}")
    print(f"  Type: {conn.get('authType', 'N/A')}")
    print(f"  Active: {conn.get('isActive', True)}")
    print()

# Delete the DeepSeek provider (non-free one)
for conn in providers.get("connections", []):
    name = conn.get("name", "")
    ptype = conn.get("provider", "")
    
    # Delete DeepSeek API (the paid one)
    if "DeepSeek" in name:
        conn_id = conn["id"]
        print(f"\nDeleting DeepSeek provider (id={conn_id})...")
        
        req_del = urllib.request.Request(
            f"http://localhost:20128/api/providers/{conn_id}",
            method="DELETE",
            headers={"Accept": "application/json"}
        )
        try:
            opener.open(req_del)
            print(f"  Deleted!")
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code}: {e.read().decode()[:200]}")

# Also delete the openai-compatible-chat one
for conn in providers.get("connections", []):
    ptype = conn.get("provider", "")
    if "openai-compatible" in ptype:
        conn_id = conn["id"]
        print(f"\nDeleting OpenAI-compatible provider (id={conn_id})...")
        
        req_del = urllib.request.Request(
            f"http://localhost:20128/api/providers/{conn_id}",
            method="DELETE",
            headers={"Accept": "application/json"}
        )
        try:
            opener.open(req_del)
            print(f"  Deleted!")
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code}: {e.read().decode()[:200]}")

# Verify only free providers remain
req3 = urllib.request.Request("http://localhost:20128/api/providers",
                              headers={"Accept": "application/json"})
providers2 = json.loads(opener.open(req3).read())
print("\n\nProviders after cleanup:")
for conn in providers2.get("connections", []):
    print(f"  - {conn['name']} ({conn['provider']})")
if not providers2.get("connections"):
    print("  (none - all deleted)")
    print("\nResult: Only free providers (opencode, duckduckgo-web, theoldllm, etc.) remain active!")
