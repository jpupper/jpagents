import json, sys
import urllib.request

import os
token = os.getenv("FIGMA_TOKEN", "")
file_key = os.getenv("FIGMA_FILE_KEY", "UgSxrXuCd9YgioZl6eqsZU")

url = f"https://api.figma.com/v1/files/{file_key}"
req = urllib.request.Request(url, headers={"X-Figma-Token": token})

try:
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    doc = data.get('document', {})
    print(f'Document: {doc.get("name", "?")}')
    print(f'Last modified: {data.get("lastModified", "?")}')
    for c in doc.get('children', [])[:5]:
        print(f'\nCANVAS: {c.get("name")} (id={c.get("id")})')
        for f in c.get('children', [])[:15]:
            sz = f.get('absoluteBoundingBox', {})
            print(f'  [{f.get("type")}] "{f.get("name")}" {sz.get("width","?")}x{sz.get("height","?")}')
except urllib.error.HTTPError as e:
    print(f'HTTP Error: {e.code} {e.reason}')
    print(e.read().decode()[:500])
except Exception as e:
    print(f'Error: {e}')
