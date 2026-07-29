import json, urllib.request

# Get the deepseek key from env
import os
# Read from the hermes .env
p = r'C:\Users\JPupper\.hermes\.env'
deepseek_key = None
with open(p, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith('DEEPSEEK_API_KEY=') and 'sk-' in line:
            deepseek_key = line.split('=', 1)[1].strip()
            print(f"Key: {deepseek_key[:8]}...{deepseek_key[-4:]}")
            break

if deepseek_key:
    # Test against DeepSeek API directly
    req = urllib.request.Request("https://api.deepseek.com/v1/models")
    req.add_header("Authorization", f"Bearer {deepseek_key}")
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        print(f"DeepSeek API works! Models: {len(data.get('data', []))}")
        for m in data.get('data', [])[:5]:
            print(f"  - {m['id']}")
    except Exception as e:
        print(f"DeepSeek API error: {e}")
        if hasattr(e, 'read'):
            print(e.read().decode()[:500])
else:
    print("No valid DeepSeek key found")
