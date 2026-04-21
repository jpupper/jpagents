import json

with open('sessions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# The ones to keep
keep_names = ["Diploia", "ddd"]

new_projects = [p for p in data['projects'] if p['name'] in keep_names]

# If nothing left, we might need at least one, but user asked to delete them.
# The user said Artedigitaldata, testsite, JPagents are corrupted.

data['projects'] = new_projects
if len(new_projects) > 0:
    data['activeProjectId'] = new_projects[0]['id']
else:
    data['activeProjectId'] = None

with open('sessions.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
