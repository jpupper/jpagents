// Register "Fuego Violeta" project in JP Agents DB
const BASE = 'http://localhost:3001';

async function main() {
  // 1. Get current sessions
  const res = await fetch(`${BASE}/api/sessions`);
  const data = await res.json();
  const projects = data.projects || [];
  const existingNames = projects.map(p => p.name);

  console.log('Proyectos actuales:', existingNames);

  if (existingNames.includes('Fuego Violeta')) {
    console.log('✅ Fuego Violeta ya está registrado.');
    return;
  }

  // 2. Add Fuego Violeta
  projects.push({
    id: 'proj-fuego-violeta-' + Date.now().toString(36),
    name: 'Fuego Violeta',
    folder: 'D:/Programacion/jpagents/proyects/fuego_violeta',
    model: 'deepseek-v4-flash',
    chats: []
  });

  // 3. Save back
  const saveRes = await fetch(`${BASE}/api/sessions/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects })
  });

  if (!saveRes.ok) {
    const errText = await saveRes.text();
    throw new Error(`Save failed: ${saveRes.status} ${errText}`);
  }

  const result = await saveRes.json();
  const finalNames = (result.projects || []).map(p => p.name);
  console.log('✅ Fuego Violeta registrado exitosamente.');
  console.log('Proyectos finales:', finalNames);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
