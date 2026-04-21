import json
import os

with open('sessions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for p in data['projects']:
    if p['name'] == "Diploia":
        # Let's try the D: path
        d_path = r"D:\Programacion\sistemasfullscreen\diploia"
        if os.path.exists(d_path):
            p['folder'] = d_path
            p['isCorrupted'] = False

with open('sessions.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
