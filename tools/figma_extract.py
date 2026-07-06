"""
Extract all frames from Figma using REST API with retry on rate limit.
"""
import json, urllib.request, time, base64, os

import os
TOKEN = os.getenv("FIGMA_TOKEN", "")
FILE_KEY = os.getenv("FIGMA_FILE_KEY", "UgSxrXuCd9YgioZl6eqsZU")
OUTPUT_DIR = r"D:\Programacion\caminosysabores\assets\figma"

os.makedirs(OUTPUT_DIR, exist_ok=True)

def api_get(url, retries=10):
    for i in range(retries):
        req = urllib.request.Request(url, headers={"X-Figma-Token": TOKEN})
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"Rate limited. Waiting 10s... (attempt {i+1}/{retries})")
                time.sleep(10)
            else:
                print(f"HTTP Error {e.code}: {e.read().decode()[:200]}")
                return None
        except Exception as e:
            print(f"Error: {e}")
            return None
    print("Max retries exceeded")
    return None

# Step 1: Get file structure
print("Getting file structure...")
data = api_get(f"https://api.figma.com/v1/files/{FILE_KEY}")
if not data:
    print("Failed to get file structure")
    exit(1)

doc = data.get('document', {})
print(f"Document: {doc.get('name')}")

# Collect all frame IDs
frames = []

def walk_nodes(node, parent_name=""):
    name = node.get('name', '')
    node_id = node.get('id', '')
    node_type = node.get('type', '')
    children = node.get('children', [])
    
    if node_type in ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET'] and node_id:
        bbox = node.get('absoluteBoundingBox', {})
        frames.append({
            'id': node_id,
            'name': name,
            'type': node_type,
            'parent': parent_name,
            'width': bbox.get('width', '?'),
            'height': bbox.get('height', '?')
        })
    
    for child in children:
        walk_nodes(child, name)

for canvas in doc.get('children', []):
    print(f"\nCanvas: {canvas.get('name')}")
    walk_nodes(canvas)
    for f in canvas.get('children', []):
        bbox = f.get('absoluteBoundingBox', {})
        print(f"  [{f.get('type')}] '{f.get('name')}' {bbox.get('width','?')}x{bbox.get('height','?')}  id={f.get('id')}")

# Save frame list
with open(os.path.join(OUTPUT_DIR, 'frames.json'), 'w') as f:
    json.dump(frames, f, indent=2)
print(f"\nFound {len(frames)} frames. Saved to frames.json")
